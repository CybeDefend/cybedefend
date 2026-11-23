/**
 * gRPC interceptor to propagate OpenTelemetry trace context
 * Injects trace headers into gRPC metadata for distributed tracing
 */

import { Injectable } from '@nestjs/common';
import { trace, context, propagation } from '@opentelemetry/api';
import type { Metadata } from '@grpc/grpc-js';

@Injectable()
export class GrpcTracePropagationInterceptor {
  /**
   * Intercept outgoing gRPC calls to inject trace context into metadata
   */
  intercept(metadata: Metadata): Metadata {
    const activeContext = context.active();
    const span = trace.getSpan(activeContext);

    if (span) {
      // Use W3C Trace Context propagation (traceparent header)
      const carrier: Record<string, string> = {};
      propagation.inject(activeContext, carrier);

      // Inject all propagated headers into gRPC metadata
      Object.entries(carrier).forEach(([key, value]) => {
        metadata.set(key, value);
      });
    }

    return metadata;
  }
}

/**
 * Helper function to create metadata with trace context for gRPC calls
 * Usage: const metadata = createTracedMetadata();
 */
export function createTracedMetadata(): Metadata {
  const { Metadata } = require('@grpc/grpc-js');
  const metadata = new Metadata();

  const activeContext = context.active();
  const carrier: Record<string, string> = {};
  propagation.inject(activeContext, carrier);

  Object.entries(carrier).forEach(([key, value]) => {
    metadata.set(key, value);
  });

  return metadata;
}
