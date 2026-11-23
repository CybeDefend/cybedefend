'use strict';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  resourceFromAttributes,
  defaultResource,
} from '@opentelemetry/resources';
import { NodeSDK, NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import {
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';
import {
  Attributes,
  Context,
  diag,
  DiagLogger,
  DiagLogLevel,
  Span,
} from '@opentelemetry/api';
import {
  SpanProcessor,
  ReadableSpan,
  BatchSpanProcessor,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { inspect } from 'node:util';
import { matchedRouteOf } from './core/http/route-tracing';
import { redactUrlSecrets } from './core/utils/redact-url-secrets.util';

// This module is preloaded (`node --require ./dist/instrumentation.js`, see
// instrumentation.ts) before anything the SDK instruments. Keep its imports to
// the OTel packages and to modules that import nothing at runtime.

const SERVICE_NAME = 'gateway-service';

// Custom SpanProcessor to filter out RpcException errors from other microservices
class RpcExceptionFilterProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onStart(span: any, parentContext: any): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    // Check if the span has an exception event
    const events = span.events;
    if (events && events.length > 0) {
      // Filter out RpcException events
      const filteredEvents = events.filter((event) => {
        if (event.name === 'exception') {
          const exceptionType = event.attributes?.['exception.type'];
          const exceptionStacktrace =
            event.attributes?.['exception.stacktrace'];

          // Check if this is an RpcException by looking at the stacktrace
          // RpcExceptions from other microservices will have @nestjs/microservices in their stack
          const isFromMicroservice =
            typeof exceptionStacktrace === 'string' &&
            (exceptionStacktrace.includes('RpcException') ||
              exceptionStacktrace.includes(
                '@nestjs/microservices/context/rpc-proxy',
              ) ||
              exceptionStacktrace.includes(
                '@nestjs/microservices/server/server-grpc',
              ) ||
              exceptionStacktrace.includes('safeGrpcCall'));

          // If it's a microservice error (RpcException or passed through gRPC), filter it out
          if (
            exceptionType === 'RpcException' ||
            (exceptionType === 'Error' && isFromMicroservice)
          ) {
            return false; // Filter out this exception event
          }
        }
        return true; // Keep other events
      });

      // Modify span events if needed
      if (filteredEvents.length < events.length) {
        (span as any).events = filteredEvents;
      }
    }

    this.delegate.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}

/** URL attributes of the http and undici instrumentations (server and client). */
const URL_ATTRIBUTES = ['http.url', 'http.target', 'url.full', 'url.path'];
/**
 * The end user's address (X-Forwarded-For) and the raw query string, which
 * carries personal data on some routes (`/sso/...?email=`, `search=`).
 */
const DROPPED_ATTRIBUTES = ['http.client_ip', 'client.address', 'url.query'];

/** Removes what an HTTP span must not export; leaves other spans untouched. */
export function redactHttpAttributes(attributes: Attributes): void {
  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === 'string') {
      // Up to the query string, then mask the secrets a path can carry
      // (POST /webhooks/jira/:token).
      attributes[key] = redactUrlSecrets(value.split(/[?#]/, 1)[0]);
    }
  }
  for (const key of DROPPED_ATTRIBUTES) {
    delete attributes[key];
  }
}

class HttpAttributeRedactor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onStart(span: Span & ReadableSpan, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    redactHttpAttributes(span.attributes);
    this.delegate.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}

/**
 * The processor chain every span goes through. The batch processor reads
 * OTEL_BSP_MAX_QUEUE_SIZE and OTEL_BSP_MAX_EXPORT_BATCH_SIZE from the
 * environment (SDK defaults: 2048 and 512).
 */
export function buildSpanProcessor(exporter: SpanExporter): SpanProcessor {
  return new RpcExceptionFilterProcessor(
    new HttpAttributeRedactor(new BatchSpanProcessor(exporter)),
  );
}

async function loadIngestToken(): Promise<string | undefined> {
  // Loaded on demand: a closed extension may pull in an HTTP client and its
  // stack, none of which belongs in a preload.
  const { fetchOtelIngestToken } =
    await import('./core/logger/otel-token-fetcher');
  return fetchOtelIngestToken();
}

/**
 * Exporter headers, resolved on the first export rather than before the SDK
 * starts: the SDK must start synchronously, ahead of every other module, and
 * the gateway must never wait on the secret store to boot. The token is read
 * once: when the secret store fails, spans go out without it.
 */
export function ingestTokenHeaders(
  load: () => Promise<string | undefined> = loadIngestToken,
): () => Promise<Record<string, string>> {
  let token: Promise<string | undefined> | undefined;
  return async () => {
    token ??= load().catch(() => undefined);
    const value = await token;
    return value ? { Authorization: `Bearer ${value}` } : {};
  };
}

/**
 * The kubelet probes `GET /` every 5 s (readiness) and 10 s (liveness): many
 * spans with nothing to measure. Only that exact request is ignored (method,
 * path, agent). The
 * User-Agent is the caller's to choose: matched on any other request, a
 * `kube-probe/` agent would hide its own AuthGuard and PermissionsGuard spans
 * from authentication monitoring.
 */
export function isHealthProbe(request: IncomingMessage): boolean {
  const userAgent = request.headers['user-agent'];
  return (
    request.method === 'GET' &&
    request.url === '/' &&
    typeof userAgent === 'string' &&
    userAgent.startsWith('kube-probe/')
  );
}

/** Gives an HTTP server span the route Fastify matched, and its name. */
export function nameServerSpanAfterRoute(
  span: Span,
  request: ClientRequest | IncomingMessage,
): void {
  const route = matchedRouteOf(request);
  if (!route) return;
  span.setAttribute(ATTR_HTTP_ROUTE, route);
  span.updateName(`${request.method ?? 'GET'} ${route}`);
}

export function buildInstrumentations(
  deploymentEnvironment: string = process.env.OTEL_APP_ENV || 'development',
): ReturnType<typeof getNodeAutoInstrumentations> {
  return [
    ...getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: isHealthProbe,
        applyCustomAttributesOnSpan: nameServerSpanAfterRoute,
      },
      // Command name only: the default serializer keeps the key, and the
      // rate-limit keys carry the caller's IP or user id.
      '@opentelemetry/instrumentation-ioredis': {
        dbStatementSerializer: (command) => command,
      },
      // Two spans per request around the handler and its guards, on top of
      // the @Span() most controllers already have: the guards would no longer
      // be children of the HTTP server span, which already times the route.
      '@opentelemetry/instrumentation-nestjs-core': { enabled: false },
      // One span per socket and per lookup, none of them per request.
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      // Registered below with the gateway's log hook.
      '@opentelemetry/instrumentation-pino': { enabled: false },
    }),
    new PinoInstrumentation({
      // pino-opentelemetry-transport already ships the logs (with the ingest
      // token); sending them through the SDK as well would duplicate each line.
      disableLogSending: true,
      logHook: (span, record) => {
        record['service.name'] = SERVICE_NAME;
        record['deployment.environment'] = deploymentEnvironment;
      },
    }),
  ];
}

