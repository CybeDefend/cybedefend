import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import Redis from 'ioredis';

import { RateLimitGuard } from './throttler.guard';

/**
 * RateLimitGuard against a real Redis: the Lua script must run
 * on the server the gateway uses, not only on ioredis-mock's Lua engine.
 *
 *   RATE_LIMIT_REDIS_LIVE=1 [RATE_LIMIT_REDIS_URL=redis://127.0.0.1:6379] \
 *     pnpm exec jest throttler.guard.live
 *
 * Every key it writes is under a random tracker and deleted afterwards.
 */
const live = process.env.RATE_LIMIT_REDIS_LIVE === '1';
const describeLive = live ? describe : describe.skip;

describeLive('RateLimitGuard on a real Redis (RATE_LIMIT_REDIS_LIVE=1)', () => {
  let redis: Redis;
  let user: string;
  const keys = () => [
    `rl:count:gateway:user:${user}`,
    `rl:block:gateway:user:${user}`,
    `rl:blocks:gateway:user:${user}`,
  ];

  const ctxFor = (sub: string) => {
    const headers: Record<string, unknown> = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1', headers: {}, user: { sub } }),
        getResponse: () => ({
          raw: { setHeader: (k: string, v: unknown) => (headers[k] = v) },
        }),
      }),
    } as unknown as ExecutionContext;
    return { ctx, headers };
  };

  beforeAll(async () => {
    redis = new Redis(
      process.env.RATE_LIMIT_REDIS_URL ?? 'redis://127.0.0.1:6379',
    );
    // Connection setup (ready check, CLIENT SETINFO) is not the guard's.
    await redis.ping();
  });
  beforeEach(() => {
    user = `l17-live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });
  afterEach(async () => {
    await redis.del(...keys());
  });
  afterAll(async () => {
    await redis.quit();
  });

  const guard = () =>
    new RateLimitGuard(new Reflector(), new ConfigService(), redis);

  it('sends one command per request, the script by its SHA once loaded', async () => {
    // The connection's first run of the script carries it (ioredis sends
    // EVAL once per connection); every later one only its SHA.
    await guard().canActivate(ctxFor(user).ctx);
    const sent = jest.spyOn(redis, 'sendCommand');

    await expect(guard().canActivate(ctxFor(user).ctx)).resolves.toBe(true);

    expect(sent).toHaveBeenCalledTimes(1);
    const [command] = sent.mock.calls[0] as unknown as [
      { name: string; args: unknown[] },
    ];
    expect(command.name).toBe('evalsha');
    expect(String(command.args[0])).toMatch(/^[0-9a-f]{40}$/);
    sent.mockRestore();
  });

  /**
   * SCRIPT FLUSH empties the server's script cache, every client's: only on a
   * throwaway Redis (RATE_LIMIT_REDIS_FLUSHABLE=1), never the shared one.
   */
  (process.env.RATE_LIMIT_REDIS_FLUSHABLE === '1' ? it : it.skip)(
    'still counts after the server lost the script (NOSCRIPT)',
    async () => {
      await guard().canActivate(ctxFor(user).ctx);
      await redis.script('FLUSH');

      await expect(guard().canActivate(ctxFor(user).ctx)).resolves.toBe(true);

      expect(await redis.get(keys()[0])).toBe('2');
    },
  );

  it('counts, opens the window, and heals a counter without expiry', async () => {
    const { ctx, headers } = ctxFor(user);
    await guard().canActivate(ctx);
    expect(headers['X-RateLimit-Remaining']).toBe(299);
    expect(await redis.ttl(keys()[0])).toBe(60);

    await redis.persist(keys()[0]);
    await guard().canActivate(ctxFor(user).ctx);
    expect(await redis.get(keys()[0])).toBe('2');
    expect(await redis.ttl(keys()[0])).toBeGreaterThan(0);
  });

  it('blocks over the limit with an escalating, capped block', async () => {
    await redis.set(keys()[0], '300', 'EX', 30);
    await redis.set(keys()[2], '1'); // no TTL

    const { ctx, headers } = ctxFor(user);
    const error = await guard()
      .canActivate(ctx)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect((error as HttpException).getStatus()).toBe(429);
    expect(headers['Retry-After']).toBe(120);
    expect(await redis.ttl(keys()[1])).toBe(120);
    expect(await redis.ttl(keys()[2])).toBeGreaterThan(0);

    // A blocked caller is refused with the time left, uncounted.
    const again = ctxFor(user);
    await guard()
      .canActivate(again.ctx)
      .catch(() => undefined);
    expect(again.headers['Retry-After']).toBeGreaterThan(0);
    expect(await redis.get(keys()[0])).toBe('301');
  });
});
