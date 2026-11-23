import { Module } from '@nestjs/common';
import { QueueMetricsController } from './queue-metrics.controller';

/**
 * Wires the GET /internal/queue-metrics controller into the worker process.
 * RepoScanQueueService is provided globally by RepoScanQueueModule.
 */
@Module({
  controllers: [QueueMetricsController],
})
export class QueueMetricsModule {}
