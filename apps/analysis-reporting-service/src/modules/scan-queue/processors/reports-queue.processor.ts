import {
  InjectQueue,
  Processor,
  WorkerHost,
  OnWorkerEvent,
} from '@nestjs/bullmq';
import {
  Inject,
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
import { ReportJobData } from '../scan-queue.service';
import { getQueueConcurrency } from '../concurrency.config';
import {
  failLostQueuedReports,
  isQueueJobPending,
  STALE_REPORT_SWEEP_INTERVAL_MS,
} from '../../reports/retention/stale-report-sweep';
import {
  GeneratedReport,
  GeneratedReportKind,
  GeneratedReportStatus,
} from '../../../entities/generated-report.entity';
import {
  ReportUploadService,
  UploadedReport,
} from '../../reports/shared/report-upload.service';
import { OwaspReportService } from '../../reports/owasp-report/owasp-report.service';
import { CweReportService } from '../../reports/cwe-report/cwe-report.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ProjectOrgResolver } from '../../../core/realtime/project-org-resolver.service';
import { AsyncTaskStore } from '../../../core/realtime/async-task-store.service';
import {
  PROJECT_REPORT_GENERATORS,
  ProjectReportGenerator,
} from '../../../edition/ports/project-report-generators.port';

/**
 * BullMQ processor for async premium report generation (OWASP / CWE / EU AI
 * Act / scanner-type). Moved off the gRPC request path so the heavy Puppeteer
 * PDF render no longer blocks the handler.
 *
 * Flow per job:
 *  1. Build the report bytes and upload them to object storage (per-kind generator).
 *  2. Persist objectPath + status="ready" on the GeneratedReport row.
 *  3. Publish a REPORT_READY realtime event (IDs-only) so the dashboard
 *     refetches a fresh signed URL.
 *
 * Failure is terminal: we persist status="failed" + the error, publish a
 * REPORT_READY(status=failed) event and DO NOT re-throw — re-running would
 * only emit a duplicate failure (the queue is configured with attempts=1).
 */
@Processor(QUEUE_NAMES.REPORTS, {
  concurrency: getQueueConcurrency('REPORTS'), // Puppeteer is memory-heavy; default 1.
  lockDuration: 300000, // 5 min — large reports can take a while.
  lockRenewTime: 60000,
})
export class ReportsQueueProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReportsQueueProcessor.name);
  private readonly ttlMs = Number(process.env.ASYNC_TASK_TTL_MS) || 3_600_000;

  constructor(
    @InjectRepository(GeneratedReport)
    private readonly reportRepo: Repository<GeneratedReport>,
    private readonly owaspReportService: OwaspReportService,
    private readonly cweReportService: CweReportService,
    private readonly reportUpload: ReportUploadService,
    private readonly realtime: RealtimeEventPublisher,
    private readonly orgResolver: ProjectOrgResolver,
    private readonly asyncTaskStore: AsyncTaskStore,
    // The closed kinds (scanner_type, eu_ai_act), registered by an
    // ee module; absent in the Community Edition.
    @Optional()
    @Inject(PROJECT_REPORT_GENERATORS)
    private readonly generators?: ProjectReportGenerator[],
    // Its own queue, for the stale sweep's job lookups.
    @Optional()
    @InjectQueue(QUEUE_NAMES.REPORTS)
    private readonly reportsQueue?: Queue<ReportJobData>,
  ) {
    super();
  }

  private sweepTimer?: NodeJS.Timeout;

  onModuleInit(): void {
    if (!this.reportsQueue) return;
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
   * Fail the old queued reports whose job is gone; never one whose job
   * still waits or renders (it still ends ready). Every report worker runs
   * it: the update is guarded, so two runs never conflict.
   */
  async sweepLostReports(): Promise<void> {
    const queue = this.reportsQueue;
    if (!queue) return;
    try {
      const failed = await failLostQueuedReports(this.reportRepo, (id) =>
        isQueueJobPending(queue, `report-${id}`),
      );
      if (failed > 0) {
        this.logger.log(
          `[Reports] stale sweep failed ${failed} lost report(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[Reports] stale sweep failed: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job<ReportJobData>): Promise<void> {
    const { reportId, kind, projectId, format, taskId, userId } = job.data;
    this.logger.log(
      `[Reports] Starting job ${job.id} reportId=${reportId} kind=${kind} project=${projectId} format=${format}`,
    );
    const startedAt = Date.now();
    await this.markTaskRunning(taskId);

    try {
      const row = await this.reportRepo.findOne({ where: { id: reportId } });
      if (row?.status !== 'queued') {
        await this.skipNotQueued(job.data, row ?? null);
        return;
      }
      const uploaded = await this.buildAndUpload(job.data);
      if (!uploaded) {
        await this.skipNotQueued(job.data);
        return;
      }

      // Guarded on 'queued': a row deleted during the upload is not
      // recreated, and its file is removed instead of being left behind.
      const res = await this.reportRepo.update(
        { id: reportId, status: 'queued' },
        {
          objectPath: uploaded.objectPath,
          filename: uploaded.filename,
          contentType: uploaded.contentType,
          status: 'ready',
        },
      );
      if ((res?.affected ?? 0) === 0) {
        await this.removeUpload(uploaded.objectPath, projectId);
        await this.skipNotQueued(job.data);
        return;
      }

      await this.publish(reportId, projectId, kind, 'ready');
      // resultUrl is a dashboard deep-link (NOT a signed URL): the
      // task expires in ~1h while the report persists, so the click must land
      // on the stored-reports list where the URL is re-minted on demand.
      await this.completeTask(taskId, userId, projectId, 'completed', {
        resultUrl: `/project/${projectId}/reports?reportId=${reportId}`,
      });

      this.logger.log(
        `[Reports] reportId=${reportId} ready in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      const message = (err as Error).message ?? 'report generation failed';
      this.logger.error(
        `[Reports] reportId=${reportId} failed: ${message}`,
        (err as Error).stack,
      );

      await this.reportRepo.update(reportId, {
        status: 'failed',
        error: message.slice(0, 2000),
      });

      await this.publish(reportId, projectId, kind, 'failed');
      await this.completeTask(taskId, userId, projectId, 'failed', {
        error: message.slice(0, 2000),
      });
      // Intentionally NOT re-throwing: the failure is terminal and already
      // surfaced to the user via the realtime event.
    }
  }

  /**
   * True while the report row still exists and waits for this job. A report
   * the user deleted (or one already settled) is not rendered nor uploaded:
   * the work would be thrown away and would hold the shared worker.
   */
  private async stillQueued(reportId: string): Promise<boolean> {
    const row = await this.reportRepo.findOne({ where: { id: reportId } });
    return row?.status === 'queued';
  }

  /**
   * The job stops: its report was deleted, or already settled (failed by the
   * stale sweep). The widget says which, never « deleted » for a report
   * that still exists.
   */
  private async skipNotQueued(
    data: ReportJobData,
    known?: GeneratedReport | null,
  ): Promise<void> {
    const row =
      known !== undefined
        ? known
        : await this.reportRepo
            .findOne({ where: { id: data.reportId } })
            .catch(() => null);
    const error = row
      ? row.error || 'The report is no longer queued'
      : 'The report was deleted before it was generated';
    this.logger.log(
      `[Reports] reportId=${data.reportId} no longer queued (${row ? row.status : 'deleted'}), job stopped`,
    );
    await this.completeTask(
      data.taskId,
      data.userId,
      data.projectId,
      'failed',
      { error },
    );
  }

  private async removeUpload(
    objectPath: string,
    tenant: string,
  ): Promise<void> {
    try {
      await this.reportUpload.deleteReport(objectPath, tenant);
    } catch (err) {
      this.logger.warn(
        `[Reports] could not remove the file of a deleted report ${objectPath}: ${(err as Error).message}`,
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

  private async completeTask(
    taskId: string | undefined,
    userId: string | undefined,
    projectId: string,
    status: 'completed' | 'failed',
    extra: { resultUrl?: string; error?: string },
  ): Promise<void> {
    if (!taskId || !userId) return;
    const succeeded = status === 'completed' ? 1 : 0;
    const failed = status === 'completed' ? 0 : 1;
    try {
      await this.asyncTaskStore.markTerminal(
        taskId,
        { status, processed: 1, succeeded, failed, ...extra },
        this.ttlMs,
      );
    } catch {
      // best-effort
    }
    let organizationId: string | undefined;
    try {
      organizationId =
        (await this.orgResolver.resolveOrgId(projectId)) ?? undefined;
    } catch {
      // best-effort routing enrichment
    }
    try {
      await this.realtime.publish({
        eventId: ulid(),
        type: 'ASYNC_TASK_COMPLETED',
        scope: {
          jobId: taskId,
          userId,
          projectId,
          ...(organizationId ? { organizationId } : {}),
        },
        payload: {
          asyncTask: {
            taskId,
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

  /**
   * Generate the report bytes for `kind` and upload them, returning the
   * persisted storage object path + signed URL metadata.
   *
   * OWASP/CWE return a Buffer, uploaded here through the shared service. Any
   * other kind (scanner-type, EU AI Act) is built and uploaded by the
   * generator an ee module registers for it (PROJECT_REPORT_GENERATORS).
   *
   * Resolves `null` when the report row was deleted while the bytes were
   * being built: nothing is uploaded then.
   */
  private async buildAndUpload(
    data: ReportJobData,
  ): Promise<UploadedReport | null> {
    const { kind, projectId, format, detailed, branch } = data;

    switch (kind) {
      case 'owasp': {
        const r = await this.owaspReportService.generateReport(
          projectId,
          format,
          detailed,
          branch,
        );
        if (!(await this.stillQueued(data.reportId))) return null;
        return this.reportUpload.uploadReport({
          projectId,
          filename: r.filename,
          contentType: r.contentType,
          buffer: r.content,
        });
      }

      case 'cwe': {
        const r = await this.cweReportService.generateReport(
          projectId,
          format,
          detailed,
          branch,
        );
        if (!(await this.stillQueued(data.reportId))) return null;
        return this.reportUpload.uploadReport({
          projectId,
          filename: r.filename,
          contentType: r.contentType,
          buffer: r.content,
        });
      }

      default: {
        const generator = this.generators?.find((g) => g.kind === kind);
        if (!generator) {
          throw new Error(`Unknown report kind: ${kind as string}`);
        }
        return generator.buildAndUpload(data);
      }
    }
  }

  private async publish(
    reportId: string,
    projectId: string,
    kind: GeneratedReportKind,
    status: Extract<GeneratedReportStatus, 'ready' | 'failed'>,
  ): Promise<void> {
    let organizationId: string | undefined;
    try {
      organizationId =
        (await this.orgResolver.resolveOrgId(projectId)) ?? undefined;
    } catch {
      // Org resolution is best-effort; REPORT_READY routes on projectId alone.
    }

    await this.realtime.publish({
      eventId: ulid(),
      type: 'REPORT_READY',
      scope: { projectId, ...(organizationId ? { organizationId } : {}) },
      payload: {
        reportReady: { reportId, projectId, reportKind: kind, status },
      },
    });
  }

  /**
   * Queue-level failure (e.g. "job stalled more than allowable limit" after a
   * worker crash mid-render): process() never ran its catch, so the row would
   * stay "queued" forever and the dashboard would never receive an event.
   * Flip it to failed — atomically guarded on status='queued' so a job that
   * stalled AFTER a successful upload (row already 'ready') is left untouched
   * — and publish REPORT_READY(failed) only when this call did the transition.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ReportJobData> | undefined,
    error: Error,
  ): Promise<void> {
    const message = error?.message ?? 'report job failed at the queue level';
    this.logger.error(
      `[Reports] Job ${job?.id} failed at the queue level: ${message}`,
    );

    const data = job?.data;
    if (!data?.reportId) return;

    try {
      const res = await this.reportRepo.update(
        { id: data.reportId, status: 'queued' },
        { status: 'failed', error: message.slice(0, 2000) },
      );
      if ((res?.affected ?? 0) > 0) {
        await this.publish(data.reportId, data.projectId, data.kind, 'failed');
        await this.completeTask(
          data.taskId,
          data.userId,
          data.projectId,
          'failed',
          { error: message.slice(0, 2000) },
        );
      }
    } catch (err) {
      // Never throw from a worker event handler — log and move on.
      this.logger.error(
        `[Reports] Could not persist queue-level failure for reportId=${data.reportId}: ${(err as Error).message}`,
      );
    }
  }
}
