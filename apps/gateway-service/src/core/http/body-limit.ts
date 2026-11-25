import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
} from 'fastify';
import { trustedProxyCidrsFromEnv } from '../trust-proxy/trust-proxy';

const MIB = 1024 * 1024;

/**
 * The largest request body the gateway reads on a route that sets no limit
 * of its own: 1 MiB.
 *
 * Fastify reads and parses a JSON body before any guard runs, on the event
 * loop every other request shares. A large limit there lets an anonymous
 * client stall the whole API with a single body. No JSON route needs more
 * than this. The webhook routes set their own, larger limit. The upload
 * routes take multipart only (`registerUploadRoutesMultipartOnly` below),
 * whose parts are bounded by the multipart limits, not by this one.
 */
export const GATEWAY_BODY_LIMIT_BYTES = MIB;

/** The highest value `GATEWAY_BODY_LIMIT_BYTES` may be tuned to. */
export const GATEWAY_BODY_LIMIT_MAX_BYTES = 16 * MIB;

/**
 * The routes that receive a large multipart upload: the results import and
 * the results a scanner pod sends. Matched on Fastify's route template.
 */
export const UPLOAD_ROUTES: ReadonlyArray<{ method: string; url: string }> = [
  { method: 'POST', url: '/project/:projectId/scan/import/start' },
  { method: 'POST', url: '/scan-runs/:scanId/results' },
];

/**
 * The global body limit, from the optional `GATEWAY_BODY_LIMIT_BYTES`: a
 * whole number of bytes between 1 and 16 MiB. Anything else is ignored and
 * the default applies.
 */
export function gatewayBodyLimitFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.GATEWAY_BODY_LIMIT_BYTES?.trim();
  if (!raw || !/^\d+$/.test(raw)) return GATEWAY_BODY_LIMIT_BYTES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    return GATEWAY_BODY_LIMIT_BYTES;
  if (value > GATEWAY_BODY_LIMIT_MAX_BYTES) return GATEWAY_BODY_LIMIT_BYTES;
  return value;
}

/** The options main.ts gives the gateway's Fastify adapter. */
export function gatewayAdapterOptions(env: NodeJS.ProcessEnv): {
  trustProxy: string[] | false;
  bodyLimit: number;
} {
  return {
    // Honor X-Forwarded-For only when the upstream hop sits inside
    // `TRUSTED_PROXY_CIDRS` (the only name read). Without this, the
    // rate-limit guards would either see the proxy IP for every caller
    // (over-aggregating) or, with an unconditional `trustProxy: true`,
    // take a client-supplied X-Forwarded-For as the throttler bucket key.
    trustProxy: trustedProxyCidrsFromEnv(env),
    bodyLimit: gatewayBodyLimitFromEnv(env),
  };
}

/** True when the request declares a multipart/form-data body. */
function isMultipart(request: FastifyRequest): boolean {
  const type = request.headers['content-type'];
  return (
    typeof type === 'string' &&
    /^multipart\/form-data(\s*;|$)/i.test(type.trim())
  );
}

/**
 * The upload routes take a multipart body and nothing else. Their files are
 * read by the multipart plugin within its own limits, which do not depend on
 * the route's body limit. Any other content type is refused with 415 in
 * `onRequest`, before a parser reads a byte: a JSON or text body is never
 * parsed on these routes, whatever its size. The routes keep the global body
 * limit.
 *
 * An `onRoute` hook is the only place a route option can be set from outside
 * the route definition, so it must be added before `app.init()` declares the
 * routes.
 */
export function registerUploadRoutesMultipartOnly(
  fastify: FastifyInstance,
): void {
  const refuseOtherTypes = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    if (isMultipart(request)) return;
    await reply.code(415).header('Connection', 'close').send({
      statusCode: 415,
      error: 'Unsupported Media Type',
      code: 'IMPORT_INVALID_REQUEST',
      message: 'The body must be multipart/form-data.',
    });
  };
  fastify.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const isUpload = UPLOAD_ROUTES.some(
      (upload) => upload.url === route.url && methods.includes(upload.method),
    );
    if (!isUpload) return;
    const existing = route.onRequest
      ? Array.isArray(route.onRequest)
        ? route.onRequest
        : [route.onRequest]
      : [];
    route.onRequest = [refuseOtherTypes, ...existing];
  });
}
