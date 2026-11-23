import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from './core/logger/logger.module';
import { validationSchema } from './core/config/validation.schema';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { GrpcModule } from '@grpc/grpc.module';
import { GeneratedReport } from './entities/generated-report.entity';
import { AggregatedReport } from './entities/aggregated-report.entity';
import { ReportUploadModule } from './modules/reports/shared/report-upload.module';
import { ReportRetentionService } from './modules/reports/retention/report-retention.service';
import { ProjectOrgResolver } from './core/realtime/project-org-resolver.service';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';

/**
 * One-shot entrypoint module for the report-retention purge CronJob.
 *
 * Deliberately lean: it only needs the DB (the two report tables), the billing
 * client (retention days), global-management (projectId→orgId) and the
 * file-management client (delete the stored object). No ScheduleModule — the
 * schedule lives in the Helm chart; the process runs once and exits.
 */
@Module({
  imports: [
    SecretsModule,
    LoggerModule,
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
          { context: 'cron-report-retention' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    GrpcModule.register(),
    TypeOrmModule.forFeature([GeneratedReport, AggregatedReport]),
    ReportUploadModule,
    ...editionImportsFor('cron-report-retention'),
  ],
  providers: [ReportRetentionService, ProjectOrgResolver],
})
export class ReportRetentionCronModule {}
