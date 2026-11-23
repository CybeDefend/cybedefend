import './instrumentation';
import tracer from './tracer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { writeFileSync } from 'node:fs';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { buildCorsOptions } from './core/config/cors.options';
import { GlobalExceptionFilter } from './core/exceptions';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from './core/validation/global-validation-pipe-options';
import { trustedProxyCidrsFromEnv } from './core/trust-proxy/trust-proxy';
import { registerCompression } from './core/http/register-compression';
import { registerMultipart } from './core/http/register-multipart';
import { registerRouteTracing } from './core/http/route-tracing';
import { registerGracefulShutdown } from './core/shutdown/graceful-shutdown';
import { shouldServeSwagger } from './core/config/swagger-exposure';

async function bootstrap() {
  // The tracer is already running: ./instrumentation starts it before any
  // other module is loaded.
  dotenv.config();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Honor X-Forwarded-For only when the upstream hop sits inside
      // `TRUSTED_PROXY_CIDRS` (the only name read). Without this, the
      // rate-limit guards would either see the proxy IP for every caller
      // (over-aggregating) or, with an unconditional `trustProxy: true`,
      // take a client-supplied X-Forwarded-For as the throttler bucket key.
      trustProxy: trustedProxyCidrsFromEnv(process.env),
      // 50MB body limit, for the upload routes.
      bodyLimit: 50 * 1024 * 1024,
    }),
    { rawBody: true },
  );

  // Register HTTP response compression FIRST so its onSend hook is wired
  // into the Fastify request pipeline before any other plugin or route
  // touches the response chain.
  await registerCompression(app);

  // multipart/form-data for the SARIF import route only (its limits are in
  // register-multipart.ts). The parser reads nothing until the handler asks.
  await registerMultipart(app);

  // The matched route template, for the HTTP server span (src/tracer.ts).
  // Same constraint: a hook added after app.init() never fires.
  registerRouteTracing(app);

  app.enableCors(buildCorsOptions(process.env));

  app.useLogger(app.get(Logger));
  // Dropped spans and failed exports, dated in the OTLP backend rather than on stdout.
  tracer.routeDiagnostics(app.get(Logger));

  // Global exception filter for standardized error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));

  // Not in the Community edition in production (swagger-exposure.ts).
  if (shouldServeSwagger(process.env.NODE_ENV)) {
    const config = new DocumentBuilder()
      .setTitle('Cybedefend API')
      .setDescription(
        'CybeDefend is an advanced API for application security analysis. Key features include OAuth 2.0 authentication, user/organization/project management, and REBAC-based permissions. It excels in static, dynamic, and IaC security analyses (SAST, DAST, IaC, etc.).',
      )
      .setVersion('1.0')
      .addServer('https://api.example.com')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token.',
        },
        'bearer',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        filter: true,
        apisSorter: 'alpha',
        operationsSorter: (a, b) => {
          const methodOrder = { get: 1, post: 2, put: 3, delete: 4, patch: 5 };
          const pathA = a.get('path');
          const pathB = b.get('path');
          if (pathA === pathB) {
            const methodA = a.get('method').toLowerCase();
            const methodB = b.get('method').toLowerCase();
            return (methodOrder[methodA] || 99) - (methodOrder[methodB] || 99);
          }
          return pathA.localeCompare(pathB);
        },
        docExpansion: 'none',
        showRequestDuration: true,
      },
      customCss: `
        .swagger-ui .topbar { background-color: #0056b3; }
        .swagger-ui .info .title { text-align: center; font-size: 2.5em; }
        .swagger-ui .info .description { text-align: center; font-size: 1.2em; max-width: 800px; margin: 0 auto; }
        /* Other custom styles... */
      `,
      customJs: '/swagger-custom.js',
      customSiteTitle: 'Cybedefend API Documentation',
    });

    if (process.env.NODE_ENV !== 'production')
      writeFileSync('./swagger-spec.json', JSON.stringify(document, null, 2));
  }

  // PORT: same override as mcp-service; the deployment does not set it. The
  // tracing e2e test needs it to run next to a local gateway on 3000.
  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');

  // Graceful shutdown — single owner of the SIGINT/SIGTERM → close → tracer
  // sequence. Deliberately NOT app.enableShutdownHooks(): that would add a
  // second app.close() path (harmless for the HTTP gateway today, but the
  // pattern is what double-destroys a datasource in the DB-backed services —
  // "Called end on pool more than once").
  registerGracefulShutdown(app, tracer);
}
bootstrap();
