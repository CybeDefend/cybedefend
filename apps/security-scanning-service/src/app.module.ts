import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScanModule } from './modules/scan/scan.module';
import { DataPurgeModule } from './modules/data-purge/data-purge.module';
import { LoggerModule } from './core/logger/logger.module';
import { OpenTelemetryModule } from 'nestjs-otel';
import { validationSchema } from './core/config/validation.schema';
import { SecretsModule } from './core/secrets/secrets.module';
import { HealthModule } from './core/health/health.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import SecretsService from './core/secrets/secrets.service';
import { EditionModule } from './edition/edition.module';
import { editionImports } from './edition/edition-imports';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';

@Module({
  imports: [
    SecretsModule,
    HealthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'api' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    LoggerModule,
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: true,
      },
    }),
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    ScanModule,
    DataPurgeModule,
    ...editionImports(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
