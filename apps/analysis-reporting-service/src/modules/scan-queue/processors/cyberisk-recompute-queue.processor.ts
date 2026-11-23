import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue-names';
import { CyberiskRecomputeJobData } from '../../cyber-risk/cyberisk-recompute.types';
import { CyberRiskService } from '../../cyber-risk/cyber-risk.service';
import { CyberiskRecomputeEnqueuer } from '../../cyber-risk/cyberisk-recompute.enqueuer';
import { ProjectScoreSyncService } from '../../cyber-risk/project-score-sync.service';
import { OrganizationStatisticsService } from '../../organization-statistics/organization-statistics.service';
import { getQueueConcurrency } from '../concurrency.config';

/**
 * BullMQ processor for the cyberisk-recompute-queue.
 *
 * One job per project (deduplicated by jobId = "cyberisk-{projectId}").
 * concurrency=4 lets us process several projects in parallel while
 * keeping per-project work serialized.
 *
 * Each invocation recomputes the project's score from scratch and
 * upserts it into project_cyber_risk.
 *
 * Lost-update guard: because the per-project jobId also dedups adds that land
 * while THIS job is active, a mutation arriving mid-recompute would otherwise
 * be lost. We snapshot the project's "dirty" counter at the start of the run
 * and, once the job completes (jobId freed), re-enqueue one catch-up recompute
 * if the counter changed. Idempotent and converges in a single extra pass.
 */
@Processor(QUEUE_NAMES.CYBERISK_RECOMPUTE, {
  concurrency: getQueueConcurrency('CYBERISK_RECOMPUTE'),
  lockDuration: 120000, // 2 min — vuln fetch + insert
  lockRenewTime: 30000,
})
export class CyberiskRecomputeQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(CyberiskRecomputeQueueProcessor.name);

  // dirty-counter snapshot captured at job start, keyed by job id, consumed by
  // the 'completed' handler. Bounded by in-flight concurrency.
  private readonly dirtyAtStart = new Map<string, number>();

  constructor(
    private readonly cyberRisk: CyberRiskService,
    private readonly enqueuer: CyberiskRecomputeEnqueuer,
    private readonly scoreSync: ProjectScoreSyncService,
    private readonly orgStats: OrganizationStatisticsService,
  ) {
    super();
  }

  async process(job: Job<CyberiskRecomputeJobData>): Promise<void> {
    const { projectId, trigger } = job.data;
    if (job.id) {
      this.dirtyAtStart.set(job.id, await this.enqueuer.readDirty(projectId));
    }
    const result =
      await this.cyberRisk.computeAndPersistProjectScore(projectId);
    this.logger.log(
      `cyberisk recompute done projectId=${projectId} trigger=${trigger} score=${result.score} level=${result.level} vulns=${result.vulnCount}`,
    );
    // Mirror the fresh score onto global-management's denormalized sort key.
    // Best-effort: pushScore never throws, so a global-management hiccup cannot
    // fail the recompute (the authoritative score is already persisted above).
    await this.scoreSync.pushScore(projectId, result.score);

    // Every score-changing event (scan_complete, vuln update, security context)
    // flows through this queue, so this is the single chokepoint to mark the
    // project's org dirty for an org-statistics recompute. Best-effort.
    void this.orgStats.markDirtyForProject(projectId);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<CyberiskRecomputeJobData>): Promise<void> {
    const jobId = job?.id;
    if (!jobId) return;
    const seen = this.dirtyAtStart.get(jobId);
    this.dirtyAtStart.delete(jobId);
    const projectId = job?.data?.projectId;
    if (seen === undefined || !projectId) return;
    try {
      // The jobId is freed now (removeOnComplete), so this add will not be
      // deduped away. Only re-run when a mutation actually landed during
      // processing — otherwise we'd loop forever.
      const current = await this.enqueuer.readDirty(projectId);
      if (current !== seen) {
        await this.enqueuer.enqueue(projectId, job.data.trigger);
      }
    } catch (err: any) {
      // Catch-up is best-effort; never let it crash the worker.
      this.logger.warn(
        `cyberisk catch-up re-enqueue failed projectId=${projectId} err=${String(
          err?.message ?? err,
        )}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CyberiskRecomputeJobData> | undefined, err: Error) {
    if (job?.id) this.dirtyAtStart.delete(job.id);
    this.logger.error(
      `cyberisk recompute failed projectId=${job?.data?.projectId} err=${err.message}`,
      err.stack,
    );
  }
}
