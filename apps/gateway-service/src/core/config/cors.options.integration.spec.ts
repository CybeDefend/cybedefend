/**
 * The CORS preflight of an SSE stream, exercised end to end.
 *
 * Hermetic on purpose: a bare Nest + Fastify app with one trivial controller
 * declaring the SAME route shape as `projects-realtime.controller.ts`
 * (`GET /v1/realtime/projects/:projectId/issues/stream`), and nothing else —
 * no guards, no gRPC client, no Redis. What it proves is exactly the thing the
 * unit spec on `buildCorsOptions` cannot: that `@fastify/cors`, as configured
 * by those options, actually answers the browser's preflight with
 * `access-control-allow-headers` containing `last-event-id`.
 *
 * It lives under `src/` (not `test/e2e/`) because the e2e runner hits a LIVE
 * gateway (`GATEWAY_URL`, `test/jest-e2e.json`); this one must run in CI with
 * no infrastructure at all.
 */
import { Controller, Get, Header } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { buildCorsOptions } from './cors.options';

const ALLOWED_ORIGIN = 'https://app.example.com';
const STREAM_PATH = '/v1/realtime/projects/p-1/issues/stream';

@Controller('v1/realtime/projects/:projectId')
class StreamStubController {
  @Get('issues/stream')
  stream(): string {
    return 'ok';
  }
}

/** A route that answers with the headers the rate limiter sets. */
@Controller('organization/:organizationId')
class ThrottledStubController {
  @Get('closed-product/projects')
  @Header('X-RateLimit-Limit', '300')
  @Header('X-RateLimit-Remaining', '297')
  @Header('X-RateLimit-Reset', '42')
  projects(): string {
    return 'ok';
  }
}

describe('CORS preflight on an SSE route', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StreamStubController, ThrottledStubController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableCors(buildCorsOptions({ FRONTEND_URL: ALLOWED_ORIGIN }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 204 and allows last-event-id for an allowed origin', async () => {
    const response = await request(app.getHttpServer())
      .options(STREAM_PATH)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,last-event-id');

    // For the record, the preflight this produces today:
    //   204
    //   access-control-allow-origin:      https://app.example.com
    //   access-control-allow-credentials: true
    //   access-control-allow-methods:     GET, POST, PUT, DELETE, PATCH
    //   access-control-allow-headers:     Authorization, Content-Type,
    //                                     Last-Event-ID, Cache-Control
    //   vary:                             Origin
    expect(response.status).toBe(204);
    // Header VALUES are case-insensitive per RFC 9110 §5.1 and browsers match
    // the requested header names case-insensitively; assert the same way
    // rather than pinning the exact casing the gateway happens to emit.
    const allowHeaders = (
      response.headers['access-control-allow-headers'] || ''
    ).toLowerCase();
    expect(allowHeaders).toContain('last-event-id');
    expect(allowHeaders).toContain('authorization');
    expect(allowHeaders).toContain('content-type');
    expect(allowHeaders).toContain('cache-control');
    expect(response.headers['access-control-allow-origin']).toBe(
      ALLOWED_ORIGIN,
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('lets the dashboard read the rate-limit headers of an answer', async () => {
    const response = await request(app.getHttpServer())
      .get('/organization/o-1/closed-product/projects')
      .set('Origin', ALLOWED_ORIGIN);

    expect(response.status).toBe(200);
    const exposed = (response.headers['access-control-expose-headers'] || '')
      .toLowerCase()
      .split(',')
      .map((h: string) => h.trim());
    expect(exposed).toEqual(
      expect.arrayContaining([
        'x-ratelimit-limit',
        'x-ratelimit-remaining',
        'x-ratelimit-reset',
        'retry-after',
      ]),
    );
    expect(response.headers['x-ratelimit-remaining']).toBe('297');
  });

  it('does not reflect an origin that is not on the allow-list', async () => {
    // `credentials: true` + a reflected Origin is the same as allowing any
    // site to read authenticated responses. Keep the allow-list honest.
    const response = await request(app.getHttpServer())
      .options(STREAM_PATH)
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,last-event-id');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
