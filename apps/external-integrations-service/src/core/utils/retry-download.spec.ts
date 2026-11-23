import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  ARCHIVE_DOWNLOAD_TIMEOUT_MS,
  ArchiveDownloadError,
  computeRetryDelayMs,
  downloadArchiveWithRetry,
} from './retry-download';
import {
  SCAN_FAILURE_SOURCE_FETCH_FAILED,
  SCAN_FAILURE_SOURCE_RATE_LIMITED,
} from '../constants/scan-failure-codes';

/**
 * Build an axios-shaped rejection: `error.response.{status,headers,data}` with
 * `data` a stream, exactly as axios reports a failed `responseType: 'stream'`
 * request.
 */
function httpError(
  httpStatus: number,
  headers: Record<string, string> = {},
): Error {
  const error = new Error(`Request failed with status code ${httpStatus}`);
  Object.assign(error, {
    isAxiosError: true,
    response: {
      status: httpStatus,
      headers,
      data: Readable.from([]),
    },
  });
  return error;
}

/**
 * Build an axios timeout rejection: the headers phase expired, so there is no
 * `response` at all — only `code`.
 */
function timeoutError(code: 'ECONNABORTED' | 'ETIMEDOUT'): Error {
  return Object.assign(new Error('timeout of 30000ms exceeded'), {
    isAxiosError: true,
    code,
  });
}

/** Build a successful streaming response carrying `body`. */
function okResponse(body = 'PKfake-zip') {
  return { status: 200, headers: {}, data: Readable.from([Buffer.from(body)]) };
}

describe('computeRetryDelayMs', () => {
  const now = 1_700_000_000_000;

  it('honours a numeric Retry-After header (seconds)', () => {
    expect(
      computeRetryDelayMs(
        { headers: { 'retry-after': '3' }, rateLimited: true },
        1,
        now,
      ),
    ).toBe(3_000);
  });

  it('honours a Retry-After HTTP-date', () => {
    const when = new Date(now + 7_000).toUTCString();
    // toUTCString drops sub-second precision, so allow the rounding slack.
    expect(
      computeRetryDelayMs(
        { headers: { 'retry-after': when }, rateLimited: true },
        1,
        now,
      ),
    ).toBeLessThanOrEqual(7_000);
    expect(
      computeRetryDelayMs(
        { headers: { 'retry-after': when }, rateLimited: true },
        1,
        now,
      ),
    ).toBeGreaterThan(6_000);
  });

  it('falls back to the x-ratelimit-reset delta when there is no Retry-After', () => {
    const resetEpochSeconds = Math.floor(now / 1000) + 12;
    expect(
      computeRetryDelayMs(
        {
          headers: { 'x-ratelimit-reset': String(resetEpochSeconds) },
          rateLimited: true,
        },
        1,
        now,
      ),
    ).toBe(12_000);
  });

  it('falls back to the 2s/4s exponential backoff when no rate-limit header is present', () => {
    expect(
      computeRetryDelayMs({ headers: {}, rateLimited: true }, 1, now),
    ).toBe(2_000);
    expect(
      computeRetryDelayMs({ headers: {}, rateLimited: true }, 2, now),
    ).toBe(4_000);
  });

  it('ignores an x-ratelimit-reset already in the past', () => {
    const resetEpochSeconds = Math.floor(now / 1000) - 30;
    expect(
      computeRetryDelayMs(
        {
          headers: { 'x-ratelimit-reset': String(resetEpochSeconds) },
          rateLimited: true,
        },
        1,
        now,
      ),
    ).toBe(2_000);
  });

  it('ignores x-ratelimit-reset when the failure is not a rate limit', () => {
    const resetEpochSeconds = Math.floor(now / 1000) + 20 * 60;
    expect(
      computeRetryDelayMs(
        {
          headers: { 'x-ratelimit-reset': String(resetEpochSeconds) },
          rateLimited: false,
        },
        1,
        now,
      ),
    ).toBe(2_000);
  });

  it('caps the wait at 60 seconds', () => {
    expect(
      computeRetryDelayMs(
        { headers: { 'retry-after': '3600' }, rateLimited: true },
        1,
        now,
      ),
    ).toBe(60_000);
  });

  it('reads headers case-insensitively', () => {
    expect(
      computeRetryDelayMs(
        { headers: { 'Retry-After': '5' }, rateLimited: true },
        1,
        now,
      ),
    ).toBe(5_000);
  });
});

