import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import * as dotenv from 'dotenv';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';
import { serverProtoPaths } from './core/grpc/server-proto-paths';
import { ErrorLoggingInterceptor } from './core/exception/error-logging.interceptor';
import { PdfGeneratorService } from './core/utils/pdf-generator.service';
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
        package: ['cybedefend.analysis_reporting', 'grpc.health.v1'],
        protoPath: serverProtoPaths(protoBasePath),
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
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Cleanup stale Puppeteer temp directories on startup (older than 1 hour)
  try {
    const pdfService = app.get(PdfGeneratorService);
    const cleanedCount = await pdfService.cleanupStaleTempDirs(3600000);
    if (cleanedCount > 0) {
      NestLogger.log(
        `Startup cleanup: removed ${cleanedCount} stale Puppeteer temp directories`,
      );
    }
  } catch {
    // PdfGeneratorService might not be available, skip cleanup
  }

  app.listen();

  if (process.env.NODE_ENV === 'production') {
    NestLogger.log('Starting in production mode');
  } else {
    NestLogger.log('Starting in development mode');
  }
}
bootstrap();
