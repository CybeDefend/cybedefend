'use strict';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  resourceFromAttributes,
  defaultResource,
} from '@opentelemetry/resources';
import { NodeSDK, NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { fetchOtelIngestToken } from './core/logger/otel-token-fetcher';
import {
  SpanProcessor,
  ReadableSpan,
  BatchSpanProcessor,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  Context,
  diag,
  DiagLogger,
  DiagLogLevel,
  Span,
  SpanKind,
} from '@opentelemetry/api';
import type { IncomingMessage } from 'node:http';
import { inspect } from 'node:util';

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
      const filteredEvents = events.filter((event: any) => {
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

/** Name the grpc instrumentation gives the server span of a health check. */
export const GRPC_HEALTH_CHECK_SPAN = 'grpc.grpc.health.v1.Health/Check';

/** At most one health-check span is exported per process in this window. */
export const HEALTH_CHECK_HEARTBEAT_MS = 60_000;

/**
 * Thins out the server span of grpc.health.v1.Health/Check. Envoy and the
 * kubelet probe every instance with it, many times a minute, which would make
 * it most of a service's server spans. One a minute is kept: a heartbeat that
 * shows the service is alive. Only that span: Permify's Permission/Check, the
 * same method name on another service, is never held back.
 */
class GrpcHealthCheckFilter implements SpanProcessor {
  // End time (ms) of the last health check exported by this process.
  private lastHeartbeatMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly delegate: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onStart(span: Span & ReadableSpan, parentContext: Context): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (span.kind === SpanKind.SERVER && span.name === GRPC_HEALTH_CHECK_SPAN) {
      const endedMs = span.endTime[0] * 1_000 + span.endTime[1] / 1e6;
      if (endedMs - this.lastHeartbeatMs < HEALTH_CHECK_HEARTBEAT_MS) return;
      this.lastHeartbeatMs = endedMs;
    }
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
    new GrpcHealthCheckFilter(new BatchSpanProcessor(exporter)),
  );
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
 * The kubelet probes GET /health on every instance, which would be most of
 * this service's spans, with nothing to measure. Only that exact request is
 * ignored (method, path, agent). The User-Agent is the caller's to choose: matched on any other
 * request, a `kube-probe/` agent would hide its own AuthGuard spans.
 */
export function isHealthProbe(request: IncomingMessage): boolean {
  const userAgent = request.headers['user-agent'];
  return (
    request.method === 'GET' &&
    request.url === '/health' &&
    typeof userAgent === 'string' &&
    userAgent.startsWith('kube-probe/')
  );
}

/** At most one kubelet probe is traced per process in this window. */
export const PROBE_HEARTBEAT_MS = 60_000;

/**
 * `ignoreIncomingRequestHook`: ignores the exact kubelet probe but one a
 * minute. mcp-service serves no gRPC health check, so while no client calls it
 * that probe is its only span: without it, monitoring that waits for spans
 * would read the service as silent. One span a minute instead of one per probe
 * (readiness every 5 s, liveness every 10 s). Any other request is always traced
 * (isHealthProbe stays exact).
 */
export function probeHeartbeatFilter(
  now: () => number = () => Date.now(),
): (request: IncomingMessage) => boolean {
  let lastTracedMs = Number.NEGATIVE_INFINITY;
  return (request) => {
    if (!isHealthProbe(request)) return false;
    const at = now();
    if (at - lastTracedMs < PROBE_HEARTBEAT_MS) return true;
    lastTracedMs = at;
    return false;
  };
}

export function buildInstrumentations(
  deploymentEnvironment: string = process.env.OTEL_APP_ENV || 'development',
): ReturnType<typeof getNodeAutoInstrumentations> {
  return [
    ...getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: probeHeartbeatFilter(),
      },
    }),
    new PinoInstrumentation({
      logHook: (span, record) => {
        record['service.name'] = 'mcp-service';
        record['deployment.environment'] = deploymentEnvironment;
      },
    }),
  ];
}

/**
 * What the SDK exports: spans, and nothing else. Left unset, NodeSDK builds an
 * OTLP metric reader and an OTLP log pipeline from the environment, both
 * without the ingest token: the collector answered 401 to the metrics every
 * 60 s, which the diag logger would now report as one ERROR per minute and
 * per pod. Logs already go through pino-opentelemetry-transport.
 */
export function sdkOptions(
  traceExporter: SpanExporter | undefined,
): Partial<NodeSDKConfiguration> {
  return {
    spanProcessors: traceExporter
      ? [buildSpanProcessor(traceExporter)]
      : undefined,
    metricReaders: [],
    logRecordProcessors: [],
  };
}

// Lightweight wrapper that avoids auto-start and never forces process exit
let sdk: NodeSDK | null = null;
let started = false;

async function createSdk(): Promise<NodeSDK> {
  const otelDisabled = process.env.OTEL_DISABLED === 'true';
  const serviceName = 'mcp-service';
  const deploymentEnvironment = process.env.OTEL_APP_ENV || 'development';

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      'deployment.environment': deploymentEnvironment,
    }),
  );

  // Derive traces endpoint from base OTLP endpoint
  const baseEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  const endpoint = `${baseEndpoint}/v1/traces`;

  // Fetch token from the secret store or env variable
  const ingestToken = await fetchOtelIngestToken();

  const traceExporter = !otelDisabled
    ? new OTLPTraceExporter({
        url: endpoint,
        headers: ingestToken
          ? {
              Authorization: `Bearer ${ingestToken}`,
            }
          : undefined,
      })
    : undefined;

  return new NodeSDK({
    ...sdkOptions(traceExporter),
    instrumentations: buildInstrumentations(deploymentEnvironment),
    resource,
  });
}

const tracer = {
  async start(): Promise<void> {
    if (started) return;
    // If disabled, no-op
    if (process.env.OTEL_DISABLED === 'true') {
      started = true;
      return;
    }
    installSdkDiagnostics();
    if (!sdk) sdk = await createSdk();
    await sdk.start();
    started = true;
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
