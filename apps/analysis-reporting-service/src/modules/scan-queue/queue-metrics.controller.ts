import { Controller, Get, UseGuards } from '@nestjs/common';
import { ScanQueueService } from './scan-queue.service';
import { QueueMetricsAuthGuard } from './queue-metrics-auth.guard';
import { QueueBacklogResponse } from './queue-metrics.types';

/**
 * Internal HTTP controller exposing queue depth metrics for KEDA autoscaling.
 *
 * Endpoint: GET /internal/queue-metrics
 *
 * Returns a plain JSON payload with per-queue counts and aggregates.
 * The payload contains integers only — no project/org/scan IDs (no tenant data).
 *
 * KEDA's `metrics-api` external scaler can target this endpoint via the
 * `targetValue` field on a ScaledObject.  See the KEDA ScaledObject manifest
 * in charts/cybedefend/templates/keda-*.yaml for the full wiring.
 *
 * Note: this controller is NOT wired into WorkerModule or AppModule yet.
 * That bootstrap step (making the worker listen on an HTTP port) is handled
 * by WS-C so this module remains independently testable.
 */
@Controller('internal')
@UseGuards(QueueMetricsAuthGuard)
export class QueueMetricsController {
  constructor(private readonly scanQueueService: ScanQueueService) {}

  /**
   * Returns the full queue backlog snapshot.
   *
   * @returns QueueBacklogResponse with per-queue depth stats and aggregates
   */
  @Get('queue-metrics')
  async getQueueMetrics(): Promise<QueueBacklogResponse> {
    return this.scanQueueService.getQueueBacklog();
  }
}
