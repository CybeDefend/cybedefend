import Fastify from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { matchedRouteOf, registerRouteTracing } from './route-tracing';

describe('registerRouteTracing', () => {
  it('leaves the matched route template on the raw request', async () => {
    const fastify = Fastify();
    registerRouteTracing({
      getHttpAdapter: () => ({ getInstance: () => fastify }),
    } as unknown as NestFastifyApplication);

    let seen: string | undefined;
    fastify.get('/projects/:projectId/scans/:scanId', async (request) => {
      seen = matchedRouteOf(request.raw);
      return {};
    });

    await fastify.inject({ method: 'GET', url: '/projects/42/scans/7?page=2' });
    expect(seen).toBe('/projects/:projectId/scans/:scanId');
    await fastify.close();
  });

  it('marks nothing on a request no route matched', async () => {
    const fastify = Fastify();
    registerRouteTracing({
      getHttpAdapter: () => ({ getInstance: () => fastify }),
    } as unknown as NestFastifyApplication);

    let raw: object | undefined;
    fastify.setNotFoundHandler(async (request, reply) => {
      raw = request.raw;
      return reply.code(404).send();
    });

    await fastify.inject({ method: 'GET', url: '/nowhere/s3cr3t' });
    expect(raw).toBeDefined();
    expect(matchedRouteOf(raw)).toBeUndefined();
    await fastify.close();
  });
});
