import { Controller, Get, UseGuards } from '@nestjs/common';
import { RepoScanQueueService } from './repo-scan-queue.service';
import { QueueMetricsAuthGuard } from './queue-metrics-auth.guard';
import { QueueBacklogResponse } from './queue-metrics.types';

/**
 * Internal HTTP controller exposing repo-scan queue depth for KEDA autoscaling.
 *
 * Endpoint: GET /internal/queue-metrics (served by the worker on METRICS_PORT).
 * KEDA's metrics-api scaler reads `queues.repoScan.pending` from the payload.
 */
@Controller('internal')
@UseGuards(QueueMetricsAuthGuard)
export class QueueMetricsController {
  constructor(private readonly repoScanQueueService: RepoScanQueueService) {}

  @Get('queue-metrics')
  async getQueueMetrics(): Promise<QueueBacklogResponse> {
    return this.repoScanQueueService.getQueueBacklog();
  }
}
