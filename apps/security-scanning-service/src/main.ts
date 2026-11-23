import tracer from './tracer';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { Logger as NestLogger } from '@nestjs/common';
import { join } from 'node:path';
import { ErrorLoggingInterceptor } from './core/exception/error-logging.interceptor';
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
        package: ['cybedefend.security_scanning', 'grpc.health.v1'],
        protoPath: [
          join(protoBasePath, 'security-scanning/security_scanning.proto'),
          join(protoBasePath, 'health/health.proto'),
        ],
        maxSendMessageLength: 50 * 1024 * 1024, // 50MB
        maxReceiveMessageLength: 50 * 1024 * 1024, // 50MB
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
  app.listen();

  if (process.env.NODE_ENV === 'production') {
    NestLogger.log('Starting in production mode');
  } else {
    NestLogger.log('Starting in development mode');
  }
}

bootstrap();
