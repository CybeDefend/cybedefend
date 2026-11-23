import tracer from './tracer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { ErrorLoggingInterceptor } from './core/exception/error-logging.interceptor';
import { GrpcTraceContextInterceptor } from './core/grpc/grpc-trace-context.interceptor';
import { serviceAuthServerChannelOptions } from './core/service-auth/service-auth.edition';
import { Logger as NestLogger } from '@nestjs/common';
import { registerGracefulShutdown } from './core/shutdown/graceful-shutdown';
import { resolveProtoBasePath } from './core/grpc/proto-base-path';

/**
 * Bootstrap function for the Policy Management service.
 *
 * Runs as a hybrid NestJS application:
 *  - a gRPC microservice (the primary transport — unchanged behaviour) and
 *  - a lightweight HTTP listener that serves GET /internal/queue-metrics for
 *    KEDA autoscaling (the always-on main service holds the BullMQ queue
 *    handle, so it can report the backlog the worker process drains).
 *
 * Initializes OpenTelemetry, configures both transports, and sets up global
 * pipes/interceptors (which apply to gRPC handlers via inheritAppConfig: true).
 */
async function bootstrap() {
  await tracer.start();
  dotenv.config();

  const protoBasePath = resolveProtoBasePath({
    nodeEnv: process.env.NODE_ENV,
    override: process.env.PROTO_BASE_PATH,
    devPath: join(__dirname, '../../../libs/protos'),
  });

  // Create the HTTP app (Express) first so it can host the metrics endpoint.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Attach the gRPC microservice. The options below (but the service-auth interceptor) are kept byte-for-byte
  // identical to the previous pure-microservice bootstrap so gRPC behaviour
  // (URL, packages, proto paths, loader, health checks) is unchanged.
  // inheritAppConfig: true makes the global pipes/interceptors below apply to
  // gRPC handlers as well.
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        // Fallback aligned to the Joi default (validation.schema.ts) and the
        // chart's containerPort/gRPC probes: this service binds gRPC on 50060.
        url: process.env.GRPC_URL || '0.0.0.0:50060',
        channelOptions: serviceAuthServerChannelOptions(),
        package: ['cybedefend.policy_management', 'grpc.health.v1'],
        protoPath: [
          join(protoBasePath, 'policy-management/policy_management.proto'),
          join(protoBasePath, 'health/health.proto'),
        ],
        loader: {
          includeDirs: [protoBasePath],
          keepCase: false,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        },
      },
    },
    { inheritAppConfig: true },
  );

  // Extract trace context from incoming gRPC metadata (distributed tracing)
  app.useGlobalInterceptors(new GrpcTraceContextInterceptor());
  app.useGlobalInterceptors(new ErrorLoggingInterceptor(app.get(Logger)));
  app.useGlobalPipes(new ValidationPipe());

  // Graceful shutdown — single owner of the SIGINT/SIGTERM → close → tracer
  // sequence. app.close() on a hybrid app closes BOTH the HTTP server and the
  // connected microservices. Deliberately NOT app.enableShutdownHooks(): that
  // would add a second app.close() path and double-destroy the datasource
  // ("Called end on pool more than once").
  registerGracefulShutdown(app, tracer);

  // Start the gRPC server (primary transport).
  await app.startAllMicroservices();
  NestLogger.log(
    `Policy Management Service is running on ${process.env.GRPC_URL || '0.0.0.0:50060'}`,
    'Bootstrap',
  );

  // Start the HTTP listener for the KEDA metrics endpoint.
  const metricsPort = Number(process.env.METRICS_PORT) || 9095;
  await app.listen(metricsPort, '0.0.0.0');
  NestLogger.log(
    `Policy Management Service metrics endpoint: http://0.0.0.0:${metricsPort}/internal/queue-metrics`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // Surface a boot failure (tracer/DB connect, gRPC bind, or HTTP listen) as a
  // clean crash-loop instead of a half-initialized zombie pod. Mirrors the
  // analysis-reporting worker bootstrap.
  console.error('Failed to start policy-management-service:', err);
  process.exit(1);
});
