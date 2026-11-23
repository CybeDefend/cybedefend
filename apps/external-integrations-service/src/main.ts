import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { ErrorLoggingInterceptor } from './core/exception/error-logging.interceptor';
import { Logger } from 'nestjs-pino';
import { join } from 'node:path';
import tracer from './tracer';
import { CORE_GRPC_PROTO_PATHS, grpcPackagesOf } from './grpc-proto-paths';
import { editionProtoPaths } from './edition/edition-protos';
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

  const protoFiles = [...CORE_GRPC_PROTO_PATHS, ...editionProtoPaths()].map(
    (p) => join(protoBasePath, p),
  );

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        url: process.env.GRPC_URL || '0.0.0.0:50051',
        channelOptions: serviceAuthServerChannelOptions(),
        // The core list carries every proto the exported tree ships;
        // the closed ones are appended through editionProtoPaths(), so the
        // community edition never references a proto file it does not have,
        // and the packages follow the protos actually loaded.
        package: grpcPackagesOf(protoFiles),
        protoPath: protoFiles,
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
}
bootstrap();
