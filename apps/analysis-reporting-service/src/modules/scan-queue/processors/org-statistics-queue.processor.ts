import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue-names';
import { OrgStatisticsRecomputeJobData } from '../../organization-statistics/organization-statistics-recompute.types';
import {
  OrganizationStatisticsService,
  statsRecordFromMainStatistics,
} from '../../organization-statistics/organization-statistics.service';
import {
  decideOrgStatsDrain,
  ORG_STATS_TRAILING_MS,
  ORG_STATS_RETRY_BACKOFF_MS,
} from '../../organization-statistics/organization-statistics-debounce';
import { ResultService } from '../../result/result.service';
import { getQueueConcurrency } from '../concurrency.config';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ulid } from 'ulid';

/**
 * Debounced org-statistics recompute. ONE job per org (jobId dedup across
 * replicas). Each run reads the DB timings and either recomputes, skips, or
 * re-delays ITSELF (moveToDelayed → same job, so events that land meanwhile
 * just bump last_event_at and are coalesced when it next fires). The
 * trailing/maxWait/floor policy lives in decideOrgStatsDrain.
 */
@Processor(QUEUE_NAMES.ORG_STATISTICS_RECOMPUTE, {
  concurrency: getQueueConcurrency('ORG_STATISTICS_RECOMPUTE'),
  lockDuration: 120000, // org-wide aggregation can take a few seconds
  lockRenewTime: 30000,
})
export class OrganizationStatisticsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(
    OrganizationStatisticsQueueProcessor.name,
  );

  constructor(
    private readonly service: OrganizationStatisticsService,
    private readonly resultService: ResultService,
    private readonly realtime: RealtimeEventPublisher,
  ) {
    super();
  }

  async process(
    job: Job<OrgStatisticsRecomputeJobData>,
    token?: string,
  ): Promise<void> {
    const { organizationId } = job.data;

    try {
      const timings = await this.service.readTimings(organizationId);
      if (!timings) return; // row vanished — nothing to do

      const decision = decideOrgStatsDrain(timings);

      if (decision.action === 'skip') {
        return; // already computed; this was a stray/duplicate fire
      }

      if (decision.action === 'reschedule') {
        // Re-delay THIS job (keeps the per-org jobId, so concurrent events stay
        // deduped). DelayedError tells the worker it was delayed, not failed.
        await job.moveToDelayed(Date.now() + decision.delayMs, token);
        throw new DelayedError();
      }

      // recompute: org-wide aggregation, then persist (clears dirty unless an
      // event landed mid-compute).
      const projectIds = await this.service.resolveProjectIds(organizationId);
      const dto = projectIds.length
        ? await this.resultService.getMainStatistics({ projectIds })
        : null;
      const { stillDirty } = await this.service.finishCompute(
        organizationId,
        statsRecordFromMainStatistics(dto),
        timings.now,
      );
      this.logger.log(
        `org-statistics recomputed org=${organizationId} projects=${projectIds.length} stillDirty=${stillDirty}`,
      );

      // Close the loop: the home "/" cards subscribe to the org projects stream
      // and refetch on this event only (changeType `org_stats_updated`, and on
      // a stream reconnect): they read the row persisted just above, which
      // nothing else changes. The triggering event fired BEFORE this
      // (debounced) recompute, so without this emit the cards would keep
      // showing the pre-recompute numbers. The project list refetches on it
      // too, its counts being final once the recompute ran.
      await this.realtime
        .publish({
          eventId: ulid(),
          type: 'PROJECT_STATE_CHANGED',
          scope: { organizationId },
          payload: {
            projectStateChanged: { changeType: 'org_stats_updated' },
          },
        })
        .catch(() => {
          // best-effort — a realtime hiccup must not fail the recompute
        });

      if (stillDirty) {
        // Events landed during the compute → keep the cycle going.
        await job.moveToDelayed(Date.now() + ORG_STATS_TRAILING_MS, token);
        throw new DelayedError();
      }
    } catch (err) {
      // DelayedError is the intended "re-delayed, not failed" signal — re-throw.
      if (err instanceof DelayedError) throw err;

      // Transient DB/gRPC failure during the recompute. Crucially we must NOT
      // let this fail terminally: with a stable per-org jobId a retained failed
      // job would dedup away every future markDirty, freezing the org's KPI
      // cards until the job is cleaned up by hand. Instead re-delay THIS job
      // (jobId stays held by a healthy delayed job) — the org is still dirty,
      // so it retries until the dependency recovers.
      this.logger.warn(
        `org-statistics recompute failed org=${organizationId}, retrying in ${ORG_STATS_RETRY_BACKOFF_MS}ms: ${String(
          (err as any)?.message ?? err,
        )}`,
      );
      await job.moveToDelayed(Date.now() + ORG_STATS_RETRY_BACKOFF_MS, token);
      throw new DelayedError();
    }
  }
}
