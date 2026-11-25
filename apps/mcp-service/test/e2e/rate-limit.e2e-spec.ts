/**
 * Rate-limit e2e.
 *
 * Boots the application with the request guards `src/main.ts` registers
 * (`registerRequestGuards` with `requestGuardOptionsFromEnv`), lowers the
 * budget of requests without credentials to 5 per 10 seconds, then fires
 * bursts at POST /mcp: requests without a bearer are counted on their
 * address (the 401 path counts), a forwarded-address header from a peer
 * that is not a trusted proxy changes nothing, and refused bearers, checked
 * with a call to the gateway in this edition, have a budget of their own per
 * address.
 */

// Lower the limiter bucket BEFORE AppModule / main.ts reads process.env.
// The core contract holds in every edition; it runs in the Community Edition,
// which needs no identity provider and no secret store (the cloud run is under
// test/e2e/ee/).
for (const key of Object.keys(process.env)) {
  if (key.startsWith('LOGTO_')) delete process.env[key];
}
process.env.CYBEDEFEND_EDITION = 'community';
process.env.NODE_ENV = 'development';
process.env.PORT = '3010';
process.env.PUBLIC_URL = 'http://localhost:3010';
process.env.CYBEDEFEND_API_RESOURCE = 'http://localhost:3000';
process.env.FRONTEND_URL = 'http://localhost:3002';
process.env.OTEL_DISABLED = 'true';
process.env.RATE_LIMIT_MAX = '5';
process.env.RATE_LIMIT_ANONYMOUS_MAX = '5';
process.env.RATE_LIMIT_WINDOW = '10 seconds';

// `jose@6` is ESM-only — the e2e hits unauth endpoints so jwtVerify is never
// called. Stub it so Jest's CJS runtime can import AppModule cleanly.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/core/exception/global-exception.filter';
import { httpAdapterOptions } from '../../src/core/http/http-surface.options';
import {
  registerRequestGuards,
  requestGuardOptionsFromEnv,
} from '../../src/core/http/request-guards';

describe('mcp-service rate limit e2e', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // Mirror main.ts: trustProxy is parsed from TRUST_PROXY_CIDR. The env var
    // is intentionally NOT set in this spec so that `trustProxy` resolves to
    // `false` — see the "XFF rotation" test below for why this matters.
    delete process.env.TRUST_PROXY_CIDR;

    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(httpAdapterOptions(process.env.TRUST_PROXY_CIDR)),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );

    // The registration main.ts runs, before init/ready.
    await registerRequestGuards(app, requestGuardOptionsFromEnv(process.env));

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('triggers 429 when POST /mcp bursts past the configured max', async () => {
    // Fire 10 requests without credentials in parallel against /mcp (not
    // exempt). Each is counted when it arrives: 5 reach the authentication
    // guard (401), the rest get 429.
    const burst = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: 'POST', url: '/mcp', payload: {} }),
      ),
    );
    const statuses = burst.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it('answers made-up bearers 401 up to their own budget of the address, then 429 before checking them', async () => {
    // The Community Edition checks a token with a call to the gateway, so
    // bearers not accepted recently have a budget per address, apart from
    // the one requests without a bearer spent above.
    const burst = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/mcp',
          payload: {},
          headers: { authorization: `Bearer not-a-token-${i}` },
        }),
      ),
    );
    const statuses = burst.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    for (const r of burst.filter((x) => x.statusCode === 429)) {
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    }
  });

  it('still triggers 429 when callers rotate X-Forwarded-For (TRUST_PROXY_CIDR unset)', async () => {
    // With `trustProxy: true`, a different X-Forwarded-For value on every
    // request would key a fresh bucket each time and never trigger 429. With `trustProxy: parseTrustProxyCidrs(undefined)`
    // (i.e. `false`), `req.ip` ignores XFF and falls back to the socket origin,
    // so the bucket fills as if the headers were never sent.
    const burst = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/mcp',
          payload: {},
          headers: { 'x-forwarded-for': `9.9.9.${i}` },
        }),
      ),
    );
    const statuses = burst.map((r) => r.statusCode);
    expect(statuses).toContain(429);
  });
});
