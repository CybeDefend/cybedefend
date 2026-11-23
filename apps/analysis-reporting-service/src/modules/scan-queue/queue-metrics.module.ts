import { Module } from '@nestjs/common';
import { ScanQueueModule } from './scan-queue.module';
import { QueueMetricsController } from './queue-metrics.controller';
import { QueueMetricsAuthGuard } from './queue-metrics-auth.guard';

/**
 * Module that exposes the /internal/queue-metrics HTTP endpoint.
 *
 * Imports ScanQueueModule (a @Global module) to access ScanQueueService.
 * The controller and the optional auth guard are declared here.
 *
 * This module is NOT imported into WorkerModule or AppModule yet —
 * that wiring (starting an HTTP listener inside the worker process) is
 * handled by WS-C.  Keeping it separate makes the service method and
 * controller independently testable without any worker bootstrapping.
 */
@Module({
  imports: [ScanQueueModule],
  controllers: [QueueMetricsController],
  providers: [QueueMetricsAuthGuard],
})
export class QueueMetricsModule {}
