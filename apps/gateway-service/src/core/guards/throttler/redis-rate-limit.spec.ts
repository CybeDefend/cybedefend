import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import {
  DEGRADED_WARN_INTERVAL_MS,
  enforceRateLimit,
  InProcessBlocks,
  InProcessFixedWindow,
  RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT,
  rateLimitRedisTimeoutMs,
  resetRateLimitFallback,
  violationsFor,
} from './redis-rate-limit';
import { RATE_LIMIT_HIT_COMMAND } from './rate-limit-bucket';
import { GATEWAY_REDIS_COMMAND_TIMEOUT_MS } from '../../redis/gateway-redis-client';

/**
 * A client whose bucket script (rate-limit-bucket.ts, one round-trip)
 * answers with `reply`: a reply array of the script, a
 * rejection, or a promise that never settles.
 */
const scriptRedis = (
  reply: Promise<unknown> | (() => Promise<unknown>),
  status?: string,
) => {
  const hit = jest.fn(typeof reply === 'function' ? reply : () => reply);
  return { status, [RATE_LIMIT_HIT_COMMAND]: hit, hit };
};
const never = () => new Promise<never>(() => undefined);
const closed = () => Promise.reject(new Error('Connection is closed.'));

describe('InProcessFixedWindow (the rate limit used while Redis is down)', () => {
  it('counts the hits of one key within its window', () => {
    const windows = new InProcessFixedWindow(10);

    expect(windows.hit('k', 60, 0)).toEqual({ count: 1, resetInSeconds: 60 });
    expect(windows.hit('k', 60, 15_000)).toEqual({
      count: 2,
      resetInSeconds: 45,
    });
  });

  it('starts a fresh window once the previous one is over', () => {
    const windows = new InProcessFixedWindow(10);
    windows.hit('k', 60, 0);
    windows.hit('k', 60, 1_000);

    expect(windows.hit('k', 60, 60_000)).toEqual({
      count: 1,
      resetInSeconds: 60,
    });
  });

  it('never holds more buckets than its bound', () => {
    const windows = new InProcessFixedWindow(100);
    for (let i = 0; i < 1_000; i++) windows.hit(`ip:${i}`, 60, i);

    expect(windows.size).toBe(100);
  });

  it('evicts expired buckets before live ones', () => {
    const windows = new InProcessFixedWindow(3);
    windows.hit('expired-1', 60, 0);
    windows.hit('expired-2', 60, 1_000);
    windows.hit('live', 60, 30_000);
    windows.hit('live', 60, 30_000);

    windows.hit('new', 60, 61_500);

    expect(windows.size).toBe(2);
    // 'live' kept its count: its window (30 s -> 90 s) is still running.
    expect(windows.hit('live', 60, 62_000).count).toBe(3);
  });
});

describe('InProcessBlocks (the escalating block used while Redis is down)', () => {
  it('blocks for 60 s, doubling on each violation up to 900 s', () => {
    const blocks = new InProcessBlocks(10);

    expect(blocks.remainingSeconds('k', 0)).toBe(0);
    expect(blocks.block('k', 0)).toBe(60);
    expect(blocks.remainingSeconds('k', 0)).toBe(60);
    expect(blocks.remainingSeconds('k', 59_001)).toBe(1);
    expect(blocks.remainingSeconds('k', 60_000)).toBe(0);
    expect(
      [60, 180, 420, 900, 1800].map((s) => blocks.block('k', s * 1000)),
    ).toEqual([120, 240, 480, 900, 900]);
  });

  it('never holds more entries than its bound', () => {
    const blocks = new InProcessBlocks(100);
    for (let i = 0; i < 1_000; i++) blocks.block(`ip:${i}`, i);

    expect(blocks.size).toBe(100);
  });

  it('evicts entries whose block and escalation are both over first', () => {
    const blocks = new InProcessBlocks(3);
    blocks.block('stale-1', 0);
    blocks.block('stale-2', 1_000);
    blocks.block('live', 3_000_000);

    blocks.block('new', 3_601_500);

    expect(blocks.size).toBe(2);
    // 'live' kept its escalation: its hour (3000 s -> 6600 s) is running.
    expect(blocks.block('live', 3_700_000)).toBe(120);
  });

  it('does not take a running block for a stale entry once its escalation hour is over', () => {
    const blocks = new InProcessBlocks(3);
    blocks.block('stale', 0);
    for (const s of [0, 60, 180, 420, 900, 3000]) {
      blocks.block('long', s * 1000);
    }
    // 6th violation at 3000 s: blocked for 900 s, until 3900 s, although
    // its escalation hour ends at 3600 s.
    blocks.block('live', 3_000_000);

    blocks.block('new', 3_700_000);

    expect(blocks.size).toBe(3);
    expect(blocks.remainingSeconds('long', 3_700_000)).toBe(200);
  });

  it('holds a block Redis decided and carries on from its escalation', () => {
    const blocks = new InProcessBlocks(10);

    blocks.hold('k', 240, 0, 3);
    expect(blocks.remainingSeconds('k', 0)).toBe(240);
    expect(blocks.block('k', 240_000)).toBe(480);
  });

  it('never shortens a running block nor lowers the escalation when holding', () => {
    const blocks = new InProcessBlocks(10);
    for (const s of [0, 60, 180, 420, 900, 3000]) blocks.block('k', s * 1000);

    // Escalation hour over at 3600 s, block running until 3900 s.
    blocks.hold('k', 10, 3_700_000);
    expect(blocks.remainingSeconds('k', 3_700_000)).toBe(200);

    blocks.hold('j', 900, 0, 5);
    blocks.hold('j', 30, 1_000);
    expect(blocks.remainingSeconds('j', 1_000)).toBe(899);
    expect(blocks.block('j', 900_000)).toBe(900);
  });
});

