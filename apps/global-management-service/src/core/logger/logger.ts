import Pino, { Logger, LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';
import {
  framesOf,
  isDriverError,
  safeDriverFields,
} from '../exception/driver-error';

/**
 * Serializes an error bound for the logs. A database driver error keeps its
 * class, its identifier-like fields and its stack frames only: its message,
 * parameters, statement and detail can quote the values of the statement (a
 * password hash, a token digest, an e-mail address, a whole user text).
 * Nest's RPC exception handler logs every unexpected error whole, as `err`;
 * a service may also pass one as the context argument.
 */
export function serializeLoggedError(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isDriverError(value as Record<string, unknown>)) {
    return {
      type: value.constructor?.name ?? 'Error',
      ...safeDriverFields(value as Record<string, unknown>),
      stack: framesOf(value as Error),
    };
  }
  return value instanceof Error ? Pino.stdSerializers.err(value) : value;
}

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
          'service.name': 'global-management-service',
          'deployment.environment': deploymentEnvironment,
        },
        logRecordProcessorOptions: {
          recordProcessorType: 'batch',
          // Batch processor options optimized for the OTLP backend's ClickHouse (avoid "too many partitions" error)
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
    serializers: {
      err: serializeLoggedError,
      context: serializeLoggedError,
    },
    // Redact sensitive information from logs
    redact: {
      paths: [
        // Redact authorization headers (Bearer tokens, API keys, etc.)
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'req.headers["x-api-token"]',
        'req.headers["api-key"]',
        'req.headers.cookie',
        // Redact response headers that might contain tokens
        'res.headers["set-cookie"]',
        'res.headers.authorization',
        // Redact common password/secret fields in body
        'req.body.password',
        'req.body.secret',
        'req.body.token',
        'req.body.apiKey',
        'req.body.api_key',
        // Redact query params that might be sensitive
        'req.query.password',
        'req.query.token',
        'req.query.api_key',
        'req.query.apiKey',
      ],
      censor: '[REDACTED]',
    },
  };
}

// Default logger for initial bootstrap (without token)
export const logger: Logger = Pino(createLoggerOptions());
