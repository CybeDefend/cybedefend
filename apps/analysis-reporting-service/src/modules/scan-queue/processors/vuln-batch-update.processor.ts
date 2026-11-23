import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ulid } from 'ulid';

import { QUEUE_NAMES } from '../queue-names';
import { VulnBatchUpdateJobData } from '../scan-queue.service';
import { getQueueConcurrency } from '../concurrency.config';
import {
  AsyncTaskStore,
  AsyncTaskStatus,
} from '../../../core/realtime/async-task-store.service';
import { ResultService } from '../../result/result.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ProjectOrgResolver } from '../../../core/realtime/project-org-resolver.service';
import { BatchUpdateResultRequest } from '../../../core/grpc/analysis-reporting/result';

/**
 * BullMQ processor for async bulk vulnerability batch-updates (status / priority
 * / comment changes applied to N vulnerabilities in one background job).
 *
 * Flow per job:
 *  1. Mark the AsyncTaskRecord as 'running'.
 *  2. Delegate to ResultService.applyBatchUpdate() with a decile-throttled
 *     progress callback that publishes ASYNC_TASK_PROGRESS events.
 *  3. On success: markTerminal(completed) + publish ASYNC_TASK_COMPLETED.
 *  4. On failure: markTerminal(failed) + publish ASYNC_TASK_COMPLETED(failed).
 *     Does NOT re-throw — the failure is terminal and already surfaced via
 *     the realtime event.
 */
@Processor(QUEUE_NAMES.VULN_BATCH_UPDATE, {
  concurrency: getQueueConcurrency('VULN_BATCH_UPDATE'),
})
export class VulnBatchUpdateProcessor extends WorkerHost {
  private readonly logger = new Logger(VulnBatchUpdateProcessor.name);

  /** TTL applied to terminal records so they are auto-evicted from Redis. */
  private readonly ttlMs = Number(process.env.ASYNC_TASK_TTL_MS) || 3_600_000;

  constructor(
    private readonly store: AsyncTaskStore,
    private readonly resultService: ResultService,
    private readonly realtime: RealtimeEventPublisher,
    private readonly orgResolver: ProjectOrgResolver,
  ) {
    super();
  }

  async process(job: Job<VulnBatchUpdateJobData>): Promise<void> {
    const {
      taskId,
      projectId,
      userId,
      items,
      agentToolCallId,
      agentConversationId,
      agentStreamId,
    } = job.data;

    this.logger.log(
      `[VulnBatchUpdate] Starting job ${job.id} taskId=${taskId} project=${projectId} items=${items.length}`,
    );

    const startedAt = Date.now();

    try {
      // 1. Mark running
      await this.store.update(taskId, { status: 'running' });

      // 2. Build request for ResultService
      const request: BatchUpdateResultRequest = {
        projectId,
        userId,
        items,
        agentToolCallId: agentToolCallId ?? '',
        agentConversationId: agentConversationId ?? '',
        agentStreamId: agentStreamId ?? '',
      };

      // 3. Decile-throttled progress callback
      const total = items.length;
      let lastDecile = 0;

      const onProgress = async (p: {
        processed: number;
        succeeded: number;
        failed: number;
      }) => {
        await this.store.update(taskId, {
          processed: p.processed,
          succeeded: p.succeeded,
          failed: p.failed,
        });
        const decile = total > 0 ? Math.floor((p.processed / total) * 10) : 10;
        if (decile > lastDecile) {
          lastDecile = decile;
          await this.publish('ASYNC_TASK_PROGRESS', {
            taskId,
            userId,
            projectId,
            status: 'running',
            total,
            processed: p.processed,
            succeeded: p.succeeded,
            failed: p.failed,
          });
        }
      };

      // 4. Execute the batch update
      const res = await this.resultService.applyBatchUpdate(
        request,
        onProgress,
      );

      // 5. Terminal success
      await this.store.markTerminal(
        taskId,
        {
          status: 'completed',
          processed: res.totalCount,
          succeeded: res.successCount,
          failed: res.failureCount,
        },
        this.ttlMs,
      );

      await this.publish('ASYNC_TASK_COMPLETED', {
        taskId,
        userId,
        projectId,
        status: 'completed',
        total,
        processed: res.totalCount,
        succeeded: res.successCount,
        failed: res.failureCount,
      });

      this.logger.log(
        `[VulnBatchUpdate] taskId=${taskId} completed in ${Date.now() - startedAt}ms — ` +
          `${res.successCount}/${res.totalCount} succeeded`,
      );
    } catch (err) {
      const msg = (err as Error).message ?? 'vuln batch update failed';
      this.logger.error(
        `[VulnBatchUpdate] taskId=${taskId} failed: ${msg}`,
        (err as Error).stack,
      );

      await this.store.markTerminal(
        taskId,
        { status: 'failed', error: msg },
        this.ttlMs,
      );

      await this.publish('ASYNC_TASK_COMPLETED', {
        taskId,
        userId,
        projectId,
        status: 'failed',
        total: items.length,
        error: msg,
      });

      // Intentionally NOT re-throwing: failure is terminal and already
      // surfaced to the client via the realtime event.
    }
  }

  /**
   * Queue-level failure (e.g. job stalled after a worker crash mid-update).
   * process() never ran its catch, so the record could stay 'queued' or
   * 'running' forever. Guard on non-terminal status before flipping to failed.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VulnBatchUpdateJobData> | undefined,
    error: Error,
  ): Promise<void> {
    const msg =
      error?.message ?? 'vuln batch update job failed at the queue level';
    this.logger.error(
      `[VulnBatchUpdate] Job ${job?.id} failed at the queue level: ${msg}`,
    );

    const data = job?.data;
    if (!data?.taskId) return;

    try {
      const record = await this.store.get(data.taskId);
      const status: AsyncTaskStatus | undefined = record?.status;

      // Only flip if still in a non-terminal state
      if (status !== 'queued' && status !== 'running') return;

      await this.store.markTerminal(
        data.taskId,
        { status: 'failed', error: msg },
        this.ttlMs,
      );

      await this.publish('ASYNC_TASK_COMPLETED', {
        taskId: data.taskId,
        userId: data.userId,
        projectId: data.projectId,
        status: 'failed',
        total: data.items.length,
        error: msg,
      });
    } catch (err) {
      // Never throw from a worker event handler — log and move on.
      this.logger.error(
        `[VulnBatchUpdate] Could not persist queue-level failure for taskId=${data.taskId}: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async publish(
    type: 'ASYNC_TASK_PROGRESS' | 'ASYNC_TASK_COMPLETED',
    f: {
      taskId: string;
      userId: string;
      projectId: string;
      status: string;
      total?: number;
      processed?: number;
      succeeded?: number;
      failed?: number;
      error?: string;
    },
  ): Promise<void> {
    let organizationId: string | undefined;
    try {
      organizationId =
        (await this.orgResolver.resolveOrgId(f.projectId)) ?? undefined;
    } catch {
      // Org resolution is best-effort; route on projectId + userId alone.
    }

    await this.realtime.publish({
      eventId: ulid(),
      type,
      scope: {
        jobId: f.taskId,
        userId: f.userId,
        projectId: f.projectId,
        ...(organizationId ? { organizationId } : {}),
      },
      payload: {
        asyncTask: {
          taskId: f.taskId,
          type: 'vuln_batch_update',
          status: f.status,
          total: f.total,
          processed: f.processed,
          succeeded: f.succeeded,
          failed: f.failed,
          ...(f.error ? { error: f.error } : {}),
        },
      },
    });
  }
}
