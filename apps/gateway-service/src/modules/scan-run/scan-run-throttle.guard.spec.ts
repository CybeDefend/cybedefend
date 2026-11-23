import 'reflect-metadata';
import { ExecutionContext, HttpException } from '@nestjs/common';
import type Redis from 'ioredis';

import {
  SCAN_RUN_IP_LIMIT,
  SCAN_RUN_IP_WINDOW_SECONDS,
  ScanRunThrottleGuard,
} from './scan-run-throttle.guard';

/** A Redis double holding real counters, with SET … NX EX and INCR in a MULTI. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const ttls = new Map<string, number>();
  const failure: { error?: Error } = {};
  const redis = {
    multi: jest.fn(() => {
      const ops: Array<() => [Error | null, unknown]> = [];
      const chain = {
        set: (key: string, value: number, _ex: string, ttl: number) => {
          ops.push(() => {
            if (!counters.has(key)) {
              counters.set(key, value);
              ttls.set(key, ttl);
              return [null, 'OK'];
            }
            return [null, null];
          });
          return chain;
        },
        incr: (key: string) => {
          ops.push(() => {
            const next = (counters.get(key) ?? 0) + 1;
            counters.set(key, next);
            return [null, next];
          });
          return chain;
        },
        exec: async () => {
          if (failure.error) throw failure.error;
          return ops.map((op) => op());
        },
      };
      return chain;
    }),
    ttl: jest.fn(async (key: string) => ttls.get(key) ?? -2),
  };
  return { redis: redis as unknown as Redis, counters, ttls, failure };
}

describe('ScanRunThrottleGuard', () => {
  const savedEdition = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (savedEdition === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = savedEdition;
  });

  const contextOf = (
    ip: string,
    headers: Record<string, string> = {},
  ): { ctx: ExecutionContext; reply: { header: jest.Mock } } => {
    const reply = { header: jest.fn() };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ ip, headers }),
        getResponse: () => reply,
      }),
    } as unknown as ExecutionContext;
    return { ctx, reply };
  };

  it('allows about sixty requests a minute per address', () => {
    expect(SCAN_RUN_IP_LIMIT).toBe(60);
    expect(SCAN_RUN_IP_WINDOW_SECONDS).toBe(60);
  });

  it('lets the requests under the limit through and counts them per address', async () => {
    const { redis, counters, ttls } = fakeRedis();
    const guard = new ScanRunThrottleGuard(redis);
    for (let i = 0; i < SCAN_RUN_IP_LIMIT; i++) {
      await expect(guard.canActivate(contextOf('10.0.0.1').ctx)).resolves.toBe(
        true,
      );
    }
    expect(counters.get('rl:scan-run:ip:10.0.0.1')).toBe(SCAN_RUN_IP_LIMIT);
    expect(ttls.get('rl:scan-run:ip:10.0.0.1')).toBe(60);
  });

  it('counts every address of one IPv6 /64 in one bucket', async () => {
    const { redis, counters } = fakeRedis();
    const guard = new ScanRunThrottleGuard(redis);
    await guard.canActivate(contextOf('2001:db8:7:7::1').ctx);
    await guard.canActivate(contextOf('2001:db8:7:7:1::1').ctx);
    expect(counters.get('rl:scan-run:ip:2001:db8:7:7::/64')).toBe(2);
  });

  it('refuses the request past the limit with 429 RATE_LIMITED and Retry-After', async () => {
    const { redis } = fakeRedis();
    const guard = new ScanRunThrottleGuard(redis);
    for (let i = 0; i < SCAN_RUN_IP_LIMIT; i++) {
      await guard.canActivate(contextOf('10.0.0.1').ctx);
    }
    const { ctx, reply } = contextOf('10.0.0.1');
    const error = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '60');

    // Another address keeps its own budget.
    await expect(guard.canActivate(contextOf('10.0.0.2').ctx)).resolves.toBe(
      true,
    );
  });

  it('fails closed: a Redis failure is 503 rate_limit_unavailable', async () => {
    const { redis, failure } = fakeRedis();
    failure.error = new Error('connect ECONNREFUSED redis://user:pw@redis');
    const guard = new ScanRunThrottleGuard(redis);
    const error = await guard
      .canActivate(contextOf('10.0.0.1').ctx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(JSON.stringify((error as HttpException).getResponse())).toContain(
      'rate_limit_unavailable',
    );
    expect(
      JSON.stringify((error as HttpException).getResponse()),
    ).not.toContain('pw@');
  });

  it('never keys the Community Edition on cf-connecting-ip', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    const { redis, counters } = fakeRedis();
    const guard = new ScanRunThrottleGuard(redis);
    await guard.canActivate(
      contextOf('10.0.0.9', { 'cf-connecting-ip': '1.2.3.4' }).ctx,
    );
    expect([...counters.keys()]).toEqual(['rl:scan-run:ip:10.0.0.9']);
  });
});
