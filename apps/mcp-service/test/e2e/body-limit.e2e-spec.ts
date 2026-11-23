/**
 * Body-limit e2e.
 *
 * Fastify is wired in src/main.ts with a 256 KB bodyLimit on the POST /mcp
 * surface — MCP messages are protocol-level RPC envelopes and
 * never carry file-sized payloads, so we clamp aggressively to defend
 * against memory-exhaustion / amplification attacks.
 *
 * This spec mirrors the rate-limit e2e: boot a mini Nest app on Fastify,
 * mirror main.ts's configuration (bodyLimit, rate-limit), then POST a
 * 300 KB JSON body to /mcp and assert the server rejects with 413
 * (Payload Too Large). The route handler is not reached — Fastify enforces
 * the limit at the parser level.
 */

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

// Mirror src/main.ts: 256 KB bodyLimit on the Fastify adapter.
const MCP_BODY_LIMIT = 256 * 1024;

describe('mcp-service body limit e2e', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true, bodyLimit: MCP_BODY_LIMIT }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a 300 KB POST /mcp body with 413 (Payload Too Large)', async () => {
    // Construct a JSON object well above the 256 KB cap. We pad a single
    // string field to ~300 KB so the parser hits the limit on the first
    // chunk it reads.
    const padding = 'x'.repeat(300 * 1024);
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: padding }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('accepts a small POST /mcp body (still 401 unauthenticated, but parsed)', async () => {
    // Sanity check: a small body is parsed normally and reaches the auth
    // guard, which 401s — proving the body limit doesn't reject every
    // request blanket-style.
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.statusCode).toBe(401);
  });
});
