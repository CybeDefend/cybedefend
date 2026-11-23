import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VulnerabilityModule } from './modules/vulnerability/vulnerability.module';
import { ResultModule } from './modules/result/result.module';
import { OwaspReportModule } from './modules/reports/owasp-report/owasp-report.module';
import { CweReportModule } from './modules/reports/cwe-report/cwe-report.module';
import { LoggerModule } from './core/logger/logger.module';
import { validationSchema } from './core/config/validation.schema';
import { SecretsModule } from './core/secrets/secrets.module';
import { HealthModule } from './core/health/health.module';
import SecretsService from './core/secrets/secrets.service';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { OpenTelemetryModule } from 'nestjs-otel';
import { UtilsModule } from './core/utils/utils.module';
import { ScanQueueModule } from './modules/scan-queue/scan-queue.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import { DataPurgeModule } from './modules/data-purge/data-purge.module';
import { ResultsImportModule } from './modules/results-import/results-import.module';
import { EditionModule } from './edition/edition.module';
import { editionImports } from './edition/edition-imports';

@Module({
  imports: [
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: false,
      },
    }),
    SecretsModule,
    HealthModule,
    LoggerModule,
    UtilsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    TypeOrmModule.forRootAsync({
      // One options factory for MySQL and PostgreSQL
      // (src/core/db/typeorm-options.ts), today's object on MySQL.
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
    ResultModule,
    OwaspReportModule,
    CweReportModule,
    VulnerabilityModule,
    ScanQueueModule, // Global module for BullMQ scan queues
    DataPurgeModule, // complete data deletion: purge of a deleted project, team or organization (gRPC)
    ResultsImportModule, // ImportResults, which queues a SARIF import (gRPC)
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    ...editionImports(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
