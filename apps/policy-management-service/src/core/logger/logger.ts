import Pino, { Logger, LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';
import { LOGGED_ERROR_LOGGER_OPTIONS } from './logged-error';

export { createHttpLoggerOptions } from './logged-error';

/**
 * Creates Pino logger options with OpenTelemetry integration.
 * Configures log transport to both console (pino-pretty) and OTLP exporter.
 *
 * @param opts - Optional configuration including OTEL ingest token
 * @returns Pino LoggerOptions configuration object
 */
export function createLoggerOptions(opts?: {
  otelIngestToken?: string;
}): LoggerOptions {
  const otelDisabled = process.env.OTEL_DISABLED === 'true';
  const deploymentEnvironment = process.env.OTEL_APP_ENV || 'development';

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

  if (!otelDisabled) {
    targets.unshift({
      target: 'pino-opentelemetry-transport',
      options: {
        resourceAttributes: {
          'service.name': 'policy-management-service',
          'deployment.environment': deploymentEnvironment,
        },
        logRecordProcessorOptions: {
          recordProcessorType: 'batch',
          scheduledDelayMillis: 1000,
          maxExportBatchSize: 100,
          maxQueueSize: 2048,
          exportTimeoutMillis: 30000,
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
    timestamp: () => `,"time":${Date.now()}`,
    transport: {
      targets,
    },
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
    // Errors under any key, and the line's message, are logged without
    // a statement, its parameters or a value an engine's message quotes.
    ...LOGGED_ERROR_LOGGER_OPTIONS,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'req.headers["x-api-token"]',
        'req.headers["api-key"]',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'res.headers.authorization',
        'req.body.password',
        'req.body.secret',
        'req.body.token',
        'req.body.apiKey',
        'req.body.api_key',
        'req.query.password',
        'req.query.token',
        'req.query.api_key',
        'req.query.apiKey',
      ],
      censor: '[REDACTED]',
    },
  };
}

export const logger: Logger = Pino(createLoggerOptions());
