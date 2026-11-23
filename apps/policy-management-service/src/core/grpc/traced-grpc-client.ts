// src/core/grpc/traced-grpc-client.ts
import { Observable } from "rxjs";
import { context, propagation, trace } from "@opentelemetry/api";
import { Metadata } from "@grpc/grpc-js";

/**
 * Create gRPC metadata with OpenTelemetry trace context propagation
 */
function createTracedMetadata(): Metadata {
  const metadata = new Metadata();
  const activeContext = context.active();
  const span = trace.getSpan(activeContext);

  if (!span) {
    return metadata; // No active span, return empty metadata
  }

  const carrier: Record<string, string> = {};

  // Inject trace context using W3C Trace Context propagator
  propagation.inject(activeContext, carrier);

  // Add all propagated headers to gRPC metadata
  Object.entries(carrier).forEach(([key, value]) => {
    metadata.set(key, value);
  });

  return metadata;
}

/**
 * Wraps a gRPC client to automatically inject OpenTelemetry trace context
 * into all method calls via metadata.
 *
 * This enables distributed tracing across microservices without modifying
 * every gRPC call site.
 *
 * @param client - The gRPC client instance to wrap
 * @returns A proxy that intercepts all method calls and injects trace metadata
 *
 * @example
 * ```typescript
 * // In your service's onModuleInit:
 * this.someServiceClient = wrapGrpcClientWithTracing(
 *   this.client.getService<SomeServiceClient>(SOME_SERVICE_NAME)
 * );
 * ```
 */
export function wrapGrpcClientWithTracing<T extends Record<string, any>>(
  client: T,
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);

      // Only wrap function properties (gRPC methods)
      if (typeof original !== "function") {
        return original;
      }

      // Return a wrapped function that injects trace metadata
      return function (this: any, ...args: any[]) {
        const metadata = createTracedMetadata();

        // gRPC methods signature: method(request, metadata?)
        // Always pass metadata as second argument
        return (original as Function).call(this, args[0], metadata);
      };
    },
  });
}