interface DiagnosticsSink {
  warn(message: string): void;
  error(message: string): void;
}

// The console until the Nest logger exists (routeSdkDiagnostics).
let diagnosticsSink: DiagnosticsSink = console;

const formatDiagnostic = (message: string, args: unknown[]): string =>
  [
    `[otel] ${message}`,
    ...args.map((arg) =>
      typeof arg === 'string' ? arg : inspect(arg, { breakLength: Infinity }),
    ),
  ].join(' ');

const sdkDiagnostics: DiagLogger = {
  error: (message, ...args) =>
    diagnosticsSink.error(formatDiagnostic(message, args)),
  warn: (message, ...args) =>
    diagnosticsSink.warn(formatDiagnostic(message, args)),
  info: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
};

/**
 * Without a diag logger the SDK loses spans in silence: a full queue
 * ("Dropped N spans because maxQueueSize reached") and a failed export are
 * both reported through it. OTEL_LOG_LEVEL, when set, still wins (NodeSDK
 * installs its console logger after this one).
 */
export function installSdkDiagnostics(): void {
  diag.setLogger(sdkDiagnostics, {
    logLevel: DiagLogLevel.WARN,
    suppressOverrideMessage: true,
  });
}

/** Sends the SDK's warnings to the service logger, which reaches the OTLP backend. */
export function routeSdkDiagnostics(sink: DiagnosticsSink): void {
  diagnosticsSink = sink;
}

/**
 * What the SDK exports: spans, and nothing else. Left unset, NodeSDK builds an
 * OTLP metric reader and an OTLP log pipeline from the environment, both
 * without the ingest token: the collector answered 401 to the metrics every
 * 60 s, which the diag logger would now report as one ERROR per minute and
 * per pod. Logs already go through pino-opentelemetry-transport.
 */
export function sdkOptions(
  traceExporter: SpanExporter,
): Partial<NodeSDKConfiguration> {
  return {
    spanProcessors: [buildSpanProcessor(traceExporter)],
    metricReaders: [],
    logRecordProcessors: [],
  };
}

// Lightweight wrapper that avoids auto-start and never forces process exit
let sdk: NodeSDK | null = null;
let started = false;

function createSdk(): NodeSDK {
  const deploymentEnvironment = process.env.OTEL_APP_ENV || 'development';

  // Derive traces endpoint from base OTLP endpoint
  const baseEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const traceExporter = new OTLPTraceExporter({
    url: `${baseEndpoint}/v1/traces`,
    headers: ingestTokenHeaders(),
  });

  return new NodeSDK({
    ...sdkOptions(traceExporter),
    instrumentations: buildInstrumentations(deploymentEnvironment),
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        'deployment.environment': deploymentEnvironment,
      }),
    ),
  });
}

const tracer = {
  /** Synchronous: the SDK only instruments modules loaded after it starts. */
  start(): void {
    if (started) return;
    started = true;
    // If disabled, no-op
    if (process.env.OTEL_DISABLED === 'true') return;
    installSdkDiagnostics();
    sdk = createSdk();
    sdk.start();
  },
  routeDiagnostics(sink: DiagnosticsSink): void {
    routeSdkDiagnostics(sink);
  },
  async shutdown(): Promise<void> {
    if (sdk) {
      try {
        await sdk.shutdown();
        console.log('OpenTelemetry SDK shut down successfully');
      } catch (error) {
        console.log('Error shutting down OpenTelemetry SDK', error);
      } finally {
        sdk = null;
        started = false;
      }
    }
  },
};

export default tracer;