describe('enforceRateLimit — degraded mode warning', () => {
  let warn: jest.SpyInstance;

  const downRedis = () => scriptRedis(closed) as unknown as Redis;

  const check = (tracker: string) => ({
    redis: downRedis(),
    tracker,
    limit: 100,
    windowSeconds: 60,
    errorMessage: 'Too many requests',
    timeoutMs: 500,
  });

  beforeEach(() => {
    resetRateLimitFallback();
    jest.useFakeTimers();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetRateLimitFallback();
  });

  it('warns once per 30 s while Redis stays down, naming the cause', async () => {
    await enforceRateLimit(check('a'));
    await enforceRateLimit(check('b'));
    jest.advanceTimersByTime(DEGRADED_WARN_INTERVAL_MS - 1);
    await enforceRateLimit(check('c'));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Connection is closed.');

    jest.advanceTimersByTime(1);
    await enforceRateLimit(check('d'));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('says once when Redis answers again, so the degraded period can be read from the logs', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const healthy = scriptRedis(() => Promise.resolve([1, 60]));

    await enforceRateLimit(check('a'));
    await enforceRateLimit(check('b'));
    jest.advanceTimersByTime(12_000);
    await enforceRateLimit({
      ...check('c'),
      redis: healthy as unknown as Redis,
    });
    await enforceRateLimit({
      ...check('d'),
      redis: healthy as unknown as Redis,
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/Redis answers again.*12 s/);
  });

  it('says nothing about a recovery while Redis never failed', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const healthy = scriptRedis(() => Promise.resolve([1, 60]));

    await enforceRateLimit({
      ...check('a'),
      redis: healthy as unknown as Redis,
    });

    expect(log).not.toHaveBeenCalled();
  });

  it('does not take a 429 decided by Redis for an outage', async () => {
    const blocked = scriptRedis(() => Promise.resolve([0, 45]));

    await expect(
      enforceRateLimit({ ...check('e'), redis: blocked as unknown as Redis }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * While ioredis already knows the connection is down, asking
 * it anyway made every request of the outage wait the whole timeout (about
 * 1 s on chat routes, which run two rate-limit guards) and left one more
 * command in the offline queue per request.
 */
describe('enforceRateLimit — connection known to be down', () => {
  const hungRedis = (status: string | undefined) => scriptRedis(never, status);

  const check = (redis: ReturnType<typeof hungRedis>, limit = 100) => ({
    redis: redis as unknown as Redis,
    tracker: 'gateway:user:status-test',
    limit,
    windowSeconds: 60,
    errorMessage: 'Too many requests',
    timeoutMs: 500,
  });

  /** Settles `promise` if it can without any timer firing. */
  const settledAtOnce = async (promise: Promise<unknown>) => {
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await jest.advanceTimersByTimeAsync(0);
    return settled;
  };

  let warn: jest.SpyInstance;

  beforeEach(() => {
    resetRateLimitFallback();
    jest.useFakeTimers();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetRateLimitFallback();
  });

  it.each(['reconnecting', 'connecting', 'connect', 'close', 'end'])(
    'counts in-process at once while the connection is %s, sending nothing',
    async (status) => {
      const redis = hungRedis(status);
      const outcome = enforceRateLimit(check(redis));

      expect(await settledAtOnce(outcome)).toBe(true);
      await expect(outcome).resolves.toBe(true);
      expect(redis.hit).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(`connection ${status}`);
    },
  );

  it('still answers 429 above the limit while it skips Redis', async () => {
    const redis = hungRedis('reconnecting');

    await enforceRateLimit(check(redis, 1));
    await expect(enforceRateLimit(check(redis, 1))).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it.each([
    ['ready', 'ready'],
    ['wait', 'wait'], // lazyConnect: the first command is what connects it
    ['unknown', undefined],
  ])('still asks Redis when the status is %s', async (_label, status) => {
    const redis = hungRedis(status);
    const outcome = enforceRateLimit(check(redis));

    expect(await settledAtOnce(outcome)).toBe(false);
    expect(redis.hit).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500);
    await expect(outcome).resolves.toBe(true);
  });
});

/**
 * The fallback only kept a fresh 60 s window, not the
 * escalating block of the Redis path (rl:block, 60 s doubling up to 900 s),
 * so an abusive client got a fresh quota every minute on every pod while
 * Redis was slow or down.
 */
describe('enforceRateLimit — escalating block while Redis is down', () => {
  const downRedis = () =>
    scriptRedis(never, 'reconnecting') as unknown as Redis;

  const check = (tracker: string, redis: Redis = downRedis()) => {
    const headers: Record<string, number> = {};
    return {
      headers,
      check: {
        redis,
        tracker,
        limit: 1,
        windowSeconds: 60,
        errorMessage: 'Too many requests',
        timeoutMs: 500,
        setHeader: (name: string, value: number) => (headers[name] = value),
      },
    };
  };

  /** The Retry-After of the 429, or 'allowed'. */
  const outcome = async (
    tracker: string,
    redis?: Redis,
  ): Promise<number | 'allowed'> => {
    const { check: c, headers } = check(tracker, redis);
    try {
      await enforceRateLimit(c);
      return 'allowed';
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const response = (err as HttpException).getResponse() as {
        retryAfter: number;
      };
      expect(headers['Retry-After']).toBe(response.retryAfter);
      return response.retryAfter;
    }
  };

  const at = (seconds: number) => jest.setSystemTime(seconds * 1000);

  beforeEach(() => {
    resetRateLimitFallback();
    jest.useFakeTimers();
    at(0);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetRateLimitFallback();
  });

  it('blocks for 60 s on the first violation, then doubles up to 900 s', async () => {
    expect(await outcome('abuser')).toBe('allowed');
    expect(await outcome('abuser')).toBe(60);
    at(59.999);
    expect(await outcome('abuser')).toBe(1);

    let now = 60;
    for (const block of [120, 240, 480, 900, 900]) {
      at(now);
      expect(await outcome('abuser')).toBe('allowed');
      expect(await outcome('abuser')).toBe(block);
      now += block;
    }
  });

  it('keeps a blocked client blocked across a window reset', async () => {
    expect(await outcome('late-burst')).toBe('allowed');
    at(59);
    // Over the limit 1 s before the window ends: blocked until 119 s.
    expect(await outcome('late-burst')).toBe(60);

    at(61); // the window (0 -> 60 s) is over, the block is not
    expect(await outcome('late-burst')).toBe(58);
    at(118.5);
    expect(await outcome('late-burst')).toBe(1);
    at(119);
    expect(await outcome('late-burst')).toBe('allowed');
  });

  it('forgets the escalation an hour after the first violation, like rl:blocks', async () => {
    await outcome('reformed');
    expect(await outcome('reformed')).toBe(60);
    at(60);
    await outcome('reformed');
    expect(await outcome('reformed')).toBe(120);

    at(3600);
    expect(await outcome('reformed')).toBe('allowed');
    expect(await outcome('reformed')).toBe(60);
  });

  it('blocks per client', async () => {
    await outcome('noisy');
    expect(await outcome('noisy')).toBe(60);

    expect(await outcome('quiet')).toBe('allowed');
  });

  it('applies the same block when Redis fails instead of being known down', async () => {
    const failing = scriptRedis(closed) as unknown as Redis;

    expect(await outcome('failing', failing)).toBe('allowed');
    expect(await outcome('failing', failing)).toBe(60);
    at(60);
    expect(await outcome('failing', failing)).toBe('allowed');
    expect(await outcome('failing', failing)).toBe(120);
  });

  it.each([
    [60, 120],
    [120, 240],
    [240, 480],
    [480, 900],
    [900, 900],
  ])(
    'carries on the escalation of a %i s block Redis set: the next one lasts %i s',
    async (seconds, next) => {
      // {2, count, reset, retryAfter}: counted over the limit, now blocked.
      const redis = scriptRedis(
        () => Promise.resolve([2, 2, 30, seconds]),
        'ready',
      ) as unknown as Redis;

      expect(await outcome('redis-side', redis)).toBe(seconds);

      at(seconds);
      expect(await outcome('redis-side')).toBe('allowed');
      expect(await outcome('redis-side')).toBe(next);
    },
  );

  describe('a block Redis decided, once Redis stops answering', () => {
    /** Redis answering one script reply, then nothing more. */
    const redisSaying = (reply: number[]) =>
      scriptRedis(() => Promise.resolve(reply), 'ready') as unknown as Redis;

    it('keeps a running rl:block for the rest of its TTL', async () => {
      // {0, retryAfter}: an earlier block still runs.
      expect(await outcome('known', redisSaying([0, 900]))).toBe(900);

      at(100);
      expect(await outcome('known')).toBe(800);
      at(900);
      expect(await outcome('known')).toBe('allowed');
    });

    it('keeps the block Redis just set, and carries on its escalation', async () => {
      // The third violation within the hour: blocked for 240 s.
      const redis = redisSaying([2, 2, 30, 240]);
      expect(await outcome('escalated', redis)).toBe(240);

      at(10);
      expect(await outcome('escalated')).toBe(230);
      at(240);
      expect(await outcome('escalated')).toBe('allowed');
      expect(await outcome('escalated')).toBe(480);
    });
  });

  it('lets Redis decide again as soon as it answers', async () => {
    await outcome('back-online');
    expect(await outcome('back-online')).toBe(60);

    // {1, count, reset}: counted, under the limit.
    const healthy = scriptRedis(
      () => Promise.resolve([1, 1, 60]),
      'ready',
    ) as unknown as Redis;
    expect(await outcome('back-online', healthy)).toBe('allowed');
  });
});

describe('violationsFor (the inverse of the block ladder)', () => {
  it.each([
    [60, 1],
    [120, 2],
    [240, 3],
    [480, 4],
    [900, 5],
  ])('reads a %i s block as violation #%i', (seconds, violations) => {
    expect(violationsFor(seconds)).toBe(violations);
  });

  it.each([0, -1, Number.NaN])('reads a nonsensical %p as the first', (s) => {
    expect(violationsFor(s)).toBe(1);
  });
});

describe('rateLimitRedisTimeoutMs', () => {
  it('defaults to 500 ms', () => {
    expect(rateLimitRedisTimeoutMs(new ConfigService({}))).toBe(
      RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT,
    );
    expect(RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT).toBe(500);
  });

  it('reads RATE_LIMIT_REDIS_TIMEOUT_MS, from a number or an env string', () => {
    expect(
      rateLimitRedisTimeoutMs(
        new ConfigService({ RATE_LIMIT_REDIS_TIMEOUT_MS: 50 }),
      ),
    ).toBe(50);
    expect(
      rateLimitRedisTimeoutMs(
        new ConfigService({ RATE_LIMIT_REDIS_TIMEOUT_MS: '250' }),
      ),
    ).toBe(250);
  });

  // Above the shared client's command timeout the bound changes nothing,
  // and above 2^31 - 1 ms Node fires the timer at once: every request would
  // then be counted in-process, per pod.
  it.each([1_000, 5_000, 3_000_000_000])(
    'never waits longer than the shared client would (%p)',
    (value) => {
      expect(
        rateLimitRedisTimeoutMs(
          new ConfigService({ RATE_LIMIT_REDIS_TIMEOUT_MS: value }),
        ),
      ).toBe(GATEWAY_REDIS_COMMAND_TIMEOUT_MS);
    },
  );

  it.each(['abc', '0', '-5', ''])(
    'falls back to the default on %p, so a typo cannot disable the bound',
    (value) => {
      expect(
        rateLimitRedisTimeoutMs(
          new ConfigService({ RATE_LIMIT_REDIS_TIMEOUT_MS: value }),
        ),
      ).toBe(RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT);
    },
  );
});