describe('downloadArchiveWithRetry', () => {
  let tmpDir: string;
  let outputPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-download-'));
    outputPath = path.join(tmpDir, 'archive.zip');
    // `nextTick`/`queueMicrotask`/`setImmediate` stay real so the fs write
    // streams below still complete; only the retry sleeps are virtualized.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the archive on the first attempt and never retries', async () => {
    const attempt = jest.fn().mockResolvedValue(okResponse('hello-zip'));

    await downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' });

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith(ARCHIVE_DOWNLOAD_TIMEOUT_MS);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('hello-zip');
  });

  it('retries a 429 exactly once after the Retry-After delay, then succeeds', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(httpError(429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(okResponse('retried-zip'));

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
    });

    // Still waiting one millisecond before the Retry-After deadline.
    await jest.advanceTimersByTimeAsync(2_999);
    expect(attempt).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await promise;

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('retried-zip');
  });

  it('gives up after three rate-limited attempts and throws code 67', async () => {
    const attempt = jest.fn().mockRejectedValue(httpError(429));

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
    });
    const assertion =
      expect(promise).rejects.toBeInstanceOf(ArchiveDownloadError);

    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;
    await promise.catch((error: ArchiveDownloadError) => {
      expect(error.code).toBe(SCAN_FAILURE_SOURCE_RATE_LIMITED);
      expect(error.code).toBe(67);
      expect(error.message).toContain('rate limit');
      expect(error.attempts).toBe(3);
    });

    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('waits 2s then 4s when the rate-limit response carries no timing header', async () => {
    const attempt = jest.fn().mockRejectedValue(httpError(429));

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
    });
    const assertion =
      expect(promise).rejects.toBeInstanceOf(ArchiveDownloadError);

    await jest.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(3_999);
    expect(attempt).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(3);

    await assertion;
  });

  it('gives up after three 5xx attempts and throws code 66', async () => {
    const attempt = jest.fn().mockRejectedValue(httpError(500));

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitLab',
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_FETCH_FAILED,
      attempts: 3,
    });

    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(attempt).toHaveBeenCalledTimes(3);
    expect(SCAN_FAILURE_SOURCE_FETCH_FAILED).toBe(66);
  });

  it('retries a 403 that carries rate-limit headers and reports it as rate limited', async () => {
    // Pin the clock to a whole second so the reset delta is exactly 5 000 ms.
    jest.setSystemTime(1_700_000_000_000);
    const resetEpochSeconds = 1_700_000_000 + 5;
    const attempt = jest.fn().mockRejectedValue(
      httpError(403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetEpochSeconds),
      }),
    );

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_RATE_LIMITED,
    });

    await jest.advanceTimersByTimeAsync(4_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('does not retry a plain 403 (no rate-limit markers) and throws code 66', async () => {
    const attempt = jest.fn().mockRejectedValue(httpError(403));

    await expect(
      downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' }),
    ).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_FETCH_FAILED,
      attempts: 1,
    });

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 404 and throws code 66', async () => {
    const attempt = jest.fn().mockRejectedValue(httpError(404));

    await expect(
      downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' }),
    ).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_FETCH_FAILED,
      attempts: 1,
    });

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not leak the underlying exception text into the thrown message', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443'));

    await expect(
      downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' }),
    ).rejects.toMatchObject({ code: SCAN_FAILURE_SOURCE_FETCH_FAILED });

    await expect(
      downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' }),
    ).rejects.toThrow(/^GitHub archive download failed after 1 attempt/);

    await expect(
      downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' }),
    ).rejects.not.toThrow(/ECONNREFUSED/);
  });

  it('destroys the error response stream so the socket is released', async () => {
    const error = httpError(404);
    const destroy = jest.spyOn(
      (error as unknown as { response: { data: Readable } }).response.data,
      'destroy',
    );
    const attempt = jest.fn().mockRejectedValue(error);

    await expect(
      downloadArchiveWithRetry({ attempt, outputPath, label: 'GitHub' }),
    ).rejects.toBeInstanceOf(ArchiveDownloadError);

    expect(destroy).toHaveBeenCalled();
  });

  it('retries a headers-phase timeout and succeeds on the next attempt', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(timeoutError('ECONNABORTED'))
      .mockResolvedValueOnce(okResponse('after-timeout'));

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
    });

    await jest.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await promise;

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('after-timeout');
  });

  it('gives up after three timeouts and reports code 66', async () => {
    const attempt = jest.fn().mockRejectedValue(timeoutError('ETIMEDOUT'));

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitLab',
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_FETCH_FAILED,
      attempts: 3,
    });

    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('keeps the 2s/4s backoff on a 5xx carrying a far-future x-ratelimit-reset', async () => {
    // GitHub sends its rate-limit headers on EVERY response, so a plain 500
    // must not be made to wait for the rate-limit window to reset.
    jest.setSystemTime(1_700_000_000_000);
    const twentyMinutesOut = String(1_700_000_000 + 20 * 60);
    const attempt = jest
      .fn()
      .mockRejectedValue(
        httpError(500, { 'x-ratelimit-reset': twentyMinutesOut }),
      );

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_FETCH_FAILED,
      attempts: 3,
    });

    await jest.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(3_999);
    expect(attempt).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(3);

    await assertion;
  });

  it('logs every failed attempt through the provided logger', async () => {
    const logger = { log: jest.fn(), warn: jest.fn() };
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(httpError(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(okResponse());

    const promise = downloadArchiveWithRetry({
      attempt,
      outputPath,
      label: 'GitHub',
      logger,
    });
    await jest.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GitHub archive download attempt 1/3 failed'),
    );
  });
});
