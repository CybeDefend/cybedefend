import { createHash } from 'node:crypto';
import {
  ExecutionContext,
  HttpException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  AUTH_IP_LIMIT,
  AUTH_IP_WINDOW_SECONDS,
  AUTH_RATE_LIMIT_KIND,
  type AuthRateLimitKind,
  LOGIN_IP_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_WINDOW_SECONDS,
  LocalAuthRateLimitGuard,
  PASSWORD_CHANGE_USER_LIMIT,
  PASSWORD_CHANGE_WINDOW_SECONDS,
  RESET_EMAIL_LIMIT,
  RESET_IP_LIMIT,
  RESET_WINDOW_SECONDS,
  SIGNUP_IP_LIMIT,
  SIGNUP_WINDOW_SECONDS,
} from './local-auth-rate-limit.guard';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface FakeRequest {
  ip?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  user?: { sub?: string };
}

/** Mirrors ioredis' MULTI (SET key 0 EX w NX, INCR), as the SSO guard spec. */
function makeRedis(opts: { execError?: Error; ttl?: number } = {}) {
  const store: Record<string, number> = {};
  const sets: unknown[][] = [];
  return {
    store,
    sets,
    multi: jest.fn(() => {
      const queue: Array<() => [Error | null, unknown]> = [];
      const chain = {
        set: (...args: unknown[]) => {
          sets.push(args);
          const key = args[0] as string;
          queue.push(() => {
            if (!(key in store)) store[key] = 0;
            return [null, 'OK'];
          });
          return chain;
        },
        incr: (key: string) => {
          queue.push(() => {
            store[key] = (store[key] ?? 0) + 1;
            return [null, store[key]];
          });
          return chain;
        },
        exec: jest.fn(async () => {
          if (opts.execError) throw opts.execError;
          return queue.map((run) => run());
        }),
      };
      return chain;
    }),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(async () => opts.ttl ?? 42),
  };
}

function makeCtx(kind: AuthRateLimitKind | undefined, req: FakeRequest) {
  const headers: Record<string, unknown> = {};
  const reply = {
    header: (k: string, v: unknown) => {
      headers[k] = v;
      return reply;
    },
  };
  const handler = () => undefined;
  if (kind) Reflect.defineMetadata(AUTH_RATE_LIMIT_KIND, kind, handler);
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, ...req }),
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

function makeGuard(
  redis: ReturnType<typeof makeRedis>,
  env: Record<string, unknown> = {},
) {
  return new LocalAuthRateLimitGuard(
    new ConfigService(env),
    new Reflector(),
    redis as never,
  );
}

async function hitN(
  guard: LocalAuthRateLimitGuard,
  kind: AuthRateLimitKind,
  req: () => FakeRequest,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    await expect(guard.canActivate(makeCtx(kind, req()).ctx)).resolves.toBe(
      true,
    );
  }
}

async function expect429(
  guard: LocalAuthRateLimitGuard,
  kind: AuthRateLimitKind,
  req: FakeRequest,
) {
  const { ctx, headers } = makeCtx(kind, req);
  const err = await guard.canActivate(ctx).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(429);
  expect((err as HttpException).getResponse()).toMatchObject({
    code: 'RATE_LIMITED',
    message: 'RATE_LIMITED',
  });
  return headers;
}

