import { LessThan, Repository } from 'typeorm';
import type { Queue } from 'bullmq';

/**
 * A queued report older than this is no longer counted as in flight, and
 * the stale sweep fails it once its job is gone.
 */
export const REPORT_STALE_AFTER_MS = 60 * 60 * 1000;

/** The error a report settled by the stale sweep carries. */
export const STALE_REPORT_ERROR = 'Report generation timed out';

/** How often each report worker runs the stale sweep. */
export const STALE_REPORT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** Job states in which the worker will still process the job. */
const PENDING_JOB_STATES = new Set([
  'waiting',
  'prioritized',
  'active',
  'delayed',
  'waiting-children',
]);

/** True while the queue still holds the job in a state it will process. */
export async function isQueueJobPending(
  queue: Pick<Queue, 'getJob'>,
  jobId: string,
): Promise<boolean> {
  const job = await queue.getJob(jobId);
  if (!job) return false;
  return PENDING_JOB_STATES.has(await job.getState());
}

/**
 * Fail the queued reports older than REPORT_STALE_AFTER_MS whose job was
 * lost (the worker died, the queue lost it): they would show as generating
 * forever. A report whose job still waits behind a backlog or renders is
 * left alone, and so is one whose job cannot be looked up: the sweep never
 * fails a report that may still end ready. The update is guarded on
 * 'queued', so a report that ended meanwhile keeps its status. Returns the
 * number of reports failed.
 */
export async function failLostQueuedReports(
  repo: Pick<Repository<{ id: string }>, 'find' | 'update'>,
  isPending: (reportId: string) => Promise<boolean>,
  opts: { now?: Date; batchSize?: number } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - REPORT_STALE_AFTER_MS);
  const rows = await repo.find({
    where: { status: 'queued', createdAt: LessThan(cutoff) } as never,
    select: { id: true } as never,
    take: opts.batchSize ?? 200,
    order: { createdAt: 'ASC' } as never,
  });
  let failed = 0;
  for (const row of rows) {
    let pending: boolean;
    try {
      pending = await isPending(row.id);
    } catch {
      pending = true;
    }
    if (pending) continue;
    const res = await repo.update(
      { id: row.id, status: 'queued' } as never,
      { status: 'failed', error: STALE_REPORT_ERROR } as never,
    );
    failed += res?.affected ?? 0;
  }
  return failed;
}
