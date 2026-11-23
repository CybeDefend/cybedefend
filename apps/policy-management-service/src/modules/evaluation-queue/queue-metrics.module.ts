import { Module } from '@nestjs/common';
import { EvaluationQueueModule } from './evaluation-queue.module';
import { QueueMetricsController } from './queue-metrics.controller';
import { QueueMetricsAuthGuard } from './queue-metrics-auth.guard';

/**
 * Module that exposes the /internal/queue-metrics HTTP endpoint.
 *
 * Imports EvaluationQueueModule (a @Global module) to access EvaluationQueueService.
 * The controller and the optional auth guard are declared here.
 *
 * This module is NOT imported into WorkerModule or AppModule yet —
 * that wiring (starting an HTTP listener inside the service process) is
 * handled in a subsequent task.  Keeping it separate makes the service
 * method and controller independently testable without any infrastructure.
 */
@Module({
  imports: [EvaluationQueueModule],
  controllers: [QueueMetricsController],
  providers: [QueueMetricsAuthGuard],
})
export class QueueMetricsModule {}
