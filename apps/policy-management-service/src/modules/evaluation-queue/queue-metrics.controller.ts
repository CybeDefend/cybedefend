import { Controller, Get, UseGuards } from '@nestjs/common';
import { EvaluationQueueService } from './evaluation-queue.service';
import { QueueMetricsAuthGuard } from './queue-metrics-auth.guard';
import { QueueBacklogResponse } from './queue-metrics.types';

/**
 * Internal HTTP controller exposing queue depth metrics for KEDA autoscaling.
 *
 * Endpoint: GET /internal/queue-metrics
 *
 * Returns a plain JSON payload with per-queue counts.
 * The payload contains integers only — no project/org IDs (no tenant data).
 *
 * KEDA's `metrics-api` external scaler can target this endpoint via the
 * `targetValue` field on a ScaledObject.  See the KEDA ScaledObject manifest
 * in charts/cybedefend/templates/keda-*.yaml for the full wiring.
 *
 * Note: this controller is NOT wired into WorkerModule or AppModule yet.
 * That bootstrap step (making the service listen on an HTTP port) is handled
 * in a subsequent task so this module remains independently testable.
 */
@Controller('internal')
@UseGuards(QueueMetricsAuthGuard)
export class QueueMetricsController {
  constructor(
    private readonly evaluationQueueService: EvaluationQueueService,
  ) {}

  /**
   * Returns the full queue backlog snapshot.
   *
   * @returns QueueBacklogResponse with per-queue depth stats
   */
  @Get('queue-metrics')
  async getQueueMetrics(): Promise<QueueBacklogResponse> {
    return this.evaluationQueueService.getQueueBacklog();
  }
}
