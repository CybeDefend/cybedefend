import tracer from './tracer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'node:path';
import { GlobalExceptionFilter } from './core/exception/global-exception.filter';
import { Logger as NestLogger } from '@nestjs/common';
import { httpAdapterOptions } from './core/http/http-surface.options';
import {
  registerRequestGuards,
  requestGuardOptionsFromEnv,
} from './core/http/request-guards';
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

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS, the `Origin` check and the request limits of the public entry:
  // requests without valid credentials have a small budget per address,
  // authenticated callers one per identity, counted apart (see
  // `request-guards.ts`).
  await registerRequestGuards(app, requestGuardOptionsFromEnv(process.env));

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
