import { Controller, Get, Module, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';

import { AuthGuard } from '../guards/auth/auth.guard';
import { Public } from '../guards/auth/public.decorator';
import axios from 'axios';
import type { ConfigService } from '@nestjs/config';

import {
  BEARER_VERIFIER,
  type BearerVerifier,
} from '../../edition/ports/bearer-verifier.port';
import { PersonalAccessTokenBearerVerifier } from '../../edition/community/bearer-verifier.community';
import { httpAdapterOptions } from './http-surface.options';
import {
  DEFAULT_ANONYMOUS_MAX,
  DEFAULT_AUTHENTICATED_MAX,
  registerRequestGuards,
  requestGuardOptionsFromEnv,
  windowMsFrom,
  type RequestGuardOptions,
} from './request-guards';

/**
 * The public HTTP entry, driven through the real `AuthGuard` and the
 * production adapter: requests without valid credentials have a small budget
 * of their own per address, and an authenticated caller is counted on its
 * own identity, so neither can use up the other's share. A browser page of
 * another site is refused before anything else runs.
 */

const USERS: Record<string, string> = {
  'good-a': 'user-a',
  'good-a2': 'user-a',
  'good-b': 'user-b',
  'good-f': 'user-f',
};

/** Personal tokens: the session id is per token, the person is `subject`. */
const PERSONAL: Record<string, { userId: string; subject: string }> = {
  'pat-1': { userId: 'pat:1', subject: 'user:c' },
  'pat-2': { userId: 'pat:2', subject: 'user:c' },
};

/** A bearer accepted by the first check and refused by the next one. */
const flakyChecks = new Map<string, number>();

const verify = jest.fn(async (token: string) => {
  if (token.startsWith('flaky')) {
    const n = (flakyChecks.get(token) ?? 0) + 1;
    flakyChecks.set(token, n);
    return n % 2 === 1 ? { userId: 'user-f', accessToken: token } : null;
  }
  if (PERSONAL[token]) return { ...PERSONAL[token], accessToken: token };
  return USERS[token] ? { userId: USERS[token], accessToken: token } : null;
});

const verifier: BearerVerifier = {
  verify: (token) => verify(token),
  challenge: () => 'Bearer',
};

@Controller()
class ProbeController {
  @Post('mcp')
  handle(): { ok: boolean } {
    return { ok: true };
  }

  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: BEARER_VERIFIER, useValue: verifier },
    { provide: Logger, useValue: { log: jest.fn(), warn: jest.fn() } },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
class ProbeModule {}

const ANON_MAX = 3;
const AUTH_MAX = 5;
const WINDOW_MS = 60_000;

describe('registerRequestGuards', () => {
  let app: NestFastifyApplication;
  let clock: number;

  async function boot(overrides: Partial<RequestGuardOptions> = {}) {
    const mod = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(httpAdapterOptions(undefined)),
    );
    await registerRequestGuards(app, {
      authenticatedMax: AUTH_MAX,
      anonymousMax: ANON_MAX,
      windowMs: WINDOW_MS,
      allowedOrigins: new Set(['https://agent.example']),
      edition: 'community',
      nodeEnv: 'test',
      now: () => clock,
      ...overrides,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }

  function post(
    headers: Record<string, string> = {},
    remoteAddress = '127.0.0.1',
  ) {
    return app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {},
      remoteAddress,
      headers,
    });
  }

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeEach(async () => {
    clock = 1_000_000;
    verify.mockClear();
    flakyChecks.clear();
    await boot();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('requests without valid credentials', () => {
    it('get a small budget of their own per address', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < ANON_MAX + 2; i++) {
        statuses.push((await post()).statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    });

    it('do not stop an authenticated caller from the same address', async () => {
      for (let i = 0; i < ANON_MAX * 3; i++) await post();
      expect((await post()).statusCode).toBe(429);

      const res = await post(bearer('good-a'));

      expect(res.statusCode).toBe(201);
    });

    it('answer 429 with the delay before the window ends', async () => {
      for (let i = 0; i < ANON_MAX; i++) await post();

      const res = await post();

      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
      expect(res.json()).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded, retry in 60s',
      });
    });

    it('are counted again once the window has passed', async () => {
      for (let i = 0; i < ANON_MAX; i++) await post();
      expect((await post()).statusCode).toBe(429);

      clock += WINDOW_MS;

      expect((await post()).statusCode).toBe(401);
    });

    it('from another address are counted apart', async () => {
      for (let i = 0; i < ANON_MAX; i++) await post();

      expect((await post({}, '198.51.100.20')).statusCode).toBe(401);
    });

    it('cannot rotate X-Forwarded-For from a peer that is not a trusted proxy', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < ANON_MAX + 1; i++) {
        statuses.push(
          (await post({ 'x-forwarded-for': `198.51.100.${i}` })).statusCode,
        );
      }
      expect(statuses[ANON_MAX]).toBe(429);
    });

    it('with refused bearers do not spend the budget of requests without one', async () => {
      for (let i = 0; i < ANON_MAX; i++) await post(bearer(`forged-${i}`));

      expect((await post()).statusCode).toBe(401);
    });

    it('never count on the health probe', async () => {
      for (let i = 0; i < ANON_MAX * 2; i++) {
        expect(
          (await app.inject({ method: 'GET', url: '/health' })).statusCode,
        ).toBe(200);
      }
      expect((await post()).statusCode).toBe(401);
    });
  });

  describe('a refused bearer', () => {
    it.each([
      ['community', 'test', {}],
      ['cloud', 'production', { 'cf-connecting-ip': '203.0.113.50' }],
    ] as const)(
      'never makes a valid bearer wait, even one never seen before (%s, fresh instance as after a deploy)',
      async (edition, nodeEnv, edge) => {
        await app.close();
        await boot({ edition, nodeEnv });
        for (let i = 0; i < ANON_MAX * 5; i++) {
          expect(
            (await post({ ...edge, ...bearer(`forged-${i}`) }, '10.0.5.5'))
              .statusCode,
          ).toBe(401);
        }

        const res = await post({ ...edge, ...bearer('good-b') }, '10.0.5.5');

        expect(res.statusCode).toBe(201);
      },
    );

    it('accepted by verification then refused by authentication gives its count back', async () => {
      for (let i = 0; i < AUTH_MAX * 2; i++) {
        expect((await post(bearer(`flaky-${i}`))).statusCode).toBe(401);
      }

      // user-f has spent nothing: its whole budget is left.
      const statuses: number[] = [];
      for (let i = 0; i < AUTH_MAX; i++) {
        statuses.push((await post(bearer('good-f'))).statusCode);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201]);
    });
  });

  describe('in-cluster peers (no edge address header behind the edge)', () => {
    beforeEach(async () => {
      await app.close();
      await boot({ edition: 'cloud', nodeEnv: 'production' });
    });

    it('are never limited by address', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < ANON_MAX * 3; i++) {
        statuses.push((await post({}, '10.0.5.5')).statusCode);
      }
      expect(statuses.every((s) => s === 401)).toBe(true);
      expect((await post(bearer('good-a'), '10.0.5.5')).statusCode).toBe(201);
    });

    it('never wait on refused bearers, even where a verification is a call to another service', async () => {
      await app.close();
      await boot({
        edition: 'cloud',
        nodeEnv: 'production',
        verifier: { ...verifier, remote: true },
      });

      const statuses: number[] = [];
      for (let i = 0; i < ANON_MAX * 3; i++) {
        statuses.push(
          (await post(bearer(`forged-${i}`), '10.0.5.5')).statusCode,
        );
      }

      expect(statuses.every((s) => s === 401)).toBe(true);
      expect((await post(bearer('good-b'), '10.0.5.5')).statusCode).toBe(201);
    });

    it('while requests through the edge still are', async () => {
      const edge = { 'cf-connecting-ip': '203.0.113.50' };
      const statuses: number[] = [];
      for (let i = 0; i < ANON_MAX + 1; i++) {
        statuses.push((await post(edge, '10.0.5.5')).statusCode);
      }
      expect(statuses[ANON_MAX]).toBe(429);
    });
  });

  describe('concurrent requests', () => {
    it('are counted when they arrive: of a burst without credentials, exactly the budget gets through', async () => {
      const res = await Promise.all(Array.from({ length: 20 }, () => post()));
      const statuses = res.map((r) => r.statusCode);

      expect(statuses.filter((s) => s === 401)).toHaveLength(ANON_MAX);
      expect(statuses.filter((s) => s === 429)).toHaveLength(20 - ANON_MAX);
    });

    it('of one identity: exactly the budget is served', async () => {
      const res = await Promise.all(
        Array.from({ length: 20 }, () => post(bearer('good-b'))),
      );
      const statuses = res.map((r) => r.statusCode);

      expect(statuses.filter((s) => s === 201)).toHaveLength(AUTH_MAX);
    });

    it('with a new token of a user whose budget is spent: none is served', async () => {
      for (let i = 0; i < AUTH_MAX; i++) await post(bearer('good-a'));

      const res = await Promise.all(
        Array.from({ length: 20 }, () => post(bearer('good-a2'))),
      );

      expect(res.map((r) => r.statusCode).filter((s) => s === 201)).toEqual([]);
    });
  });

  describe('authenticated callers', () => {
    it('are counted on their own identity', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < AUTH_MAX + 1; i++) {
        statuses.push((await post(bearer('good-a'))).statusCode);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);

      expect((await post(bearer('good-b'))).statusCode).toBe(201);
    });

    it('keep their whole budget when requests without valid credentials flood the address', async () => {
      for (let i = 0; i < ANON_MAX * 3; i++) await post();
      for (let i = 0; i < ANON_MAX * 3; i++) await post(bearer(`forged-${i}`));

      const statuses: number[] = [];
      for (let i = 0; i < AUTH_MAX; i++) {
        statuses.push((await post(bearer('good-b'))).statusCode);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201]);
    });

    it('share one budget across the tokens of one user, from the first request', async () => {
      for (let i = 0; i < AUTH_MAX; i++) await post(bearer('good-a'));

      expect((await post(bearer('good-a2'))).statusCode).toBe(429);
    });

    it('are counted on the person the verifier names, not on the token', async () => {
      for (let i = 0; i < AUTH_MAX; i++) {
        expect((await post(bearer('pat-1'))).statusCode).toBe(201);
      }

      expect((await post(bearer('pat-2'))).statusCode).toBe(429);
    });
  });

  describe('Origin', () => {
    it('refuses a request from a page of a site that is not allowed', async () => {
      const res = await post({ origin: 'https://evil.example' });

      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses it before the bearer is checked or any budget is spent', async () => {
      for (let i = 0; i < ANON_MAX * 2; i++) {
        await post({ origin: 'https://evil.example', ...bearer('forged') });
      }

      expect(verify).not.toHaveBeenCalled();
      expect((await post()).statusCode).toBe(401);
    });

    it('refuses the opaque origin of a sandboxed page', async () => {
      expect((await post({ origin: 'null' })).statusCode).toBe(403);
    });

    it('serves an allowed origin', async () => {
      const res = await post({
        origin: 'https://agent.example',
        ...bearer('good-a'),
      });

      expect(res.statusCode).toBe(201);
    });

    it('serves a request without an Origin header (a local agent)', async () => {
      expect((await post(bearer('good-a'))).statusCode).toBe(201);
    });

    it('reflects only an allowed origin in CORS preflights', async () => {
      const preflight = (origin: string) =>
        app.inject({
          method: 'OPTIONS',
          url: '/mcp',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
        });

      expect(
        (await preflight('https://agent.example')).headers[
          'access-control-allow-origin'
        ],
      ).toBe('https://agent.example');
      const refused = await preflight('https://evil.example');
      expect(refused.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('serves any origin when the allow-list is a wildcard', async () => {
      await app.close();
      await boot({ allowedOrigins: '*' });

      expect(
        (await post({ origin: 'https://evil.example', ...bearer('good-a') }))
          .statusCode,
      ).toBe(201);
    });
  });
});

/**
 * The same entry with the Community Edition's verifier, which checks a
 * personal access token with one call to the gateway, so a verification
 * costs a call to another service. A bearer this process has not accepted
 * recently takes a place in a per-address budget before that call: refused
 * bearers (or bearers the gateway cannot check) keep their place until the
 * window ends, accepted ones give it back at once. A bearer already accepted
 * is served whatever other bearers from its address did.
 */
describe('registerRequestGuards with the community verifier', () => {
  const VALID = 'cdp_' + 'V'.repeat(43);
  const forged = (i: number) =>
    'cdp_' + String(i).padStart(43, 'F').slice(0, 43);
  const valid = (i: number) =>
    'cdp_' + String(i).padStart(43, 'W').slice(0, 43);
  const FLOODER = '203.0.113.7';
  const OTHER = '198.51.100.9';
  let app: NestFastifyApplication;
  let gatewayGet: jest.Mock;
  let clock: number;
  let gatewayDown: boolean;
  let gate: Promise<void> | null;

  const isValid = (token: string) =>
    token === VALID || /^cdp_W+\d+$/.test(token);

  @Module({
    controllers: [ProbeController],
    providers: [
      {
        provide: BEARER_VERIFIER,
        useFactory: () =>
          new PersonalAccessTokenBearerVerifier({
            get: () => 'http://gateway.test',
          } as unknown as ConfigService),
      },
      { provide: Logger, useValue: { log: jest.fn(), warn: jest.fn() } },
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class CommunityProbeModule {}

  async function boot() {
    const mod = await Test.createTestingModule({
      imports: [CommunityProbeModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(httpAdapterOptions(undefined)),
    );
    await registerRequestGuards(app, {
      authenticatedMax: AUTH_MAX,
      anonymousMax: ANON_MAX,
      windowMs: WINDOW_MS,
      allowedOrigins: new Set(),
      edition: 'community',
      nodeEnv: 'production',
      now: () => clock,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }

  const post = (token: string, remoteAddress = '127.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {},
      remoteAddress,
      headers: { authorization: `Bearer ${token}` },
    });

  /** The tokens the gateway was asked about, in order. */
  const asked = () =>
    gatewayGet.mock.calls.map(([, config]) =>
      String(config.headers.Authorization).replace(/^Bearer /, ''),
    );

  beforeEach(async () => {
    clock = 1_000_000;
    gatewayDown = false;
    gate = null;
    gatewayGet = jest.fn(
      async (_path: string, config: { headers: Record<string, string> }) => {
        if (gate) await gate;
        if (gatewayDown) return { status: 503, data: {} };
        const token = config.headers.Authorization.replace(/^Bearer /, '');
        // Each valid token belongs to its own person, so the per-person
        // budget never answers for the budget under test.
        return isValid(token)
          ? { status: 200, data: { id: `u-${token}` } }
          : { status: 401, data: {} };
      },
    );
    jest
      .spyOn(axios, 'create')
      .mockReturnValue({ get: gatewayGet } as unknown as ReturnType<
        typeof axios.create
      >);
    await boot();
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  /** Sends refused bearers from one address until its places are gone. */
  async function flood(from = FLOODER, count = ANON_MAX * 5) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) {
      statuses.push((await post(forged(i), from)).statusCode);
    }
    return statuses;
  }

  it('asks the gateway once about a refused bearer for the rest of the window', async () => {
    for (let i = 0; i < ANON_MAX; i++) {
      expect((await post(forged(1))).statusCode).toBe(401);
    }

    expect(gatewayGet).toHaveBeenCalledTimes(1);
  });

  describe('distinct refused bearers from one address', () => {
    it('reach the gateway at most the budget of the address, then get 429 before any verification', async () => {
      const statuses = await flood();

      expect(statuses.slice(0, ANON_MAX)).toEqual(
        new Array(ANON_MAX).fill(401),
      );
      expect(statuses.slice(ANON_MAX)).toEqual(
        new Array(ANON_MAX * 4).fill(429),
      );
      expect(gatewayGet).toHaveBeenCalledTimes(ANON_MAX);

      const res = await post(forged(999), FLOODER);
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
    });

    it('reach the gateway at most the budget of the address when they arrive together', async () => {
      const res = await Promise.all(
        Array.from({ length: ANON_MAX * 5 }, (_, i) =>
          post(forged(i), FLOODER),
        ),
      );
      const statuses = res.map((r) => r.statusCode);

      expect(gatewayGet.mock.calls.length).toBeLessThanOrEqual(ANON_MAX);
      expect(statuses.filter((s) => s === 401)).toHaveLength(ANON_MAX);
      expect(statuses.filter((s) => s === 429)).toHaveLength(ANON_MAX * 4);
    });

    it('are counted the same way when the gateway cannot answer', async () => {
      gatewayDown = true;

      const statuses = await flood();

      // A failed check is not cached, so a request let through is checked
      // again by the authentication guard: at most two calls for each of the
      // budget's bearers, and no other bearer reaches the gateway.
      expect(new Set(asked()).size).toBe(ANON_MAX);
      expect(gatewayGet.mock.calls.length).toBeLessThanOrEqual(2 * ANON_MAX);
      expect(statuses.slice(0, ANON_MAX).every((s) => s !== 429)).toBe(true);
      expect(statuses.slice(ANON_MAX).every((s) => s === 429)).toBe(true);
    });

    it('are counted the same way when the gateway cannot answer and they arrive together', async () => {
      gatewayDown = true;

      const res = await Promise.all(
        Array.from({ length: ANON_MAX * 5 }, (_, i) =>
          post(forged(i), FLOODER),
        ),
      );

      expect(new Set(asked()).size).toBeLessThanOrEqual(ANON_MAX);
      expect(gatewayGet.mock.calls.length).toBeLessThanOrEqual(2 * ANON_MAX);
      expect(res.filter((r) => r.statusCode === 429)).toHaveLength(
        ANON_MAX * 4,
      );
    });

    it('do not spend the budget of requests without a bearer', async () => {
      await flood();

      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        payload: {},
        remoteAddress: FLOODER,
      });

      expect(res.statusCode).toBe(401);
    });

    it('are counted again once the window has passed', async () => {
      await flood();

      clock += WINDOW_MS;

      expect((await post(forged(1000), FLOODER)).statusCode).toBe(401);
    });
  });

  describe('during a flood of refused bearers', () => {
    it('a bearer accepted before the flood is still served', async () => {
      expect((await post(VALID, FLOODER)).statusCode).toBe(201);

      await flood();

      expect((await post(VALID, FLOODER)).statusCode).toBe(201);
    });

    it('a valid bearer never used on this process, from the flooding address, waits until the window ends', async () => {
      await flood();

      const waiting = await post(VALID, FLOODER);
      expect(waiting.statusCode).toBe(429);
      expect(waiting.headers['retry-after']).toBe('60');
      expect(asked()).not.toContain(VALID);

      clock += WINDOW_MS;

      expect((await post(VALID, FLOODER)).statusCode).toBe(201);
    });

    it('a valid bearer never seen before, from another address, is served', async () => {
      await flood();

      expect((await post(VALID, OTHER)).statusCode).toBe(201);
    });

    it('refused bearers from another address are still verified', async () => {
      await flood();

      expect((await post(forged(1), OTHER)).statusCode).toBe(401);
    });
  });

  describe('a burst of valid bearers never seen before, from one address', () => {
    it('gives every place back: a 429 says retry in 1 second, a retry is served, nothing is counted as refused', async () => {
      let open!: () => void;
      gate = new Promise<void>((resolve) => (open = resolve));
      const tokens = Array.from({ length: ANON_MAX * 3 }, (_, i) => valid(i));

      const pending = Promise.all(tokens.map((t) => post(t, FLOODER)));
      await new Promise((resolve) => setTimeout(resolve, 50));
      open();
      const res = await pending;
      gate = null;

      const turnedAway = tokens.filter((_, i) => res[i].statusCode === 429);
      expect(res.filter((r) => r.statusCode === 201)).toHaveLength(ANON_MAX);
      expect(turnedAway.length).toBeGreaterThan(0);
      for (const r of res.filter((x) => x.statusCode === 429)) {
        expect(r.headers['retry-after']).toBe('1');
      }

      for (const token of turnedAway) {
        expect((await post(token, FLOODER)).statusCode).toBe(201);
      }
      // No place is held: a full budget of refused bearers still reaches
      // the gateway.
      const statuses = await flood(FLOODER, ANON_MAX);
      expect(statuses).toEqual(new Array(ANON_MAX).fill(401));
    });
  });
});

describe('windowMsFrom', () => {
  it.each([
    ['1 minute', 60_000],
    ['10 seconds', 10_000],
    ['30s', 30_000],
    ['2 hours', 7_200_000],
    ['1500', 1_500],
    [undefined, 60_000],
    ['soon', 60_000],
    ['0 seconds', 60_000],
  ])('%p → %p ms', (raw, expected) => {
    expect(windowMsFrom(raw)).toBe(expected);
  });
});

describe('requestGuardOptionsFromEnv', () => {
  it('reads the budgets, the window and the origins', () => {
    const options = requestGuardOptionsFromEnv(
      {
        RATE_LIMIT_MAX: '300',
        RATE_LIMIT_ANONYMOUS_MAX: '20',
        RATE_LIMIT_WINDOW: '30 seconds',
        MCP_ALLOWED_ORIGINS: 'https://agent.example',
        PUBLIC_URL: 'http://localhost:3010',
        NODE_ENV: 'production',
      },
      'community',
    );

    expect(options).toEqual({
      authenticatedMax: 300,
      anonymousMax: 20,
      windowMs: 30_000,
      allowedOrigins: new Set([
        'https://agent.example',
        'http://localhost:3010',
      ]),
      edition: 'community',
      nodeEnv: 'production',
    });
  });

  it('falls back to the defaults on missing or invalid values', () => {
    const options = requestGuardOptionsFromEnv(
      { RATE_LIMIT_MAX: '-1', RATE_LIMIT_ANONYMOUS_MAX: 'many' },
      'community',
    );

    expect(options.authenticatedMax).toBe(DEFAULT_AUTHENTICATED_MAX);
    expect(options.anonymousMax).toBe(DEFAULT_ANONYMOUS_MAX);
    expect(options.windowMs).toBe(60_000);
    expect(options.allowedOrigins).toEqual(new Set());
  });
});
