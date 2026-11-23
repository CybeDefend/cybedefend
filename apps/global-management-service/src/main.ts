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
import { Logger as NestLogger } from '@nestjs/common';
import { registerGracefulShutdown } from './core/shutdown/graceful-shutdown';
import { editionServerProtos } from './edition/edition-protos';
import { resolveProtoBasePath } from './core/grpc/proto-base-path';
import { serviceAuthServerChannelOptions } from './core/service-auth/service-auth.edition';

async function bootstrap() {
  await tracer.start();
  dotenv.config();

  const protoBasePath = resolveProtoBasePath({
    nodeEnv: process.env.NODE_ENV,
    override: process.env.PROTO_BASE_PATH,
    devPath: join(__dirname, '../../../libs/protos'),
  });

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        url: process.env.GRPC_URL || '0.0.0.0:50051',
        channelOptions: serviceAuthServerChannelOptions(),
        package: ['cybedefend.global_management', 'grpc.health.v1'],
        protoPath: editionServerProtos().map((p) => join(protoBasePath, p)),
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
  );

  // Extract trace context from incoming gRPC metadata (distributed tracing)
  app.useGlobalInterceptors(new GrpcTraceContextInterceptor());
  app.useGlobalInterceptors(new ErrorLoggingInterceptor(app.get(Logger)));
  app.useLogger(app.get(Logger));
  // Dropped spans and failed exports, dated in the OTLP backend rather than on stdout.
  tracer.routeDiagnostics(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe());

  // Graceful shutdown — single owner of the SIGINT/SIGTERM → close → tracer
  // sequence. Deliberately NOT app.enableShutdownHooks(): that would add a
  // second app.close() path and double-destroy the datasource
  // ("Called end on pool more than once").
  registerGracefulShutdown(app, tracer);

  app.listen();

  if (process.env.NODE_ENV === 'production') {
    NestLogger.log('Starting in production mode');
  } else {
    NestLogger.log('Starting in development mode');
  }
}
bootstrap();
