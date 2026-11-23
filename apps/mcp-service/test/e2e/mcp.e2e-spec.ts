/**
 * End-to-end smoke for mcp-service.
 *
 * Boots the real {@link AppModule} on Fastify through
 * `Test.createTestingModule` and asserts that `/health` is publicly
 * reachable. The OAuth discovery and callback surfaces are cloud-only and
 * tested with the closed code. The Community Edition's
 * bearer challenge is test/e2e/community.e2e-spec.ts.
 *
 * Env is set BEFORE importing `AppModule` so the Joi validation schema sees
 * the test values.
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

// `jose@6` ships only as native ESM, which Jest's default CJS runtime cannot
// load. We swap it for a stub here — the e2e only exercises the 401 path,
// which short-circuits before `jwtVerify` is ever called, so a no-op JWKS
// factory is sufficient.
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

describe('mcp-service e2e', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
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

  it('GET /health returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      service: 'mcp-service',
    });
  });
});
