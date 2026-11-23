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
} from '@opentelemetry/sdk-trace-base';

/**
 * Custom SpanProcessor to filter out RpcException errors from other microservices.
 * This prevents noise in traces from expected gRPC errors.
 */
class RpcExceptionFilterProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  onStart(span: any, parentContext: any): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const events = span.events;
    if (events && events.length > 0) {
      const filteredEvents = events.filter((event: any) => {
        if (event.name === 'exception') {
          const exceptionStacktrace =
            event.attributes?.['exception.stacktrace'];
          const isFromMicroservice =
            typeof exceptionStacktrace === 'string' &&
            (exceptionStacktrace.includes('RpcException') ||
              exceptionStacktrace.includes(
                '@nestjs/microservices/context/rpc-proxy',
              ) ||
              exceptionStacktrace.includes('handleError'));

          if (isFromMicroservice) {
            return false;
          }
        }
        return true;
      });

      (span as any).events = filteredEvents;
    }

    this.delegate.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}

const serviceName = 'policy-management-service';

/**
 * What the SDK exports: spans, through the processor chain built in start(),
 * and nothing else. Left unset, NodeSDK builds an OTLP metric reader and an
 * OTLP log pipeline from the environment, both without the ingest token: the
 * collector answers 401 to the metrics every 60 s.
 */
export function sdkOptions(
  spanProcessor: SpanProcessor,
): Partial<NodeSDKConfiguration> {
  return {
    spanProcessors: [spanProcessor],
    metricReaders: [],
    logRecordProcessors: [],
  };
}

const otelDisabled = process.env.OTEL_DISABLED === 'true';

/**
 * OpenTelemetry tracer configuration for the Policy Management Service.
 * Provides distributed tracing capabilities across microservices.
 */
const tracer = {
  sdk: null as NodeSDK | null,

  async start(): Promise<void> {
    if (otelDisabled) {
      console.log('OpenTelemetry is disabled via OTEL_DISABLED=true');
      return;
    }

    try {
      const otelToken = await fetchOtelIngestToken();

      const otelExporterEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      if (!otelExporterEndpoint) {
        console.warn(
          'OTEL_EXPORTER_OTLP_ENDPOINT not set, OpenTelemetry disabled',
        );
        return;
      }

      const exporter = new OTLPTraceExporter({
        url: otelExporterEndpoint,
        headers: otelToken ? { Authorization: `Bearer ${otelToken}` } : {},
      });

      const batchProcessor = new BatchSpanProcessor(exporter);
      const filteringProcessor = new RpcExceptionFilterProcessor(
        batchProcessor,
      );

      const resource = defaultResource().merge(
        resourceFromAttributes({
          [ATTR_SERVICE_NAME]: serviceName,
        }),
      );

      this.sdk = new NodeSDK({
        resource,
        ...sdkOptions(filteringProcessor),
        instrumentations: [
          getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': { enabled: false },
            '@opentelemetry/instrumentation-http': { enabled: true },
            '@opentelemetry/instrumentation-grpc': { enabled: true },
          }),
          new PinoInstrumentation(),
        ],
      });

      this.sdk.start();
      console.log(`OpenTelemetry initialized for ${serviceName}`);
    } catch (error) {
      console.error('Failed to initialize OpenTelemetry:', error);
    }
  },

  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
      console.log('OpenTelemetry shut down');
    }
  },
};

export default tracer;
