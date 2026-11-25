import {
  InjectQueue,
  Processor,
  WorkerHost,
  OnWorkerEvent,
} from '@nestjs/bullmq';
import {
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { ulid } from 'ulid';

import { QUEUE_NAMES } from '../queue-names';
import { AggregatedReportJobData } from '../scan-queue.service';
import { AggregatedReportsService } from '../../reports/aggregated-reports/aggregated-reports.service';
import { getQueueConcurrency } from '../concurrency.config';
import {
  failLostQueuedReports,
  isQueueJobPending,
  STALE_REPORT_SWEEP_INTERVAL_MS,
} from '../../reports/retention/stale-report-sweep';
import { AggregatedReport } from '../../../entities/aggregated-report.entity';
import { AsyncTaskStore } from '../../../core/realtime/async-task-store.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

/**
 * BullMQ processor for async AGGREGATED report generation (org/team/batch ×
 * owasp/cwe/license/ai-act). Isolated from the per-project 'reports-queue' so a
 * heavy org-wide PDF render (30-60s) never starves fast per-project reports.
 *
 * runAggregatedReport() owns the row status transitions + the AGGREGATED_REPORT
 * realtime event, including the failure path — so this processor never
 * re-throws (attempts=1). This processor additionally drives the
 * background-tasks widget (async task), reading the persisted row status to
 * decide the task outcome.
 */
@Processor(QUEUE_NAMES.AGGREGATED_REPORTS, {
  concurrency: getQueueConcurrency('AGGREGATED_REPORTS'),
  lockDuration: 300000,
  lockRenewTime: 60000,
})
export class AggregatedReportsQueueProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AggregatedReportsQueueProcessor.name);
  private readonly ttlMs = Number(process.env.ASYNC_TASK_TTL_MS) || 3_600_000;

  constructor(
    private readonly aggregatedReports: AggregatedReportsService,
    @InjectRepository(AggregatedReport)
    private readonly aggregatedRepo: Repository<AggregatedReport>,
    private readonly asyncTaskStore: AsyncTaskStore,
    private readonly realtime: RealtimeEventPublisher,
    // Its own queue, for the stale sweep's job lookups.
    @Optional()
    @InjectQueue(QUEUE_NAMES.AGGREGATED_REPORTS)
    private readonly aggregatedQueue?: Queue<AggregatedReportJobData>,
  ) {
    super();
  }

  private sweepTimer?: NodeJS.Timeout;

  onModuleInit(): void {
    if (!this.aggregatedQueue) return;
    this.sweepTimer = setInterval(
      () => void this.sweepLostReports(),
      STALE_REPORT_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Fail the old queued aggregated reports whose job is gone; never one whose
   * job still waits or renders (it still ends ready).
   */
  async sweepLostReports(): Promise<void> {
    const queue = this.aggregatedQueue;
    if (!queue) return;
    try {
      const failed = await failLostQueuedReports(this.aggregatedRepo, (id) =>
        isQueueJobPending(queue, `aggregated-report-${id}`),
      );
      if (failed > 0) {
        this.logger.log(
          `[AggReports] stale sweep failed ${failed} lost report(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[AggReports] stale sweep failed: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job<AggregatedReportJobData>): Promise<void> {
    const { reportId, scopeType, reportType, taskId } = job.data;
    this.logger.log(
      `[AggReports] job ${job.id} reportId=${reportId} scope=${scopeType} type=${reportType}`,
    );
    await this.markTaskRunning(taskId);
    try {
      await this.aggregatedReports.runAggregatedReport(job.data);
    } catch (err) {
      // runAggregatedReport already persisted status=failed + published the
      // event; this is a defensive backstop. Do NOT re-throw (attempts=1).
      this.logger.error(
        `[AggReports] reportId=${reportId} unexpected: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    // Settle the widget task from the persisted row status.
    await this.settleTask(job.data);
  }

  /**
   * Queue-level failure (e.g. stall after a worker crash mid-render):
   * runAggregatedReport's catch never ran, so the row would stay "queued"
   * forever. Delegate to the service, which owns the guarded queued→failed
   * transition + the AGGREGATED_REPORT_READY(failed) event.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<AggregatedReportJobData> | undefined,
    error: Error,
  ): Promise<void> {
    const message =
      error?.message ?? 'aggregated report job failed at the queue level';
    this.logger.error(
      `[AggReports] Job ${job?.id} failed at the queue level: ${message}`,
    );

    const data = job?.data;
    if (!data?.reportId) return;

    try {
      // markFailedFromQueue returns true ONLY when it actually performed the
      // guarded queued→failed transition. A job that stalled after a successful
      // render keeps its "ready" row (returns false) and its widget task was
      // already settled to "completed" by settleTask — gate completeTask on the
      // boolean so we never clobber that completed task into a spurious failure.
      const transitioned = await this.aggregatedReports.markFailedFromQueue(
        data,
        message,
      );
      if (transitioned) {
        await this.completeTask(data, 'failed', {
          error: message.slice(0, 2000),
        });
      }
    } catch (err) {
      // Never throw from a worker event handler — log and move on.
      this.logger.error(
        `[AggReports] Could not persist queue-level failure for reportId=${data.reportId}: ${(err as Error).message}`,
      );
    }
  }

  private async markTaskRunning(taskId?: string): Promise<void> {
    if (!taskId) return;
    try {
      await this.asyncTaskStore.update(taskId, { status: 'running' });
    } catch {
      // widget progress is best-effort
    }
  }

  private async settleTask(data: AggregatedReportJobData): Promise<void> {
    if (!data.taskId || !data.userId) return;
    let rowStatus: string | undefined;
    let rowError: string | null | undefined;
    let readOk = false;
    try {
      const row = await this.aggregatedRepo.findOne({
        where: { id: data.reportId },
      });
      rowStatus = row?.status;
      rowError = row?.error;
      readOk = true;
    } catch (err) {
      this.logger.warn(
        `[AggReports] settleTask could not read row ${data.reportId}: ${(err as Error).message}`,
      );
    }
    if (!readOk) {
      // runAggregatedReport already persisted the terminal row status (ready OR
      // failed) and published its event BEFORE we got here, so a transient read
      // blip must NOT default the widget task to 'failed' — that would mislabel
      // a fully-generated, reachable report as a failure. Leave the task to its
      // TTL instead of reporting a false outcome.
      return;
    }
    if (rowStatus === 'ready') {
      await this.completeTask(data, 'completed', {
        // Deep-link to the org stored-reports list (NOT a signed URL): the task
        // expires in ~1h while the report persists for the plan's retention.
        resultUrl: `/reports?reportId=${data.reportId}`,
      });
    } else {
      await this.completeTask(data, 'failed', {
        error: rowError ?? 'report generation failed',
      });
    }
  }

  private async completeTask(
    data: AggregatedReportJobData,
    status: 'completed' | 'failed',
    extra: { resultUrl?: string; error?: string },
  ): Promise<void> {
    if (!data.taskId || !data.userId) return;
    const succeeded = status === 'completed' ? 1 : 0;
    const failed = status === 'completed' ? 0 : 1;
    try {
      await this.asyncTaskStore.markTerminal(
        data.taskId,
        { status, processed: 1, succeeded, failed, ...extra },
        this.ttlMs,
      );
    } catch {
      // best-effort
    }
    try {
      await this.realtime.publish({
        eventId: ulid(),
        type: 'ASYNC_TASK_COMPLETED',
        scope: {
          jobId: data.taskId,
          userId: data.userId,
          ...(data.organizationId
            ? { organizationId: data.organizationId }
            : {}),
        },
        payload: {
          asyncTask: {
            taskId: data.taskId,
            type: 'report_generation',
            status,
            total: 1,
            processed: 1,
            succeeded,
            failed,
            ...(extra.resultUrl ? { resultUrl: extra.resultUrl } : {}),
            ...(extra.error ? { error: extra.error } : {}),
          },
        },
      });
    } catch {
      // best-effort realtime
    }
  }
}
