import tracer from './tracer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import rateLimit from '@fastify/rate-limit';
import { rateLimitAddressOf } from './core/http/rate-limit-address';
import { GlobalExceptionFilter } from './core/exception/global-exception.filter';
import { Logger as NestLogger } from '@nestjs/common';
import {
  corsOptions,
  httpAdapterOptions,
} from './core/http/http-surface.options';
import { registerGracefulShutdown } from './core/shutdown/graceful-shutdown';
import { editionProtoPaths } from './edition/edition-protos';
import { resolveProtoBasePath } from './core/config/proto-base-path';

export async function bootstrap(): Promise<void> {
  await tracer.start();
  dotenv.config();

  // Adapter + CORS options live in `http-surface.options.ts`, shared with the
  // e2e harness so the routing/CORS tests bind to the production wiring.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(httpAdapterOptions(process.env.TRUST_PROXY_CIDR)),
    { rawBody: true, bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  // Dropped spans and failed exports, dated in the OTLP backend rather than on stdout.
  tracer.routeDiagnostics(app.get(Logger));

  app.enableCors(corsOptions);

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Rate limit public HTTP entry. Scoped to client IP — X-Forwarded-For is
  // honoured ONLY when the upstream hop sits inside `TRUST_PROXY_CIDR`;
  // otherwise `req.ip` falls back to the socket origin so an unauthenticated
  // caller cannot rotate XFF to dodge the bucket.
  // Health and OAuth discovery endpoints are allow-listed so probes and
  // unauthenticated handshake calls never trip the limiter; /mcp itself IS
  // counted (401s count toward the bucket on purpose).
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    // An IPv6 caller is keyed on its /64, an IPv4-mapped one on its IPv4.
    keyGenerator: (req) => rateLimitAddressOf(req.ip),
    allowList: (req) => {
      // The router tolerates duplicate leading slashes (see
      // `httpAdapterOptions`), but this callback sees the raw URL — collapse
      // them so `//.well-known/…` probes stay allow-listed too.
      const url = (req.url || '').replace(/^\/{2,}/, '/');
      return (
        url.startsWith('/health') ||
        url.startsWith('/.well-known/oauth-protected-resource') ||
        url.startsWith('/.well-known/oauth-authorization-server')
      );
    },
    errorResponseBuilder: (_req, ctx) =>
      // @fastify/rate-limit throws this return value. Nest's global exception
      // filter catches everything, so we throw an HttpException so it is
      // serialized as a proper 429 (otherwise the filter's fallback branch
      // would return 500).
      new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit exceeded, retry in ${Math.ceil(ctx.ttl / 1000)}s`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
  });

  // Connect the internal gRPC listener used by the Gateway to fan out
  // secrets rotation events (package cybedefend.mcp). Every other
  // inter-service contract already goes over gRPC, so mcp-service becomes a
  // hybrid app: Fastify HTTP on PORT, gRPC on GRPC_URL. Its protos are closed
  // (EE_PROTO_PATHS): the Community Edition loads none and starts no
  // listener.
  const protoPaths = editionProtoPaths();
  let grpcUrl: string | undefined;
  if (protoPaths.length > 0) {
    const protoBasePath = resolveProtoBasePath({
      nodeEnv: process.env.NODE_ENV,
      override: process.env.PROTO_BASE_PATH,
      devPath: join(__dirname, '../../../libs/protos'),
    });
    grpcUrl = process.env.GRPC_URL || '0.0.0.0:50061';
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        url: grpcUrl,
        package: 'cybedefend.mcp',
        protoPath: protoPaths.map((p) => join(protoBasePath, p)),
        loader: {
          includeDirs: [protoBasePath],
          keepCase: false,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        },
      },
    });
    await app.startAllMicroservices();
  }

  const port = Number(process.env.PORT) || 3010;
  await app.listen(port, '0.0.0.0');
  NestLogger.log(
    grpcUrl
      ? `mcp-service listening on :${port} (HTTP) and ${grpcUrl} (gRPC) (NODE_ENV=${process.env.NODE_ENV})`
      : `mcp-service listening on :${port} (HTTP), gRPC disabled (community edition)`,
  );

  // Graceful shutdown — single owner of the SIGINT/SIGTERM → close → tracer
  // sequence. Deliberately NOT app.enableShutdownHooks(): that would add a
  // second app.close() path (the pattern that double-destroys a datasource in
  // the DB-backed services — "Called end on pool more than once").
  registerGracefulShutdown(app, tracer);
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error('bootstrap() failed:', e);
    process.exit(1);
  });
}
