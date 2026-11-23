import { redisConnectionOptions } from '../../core/redis/redis-connection-options';
import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScanQueueService } from './scan-queue.service';
import { ScanMetaCache } from './scan-meta-cache.service';
import { QUEUE_NAMES } from './queue-names';

// Re-export for convenience
export { QUEUE_NAMES } from './queue-names';

/**
 * Global module that sets up BullMQ queues for scan result processing.
 *
 * Features:
 * - Redis-backed job queues for async processing
 * - Three separate queues: SCA, SAST/IAC, and Container
 * - Global module so ScanQueueService is available everywhere
 *
 * Note: Processors are registered in ResultModule where the
 * scan services are available.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    // Register BullMQ with Redis connection from env vars
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          connection: redisConnectionOptions(configService),
          // Default settings for all workers
          defaultJobOptions: {
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
          },
        };
      },
    }),
    // Register the individual queues
    BullModule.registerQueue(
      { name: QUEUE_NAMES.SCA },
      { name: QUEUE_NAMES.SAST_IAC },
      { name: QUEUE_NAMES.CONTAINER },
      // SCA_AUTOFIX is registered by EeQueuesModule in the cloud.
      { name: QUEUE_NAMES.CVSS_RECALCULATION },
      // AGENT_REANALYSIS is registered by EeQueuesModule in the cloud.
      { name: QUEUE_NAMES.CYBERISK_RECOMPUTE },
      { name: QUEUE_NAMES.ORG_STATISTICS_RECOMPUTE },
      { name: QUEUE_NAMES.REPORTS },
      { name: QUEUE_NAMES.AGGREGATED_REPORTS },
      { name: QUEUE_NAMES.VULN_BATCH_UPDATE },
      { name: QUEUE_NAMES.SCAN_END_EVALUATION },
      // SARIF imports.
      { name: QUEUE_NAMES.RESULTS_IMPORT },
    ),
  ],
  // ScanMetaCache: a scan's fixed metadata, read once per scan
  // by the ingestion instead of one GetScan per batch.
  providers: [ScanQueueService, ScanMetaCache],
  exports: [ScanQueueService, ScanMetaCache, BullModule],
})
export class ScanQueueModule {}
