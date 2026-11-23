import { HttpException, Logger } from '@nestjs/common';
import {
  LOGIN_IN_FLIGHT_PER_ADDRESS,
  LOGIN_IN_FLIGHT_TTL_SECONDS,
  LoginInFlightLimiter,
  resetLoginInFlightFallback,
} from './login-in-flight-limiter';

/**
 * Mirrors the ioredis calls of the limiter: MULTI (INCR, EXPIRE) and the
 * conditional-decrement EVAL.
 */
function makeRedis(opts: { fail?: boolean } = {}) {
  const store: Record<string, number> = {};
  const expires: Record<string, number> = {};
  const reject = async () => {
    throw new Error('ECONNRESET');
  };
  return {
    status: 'ready',
    store,
    expires,
    multi: jest.fn(() => {
      const queue: Array<() => [Error | null, unknown]> = [];
      const chain = {
        incr: (key: string) => {
          queue.push(() => {
            store[key] = (store[key] ?? 0) + 1;
            return [null, store[key]];
          });
          return chain;
        },
        expire: (key: string, seconds: number) => {
          queue.push(() => {
            expires[key] = seconds;
            return [null, 1];
          });
          return chain;
        },
        exec: jest.fn(async () => {
          if (opts.fail) return reject();
          return queue.map((run) => run());
        }),
      };
      return chain;
    }),
    eval: jest.fn(async (_script: string, _n: number, key: string) => {
      if (opts.fail) return reject();
      if (!(key in store)) return 0;
      store[key] -= 1;
      return store[key];
    }),
  };
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

async function refusal(promise: Promise<unknown>) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  expect((err as HttpException).getStatus()).toBe(429);
  expect((err as HttpException).getResponse()).toMatchObject({
    code: 'RATE_LIMITED',
  });
}

/**
 * One address (an IPv6 /64) may run only a few logins at once: the password
 * verifier takes 4 at a time and queues 64, so one address must not be able
 * to fill that queue and make every other user's login a 503.
 */
describe('LoginInFlightLimiter', () => {
  beforeEach(() => {
    resetLoginInFlightFallback();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('allows 4 logins at once per address, far below the verifier queue', () => {
    expect(LOGIN_IN_FLIGHT_PER_ADDRESS).toBe(4);
    expect(LOGIN_IN_FLIGHT_TTL_SECONDS).toBe(30);
  });

  it('refuses the fifth concurrent login of one address with 429 and Retry-After 1', async () => {
    const limiter = new LoginInFlightLimiter(makeRedis() as never);
    for (let i = 0; i < 4; i++) {
      await limiter.acquire('2001:db8:1:2::/64', makeReply());
    }
    const reply = makeReply();
    await refusal(limiter.acquire('2001:db8:1:2::/64', reply));
    expect(reply.headers['Retry-After']).toBe('1');
    // Another address is untouched.
    await expect(
      limiter.acquire('198.51.100.1', makeReply()),
    ).resolves.toBeInstanceOf(Function);
  });

  it('frees the slot when the login ends, and a refusal holds none', async () => {
    const redis = makeRedis();
    const limiter = new LoginInFlightLimiter(redis as never);
    const releases = [];
    for (let i = 0; i < 4; i++) {
      releases.push(await limiter.acquire('198.51.100.1', makeReply()));
    }
    await refusal(limiter.acquire('198.51.100.1', makeReply()));
    await releases[0]();
    await expect(
      limiter.acquire('198.51.100.1', makeReply()),
    ).resolves.toBeInstanceOf(Function);
    expect(redis.store['rl:auth:login:inflight:198.51.100.1']).toBe(4);
  });

  it('gives every counter a TTL, so a crashed request never holds a slot for good', async () => {
    const redis = makeRedis();
    const limiter = new LoginInFlightLimiter(redis as never);
    await limiter.acquire('198.51.100.1', makeReply());
    expect(redis.expires['rl:auth:login:inflight:198.51.100.1']).toBe(30);
  });

  it('counts in-process when Redis fails, never an open door', async () => {
    const limiter = new LoginInFlightLimiter(
      makeRedis({ fail: true }) as never,
    );
    const releases = [];
    for (let i = 0; i < 4; i++) {
      releases.push(await limiter.acquire('198.51.100.1', makeReply()));
    }
    await refusal(limiter.acquire('198.51.100.1', makeReply()));
    await releases[0]();
    await expect(
      limiter.acquire('198.51.100.1', makeReply()),
    ).resolves.toBeInstanceOf(Function);
  });
});
