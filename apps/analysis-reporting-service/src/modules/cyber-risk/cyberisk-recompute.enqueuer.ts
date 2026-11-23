import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import {
  buildCyberiskJobId,
  CyberiskRecomputeJobData,
  CyberiskRecomputeTrigger,
} from './cyberisk-recompute.types';

/**
 * Central enqueuer for cyberisk-recompute-queue.
 *
 * Every trigger (scan complete, vuln update, security context update,
 * admin) goes through this service so the dedup + delay policy is in
 * exactly one place.
 *
 * Deduplication: BullMQ refuses to add a new job when one with the
 * same jobId is already pending. We exploit that with jobId =
 * "cyberisk-{projectId}", so bursts of updates on the same project
 * coalesce into a single recompute.
 *
 * Debounce window (5s): the first event of a burst schedules a job
 * delayed by COALESCE_DELAY_MS; every later event on the SAME project
 * that lands while that job is still pending is dropped by the jobId
 * dedup (its mutation is still honoured — the recompute re-reads the
 * latest committed DB state when it finally runs). This stops a flurry
 * of events (e.g. bulk "ignore", repeated context saves) from spamming
 * the queue with one recompute each: the whole 5s window collapses into
 * a single recompute.
 *
 * Lost-update guard: the jobId dedup also drops adds that arrive while the
 * job is ACTIVE (being processed), so a mutation that lands mid-recompute
 * would be silently lost until the next trigger. To close that window every
 * enqueue bumps a per-project "dirty" counter in Redis; the processor reads it
 * before computing and, once the job completes, re-enqueues a catch-up
 * recompute if the counter moved during processing. See
 * CyberiskRecomputeQueueProcessor.
 */
@Injectable()
export class CyberiskRecomputeEnqueuer {
  private readonly logger = new Logger(CyberiskRecomputeEnqueuer.name);

  // Per-project mutation counter TTL — long enough to outlive any recompute,
  // short enough that idle projects don't keep the key around forever.
  private static readonly DIRTY_TTL_SECONDS = 86_400;

  // Per-project debounce/coalescing window. The first event of a burst schedules
  // a recompute delayed by this much; every later event on the same project that
  // arrives within the window is deduped away (jobId collision) so the burst
  // collapses into ONE recompute instead of spamming the queue.
  private static readonly COALESCE_DELAY_MS = 5_000;

  constructor(
    @InjectQueue(QUEUE_NAMES.CYBERISK_RECOMPUTE)
    private readonly queue: Queue<CyberiskRecomputeJobData>,
  ) {}

  private dirtyKey(projectId: string): string {
    return `cyberisk:dirty:${projectId}`;
  }

  /**
   * Bumps the per-project mutation counter. Best-effort: dirty tracking must
   * never break the primary enqueue, so any Redis error is swallowed.
   */
  async markDirty(projectId: string): Promise<void> {
    try {
      // BullMQ ≥5.77 narrows `queue.client` to its own IRedisClient
      // interface, which omits incr/expire. The runtime client is ioredis,
      // so cast to reach the counter commands (same pattern as scan-queue).
      const client = (await this.queue.client) as unknown as Redis;
      await client.incr(this.dirtyKey(projectId));
      await client.expire(
        this.dirtyKey(projectId),
        CyberiskRecomputeEnqueuer.DIRTY_TTL_SECONDS,
      );
    } catch {
      // best-effort — see above
    }
  }

  /** Reads the per-project mutation counter (0 when unset/unreachable). */
  async readDirty(projectId: string): Promise<number> {
    try {
      const client = await this.queue.client;
      const v = await client.get(this.dirtyKey(projectId));
      return v ? Number(v) : 0;
    } catch {
      return 0;
    }
  }

  async enqueue(
    projectId: string,
    trigger: CyberiskRecomputeTrigger,
  ): Promise<void> {
    // Record the mutation BEFORE adding the job so the processor's
    // start-of-run read reflects it (commit-then-enqueue ordering guarantees
    // the DB change is visible by then).
    await this.markDirty(projectId);
    try {
      await this.queue.add(
        'recompute',
        { projectId, trigger },
        {
          jobId: buildCyberiskJobId(projectId),
          delay: CyberiskRecomputeEnqueuer.COALESCE_DELAY_MS,
          removeOnComplete: true,
          // MUST remove failed jobs, not retain them. The jobId is a stable
          // per-project key, so a retained failed job would dedup away every
          // future enqueue for that project and freeze its CyberRisk score
          // until cleaned up by hand. Removing it frees the key: the next
          // trigger (vuln update / scan complete) — or the worker-boot
          // backfill — re-enqueues and recovers. `attempts` below still rides
          // out short transient blips before the job is ever marked failed.
          removeOnFail: true,
          // Transient Redis/DB blips shouldn't drop a recompute; retry a few
          // times with exponential backoff before giving up.
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    } catch (err: any) {
      // Duplicate jobId means an identical job is already pending —
      // that's exactly the dedup we want, not a real failure.
      if (
        err?.code === 'JOB_EXISTS' ||
        /already exists/i.test(String(err?.message))
      ) {
        return;
      }
      // Enqueueing a recompute is a best-effort side-effect of the primary
      // operation (scan-complete, vuln update, CVSS recalc, read backfill).
      // It must NEVER break that operation, so log and swallow any other
      // error rather than rethrowing.
      this.logger.warn(
        `Failed to enqueue cyberisk recompute for project=${projectId} trigger=${trigger}: ${String(
          err?.message,
        )}`,
      );
    }
  }
}
