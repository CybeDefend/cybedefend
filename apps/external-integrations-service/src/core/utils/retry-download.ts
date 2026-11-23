import * as fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  SCAN_FAILURE_SOURCE_FETCH_FAILED,
  SCAN_FAILURE_SOURCE_RATE_LIMITED,
} from '../constants/scan-failure-codes';

/**
 * Connect/headers timeout handed to every attempt. With `responseType:
 * 'stream'` axios applies it until the response headers arrive, which is what
 * we want: the body transfer itself is unbounded (repositories are large).
 */
export const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Total attempts, the first one included, before the download is given up. */
export const ARCHIVE_DOWNLOAD_MAX_ATTEMPTS = 3;

/** Wait after attempt N when the failing response carried no timing header. */
const BACKOFF_MS = [2_000, 4_000];

/** Longest wait between two attempts, whatever the provider asked for. */
const MAX_WAIT_MS = 60_000;

/**
 * The logging surface this helper needs. Both `nestjs-pino`'s Logger and
 * `@nestjs/common`'s satisfy it, so either service can pass its own.
 */
export type ArchiveDownloadLogger = {
  warn(message: string): void;
};

/** The subset of an HTTP response this helper consumes. */
export interface StreamingHttpResponse {
  data: NodeJS.ReadableStream;
}

export interface DownloadArchiveWithRetryOptions {
  /**
   * Performs one download attempt and resolves with the streaming response.
   * Receives the timeout (ms) the request must apply to its headers phase.
   */
  attempt: (timeoutMs: number) => Promise<StreamingHttpResponse>;
  /** Absolute path the response body is streamed to. */
  outputPath: string;
  /** Provider name used in log and error messages — never a credentialed URL. */
  label: string;
  logger?: ArchiveDownloadLogger;
  /** Defaults to {@link ARCHIVE_DOWNLOAD_MAX_ATTEMPTS}. */
  maxAttempts?: number;
}

/**
 * Terminal failure of an archive download. `code` is the scan-failure code the
 * caller reports on the scan (see `core/constants/scan-failure-codes`), so a
 * rate limit is distinguishable from any other fetch failure in the dashboard.
 *
 * The message is deliberately curated (never the underlying exception text):
 * it ends up in the scan's user-visible `errorMessage`.
 */
export class ArchiveDownloadError extends Error {
  readonly code: number;
  readonly attempts: number;
  readonly httpStatus?: number;

  constructor(
    message: string,
    code: number,
    attempts: number,
    httpStatus?: number,
  ) {
    super(message);
    this.name = 'ArchiveDownloadError';
    this.code = code;
    this.attempts = attempts;
    this.httpStatus = httpStatus;
  }
}

/** Axios codes for "the request gave up before the headers arrived". */
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

/** What one failed attempt tells us about whether (and when) to try again. */
export interface AttemptFailure {
  retryable: boolean;
  rateLimited: boolean;
  httpStatus?: number;
  headers: Record<string, string>;
  /** Curated, user-safe reason — no exception text, no URL, no token. */
  reason: string;
}

/** Lower-cases header names and flattens the value shapes axios can return. */
function normalizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      normalized[key.toLowerCase()] = String(value);
    } else if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = String(value[0]);
    }
  }
  return normalized;
}

/** `Retry-After` as milliseconds — delta-seconds or an HTTP-date. */
function retryAfterMs(
  raw: string | undefined,
  now: number,
): number | undefined {
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }
  const deadline = Date.parse(raw);
  return Number.isNaN(deadline) ? undefined : Math.max(0, deadline - now);
}

/** `x-ratelimit-reset` (epoch seconds) as a positive delay, when still ahead. */
function rateLimitResetMs(
  raw: string | undefined,
  now: number,
): number | undefined {
  if (!raw) {
    return undefined;
  }
  const epochSeconds = Number(raw.trim());
  if (!Number.isFinite(epochSeconds)) {
    return undefined;
  }
  const delay = epochSeconds * 1000 - now;
  return delay > 0 ? delay : undefined;
}

/**
 * How long to wait before the attempt following `attemptNumber`:
 * `Retry-After` when present, else — for a rate limit only — the
 * `x-ratelimit-reset` delta, else the 2s/4s exponential backoff — capped at
 * {@link MAX_WAIT_MS}.
 *
 * `x-ratelimit-reset` is deliberately gated on `rateLimited`: GitHub sends its
 * rate-limit headers on EVERY response, so a plain 5xx would otherwise wait
 * for a reset window up to 60 minutes out (i.e. the 60 s cap, twice) instead
 * of retrying promptly.
 */
