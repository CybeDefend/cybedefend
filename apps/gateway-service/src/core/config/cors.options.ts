import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * The slice of the environment the CORS policy is built from. Structural, so
 * `process.env` satisfies it directly and a test can hand it a literal.
 */
export interface CorsEnv {
  /** Comma-separated list of dashboard origins allowed to call the API. */
  FRONTEND_URL?: string;
}

/** `CorsOptions` narrowed to the shape this gateway actually emits. */
export interface GatewayCorsOptions extends CorsOptions {
  origin: string[];
  credentials: true;
  allowedHeaders: string[];
  exposedHeaders: string[];
  methods: string[];
}

/** Used when `FRONTEND_URL` is not set — the local dashboard dev server. */
const DEFAULT_ORIGINS = ['http://localhost:3002'];

/**
 * Headers a browser is allowed to send on a cross-origin request.
 *
 * `Last-Event-ID` is NOT optional: `@microsoft/fetch-event-source`
 * adds it to every SSE reconnection as soon as the stream has delivered one
 * event carrying an `id`, and the gateway's very first frame carries one
 * (`realtime-stream.factory.ts`). Without it here, the preflight of every
 * reconnection is rejected by the browser, the dashboard burns its retry
 * budget on a `TypeError` it can do nothing about, and the page's realtime
 * stream dies silently. `Cache-Control` rides along for the same reason: SSE clients
 * routinely send `Cache-Control: no-cache` to defeat intermediary caching.
 *
 * Kept as an explicit allow-list — never `*`, which the spec would anyway
 * ignore on a credentialed request.
 */
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'Last-Event-ID',
  'Cache-Control',
];

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * Response headers a cross-origin page may read, beyond the CORS-safelisted
 * ones: what the rate limiter sets (`throttler.guard.ts`). The limit counts
 * every request of a user, the dashboard's and its MCP agents' alike, and
 * blocks them all for 60 to 900 s once passed; reading `X-RateLimit-Remaining`
 * lets the dashboard slow its polls before that, and `Retry-After` tells it
 * how long a block lasts. An explicit list, never `*`.
 */
const EXPOSED_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
];

/**
 * Build the gateway's CORS policy.
 *
 * Extracted from `main.ts` so the policy is unit-testable and so a change to
 * it shows up in a diff as a change to a tested module rather than a line
 * inside `bootstrap()`.
 *
 * `origin` stays an explicit allow-list sourced from `FRONTEND_URL`: the API
 * answers with `credentials: true`, so reflecting the request `Origin` would
 * be equivalent to letting any site read authenticated responses.
 */
export function buildCorsOptions(env: CorsEnv): GatewayCorsOptions {
  return {
    origin: env.FRONTEND_URL?.split(',') || DEFAULT_ORIGINS,
    credentials: true,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    methods: ALLOWED_METHODS,
  };
}
