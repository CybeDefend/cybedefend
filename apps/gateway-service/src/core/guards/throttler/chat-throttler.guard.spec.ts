import { ChatThrottlerGuard } from './chat-throttler.guard';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';

import { RATE_LIMIT_HIT_COMMAND } from './rate-limit-bucket';

function makeCtx(req: Record<string, unknown> = {}) {
  const request = { ip: '1.1.1.1', headers: {}, ...req };
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
let mockPort = 21_500;

/**
 * An in-memory Redis (ioredis-mock runs the Lua scripts too) that records the
 * keys of every command the guard sends.
 */
function recordingRedis(): {
  redis: Redis;
  store: Redis;
  commands: { name: string; args: unknown[] }[];
} {
  const store = new RedisMock({ port: mockPort++ }) as unknown as Redis;
  const commands: { name: string; args: unknown[] }[] = [];
  const redis = new Proxy(store, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') {
        return value;
      }
      return (...args: unknown[]) => {
        // Registering a script is local to the client: not a round-trip.
        if (prop !== 'defineCommand') commands.push({ name: prop, args });
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

describe('ChatThrottlerGuard', () => {
  const reflector = new Reflector();
  const config = new ConfigService();
  const guardOn = (redis: Redis) =>
    new ChatThrottlerGuard(reflector, config, redis);

  /** Every Redis key the guard's commands named. */
  const keysOf = (commands: { args: unknown[] }[]): string[] =>
    commands.flatMap(({ args }) =>
      args.filter(
        (arg): arg is string => typeof arg === 'string' && arg.includes(':'),
      ),
    );

  it('uses chat:msg:<userId> bucket keys', async () => {
    const { redis, commands } = recordingRedis();
    const { ctx } = makeCtx({ user: { sub: 'user-abc' } });

    await guardOn(redis).canActivate(ctx);

    const keys = keysOf(commands);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.includes('chat:msg:user-abc'))).toBe(true);
  });

  it('allows the first 15 requests in 60 s', async () => {
    const { redis } = recordingRedis();
    const guard = guardOn(redis);

    for (let i = 1; i <= 15; i++) {
      const { ctx, headers } = makeCtx({ user: { sub: 'u1' } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(headers['X-RateLimit-Remaining']).toBe(15 - i);
    }
  });

  it('rejects the 16th request with 429 chat_rate_limit_exceeded', async () => {
    const { redis } = recordingRedis();
    const guard = guardOn(redis);
    for (let i = 1; i <= 15; i++) {
      await guard.canActivate(makeCtx({ user: { sub: 'u2' } }).ctx);
    }
    const { ctx, headers } = makeCtx({ user: { sub: 'u2' } });

    const error = await refusal(guard.canActivate(ctx));

    expect(error.getResponse()).toEqual({
      message: 'chat_rate_limit_exceeded',
      retryAfter: 60,
    });
    expect(headers['Retry-After']).toBe(60);
  });

  it('rejects when already blocked (TTL > 0)', async () => {
    const { redis, store } = recordingRedis();
    await store.set('rl:block:chat:msg:u3', '1', 'EX', 45);
    const { ctx, headers } = makeCtx({ user: { sub: 'u3' } });

    const error = await refusal(guardOn(redis).canActivate(ctx));

    expect(error.getResponse()).toEqual({
      message: 'chat_rate_limit_exceeded',
      retryAfter: 45,
    });
    expect(headers['Retry-After']).toBe(45);
  });

  it('opens a 60 s window on the first request', async () => {
    const { redis, store } = recordingRedis();
    const { ctx } = makeCtx({ user: { sub: 'u4' } });

    await expect(guardOn(redis).canActivate(ctx)).resolves.toBe(true);

    expect(await store.ttl('rl:count:chat:msg:u4')).toBe(60);
  });

  it('keys an IPv6 caller without a user on its /64', async () => {
    const { redis, commands } = recordingRedis();
    await guardOn(redis).canActivate(makeCtx({ ip: '2001:db8:9:9::5' }).ctx);

    const keys = keysOf(commands);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.includes('chat:msg:ip:2001:db8:9:9::/64'))).toBe(
      true,
    );
  });

  it('falls back to chat:msg:ip:<ip> when no user is present', async () => {
    const { redis, commands } = recordingRedis();
    const { ctx } = makeCtx(); // no req.user

    await guardOn(redis).canActivate(ctx);

    const keys = keysOf(commands);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.includes('chat:msg:ip:1.1.1.1'))).toBe(true);
  });

  /**
   * In the Community Edition the guard keys on req.ip whatever
   * cf-connecting-ip says, even with NODE_ENV=production: the header is forgeable
   * without an edge rewriting it.
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
      const { redis, commands } = recordingRedis();
      const env = new ConfigService({ NODE_ENV: 'production' });
      const guard = new ChatThrottlerGuard(new Reflector(), env, redis);
      const { ctx } = makeCtx({
        headers: { 'cf-connecting-ip': '6.6.6.6' },
      }); // no req.user

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      const keys = keysOf(commands);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((k) => k.includes('chat:msg:ip:1.1.1.1'))).toBe(true);
      expect(keys.some((k) => k.includes('6.6.6.6'))).toBe(false);
    });
  });

  /**
   * CHAT_RATE_LIMIT is not in the Joi schema, so it reaches the guard as the
   * raw environment string. A value that is not a positive number used to
   * turn the bucket script's limit into nil, and every chat message into a
   * 500: it falls back to the default, like SsoConnectorsRateLimitGuard.
   */
  it.each([
    ['not a number', 'abc', 15],
    ['zero', '0', 15],
    ['negative', '-3', 15],
    ['a number from the environment', '20', 20],
  ])(
    'reads a CHAT_RATE_LIMIT that is %s (%p) as %i',
    async (_name, raw, expected) => {
      const { redis } = recordingRedis();
      const env = new ConfigService({ CHAT_RATE_LIMIT: raw });
      const guard = new ChatThrottlerGuard(reflector, env, redis);
      const { ctx, headers } = makeCtx({ user: { sub: `limit-${raw}` } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(headers['X-RateLimit-Limit']).toBe(expected);
      expect(headers['X-RateLimit-Remaining']).toBe(expected - 1);
    },
  );

  /** One script, not three to four round-trips, as in RateLimitGuard. */
  it('costs one round-trip to Redis per request', async () => {
    const { redis, commands } = recordingRedis();
    const { ctx } = makeCtx({ user: { sub: 'u5' } });

    await guardOn(redis).canActivate(ctx);

    expect(commands).toHaveLength(1);
  });

  /**
   * A counter whose EXPIRE never ran would count forever, so that user
   * would be blocked from the chat again after every block, for good.
   */
  it('puts the window back on a counter that lost its expiry', async () => {
    const { redis, store } = recordingRedis();
    await store.set('rl:count:chat:msg:u6', '3'); // no TTL
    const { ctx } = makeCtx({ user: { sub: 'u6' } });

    await expect(guardOn(redis).canActivate(ctx)).resolves.toBe(true);

    const ttl = await store.ttl('rl:count:chat:msg:u6');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});

/**
 * Same rule as RateLimitGuard: an unbounded Redis call hangs while Redis
 * restarts, then fails with a 500. A bounded round-trip, in-process fallback.
 */
describe('ChatThrottlerGuard — Redis unavailable', () => {
  const MAX_RETRIES = 'Reached the max retries per request limit (which is 20)';

  /** A client whose bucket script (rate-limit-bucket.ts) rejects. */
  const failingRedis = () =>
    ({
      [RATE_LIMIT_HIT_COMMAND]: jest
        .fn()
        .mockRejectedValue(new Error(MAX_RETRIES)),
    }) as unknown as Redis;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the chat limit from the in-process fallback, then answers 429', async () => {
    const guard = new ChatThrottlerGuard(
      new Reflector(),
      new ConfigService({ CHAT_RATE_LIMIT: 2 }),
      failingRedis(),
    );
    const user = { user: { sub: 'chat-redis-down' } };

    await expect(guard.canActivate(makeCtx(user).ctx)).resolves.toBe(true);
    const second = makeCtx(user);
    await expect(guard.canActivate(second.ctx)).resolves.toBe(true);
    expect(second.headers['X-RateLimit-Limit']).toBe(2);
    expect(second.headers['X-RateLimit-Remaining']).toBe(0);

    const third = makeCtx(user);
    const rejection = guard.canActivate(third.ctx);
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await rejection.catch((err: HttpException) => {
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toEqual({
        message: 'chat_rate_limit_exceeded',
        retryAfter: 60,
      });
    });
    expect(third.headers['Retry-After']).toBe(60);
  });

  it('stops waiting on a hung Redis after the timeout', async () => {
    jest.useFakeTimers();
    const redis = failingRedis();
    (redis as unknown as Record<string, jest.Mock>)[
      RATE_LIMIT_HIT_COMMAND
    ].mockReturnValue(new Promise(() => undefined));
    const guard = new ChatThrottlerGuard(
      new Reflector(),
      new ConfigService({}),
      redis,
    );

    let settled = false;
    void guard
      .canActivate(makeCtx({ user: { sub: 'chat-hung' } }).ctx)
      .then(() => (settled = true));

    await jest.advanceTimersByTimeAsync(500);
    expect(settled).toBe(true);
  });
});
