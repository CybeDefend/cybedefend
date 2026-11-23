/**
 * Per-queue backlog statistics returned by EvaluationQueueService.getQueueBacklog().
 *
 * Counts are sourced from BullMQ's getJobCounts('wait','prioritized','delayed','active'):
 *   - waiting   = BullMQ `wait` list (FIFO non-prioritized jobs)
 *   - prioritized = BullMQ `prioritized` ZSET (jobs with explicit priority)
 *   - delayed   = BullMQ `delayed` ZSET (jobs scheduled for the future)
 *   - active    = jobs currently being processed by workers
 *   - pending   = waiting + prioritized + delayed  (work NOT yet started — KEDA scales on this)
 *   - backlog   = pending + active                 (total outstanding — observability)
 */
export interface QueueDepthStats {
  waiting: number;
  prioritized: number;
  delayed: number;
  active: number;
  /** Work not yet started: waiting + prioritized + delayed */
  pending: number;
  /** Total outstanding work: pending + active */
  backlog: number;
}

/**
 * Backlog snapshot for the single policy-management queue.
 *
 * Queue→key mapping:
 *   policy-evaluation-queue → policyEvaluation
 *
 * Note: there is exactly ONE queue, so there is no `aggregates` block
 * (unlike analysis-reporting which aggregates across 10 queues).
 */
export interface QueueBacklogResponse {
  queues: {
    policyEvaluation: QueueDepthStats;
  };
}
