/**
 * Debounce / rate-limit policy for the org-statistics recompute.
 *
 * Pure functions over timestamps so the (tricky) timing math is unit-testable
 * and the distributed processor stays a thin shell. The actual scheduling is
 * done with BullMQ delayed jobs (jobId = per-org → dedup across worker
 * replicas) and the timestamps live in the `organization_statistics` row, so
 * the policy is correct even though the analysis-worker is multi-replica
 * (KEDA) — no in-memory timers.
 *
 * Three forces:
 *  - TRAILING: recompute only after a quiet period (coalesce event bursts).
 *  - MAX_WAIT: …but never more than this after the first event of the cycle,
 *    so a perpetually-busy org (events every <TRAILING ms forever) still
 *    refreshes instead of freezing.
 *  - MIN_INTERVAL: …and never sooner than this after the last successful
 *    compute, so volume can't push the recompute frequency past one per
 *    window (the real storm guard).
 */
export const ORG_STATS_TRAILING_MS = 3_000;
export const ORG_STATS_MAX_WAIT_MS = 60_000;
export const ORG_STATS_MIN_INTERVAL_MS = 30_000;
// On a transient recompute failure the drain re-delays ITSELF by this much
// (instead of failing terminally, which would retain the per-org jobId and
// block every future drain). The org stays dirty, so it retries until it
// succeeds — no frozen KPI cards waiting on a manual job cleanup.
export const ORG_STATS_RETRY_BACKOFF_MS = 15_000;

export interface OrgStatsDebounceTimings {
  /** Wall-clock now (ms). */
  now: number;
  /** Last event timestamp (ms) — advances on every markDirty. */
  lastEventAt: number;
  /** Start of the current dirty cycle (ms) — set on the first event after a
   *  compute, cleared (0) once recomputed. */
  dirtySince: number;
  /** Last successful compute (ms); 0 when never computed. */
  computedAt: number;
}

export type OrgStatsDrainDecision =
  | { action: 'recompute' }
  | { action: 'reschedule'; delayMs: number }
  | { action: 'skip' };

/**
 * Earliest timestamp (ms) at which a recompute is allowed given the timings.
 * = max( min(trailing, maxWait), floor ).
 */
export function orgStatsRecomputeAt(t: OrgStatsDebounceTimings): number {
  const trailing = t.lastEventAt + ORG_STATS_TRAILING_MS;
  const maxWait = t.dirtySince + ORG_STATS_MAX_WAIT_MS;
  const floor = t.computedAt + ORG_STATS_MIN_INTERVAL_MS;
  return Math.max(Math.min(trailing, maxWait), floor);
}

/**
 * Decide what a drain run should do: recompute now, reschedule itself for
 * later (delayMs > 0), or skip entirely when the org is not dirty.
 */
export function decideOrgStatsDrain(
  t: OrgStatsDebounceTimings,
): OrgStatsDrainDecision {
  // Not dirty → already computed, nothing to do (clears a stray job).
  if (!t.dirtySince) {
    return { action: 'skip' };
  }
  const at = orgStatsRecomputeAt(t);
  if (t.now >= at) {
    return { action: 'recompute' };
  }
  return { action: 'reschedule', delayMs: at - t.now };
}
