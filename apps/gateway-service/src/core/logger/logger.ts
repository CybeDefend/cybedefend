import Pino, { Logger, LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';
import { redactUrlSecrets } from '../utils/redact-url-secrets.util';

export function createLoggerOptions(opts?: {
  otelIngestToken?: string;
}): LoggerOptions {
  const otelDisabled = process.env.OTEL_DISABLED === 'true';
  const deploymentEnvironment = process.env.OTEL_APP_ENV || 'development';

  // Derive logs endpoint from base OTLP endpoint
  const baseEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  const logsEndpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || `${baseEndpoint}/v1/logs`;

  const ingestToken = opts?.otelIngestToken || process.env.OTEL_INGEST_TOKEN;

  const targets: any[] = [
    {
      target: 'pino-pretty',
      level: 'info',
      options: {
        colorize: true,
        ignore:
          'pid,hostname,context,req,res,responseTime,trace_id,span_id,trace_flags',
        messageFormat:
          '{pid} - url:{req.url} - traceId:{trace_id} - spanId:{span_id} {msg}',
      },
    },
  ];

  // Only add OTLP transport if not disabled
  if (!otelDisabled) {
    targets.unshift({
      target: 'pino-opentelemetry-transport',
      options: {
        resourceAttributes: {
          'service.name': 'gateway-service',
          'deployment.environment': deploymentEnvironment,
        },
        logRecordProcessorOptions: {
          recordProcessorType: 'batch',
          // Batch processor options optimized for the OTLP backend's store (avoid "too many partitions" error)
          scheduledDelayMillis: 1000, // Send logs very frequently to reduce timestamp variance
          maxExportBatchSize: 100, // Very small batches to minimize partition spread
          maxQueueSize: 2048, // Prevent accumulation of old logs
          exportTimeoutMillis: 30000, // Avoid logs being blocked indefinitely
          exporterOptions: {
            protocol: 'http/protobuf',
            protobufExporterOptions: {
              url: logsEndpoint,
              ...(ingestToken && {
                headers: {
                  Authorization: `Bearer ${ingestToken}`,
                },
              }),
            },
          },
        },
      },
    });
  }

  return {
    level: 'info',
    // Force real-time timestamp for each log to avoid partition issues in ClickHouse
    timestamp: () => `,"time":${Date.now()}`,
    transport: {
      targets,
    },
    // Mixin to inject OpenTelemetry trace context into every log
    mixin() {
      const activeContext = context.active();
      const span = trace.getSpan(activeContext);
      if (span) {
        const spanContext = span.spanContext();
        return {
          trace_id: spanContext.traceId,
          span_id: spanContext.spanId,
          trace_flags: spanContext.traceFlags,
        };
      }
      return {};
    },
    // Redact sensitive information from logs
    redact: {
      paths: [
        // Redact authorization headers (Bearer tokens, etc.)
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["proxy-authorization"]',
        // Secrets carried in non-standard headers. GlobalExceptionFilter logs the
        // whole failed request, so any error on the route would ship these
        // verbatim (a webhook secret must never reach the log backend). Hyphenated
        // names need bracket notation. HMAC signature headers (x-hub-signature-256,
        // stripe-signature, logto-signature-sha-256) stay visible on purpose: they
        // cannot be reversed into the secret, and they are what you need to debug
        // a signature mismatch.
        'req.headers["x-gitlab-token"]',
        // Deprecated: answered 410 by DeprecatedApiKeyMiddleware, but legacy
        // clients still send real key material in it.
        'req.headers["x-api-key"]',
        // Redact response headers that might contain tokens
        'res.headers["set-cookie"]',
        'res.headers.authorization',
        // Redact common password/secret fields in body
        'req.body.password',
        // The Community password change sends both passwords.
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.secret',
        // Every one-time token of the Community sign-in: reset and invitation
        // (POST /auth/invitations/accept) use `token`, the first setup
        // `setupToken`.
        'req.body.token',
        'req.body.setupToken',
        // Redact query params that might be sensitive
        'req.query.password',
        'req.query.token',
        // The URL is kept readable: censor() masks only the secrets its path can
        // carry (the Jira webhook secret, POST /webhooks/jira/:token). Redaction,
        // not a `serializers.req`, because pino-http binds `req` with its own
        // serializer, which would shadow one set here.
        'req.url',
      ],
      censor,
    },
  };
}

function censor(value: unknown, path: string[]): unknown {
  if (path.join('.') === 'req.url') {
    return typeof value === 'string' ? redactUrlSecrets(value) : value;
  }
  return '[REDACTED]';
}

// Default logger for initial bootstrap (without token)
export const logger: Logger = Pino(createLoggerOptions());
