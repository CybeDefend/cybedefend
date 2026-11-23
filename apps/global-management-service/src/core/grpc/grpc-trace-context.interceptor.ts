// src/core/grpc/grpc-trace-context.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { context, propagation, trace } from '@opentelemetry/api';
import { Metadata } from '@grpc/grpc-js';

/**
 * gRPC server interceptor that extracts OpenTelemetry trace context from incoming metadata
 * and sets it as the active context for the request handler.
 *
 * This enables distributed tracing across microservices by continuing traces
 * initiated in upstream services.
 *
 * Apply this interceptor globally in main.ts:
 * ```typescript
 * app.useGlobalInterceptors(new GrpcTraceContextInterceptor());
 * ```
 */
@Injectable()
export class GrpcTraceContextInterceptor implements NestInterceptor {
  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const contextType = executionContext.getType();

    // Only process gRPC requests
    if (contextType !== 'rpc') {
      return next.handle();
    }

    try {
      // Get metadata from gRPC context
      const metadata = executionContext.getArgByIndex<Metadata>(1);

      if (metadata) {
        // Convert gRPC Metadata to carrier object for propagation.extract()
        const carrier: Record<string, string> = {};
        metadata.getMap();

        // Extract all metadata entries
        const metadataMap = metadata.getMap();
        Object.entries(metadataMap).forEach(([key, value]) => {
          carrier[key] = Array.isArray(value)
            ? value[0]?.toString()
            : value?.toString();
        });

        // Extract trace context from carrier
        const extractedContext = propagation.extract(context.active(), carrier);

        // Run the handler in the extracted context
        return context.with(extractedContext, () => next.handle());
      }
    } catch (error) {
      console.error(
        'Failed to extract trace context from gRPC metadata:',
        error,
      );
    }

    // Fallback: run without extracted context
    return next.handle();
  }
}
