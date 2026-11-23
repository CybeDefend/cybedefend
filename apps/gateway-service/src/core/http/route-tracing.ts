import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';

/**
 * Carries the route template Fastify matched (`/projects/:projectId`) from the
 * request pipeline to the HTTP server span, which the http instrumentation
 * closes on the raw Node request. No Fastify instrumentation is maintained any
 * more, and without the template a span is only `GET`, its path holds ids, and
 * nothing can be grouped per route.
 *
 * Type imports only: `src/tracer.ts` reads it, and the tracer is preloaded
 * before Fastify is.
 */
const MATCHED_ROUTE = Symbol.for('cybedefend.http.matchedRoute');

type WithMatchedRoute = { [MATCHED_ROUTE]?: string };

export function rememberMatchedRoute(raw: object, route: string): void {
  (raw as WithMatchedRoute)[MATCHED_ROUTE] = route;
}

export function matchedRouteOf(raw: object): string | undefined {
  return (raw as WithMatchedRoute)[MATCHED_ROUTE];
}

/**
 * Must run before `app.init()`, where Nest declares its routes on Fastify:
 * see the call site in main.ts.
 */
export function registerRouteTracing(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addHook('onRequest', (request, _reply, done) => {
    const route = request.routeOptions?.url;
    if (route) rememberMatchedRoute(request.raw, route);
    done();
  });
}
