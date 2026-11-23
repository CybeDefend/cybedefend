import Pino, { Logger, LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';

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
          'service.name': 'mcp-service',
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
