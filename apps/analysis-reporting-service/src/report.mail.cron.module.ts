import { Module, forwardRef } from '@nestjs/common';
import { LoggerModule } from './core/logger/logger.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validationSchema } from './core/config/validation.schema';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResultModule } from './modules/result/result.module';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { GrpcModule } from '@grpc/grpc.module';
import { UtilsModule } from './core/utils/utils.module';
import { ScanQueueModule } from './modules/scan-queue/scan-queue.module';
// Entities reused for aggregation queries
import { SastVulnerabilityDetections } from './entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from './entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from './entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from './entities/container_vulnerability_detections.entity';
import { VulnerabilityDetectionHistory } from './entities/vulnerability-detection-history.entity';
import { SecretVulnerabilityDetections } from './entities/secret-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from './entities/cicd-vulnerability-detections.entity';
import { ReportAggregationService } from './modules/report-mail/report-aggregation.service';
import { ReportMailCron } from './modules/report-mail/report-mail.cron';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';

@Module({
  imports: [
    SecretsModule,
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
          { context: 'cron-report-mail' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    // No ScheduleModule: this entrypoint is a one-shot K8s CronJob (the
    // schedule lives in the Helm chart), not a self-scheduling daemon.
    GrpcModule.register(),
    // ScanQueueModule is needed because ResultModule's controller depends on ScanQueueService
    ScanQueueModule,
    TypeOrmModule.forFeature([
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      ScaVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
      VulnerabilityDetectionHistory,
      SecretVulnerabilityDetections,
      CicdVulnerabilityDetections,
    ]),
    forwardRef(() => ResultModule),
    // Global realtime publisher: AggregatedReportsService (pulled in
    // transitively via ResultModule -> AggregatedReportsModule) injects a
    // NON-optional RealtimeEventPublisher, so this entrypoint must register the
    // publisher just like app.module / worker.module / cron.osv.module do —
    // otherwise NestFactory.createApplicationContext fails to resolve it at boot.
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    ...editionImportsFor('cron-report-mail'),
  ],
  providers: [ReportAggregationService, ReportMailCron],
})
export class ReportMailCronModule {}
