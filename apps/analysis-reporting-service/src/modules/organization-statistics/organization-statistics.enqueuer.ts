import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import {
  buildOrgStatsJobId,
  OrgStatisticsRecomputeJobData,
} from './organization-statistics-recompute.types';

/**
 * Enqueues the org-statistics drain job. jobId = per-org so only ONE drain is
 * pending per org across all worker replicas (BullMQ refuses a duplicate
 * jobId); bursts collapse, and the in-flight job re-evaluates the latest DB
 * timestamps via moveToDelayed. Best-effort — must never break the primary
 * mutation that triggered it.
 */
@Injectable()
export class OrganizationStatisticsEnqueuer {
  private readonly logger = new Logger(OrganizationStatisticsEnqueuer.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ORG_STATISTICS_RECOMPUTE)
    private readonly queue: Queue<OrgStatisticsRecomputeJobData>,
  ) {}

  async enqueueDrain(organizationId: string, delayMs: number): Promise<void> {
    try {
      await this.queue.add(
        'drain',
        { organizationId },
        {
          jobId: buildOrgStatsJobId(organizationId),
          delay: Math.max(0, Math.round(delayMs)),
          removeOnComplete: true,
          // MUST remove failed jobs: the per-org jobId is stable, so a retained
          // failed job would dedup away every future markDirty and freeze the
          // org's KPI cards. The processor self-heals transient failures by
          // re-delaying (it never fails terminally); this is the backstop for
          // any unexpected terminal failure — free the jobId so the next event
          // can re-enqueue a fresh drain.
          removeOnFail: true,
          attempts: 1,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    } catch (err: any) {
      if (
        err?.code === 'JOB_EXISTS' ||
        /already exists/i.test(String(err?.message))
      ) {
        // A drain is already pending for this org — exactly the dedup we want.
        return;
      }
      this.logger.warn(
        `Failed to enqueue org-statistics drain for org=${organizationId}: ${String(
          err?.message,
        )}`,
      );
    }
  }
}
