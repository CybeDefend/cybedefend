import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';

import { RATE_LIMIT_HIT_COMMAND } from './rate-limit-bucket';
import { RateLimitGuard } from './throttler.guard';

function makeCtx(req: Record<string, unknown> = {}) {
  const request = { ip: '2.2.2.2', headers: {}, ...req };
  const headers: Record<string, unknown> = {};
  const res = {
    raw: { setHeader: (k: string, v: unknown) => (headers[k] = v) },
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

// ioredis-mock shares its data between instances of one host:port: a port per
// test gives each test an empty store.
let mockPort = 21_000;

/**
 * An in-memory Redis (ioredis-mock runs the Lua scripts too) that records
 * every command the guard sends, i.e. every round-trip to Redis.
 * `defineCommand` only registers a script on the client: not a round-trip.
 */
function recordingRedis(): { redis: Redis; store: Redis; commands: string[] } {
  const store = new RedisMock({ port: mockPort++ }) as unknown as Redis;
  const commands: string[] = [];
  const redis = new Proxy(store, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') {
        return value;
      }
      return (...args: unknown[]) => {
        if (prop !== 'defineCommand') commands.push(prop);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { redis, store, commands };
}

/** The 429 `canActivate` rejected with. */
async function refusal(promise: Promise<boolean>): Promise<HttpException> {
  const error = await promise.then(
    () => {
      throw new Error('the guard let the request through');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(429);
  return error as HttpException;
}

describe('RateLimitGuard', () => {
  const reflector = new Reflector();
  const config = new ConfigService();
  const guardOn = (redis: Redis) =>
    new RateLimitGuard(reflector, config, redis);

  // Default limits: 300/min per user, 100/min per address.
  const USER = 'gateway:user:u1';
  const IP = 'gateway:ip:2.2.2.2';

  it('allows the first request and sets the rate-limit headers', async () => {
    const { redis } = recordingRedis();
    const { ctx, headers } = makeCtx({ user: { sub: 'u1' } });

    await expect(guardOn(redis).canActivate(ctx)).resolves.toBe(true);

    expect(headers['X-RateLimit-Limit']).toBe(300);
    expect(headers['X-RateLimit-Remaining']).toBe(299);
    expect(headers['X-RateLimit-Reset']).toBe(60);
  });

  it('blocks the request over the limit for 60 s, then doubles the block', async () => {
    const { redis, store } = recordingRedis();
    await store.set(`rl:count:${IP}`, '100', 'EX', 30);

    const first = makeCtx();
    const error = await refusal(guardOn(redis).canActivate(first.ctx));
    expect(error.getResponse()).toEqual({
      message: 'Too many requests',
      retryAfter: 60,
    });
    expect(first.headers['Retry-After']).toBe(60);
    expect(first.headers['X-RateLimit-Remaining']).toBe(0);
    expect(await store.ttl(`rl:block:${IP}`)).toBe(60);

    // Once the block is gone, the next excess hit is blocked twice as long.
    await store.del(`rl:block:${IP}`);
    const second = makeCtx();
    await refusal(guardOn(redis).canActivate(second.ctx));
    expect(second.headers['Retry-After']).toBe(120);
  });

  it('refuses a blocked caller with the time left, without counting the hit', async () => {
    const { redis, store } = recordingRedis();
    await store.set(`rl:block:${IP}`, '1', 'EX', 45);
    await store.set(`rl:count:${IP}`, '7', 'EX', 30);
    const { ctx, headers } = makeCtx();

    const error = await refusal(guardOn(redis).canActivate(ctx));

    expect(error.getResponse()).toEqual({
      message: 'Too many requests',
      retryAfter: 45,
    });
    expect(headers['Retry-After']).toBe(45);
    expect(await store.get(`rl:count:${IP}`)).toBe('7');
  });

  /**
   * One script, not TTL, INCR, EXPIRE and TTL one after the other (3 to 4
   * round-trips, 6 over the limit), each of which a request would pay.
   */
  it('costs one round-trip to Redis per request', async () => {
    const { redis, commands } = recordingRedis();
    const { ctx } = makeCtx({ user: { sub: 'u1' } });

    await guardOn(redis).canActivate(ctx);

    expect(commands).toHaveLength(1);
  });

  /**
   * An EVAL carries the whole script (~800 bytes) on
   * every guarded request, and the ioredis instrumentation copies it into
   * the db.statement of every span. A script registered with defineCommand
   * goes by its SHA (EVALSHA), ioredis loading it once per connection and
   * again after a NOSCRIPT.
   */
  it('never sends the script in full: a registered command, run by its SHA', async () => {
    const { redis, commands } = recordingRedis();
    const guard = guardOn(redis);

    await guard.canActivate(makeCtx({ user: { sub: 'u1' } }).ctx);
    await guard.canActivate(makeCtx({ user: { sub: 'u1' } }).ctx);

    expect(commands).not.toContain('eval');
    expect(commands).toEqual([RATE_LIMIT_HIT_COMMAND, RATE_LIMIT_HIT_COMMAND]);
  });

  it('costs one round-trip to Redis for a request it blocks', async () => {
    const { redis, store, commands } = recordingRedis();
    await store.set(`rl:count:${USER}`, '300', 'EX', 30);
    const { ctx } = makeCtx({ user: { sub: 'u1' } });

    await refusal(guardOn(redis).canActivate(ctx));

    expect(commands).toHaveLength(1);
  });

  /**
   * Setting the window only when INCR returns 1 is not enough: a counter
   * whose EXPIRE never ran (the connection dropped between the two calls, or
   * the EXPIRE timed out) would count forever, and once over the limit, that
   * caller would be blocked again after every block, for good.
   */
  it('puts the window back on a counter that lost its expiry', async () => {
    const { redis, store } = recordingRedis();
    await store.set(`rl:count:${USER}`, '5'); // no TTL
    const { ctx, headers } = makeCtx({ user: { sub: 'u1' } });

    await expect(guardOn(redis).canActivate(ctx)).resolves.toBe(true);

    const ttl = await store.ttl(`rl:count:${USER}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(headers['X-RateLimit-Reset']).toBe(ttl);
    expect(headers['X-RateLimit-Remaining']).toBe(294);
  });

  it('puts the hour back on a block counter that lost its expiry', async () => {
    const { redis, store } = recordingRedis();
    await store.set(`rl:count:${IP}`, '100', 'EX', 30);
    await store.set(`rl:blocks:${IP}`, '1'); // no TTL
    const { ctx, headers } = makeCtx();

    await refusal(guardOn(redis).canActivate(ctx));

    const ttl = await store.ttl(`rl:blocks:${IP}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
    expect(headers['Retry-After']).toBe(120);
  });

  it('caps a block at 15 minutes', async () => {
    const { redis, store } = recordingRedis();
    await store.set(`rl:count:${IP}`, '100', 'EX', 30);
    await store.set(`rl:blocks:${IP}`, '40', 'EX', 3000);
    const { ctx, headers } = makeCtx();

    await refusal(guardOn(redis).canActivate(ctx));

    expect(headers['Retry-After']).toBe(900);
  });

  /**
   * When Redis cannot be reached the request is counted in-process
   * (redis-rate-limit.ts), with the same limit, never let through unlimited
   * nor failed with a 500.
   */
  /**
   * In the Community Edition the guard keys on req.ip whatever
   * cf-connecting-ip says, even with NODE_ENV=production: there is no edge rewriting
   * the header in front of a self-hosted gateway, so it is forgeable.
   */
  describe('community edition', () => {
    const EDITION_KEY = 'CYBEDEFEND_EDITION';
    let savedEdition: string | undefined;

    beforeEach(() => {
      savedEdition = process.env[EDITION_KEY];
      process.env[EDITION_KEY] = 'community';
    });

    afterEach(() => {
      if (savedEdition === undefined) delete process.env[EDITION_KEY];
      else process.env[EDITION_KEY] = savedEdition;
    });

    it('keys a community request on req.ip whatever cf-connecting-ip says', async () => {
      const { redis, store } = recordingRedis();
      const env = new ConfigService({ NODE_ENV: 'production' });
      const guard = new RateLimitGuard(new Reflector(), env, redis);
      const { ctx } = makeCtx({
        headers: { 'cf-connecting-ip': '6.6.6.6' },
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(await store.keys('rl:count:gateway:ip:*')).toEqual([
        'rl:count:gateway:ip:2.2.2.2',
      ]);
    });
  });

  it('keys an IPv6 caller on its /64 and an IPv4-mapped one on its IPv4', async () => {
    const { redis, store } = recordingRedis();
    const guard = new RateLimitGuard(
      new Reflector(),
      new ConfigService({}),
      redis,
    );

    await guard.canActivate(makeCtx({ ip: '2001:db8:1:2::1' }).ctx);
    await guard.canActivate(makeCtx({ ip: '2001:db8:1:2:aaaa::9' }).ctx);
    await guard.canActivate(makeCtx({ ip: '::ffff:2.2.2.2' }).ctx);

    expect((await store.keys('rl:count:gateway:ip:*')).sort()).toEqual([
      'rl:count:gateway:ip:2.2.2.2',
      'rl:count:gateway:ip:2001:db8:1:2::/64',
    ]);
  });

  it('counts the request in-process when Redis cannot be reached, never unlimited', async () => {
    // A client that cannot reach Redis and does not queue: every command
    // rejects at once, as one past its command timeout does.
    const down = new IORedis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    const env = new ConfigService({ USER_RATE_LIMIT: 1 });
    const guard = new RateLimitGuard(reflector, env, down);
    const user = { user: { sub: 'closed-redis' } };

    try {
      const first = makeCtx(user);
      await expect(guard.canActivate(first.ctx)).resolves.toBe(true);
      expect(first.headers['X-RateLimit-Limit']).toBe(1);
      expect(first.headers['X-RateLimit-Remaining']).toBe(0);

      await refusal(guard.canActivate(makeCtx(user).ctx));
    } finally {
      down.disconnect();
    }
  });
});

/**
 * A Redis round-trip awaited with no bound hangs behind ioredis' offline
 * queue while Redis restarts, then fails with a 500
 * MaxRetriesPerRequestError. Each Redis round-trip is therefore bounded and a failure falls back to an in-process limit — never to no
 * limit at all (security controls live server-side and fail closed).
 */
describe('RateLimitGuard — Redis unavailable', () => {
  const MAX_RETRIES = 'Reached the max retries per request limit (which is 20)';

  /** A client whose bucket script (rate-limit-bucket.ts) rejects. */
  const failingRedis = () => ({
    [RATE_LIMIT_HIT_COMMAND]: jest
      .fn()
      .mockRejectedValue(new Error(MAX_RETRIES)),
  });

  const guardWith = (
    redis: Record<string, jest.Mock>,
    env: Record<string, number> = {},
  ) =>
    new RateLimitGuard(
      new Reflector(),
      new ConfigService(env),
      redis as unknown as Redis,
    );

  // The fallback is process-wide (one guard instance per Nest module shares
  // it): a distinct caller per test keeps the tests independent.
  let caller = 0;
  const nextUser = () => ({ user: { sub: `redis-down-${++caller}` } });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the request from the in-process limit and still sets the headers', async () => {
    const guard = guardWith(failingRedis(), { USER_RATE_LIMIT: 5 });
    const { ctx, headers } = makeCtx(nextUser());

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(headers['X-RateLimit-Limit']).toBe(5);
    expect(headers['X-RateLimit-Remaining']).toBe(4);
    expect(headers['X-RateLimit-Reset']).toBe(60);
  });

  it('answers 429 from the in-process limit once the limit is exceeded', async () => {
    const guard = guardWith(failingRedis(), { USER_RATE_LIMIT: 2 });
    const user = nextUser();

    await expect(guard.canActivate(makeCtx(user).ctx)).resolves.toBe(true);
    await expect(guard.canActivate(makeCtx(user).ctx)).resolves.toBe(true);

    const { ctx, headers } = makeCtx(user);
    const error = await refusal(guard.canActivate(ctx));
    expect(error.getResponse()).toEqual({
      message: 'Too many requests',
      retryAfter: 60,
    });
    expect(headers['Retry-After']).toBe(60);
    expect(headers['X-RateLimit-Remaining']).toBe(0);
  });

  it('shares the in-process count between guard instances (one per module)', async () => {
    const user = nextUser();
    const first = guardWith(failingRedis(), { USER_RATE_LIMIT: 2 });
    const second = guardWith(failingRedis(), { USER_RATE_LIMIT: 2 });

    await first.canActivate(makeCtx(user).ctx);
    await second.canActivate(makeCtx(user).ctx);

    await refusal(first.canActivate(makeCtx(user).ctx));
  });

  it('stops waiting on a hung Redis after RATE_LIMIT_REDIS_TIMEOUT_MS (default 500)', async () => {
    jest.useFakeTimers();
    const redis = failingRedis();
    redis[RATE_LIMIT_HIT_COMMAND].mockReturnValue(new Promise(() => undefined));
    const guard = guardWith(redis);

    let settled = false;
    const pending = guard.canActivate(makeCtx(nextUser()).ctx);
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );

    await jest.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(pending).resolves.toBe(true);
    // Given up on Redis for this request: nothing more is queued behind it.
    expect(redis[RATE_LIMIT_HIT_COMMAND]).toHaveBeenCalledTimes(1);
  });

  it('honours a custom RATE_LIMIT_REDIS_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    const redis = failingRedis();
    redis[RATE_LIMIT_HIT_COMMAND].mockReturnValue(new Promise(() => undefined));
    const guard = guardWith(redis, { RATE_LIMIT_REDIS_TIMEOUT_MS: 50 });

    let settled = false;
    void guard
      .canActivate(makeCtx(nextUser()).ctx)
      .then(() => (settled = true));

    await jest.advanceTimersByTimeAsync(50);
    expect(settled).toBe(true);
  });

  it('shrugs off a reply that lands after the timeout', async () => {
    jest.useFakeTimers();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    let lateReject: (err: Error) => void = () => undefined;
    const redis = failingRedis();
    redis[RATE_LIMIT_HIT_COMMAND].mockReturnValue(
      new Promise((_, reject) => {
        lateReject = reject;
      }),
    );
    const guard = guardWith(redis);

    const pending = guard.canActivate(makeCtx(nextUser()).ctx);
    await jest.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(true);

    lateReject(new Error(MAX_RETRIES));
    await jest.advanceTimersByTimeAsync(0);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('keeps a block Redis decided once Redis stops answering', async () => {
    const { redis, store } = recordingRedis();
    const user = nextUser();
    const tracker = `gateway:user:${user.user.sub}`;
    await store.set(`rl:count:${tracker}`, '300', 'EX', 30);

    const error = await refusal(
      guardWith(redis as never).canActivate(makeCtx(user).ctx),
    );
    expect(error.getResponse()).toEqual({
      message: 'Too many requests',
      retryAfter: 60,
    });

    // Redis goes away: the caller is still blocked, not handed a new quota.
    const { ctx, headers } = makeCtx(user);
    await refusal(guardWith(failingRedis()).canActivate(ctx));
    expect(headers['Retry-After']).toBeGreaterThan(0);
    expect(headers['Retry-After']).toBeLessThanOrEqual(60);
  });
});
