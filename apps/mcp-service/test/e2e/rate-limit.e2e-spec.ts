/**
 * Rate-limit e2e.
 *
 * The @fastify/rate-limit plugin is wired in src/main.ts with a global scope
 * and an allow-list for /health and /.well-known/oauth-*. This spec boots a
 * mini Nest app mirroring main.ts's registration, lowers the bucket to 5
 * per 10 seconds via env vars, then fires a burst of POST /mcp requests
 * (unauthenticated — the 401 path still counts toward the bucket) and
 * asserts at least one 429 response.
 *
 * Assertion scope: "plugin is wired and counts requests", not "exact
 * threshold timing". If Fastify tightens its allow-list evaluation order in
 * the future, swapping the burst target is fine — the contract we care about
 * is that /mcp is NOT allow-listed.
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
process.env.RATE_LIMIT_WINDOW = '10 seconds';

// `jose@6` is ESM-only — the e2e hits unauth endpoints so jwtVerify is never
// called. Stub it so Jest's CJS runtime can import AppModule cleanly.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

import { HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import rateLimit from '@fastify/rate-limit';

import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/core/exception/global-exception.filter';
import { parseTrustProxyCidrs } from '../../src/core/trust-proxy/trust-proxy';

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
      new FastifyAdapter({
        trustProxy: parseTrustProxyCidrs(process.env.TRUST_PROXY_CIDR),
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );

    // Mirror main.ts — register rate-limit on the underlying Fastify instance
    // BEFORE init/ready so the plugin hooks into the request lifecycle.
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(rateLimit, {
      global: true,
      max: Number(process.env.RATE_LIMIT_MAX ?? 120),
      timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
      keyGenerator: (req) => req.ip,
      allowList: (req) => {
        const url = req.url || '';
        return (
          url.startsWith('/health') ||
          url.startsWith('/.well-known/oauth-protected-resource') ||
          url.startsWith('/.well-known/oauth-authorization-server')
        );
      },
      errorResponseBuilder: (_req, ctx) =>
        new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: `Rate limit exceeded, retry in ${Math.ceil(ctx.ttl / 1000)}s`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('triggers 429 when POST /mcp bursts past the configured max', async () => {
    // Fire 10 requests in parallel against /mcp (not allow-listed). The guard
    // rejects each with 401, but the rate-limit hook runs first so at least
    // the tail of the burst should see 429.
    const burst = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: 'POST', url: '/mcp', payload: {} }),
      ),
    );
    const statuses = burst.map((r) => r.statusCode);
    expect(statuses).toContain(429);
  });

  it('still triggers 429 when callers rotate X-Forwarded-For (TRUST_PROXY_CIDR unset)', async () => {
    // With `trustProxy: true`, a different X-Forwarded-For value on every
    // request would make @fastify/rate-limit see a fresh bucket each time and
    // never trigger 429. With `trustProxy: parseTrustProxyCidrs(undefined)`
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
