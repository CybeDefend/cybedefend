import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecretsModule } from './core/secrets/secrets.module';
import { LoggerModule } from './core/logger/logger.module';
import SecretsService from './core/secrets/secrets.service';
import { validationSchema } from './core/config/validation.schema';
import { GrpcModule } from '@grpc/grpc.module';
import { GithubModule } from './modules/github/github.module';
import { GitlabModule } from './modules/gitlab/gitlab.module';
import { RepoScanQueueModule } from './modules/repo-scan-queue/repo-scan-queue.module';
import { QueueMetricsModule } from './modules/repo-scan-queue/queue-metrics.module';
import { RepoScanProcessor } from './modules/repo-scan-queue/repo-scan.processor';
import { PendingRescanModule } from './modules/pending-rescan/pending-rescan.module';
import { PendingRescanConsumer } from './modules/pending-rescan/pending-rescan.consumer';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';

/**
 * Dedicated worker process for external-integrations background work.
 *
 * Runs in a SEPARATE process from the main gRPC server. It:
 *  - consumes the repo-scan BullMQ queue (download → zip → upload → startScan)
 *    via RepoScanProcessor, reusing GithubService/GitlabService,
 *  - scans the pushes deferred because a scan of their branch was running
 *    (PendingRescanConsumer), and
 *  - serves GET /internal/queue-metrics (QueueMetricsModule) on METRICS_PORT so
 *    KEDA can autoscale this Deployment by queue depth.
 *
 * Heavy zip work runs in a worker thread, so a large repo no longer blocks the
 * loop — and because work is queued, a pod death re-queues the job instead of
 * orphaning the scan.
 *
 * It does NOT consume the closed edition's CRM sync queue, which runs in its own
 * process (APP_MODE=crm-worker): a second consumer here would share the memory
 * budget of a pod whose zip rewrites already run close to its limit.
 *
 * Launched via entrypoint.sh (APP_MODE=worker → node dist/main.worker).
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
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'worker' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    GrpcModule.register(),
    // BullMQ connection + RepoScanQueueService (provides the queue the
    // processor attaches to).
    RepoScanQueueModule,
    // GET /internal/queue-metrics for KEDA.
    QueueMetricsModule,
    // The actual download/zip/upload/startScan services.
    GithubModule,
    GitlabModule,
    PendingRescanModule,
    ...editionImportsFor('worker'),
  ],
  // PendingRescanConsumer: scans the pushes refused while a
  // scan of their branch was running, once that scan has ended.
  providers: [RepoScanProcessor, PendingRescanConsumer],
})
export class WorkerModule {}
