import type { Provider } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, RouteOptions } from 'fastify';

/** Every provider webhook route is declared under this path. */
export const WEBHOOK_ROUTE_PREFIX = '/webhooks/';

/**
 * The largest gRPC message external-integrations accepts: the default
 * receive limit of a grpc-js server, which that service does not raise.
 */
export const WEBHOOK_RELAY_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * The largest webhook body the gateway relays. The relayed message carries
 * the body plus a few values read from the request line and headers (event,
 * signature or token, path secret), which Node bounds at 16 KiB together, so
 * 64 KiB of room keeps every relayed message under the receiver's limit.
 */
export const WEBHOOK_MAX_BODY_BYTES =
  WEBHOOK_RELAY_MAX_MESSAGE_BYTES - 64 * 1024;

/**
 * Caps the body Fastify reads on the provider webhook routes.
 *
 * Those routes are public, and the gateway relays the body to
 * external-integrations over gRPC before the signature is checked there. A
 * body larger than the receiver's message limit was read in full (up to the
 * gateway's global 50 MB), relayed, and refused by gRPC with
 * RESOURCE_EXHAUSTED, which the gateway answers as 429 "Too Many Requests":
 * a provider retries that, and the answer named the internal limit. Fastify
 * enforces a per-route `bodyLimit` inside the content-type parser, so the
 * refusal is now a 413 decided on the declared length, or after the first
 * bytes over the cap of a body that declared none, and nothing is relayed.
 *
 * An `onRoute` hook is the only place a route option can be set from outside
 * the route definition. It must be added before `app.init()` declares the
 * routes, which WEBHOOK_BODY_CAP_PROVIDER does when Nest instantiates the
 * module's providers.
 */
export function registerWebhookBodyCap(fastify: FastifyInstance): void {
  fastify.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (
      route.url.startsWith(WEBHOOK_ROUTE_PREFIX) &&
      methods.includes('POST')
    ) {
      route.bodyLimit = WEBHOOK_MAX_BODY_BYTES;
    }
  });
}

/**
 * Registers the cap on the application's Fastify instance at instantiation.
 * A context without an HTTP server (a testing module, an application
 * context) declares no route, so there is nothing to cap: it answers false.
 */
export const WEBHOOK_BODY_CAP_PROVIDER: Provider = {
  provide: 'WEBHOOK_BODY_CAP_REGISTERED',
  inject: [HttpAdapterHost],
  useFactory: (host: HttpAdapterHost) => {
    const fastify = host?.httpAdapter?.getInstance?.() as
      | FastifyInstance
      | undefined;
    if (!fastify) return false;
    registerWebhookBodyCap(fastify);
    return true;
  },
};
