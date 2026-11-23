import tracer from './tracer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';
import { ErrorLoggingInterceptor } from './core/exception/error-logging.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { resolveProtoBasePath } from './core/grpc/proto-base-path';
import { serviceAuthServerChannelOptions } from './core/service-auth/service-auth.edition';

async function bootstrap() {
  await tracer.start();
  dotenv.config();

  if (process.env.NODE_ENV === 'production') {
    console.log('Starting in production mode');
  } else {
    console.log('Starting in development mode');
  }

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
        package: ['cybedefend.file_management', 'grpc.health.v1'],
        protoPath: [
          join(protoBasePath, 'file-management/file_management.proto'),
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
  );

  app.useGlobalInterceptors(new ErrorLoggingInterceptor(app.get(Logger)));
  app.useLogger(app.get(Logger));
  // Dropped spans and failed exports, dated in the OTLP backend rather than on stdout.
  tracer.routeDiagnostics(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe());
  await app.listen();
}

bootstrap();
