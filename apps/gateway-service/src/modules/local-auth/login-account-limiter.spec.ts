import { createHash } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import {
  LOGIN_ACCOUNT_FAILURE_LIMIT,
  LOGIN_ACCOUNT_WINDOW_SECONDS,
  LOGIN_TRUST_TTL_SECONDS,
  LoginAccountLimiter,
  resetLoginAccountFallback,
} from './login-account-limiter';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const keyOf = (email: string) => `rl:auth:login:acct:${sha256(email)}`;

/**
 * Mirrors the ioredis calls of the limiter: MULTI (SET key 0 EX w NX, INCR,
 * TTL), DEL, and the conditional-decrement EVAL. `fail` makes every call
 * reject, `status` is ioredis' connection state.
 */
function makeRedis(
  opts: { fail?: boolean; status?: string; ttl?: number } = {},
) {
  const store: Record<string, number> = {};
  const sets: unknown[][] = [];
  /** The trust records (SET key 1 EX ttl), apart from the counters. */
  const trust: Record<string, unknown[]> = {};
  const reject = async () => {
    throw new Error('ECONNRESET');
  };
  const redis = {
    status: opts.status ?? 'ready',
    store,
    sets,
    trust,
    set: jest.fn(async (key: string, ...rest: unknown[]) => {
      if (opts.fail) return reject();
      trust[key] = rest;
      return 'OK';
    }),
    exists: jest.fn(async (...keys: string[]) => {
      if (opts.fail) return reject();
      return keys.filter((k) => k in trust).length;
    }),
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
        ttl: (key: string) => {
          queue.push(() => [null, key in store ? (opts.ttl ?? 600) : -2]);
          return chain;
        },
        exec: jest.fn(async () => {
          if (opts.fail) return reject();
          return queue.map((run) => run());
        }),
      };
      return chain;
    }),
    del: jest.fn(async (key: string) => {
      if (opts.fail) return reject();
      const had = key in store;
      delete store[key];
      return had ? 1 : 0;
    }),
    eval: jest.fn(async (_script: string, _n: number, key: string) => {
      if (opts.fail) return reject();
      if (!(key in store)) return 0;
      store[key] -= 1;
      return store[key];
    }),
  };
  return redis;
}