describe('LocalAuthRateLimitGuard', () => {
  it('fixes the rate-limit buckets', () => {
    expect([
      LOGIN_IP_EMAIL_LIMIT,
      LOGIN_IP_LIMIT,
      LOGIN_WINDOW_SECONDS,
    ]).toEqual([10, 100, 900]);
    expect([RESET_EMAIL_LIMIT, RESET_IP_LIMIT, RESET_WINDOW_SECONDS]).toEqual([
      3, 100, 3600,
    ]);
    expect([AUTH_IP_LIMIT, AUTH_IP_WINDOW_SECONDS]).toEqual([10, 900]);
    expect([SIGNUP_IP_LIMIT, SIGNUP_WINDOW_SECONDS]).toEqual([10, 3600]);
    expect([
      PASSWORD_CHANGE_USER_LIMIT,
      PASSWORD_CHANGE_WINDOW_SECONDS,
    ]).toEqual([10, 900]);
  });

  it('keys every address bucket of an IPv6 caller on its /64, and an IPv4-mapped one on its IPv4', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    const body = { email: 'ada@example.test' };
    await hitN(guard, 'login', () => ({ ip: '2001:db8:1:2::1', body }), 1);
    await hitN(guard, 'login', () => ({ ip: '2001:db8:1:2:ffff::7', body }), 1);
    await hitN(guard, 'reset', () => ({ ip: '2001:db8:1:2::3', body }), 1);
    await hitN(guard, 'ip', () => ({ ip: '2001:db8:1:2::4' }), 1);
    await hitN(guard, 'signup', () => ({ ip: '::ffff:192.0.2.1' }), 1);

    const prefix = '2001:db8:1:2::/64';
    expect(redis.store[`rl:auth:login:ip:${prefix}`]).toBe(2);
    expect(
      redis.store[
        `rl:auth:login:ipmail:${sha256(`${prefix}\nada@example.test`)}`
      ],
    ).toBe(2);
    expect(redis.store[`rl:auth:reset:ip:${prefix}`]).toBe(1);
    expect(redis.store[`rl:auth:ip:${prefix}`]).toBe(1);
    expect(redis.store['rl:auth:signup:ip:192.0.2.1']).toBe(1);
  });

  it('lets a route without a kind through without touching Redis', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    await expect(
      guard.canActivate(makeCtx(undefined, { ip: '1.2.3.4' }).ctx),
    ).resolves.toBe(true);
    expect(redis.multi).not.toHaveBeenCalled();
  });

  it('sets Cache-Control: no-store on every answer it guards', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    const { ctx, headers } = makeCtx(undefined, { ip: '1.2.3.4' });
    await guard.canActivate(ctx);
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('allows the 10th login attempt of an address and an e-mail and refuses the 11th', async () => {
    const redis = makeRedis({ ttl: 321 });
    const guard = makeGuard(redis);
    const req = () => ({ ip: '1.2.3.4', body: { email: 'user@x.io' } });
    await hitN(guard, 'login', req, 10);
    const headers = await expect429(guard, 'login', req());
    expect(headers['Retry-After']).toBe('321');
    // Each bucket gets its window in the same MULTI, never INCR then EXPIRE.
    expect(redis.sets[0]).toEqual([
      `rl:auth:login:ipmail:${sha256('1.2.3.4\nuser@x.io')}`,
      0,
      'EX',
      900,
      'NX',
    ]);
    expect(redis.sets[1]).toEqual([
      'rl:auth:login:ip:1.2.3.4',
      0,
      'EX',
      900,
      'NX',
    ]);
    expect(redis.expire).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('refuses the 101st login from one address whatever the e-mail', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    let i = 0;
    await hitN(
      guard,
      'login',
      () => ({ ip: '1.2.3.4', body: { email: `u${i++}@x.io` } }),
      100,
    );
    await expect429(guard, 'login', {
      ip: '1.2.3.4',
      body: { email: 'z@x.io' },
    });
  });

  it('buckets the e-mail case-insensitively and never stores it in clear', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    await guard.canActivate(
      makeCtx('login', { ip: '1.2.3.4', body: { email: ' User@X.io ' } }).ctx,
    );
    const keys = Object.keys(redis.store);
    expect(keys).toContain(
      `rl:auth:login:ipmail:${sha256('1.2.3.4\nuser@x.io')}`,
    );
    expect(keys.join('|').toLowerCase()).not.toContain('user@x.io');
  });

  it('counts only the address when the body has no e-mail', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    await guard.canActivate(makeCtx('login', { ip: '1.2.3.4', body: {} }).ctx);
    expect(Object.keys(redis.store)).toEqual(['rl:auth:login:ip:1.2.3.4']);
  });

  it('allows 3 reset requests per e-mail per hour and refuses the 4th', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    let ip = 0;
    const req = () => ({ ip: `10.0.0.${ip++}`, body: { email: 'A@x.io' } });
    await hitN(guard, 'reset', req, 3);
    await expect429(guard, 'reset', req());
    expect(redis.sets[0]).toEqual([
      `rl:auth:reset:mail:${sha256('a@x.io')}`,
      0,
      'EX',
      3600,
      'NX',
    ]);
  });

  it('refuses the 101st reset request from one address', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    let i = 0;
    await hitN(
      guard,
      'reset',
      () => ({ ip: '1.2.3.4', body: { email: `u${i++}@x.io` } }),
      100,
    );
    await expect429(guard, 'reset', {
      ip: '1.2.3.4',
      body: { email: 'z@x.io' },
    });
    expect(redis.store['rl:auth:reset:ip:1.2.3.4']).toBe(101);
  });

  it('allows 10 setup or invitation calls per address per 15 minutes', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    await hitN(guard, 'ip', () => ({ ip: '1.2.3.4' }), 10);
    await expect429(guard, 'ip', { ip: '1.2.3.4' });
    expect(redis.sets[0]).toEqual(['rl:auth:ip:1.2.3.4', 0, 'EX', 900, 'NX']);
  });

  it('allows 10 sign-ups per address per hour', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    await hitN(guard, 'signup', () => ({ ip: '1.2.3.4' }), 10);
    await expect429(guard, 'signup', { ip: '1.2.3.4' });
    expect(redis.sets[0]).toEqual([
      'rl:auth:signup:ip:1.2.3.4',
      0,
      'EX',
      3600,
      'NX',
    ]);
  });

  it('keys a password change on the user, not the address', async () => {
    const redis = makeRedis();
    const guard = makeGuard(redis);
    let ip = 0;
    await hitN(
      guard,
      'password-change',
      () => ({ ip: `10.0.0.${ip++}`, user: { sub: 'u1' } }),
      10,
    );
    await expect429(guard, 'password-change', {
      ip: '9.9.9.9',
      user: { sub: 'u1' },
    });
    expect(Object.keys(redis.store)).toEqual([
      'rl:auth:password-change:user:u1',
    ]);
  });

  it('refuses a password change with no authenticated user', async () => {
    const guard = makeGuard(makeRedis());
    await expect(
      guard.canActivate(makeCtx('password-change', { ip: '1.2.3.4' }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 503 rate_limit_unavailable when Redis fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementationOnce(() => {});
    const guard = makeGuard(makeRedis({ execError: new Error('ECONNRESET') }));
    const err = await guard
      .canActivate(
        makeCtx('login', { ip: '1.2.3.4', body: { email: 'a@x.io' } }).ctx,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as HttpException).getResponse()).toMatchObject({
      message: 'rate_limit_unavailable',
    });
  });

  it('reads the address through clientIpOf', async () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    process.env.CYBEDEFEND_EDITION = 'community';
    try {
      const redis = makeRedis();
      const guard = makeGuard(redis, { NODE_ENV: 'production' });
      await guard.canActivate(
        makeCtx('ip', {
          ip: '1.2.3.4',
          headers: { 'cf-connecting-ip': '6.6.6.6' },
        }).ctx,
      );
      expect(Object.keys(redis.store)).toEqual(['rl:auth:ip:1.2.3.4']);
    } finally {
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    }
  });
});
