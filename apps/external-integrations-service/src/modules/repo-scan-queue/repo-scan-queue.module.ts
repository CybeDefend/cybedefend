import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { REPO_SCAN_QUEUE_NAMES } from './queue-names';
import { RepoScanQueueService } from './repo-scan-queue.service';
import { buildRedisConnection } from './redis-connection';

/**
 * Global BullMQ module for external-integrations background work.
 *
 * Imported by BOTH the main gRPC app (producer: enqueues repo-scan jobs) and
 * the dedicated worker process (consumer: registers RepoScanProcessor). The
 * processor is NOT registered here — only in the worker module — so the main
 * app never consumes jobs.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisConnection(config),
        defaultJobOptions: {
          // Retry transient failures; combined with BullMQ's stalled-job
          // re-queue this is what makes a pod death no longer orphan a scan.
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      }),
    }),
    BullModule.registerQueue({ name: REPO_SCAN_QUEUE_NAMES.REPO_SCAN }),
  ],
  providers: [RepoScanQueueService],
  exports: [RepoScanQueueService, BullModule],
})
export class RepoScanQueueModule {}
