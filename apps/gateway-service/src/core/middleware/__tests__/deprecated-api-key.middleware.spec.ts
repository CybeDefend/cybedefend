import {
  Controller,
  Get,
  Module,
  MiddlewareConsumer,
  NestModule,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DeprecatedApiKeyMiddleware } from '../deprecated-api-key.middleware';

@Controller()
class RoutesUnderWildcardController {
  @Get('/') root() {
    return { ok: 'root' };
  }

  @Get('/organization') shallow() {
    return { ok: 'shallow' };
  }

  @Get('/organization/:organizationId/project/:projectId/results')
  deep() {
    return { ok: 'deep' };
  }

  @Post('/organization/:organizationId/scan')
  post() {
    return { ok: 'post' };
  }
}

// Mirrors AppModule exactly: a single middleware bound with the LEGACY
// wildcard syntax `forRoutes('*')`. Nest 11 rewrites that through its
// legacy-route conversion layer onto path-to-regexp v8 (`{*path}`), and
// 11.2.0 changed how that conversion handles wildcard segments. This spec
// pins the only behaviour that matters here: the middleware still runs on
// EVERY route shape, so a deprecated `x-api-key` can never reach a handler.
@Module({ controllers: [RoutesUnderWildcardController] })
class WildcardMiddlewareTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DeprecatedApiKeyMiddleware).forRoutes('*');
  }
}

describe("DeprecatedApiKeyMiddleware bound with forRoutes('*')", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      WildcardMiddlewareTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const routes: Array<[string, string]> = [
    ['GET', '/'],
    ['GET', '/organization'],
    ['GET', '/organization/org-1/project/proj-1/results'],
    ['POST', '/organization/org-1/scan'],
  ];

  describe.each(routes)('%s %s', (method, url) => {
    it('rejects a legacy x-api-key header with 410 Gone', async () => {
      const res = await app.inject({
        method: method as 'GET' | 'POST',
        url,
        headers: { 'x-api-key': 'legacy-key-value' },
      });

      expect(res.statusCode).toBe(410);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('Gone');
      expect(body.deprecatedHeader).toBe('X-Api-Key');
      expect(body.migration.authMethod).toBe('Bearer token');
    });

    it('lets a request without the legacy header through to the handler', async () => {
      const res = await app.inject({
        method: method as 'GET' | 'POST',
        url,
      });

      expect(res.statusCode).toBeLessThan(400);
      expect(JSON.parse(res.payload).ok).toBeDefined();
    });
  });

  it('matches the header case-insensitively, as HTTP requires', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/organization',
      headers: { 'X-API-KEY': 'legacy-key-value' },
    });

    expect(res.statusCode).toBe(410);
  });
});
