import { redisConnectionOptions } from './core/redis/redis-connection-options';
import { Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from './core/logger/logger.module';
import { UtilsModule } from './core/utils/utils.module';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { validationSchema } from './core/config/validation.schema';
import { GrpcModule } from '@grpc/grpc.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import Redis from 'ioredis';
import { ProjectOrgResolver } from './core/realtime/project-org-resolver.service';
import { AsyncTaskStore } from './core/realtime/async-task-store.service';
import { QUEUE_NAMES } from './modules/scan-queue/queue-names';

/**
 * DI token for the dedicated ioredis client backing {@link AsyncTaskStore} in
 * this worker. Unlike the main/autofix workers (which reuse the BullMQ queue's
 * Redis client via ScanQueueService), worker-reports owns this connection, so
 * it must close it on shutdown (see {@link WorkerReportsModule.onApplicationShutdown}).
 */
const REPORTS_ASYNC_TASK_REDIS = 'REPORTS_ASYNC_TASK_REDIS';

// Processors
import { ReportsQueueProcessor } from './modules/scan-queue/processors/reports-queue.processor';
import { AggregatedReportsQueueProcessor } from './modules/scan-queue/processors/aggregated-reports-queue.processor';

// Report generators consumed by the processors
import { OwaspReportModule } from './modules/reports/owasp-report/owasp-report.module';
import { CweReportModule } from './modules/reports/cwe-report/cwe-report.module';
import { ReportUploadModule } from './modules/reports/shared/report-upload.module';
import { AggregatedReportsModule } from './modules/reports/aggregated-reports/aggregated-reports.module';

// Entities needed by the processors themselves
import { GeneratedReport } from './entities/generated-report.entity';
import { AggregatedReport } from './entities/aggregated-report.entity';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';

/**
 * Dedicated Worker module for premium report generation (per-project
 * 'reports-queue' + org/team/batch 'aggregated-reports-queue').
 *
 * This module runs in a SEPARATE PROCESS from the main gRPC server, the scan
 * worker AND the autofix worker. Report generation loads every detection row
 * of a project with relations, renders a large HTML string and drives a
 * Chromium instance (Puppeteer) — a memory profile that must never compete
 * with scan ingestion inside the same Node heap. Isolating it means:
 * - a giant PDF render can no longer OOM the scan-ingestion worker;
 * - sustained ingestion load can no longer starve/fail user-facing reports.
 *
 * It has its own database connection pool (small: report queues run at
 * concurrency 1 each) and its own Redis/BullMQ connection. Queue-depth
 * metrics for KEDA are served by the MAIN worker (which registers all
 * queues); this process intentionally has no HTTP endpoint, like the
 * autofix worker.
 *
 * Usage:
 *   node dist/worker-reports   (APP_MODE=worker-reports via entrypoint.sh)
 */
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
    // Database connection - separate pool from main app and other workers
    TypeOrmModule.forRootAsync({
      // One options factory for MySQL and PostgreSQL
      // (src/core/db/typeorm-options.ts), today's object on MySQL.
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'worker-reports' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    // Report repos used directly by the processors for the ready/failed status
    // transitions (GeneratedReport) and the async-task outcome (AggregatedReport).
    TypeOrmModule.forFeature([GeneratedReport, AggregatedReport]),
    // gRPC clients (file-management signed URLs, global-management project
    // metadata) used by the upload/aggregation services and ProjectOrgResolver.
    GrpcModule.register(),
    // BullMQ setup — only the two report queues are consumed by this worker.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          connection: redisConnectionOptions(configService),
          defaultJobOptions: {
            removeOnComplete: { age: 86400 }, // 24 hours
            removeOnFail: { age: 604800 }, // 7 days
          },
        };
      },
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.REPORTS }),
    BullModule.registerQueue({ name: QUEUE_NAMES.AGGREGATED_REPORTS }),
    // Report generators (EuAiActReportModule and
    // ScannerTypeReportModule are closed and load through
    // EeWorkerReportsModule, spread below via editionImportsFor)
    OwaspReportModule,
    CweReportModule,
    ReportUploadModule,
    AggregatedReportsModule,
    // Realtime publisher for REPORT_READY / AGGREGATED_REPORT_READY events
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    ...editionImportsFor('worker-reports'),
  ],
  providers: [
    // Resolves projectId → organizationId so REPORT_READY events also route
    // to the org overview channel.
    ProjectOrgResolver,
    // Async-task store on the SAME Redis as the gRPC server (which
    // created the task) and the gateway (which lists it). worker-reports does
    // not import ScanQueueModule, so wire a dedicated ioredis client here. The
    // client is its own provider so the module can close it on shutdown.
    {
      provide: REPORTS_ASYNC_TASK_REDIS,
      useFactory: (configService: ConfigService) =>
        new Redis(redisConnectionOptions(configService)),
      inject: [ConfigService],
    },
    {
      provide: AsyncTaskStore,
      useFactory: (redis: Redis) => new AsyncTaskStore(redis),
      inject: [REPORTS_ASYNC_TASK_REDIS],
    },
    // Queue processors
    ReportsQueueProcessor,
    AggregatedReportsQueueProcessor,
  ],
})
export class WorkerReportsModule implements OnApplicationShutdown {
  constructor(
    @Inject(REPORTS_ASYNC_TASK_REDIS) private readonly asyncTaskRedis: Redis,
  ) {}

  /**
   * Close the dedicated AsyncTaskStore Redis client on shutdown. worker-reports
   * bootstraps with a manual SIGTERM/SIGINT → app.close() handler (see
   * worker-reports.ts), which fires this hook — without it the connection would
   * dangle across restarts (a slow connection leak).
   */
  async onApplicationShutdown(): Promise<void> {
    await this.asyncTaskRedis.quit();
  }
}