function makeReply() {
  const headers: Record<string, string> = {};
  return {
    headers,
    header: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

async function fail(limiter: LoginAccountLimiter, email: string, n: number) {
  for (let i = 0; i < n; i++) {
    // A failed attempt: reserved, then left counted (INVALID_CREDENTIALS).
    await expect(limiter.reserve(email, makeReply())).resolves.toBeDefined();
  }
}

async function expectLocked(limiter: LoginAccountLimiter, email: string) {
  const reply = makeReply();
  const err = await limiter.reserve(email, reply).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(429);
  expect((err as HttpException).getResponse()).toMatchObject({
    code: 'RATE_LIMITED',
    message: 'RATE_LIMITED',
  });
  return reply.headers;
}

describe('LoginAccountLimiter', () => {
  beforeEach(() => {
    resetLoginAccountFallback();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('fixes the per-account bucket at 20 failed attempts per 15 minutes', () => {
    expect([LOGIN_ACCOUNT_FAILURE_LIMIT, LOGIN_ACCOUNT_WINDOW_SECONDS]).toEqual(
      [20, 900],
    );
  });

  it('locks an account after 20 failed attempts, whatever the address, with Retry-After', async () => {
    const redis = makeRedis({ ttl: 512 });
    const limiter = new LoginAccountLimiter(redis as never);
    // The limiter never reads an address: 20 failures from a botnet of 20
    // addresses are 20 failures of the account.
    await fail(limiter, 'victim@x.io', 20);
    const headers = await expectLocked(limiter, 'victim@x.io');
    expect(headers['Retry-After']).toBe('512');
    // Another account is untouched.
    await expect(
      limiter.reserve('other@x.io', makeReply()),
    ).resolves.toBeDefined();
  });

  it('gives the window its TTL when it is created and never extends it', async () => {
    const redis = makeRedis();
    const limiter = new LoginAccountLimiter(redis as never);
    await fail(limiter, 'victim@x.io', 20);
    await expectLocked(limiter, 'victim@x.io');
    await expectLocked(limiter, 'victim@x.io');
    // Every SET is NX with the window: a refused attempt does not push the
    // end of the lock, so it ends at most 15 minutes after the first failure.
    for (const args of redis.sets) {
      expect(args).toEqual([keyOf('victim@x.io'), 0, 'EX', 900, 'NX']);
    }
  });

  it('resets the account counter on a successful login', async () => {
    const redis = makeRedis();
    const limiter = new LoginAccountLimiter(redis as never);
    await fail(limiter, 'user@x.io', 19);
    const attempt = await limiter.reserve('user@x.io', makeReply());
    await attempt.succeeded();
    expect(redis.store[keyOf('user@x.io')]).toBeUndefined();
    await fail(limiter, 'user@x.io', 20);
    await expectLocked(limiter, 'user@x.io');
  });

  it('gives back an attempt that did not fail on the credentials', async () => {
    const redis = makeRedis();
    const limiter = new LoginAccountLimiter(redis as never);
    for (let i = 0; i < 30; i++) {
      const attempt = await limiter.reserve('user@x.io', makeReply());
      await attempt.refund(); // an outage, a busy verifier: not the user's fault
    }
    expect(redis.store[keyOf('user@x.io')]).toBe(0);
    await fail(limiter, 'user@x.io', 20);
  });

  it('never creates a counter without a TTL when refunding an expired one', async () => {
    const redis = makeRedis();
    const limiter = new LoginAccountLimiter(redis as never);
    const attempt = await limiter.reserve('user@x.io', makeReply());
    delete redis.store[keyOf('user@x.io')]; // the window expired meanwhile
    await attempt.refund();
    expect(keyOf('user@x.io') in redis.store).toBe(false);
  });

  it('treats an unknown e-mail exactly like a known one', async () => {
    // The limiter does not know which accounts exist: the same 20 failures
    // lock an e-mail nobody uses, so a 429 tells nothing about an account.
    const redis = makeRedis();
    const limiter = new LoginAccountLimiter(redis as never);
    await fail(limiter, 'ghost@nowhere.io', 20);
    await expectLocked(limiter, 'ghost@nowhere.io');
  });

  it('keys the account on a digest of the normalised e-mail, never the e-mail', async () => {
    const redis = makeRedis();
    const limiter = new LoginAccountLimiter(redis as never);
    await limiter.reserve(' Victim@X.io ', makeReply());
    await limiter.reserve('victim@x.io', makeReply());
    expect(Object.keys(redis.store)).toEqual([keyOf('victim@x.io')]);
    expect(redis.store[keyOf('victim@x.io')]).toBe(2);
    expect(JSON.stringify(redis.sets).toLowerCase()).not.toContain('victim');
  });

  it('never logs the e-mail when it locks an account', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const limiter = new LoginAccountLimiter(makeRedis() as never);
    await fail(limiter, 'victim@x.io', 20);
    await expectLocked(limiter, 'victim@x.io');
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) {
      expect(String(call[0]).toLowerCase()).not.toContain('victim');
    }
  });

  it('counts in-process when Redis fails, never an open door', async () => {
    const redis = makeRedis({ fail: true });
    const limiter = new LoginAccountLimiter(redis as never);
    await fail(limiter, 'victim@x.io', 20);
    const headers = await expectLocked(limiter, 'victim@x.io');
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    expect(Number(headers['Retry-After'])).toBeLessThanOrEqual(900);
  });

  it('does not ask Redis while ioredis reports the connection down', async () => {
    const redis = makeRedis({ status: 'reconnecting' });
    const limiter = new LoginAccountLimiter(redis as never);
    await fail(limiter, 'victim@x.io', 20);
    await expectLocked(limiter, 'victim@x.io');
    expect(redis.multi).not.toHaveBeenCalled();
  });

  it('resets and refunds the in-process counter when Redis is down', async () => {
    const limiter = new LoginAccountLimiter(makeRedis({ fail: true }) as never);
    await fail(limiter, 'user@x.io', 19);
    await (await limiter.reserve('user@x.io', makeReply())).succeeded();
    for (let i = 0; i < 25; i++) {
      await (await limiter.reserve('user@x.io', makeReply())).refund();
    }
    await fail(limiter, 'user@x.io', 20);
    await expectLocked(limiter, 'user@x.io');
  });

  it('ends an in-process lock with its window', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const limiter = new LoginAccountLimiter(makeRedis({ fail: true }) as never);
    await fail(limiter, 'victim@x.io', 20);
    await expectLocked(limiter, 'victim@x.io');
    now.mockReturnValue(1_000_000 + 900_000);
    await expect(
      limiter.reserve('victim@x.io', makeReply()),
    ).resolves.toBeDefined();
  });

  describe('a client that proved itself is never locked out', () => {
    const DEVICE = 'd'.repeat(43);
    const OTHER_DEVICE = 'e'.repeat(43);
    const HOME = '198.51.100.7';

    async function locked(limiter: LoginAccountLimiter) {
      // 20 failures from a spraying botnet: another device, other addresses.
      for (let i = 0; i < 20; i++) {
        await limiter.reserve('admin@x.io', makeReply(), {
          deviceToken: OTHER_DEVICE,
        });
      }
    }

    it('lets the device that signed in before through a locked account, and refuses the others', async () => {
      const redis = makeRedis();
      const limiter = new LoginAccountLimiter(redis as never);
      const first = await limiter.reserve('admin@x.io', makeReply(), {
        deviceToken: DEVICE,
      });
      await first.succeeded();
      await locked(limiter);

      await expect(
        limiter.reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        }),
      ).resolves.toBeDefined();
      const refused = await limiter
        .reserve('admin@x.io', makeReply(), {
          deviceToken: OTHER_DEVICE,
        })
        .catch((e: unknown) => e);
      expect((refused as HttpException).getStatus()).toBe(429);
    });

    it('refuses an address that signed in to the account before, without its device cookie', async () => {
      // Another browser behind the same NAT or IPv6 /64 is not the user.
      const redis = makeRedis();
      const limiter = new LoginAccountLimiter(redis as never);
      await (
        await limiter.reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        })
      ).succeeded();
      await locked(limiter);

      // Even a caller that hands the limiter the address gets no trust for it.
      const sameAddressOtherBrowser = {
        deviceToken: 'f'.repeat(43),
      };
      const refused = await limiter
        .reserve('admin@x.io', makeReply(), sameAddressOtherBrowser)
        .catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(HttpException);
      expect((refused as HttpException).getStatus()).toBe(429);
    });

    it('still counts the attempts of a trusted client', async () => {
      const redis = makeRedis();
      const limiter = new LoginAccountLimiter(redis as never);
      await (
        await limiter.reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        })
      ).succeeded();
      await locked(limiter);
      await limiter.reserve('admin@x.io', makeReply(), {
        deviceToken: DEVICE,
      });
      expect(redis.store[keyOf('admin@x.io')]).toBe(21);
    });

    it('does not trust a device for another account', async () => {
      const redis = makeRedis();
      const limiter = new LoginAccountLimiter(redis as never);
      await (
        await limiter.reserve('user@x.io', makeReply(), {
          deviceToken: DEVICE,
        })
      ).succeeded();
      await locked(limiter);
      const refused = await limiter
        .reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        })
        .catch((e: unknown) => e);
      expect((refused as HttpException).getStatus()).toBe(429);
    });

    it('stores the trust as digests with a 30-day TTL: no e-mail, token or address', async () => {
      const redis = makeRedis();
      const limiter = new LoginAccountLimiter(redis as never);
      await (
        await limiter.reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        })
      ).succeeded();
      expect(LOGIN_TRUST_TTL_SECONDS).toBe(30 * 86_400);
      const keys = Object.keys(redis.trust);
      expect(keys).toHaveLength(1);
      for (const key of keys) {
        expect(key).toMatch(/^rl:auth:login:trust:dev:[0-9a-f]{64}$/);
        expect(redis.trust[key]).toEqual([1, 'EX', LOGIN_TRUST_TTL_SECONDS]);
      }
      const dump = JSON.stringify(redis.trust);
      for (const secret of ['admin', DEVICE, HOME]) {
        expect(dump).not.toContain(secret);
      }
    });

    it('a password reset clears the counter and trusts the browser that reset it', async () => {
      const redis = makeRedis();
      const limiter = new LoginAccountLimiter(redis as never);
      await locked(limiter);
      await limiter.trust(' Admin@X.io ', {
        deviceToken: DEVICE,
      });
      expect(redis.store[keyOf('admin@x.io')]).toBeUndefined();
      await locked(limiter);
      await expect(
        limiter.reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        }),
      ).resolves.toBeDefined();
    });

    it('trusts nobody while Redis fails: the strict side', async () => {
      const limiter = new LoginAccountLimiter(
        makeRedis({ fail: true }) as never,
      );
      await locked(limiter);
      const refused = await limiter
        .reserve('admin@x.io', makeReply(), {
          deviceToken: DEVICE,
        })
        .catch((e: unknown) => e);
      expect((refused as HttpException).getStatus()).toBe(429);
    });
  });
});
