import { HttpException, HttpStatus } from '@nestjs/common';

/** Minimal logger surface — satisfied by `nestjs-pino`'s `Logger`. */
export interface UpstreamErrorLogger {
  error(message: string): void;
}

/**
 * Statuses that describe THE CALLER'S REQUEST and are therefore worth
 * forwarding: only the upstream knows which one applies, and the caller can
 * act on each of them.
 *
 * Deliberately excludes 401 and 403. Those describe an authentication or
 * authorization decision, and by the time we call an upstream the caller has
 * already cleared `CombinedAuthRateLimitGuard` + `PermissionsGuard` — so an
 * upstream 401/403 is about the GATEWAY's own credentials, never the
 * caller's. Forwarding one is both uninformative and harmful: the dashboard's
 * axios interceptor treats any 401 as a broken session and clears auth state
 * (`gatewayAPI.ts`), so an ingestion-side auth misconfiguration would log
 * users out, and a 403 on a mutation surfaces the misleading "free trial
 * quota is exhausted" toast. The ingestion rules
 * modules only ever raise 400/404/409/503 in application code, so a 401/403
 * from there is by definition an infrastructure fault — i.e. a 502.
 */
const CALLER_ACTIONABLE_STATUSES = new Set([400, 404, 409, 413, 422, 429]);

/** A day: ingestion's longest cooldown (on-demand re-mining) is 24 h. */
export const MAX_RETRY_AFTER_SECONDS = 86_400;

/**
 * A `Retry-After` worth sending to a client: a whole number of seconds in
 * `1..MAX_RETRY_AFTER_SECONDS`, given as a number or as a string of digits.
 * Anything else (an HTTP date, a fraction, a negative or oversized value)
 * is `undefined`, and the header is dropped rather than guessed.
 */
export function retryAfterSeconds(value: unknown): number | undefined {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^\s*\d{1,6}\s*$/.test(value)) {
    n = Number(value.trim());
  } else {
    return undefined;
  }
  return Number.isInteger(n) && n >= 1 && n <= MAX_RETRY_AFTER_SECONDS
    ? n
    : undefined;
}

type UpstreamHeaders =
  | Record<string, unknown>
  | { get?: (name: string) => unknown };

/** Reads `Retry-After` from axios response headers (plain or `AxiosHeaders`). */
function upstreamRetryAfter(headers: UpstreamHeaders | undefined): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    return (getter as (name: string) => unknown).call(headers, 'retry-after');
  }
  const plain = headers as Record<string, unknown>;
  return plain['retry-after'] ?? plain['Retry-After'];
}

/**
 * Translate a failed upstream HTTP call (an axios rejection from one of the
 * gateway's REST-proxy modules) into the `HttpException` the client sees.
 *
 * The rule is: **a status about the caller's request belongs to the caller;
 * everything else belongs to us.**
 *
 * - {@link CALLER_ACTIONABLE_STATUSES} → forwarded verbatim. A 404 means the
 *   resource genuinely is not there, a 409 means the caller collided with an
 *   existing row, a 422 means the body was wrong.
 * - anything else (401/403, 5xx, or no response at all — `ECONNREFUSED`,
 *   timeouts) → `502 Bad Gateway`, which is what actually happened: we could
 *   not get a valid answer out of the upstream service.
 *
 * Why this exists: the closed rules proxies each rewrote
 * *every* failure to 502. `PATCH /{closed-rules-proxy}/{ruleId}` with an id that did
 * not exist therefore reached MCP clients as `UNAVAILABLE / statusText 502`,
 * identical to a genuine outage — operators reasonably concluded the endpoint
 * was down and stopped using it, when ingestion had been answering a clean
 * 404 the whole time. Collapsing the status destroyed the only signal that
 * distinguished "you passed a bad id" from "the service is broken".
 *
 * The upstream `detail` string is preserved as the message, as before. It is
 * safe to forward: these routes sit behind `PermissionsGuard`, so the caller
 * already holds access to the project the message can describe.
 *
 * On a forwarded 429, the upstream `Retry-After` (e.g. the seconds left in
 * ingestion's 24 h re-mining cooldown) travels as `retryAfter` in the
 * exception body, the shape the gateway's own rate-limit guards throw, and
 * `GlobalExceptionFilter` turns it into the response header. Only a valid
 * value ({@link retryAfterSeconds}) is kept, and no other upstream header is
 * ever forwarded.
 */
export function throwUpstreamHttpError(
  err: unknown,
  context: string,
  logger: UpstreamErrorLogger,
): never {
  const e = err as {
    response?: {
      status?: number;
      data?: { detail?: string } | string;
      headers?: UpstreamHeaders;
    };
    message?: string;
  };
  const detail =
    typeof e?.response?.data === 'string'
      ? e.response.data
      : e?.response?.data?.detail || e?.message || 'unknown error';
  const upstreamStatus = e?.response?.status;
  const status =
    typeof upstreamStatus === 'number' &&
    CALLER_ACTIONABLE_STATUSES.has(upstreamStatus)
      ? upstreamStatus
      : HttpStatus.BAD_GATEWAY;

  logger.error(
    `${context}: ${detail}` +
      (typeof upstreamStatus === 'number'
        ? ` (upstream=${upstreamStatus}, surfaced=${status})`
        : ` (surfaced=${status})`),
  );
  if (status === HttpStatus.TOO_MANY_REQUESTS) {
    const retryAfter = retryAfterSeconds(
      upstreamRetryAfter(e?.response?.headers),
    );
    if (retryAfter !== undefined) {
      throw new HttpException({ message: detail, retryAfter }, status);
    }
  }
  throw new HttpException(detail, status);
}