export function computeRetryDelayMs(
  failure: Pick<AttemptFailure, 'headers' | 'rateLimited'>,
  attemptNumber: number,
  now: number = Date.now(),
): number {
  const normalized = normalizeHeaders(failure.headers);
  const requested =
    retryAfterMs(normalized['retry-after'], now) ??
    (failure.rateLimited
      ? rateLimitResetMs(normalized['x-ratelimit-reset'], now)
      : undefined);

  const backoffIndex =
    Math.min(Math.max(attemptNumber, 1), BACKOFF_MS.length) - 1;

  return Math.min(requested ?? BACKOFF_MS[backoffIndex], MAX_WAIT_MS);
}

/** True when axios gave up on the request before any response arrived. */
function isTimeoutError(error: unknown): boolean {
  const candidate = error as
    | { isAxiosError?: unknown; code?: unknown }
    | null
    | undefined;
  return (
    candidate?.isAxiosError === true &&
    typeof candidate.code === 'string' &&
    TIMEOUT_CODES.has(candidate.code)
  );
}

/**
 * Classify a failed attempt, and release the socket of a failed streaming
 * response: axios hands the body back as a stream even on 4xx/5xx and nothing
 * else would ever consume it.
 */
function classifyFailure(error: unknown): AttemptFailure {
  const response = (
    error as
      | { response?: { status?: unknown; headers?: unknown; data?: unknown } }
      | null
      | undefined
  )?.response;

  const body = response?.data as { destroy?: () => void } | undefined;
  if (body && typeof body.destroy === 'function') {
    body.destroy();
  }

  const httpStatus =
    typeof response?.status === 'number' ? response.status : undefined;
  const headers = normalizeHeaders(response?.headers);

  if (httpStatus === undefined) {
    // No response at all. A headers-phase timeout deserves another attempt:
    // a rate-limited provider, and codeload on a large monorepo, are exactly
    // what make the 30 s headers budget expire. Any other transport error is
    // terminal — retrying it only delays the scan's failure report.
    const timedOut = isTimeoutError(error);
    return {
      retryable: timedOut,
      rateLimited: false,
      headers,
      reason: timedOut ? 'request timed out' : 'network error',
    };
  }

  const rateLimited =
    httpStatus === 429 ||
    (httpStatus === 403 &&
      (headers['x-ratelimit-remaining'] === '0' ||
        headers['retry-after'] !== undefined));

  if (rateLimited) {
    return {
      retryable: true,
      rateLimited: true,
      httpStatus,
      headers,
      reason: `rate limit exceeded (HTTP ${httpStatus})`,
    };
  }

  return {
    retryable: httpStatus >= 500 && httpStatus <= 599,
    rateLimited: false,
    httpStatus,
    headers,
    reason: `HTTP ${httpStatus}`,
  };
}

/** Exception text is safe to log, never to surface — logs only. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download an archive to `outputPath`, retrying the provider's rate limits.
 *
 * Retried: HTTP 429, HTTP 403 carrying `x-ratelimit-remaining: 0` or a
 * `retry-after` header, and any 5xx. Everything else (404, plain 403, a
 * transport error, a write failure) fails on the first attempt — retrying it
 * would only delay the scan's failure report.
 *
 * On the final failure it throws an {@link ArchiveDownloadError} carrying the
 * scan-failure code the caller reports on the scan.
 */
export async function downloadArchiveWithRetry(
  options: DownloadArchiveWithRetryOptions,
): Promise<void> {
  const {
    attempt,
    outputPath,
    label,
    logger,
    maxAttempts = ARCHIVE_DOWNLOAD_MAX_ATTEMPTS,
  } = options;

  let lastFailure: AttemptFailure | undefined;
  let attemptsMade = 0;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    attemptsMade = attemptNumber;
    try {
      const response = await attempt(ARCHIVE_DOWNLOAD_TIMEOUT_MS);
      await pipeline(response.data, fs.createWriteStream(outputPath));
      return;
    } catch (error: unknown) {
      const failure = classifyFailure(error);
      lastFailure = failure;

      logger?.warn(
        `${label} archive download attempt ${attemptNumber}/${maxAttempts} failed (${failure.reason}): ${errorText(error)}`,
      );

      if (!failure.retryable || attemptNumber >= maxAttempts) {
        break;
      }

      const waitMs = computeRetryDelayMs(failure, attemptNumber);
      logger?.warn(
        `${label} archive download retrying in ${Math.ceil(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
    }
  }

  const reason = lastFailure?.reason ?? 'unknown error';
  throw new ArchiveDownloadError(
    `${label} archive download failed after ${attemptsMade} attempt${
      attemptsMade > 1 ? 's' : ''
    }: ${reason}`,
    lastFailure?.rateLimited
      ? SCAN_FAILURE_SOURCE_RATE_LIMITED
      : SCAN_FAILURE_SOURCE_FETCH_FAILED,
    attemptsMade,
    lastFailure?.httpStatus,
  );
}
