/**
 * Per-queue backlog statistics returned by ScanQueueService.getQueueBacklog().
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
 * Full backlog snapshot across all analysis-reporting queues.
 *
 * Queue→key mapping of the core queues:
 *   SCA                → sca
 *   SAST_IAC           → sastIac
 *   CONTAINER          → container
 *   CVSS_RECALCULATION → cvss
 *   CYBERISK_RECOMPUTE → cyberisk
 *   REPORTS            → reports
 *   AGGREGATED_REPORTS → aggregatedReports
 *
 * `queues` is a record: the core keys are always present, and a
 * closed queue that left ScanQueueService keeps its key through a
 * QUEUE_BACKLOG_EXTENSIONS entry (`aibom`, `agentReanalysis`, and
 * `scaAutofix` counted in `autofixPending`; all
 * from EeQueuesModule), so
 * the KEDA payload is unchanged in the cloud. A queue missing from this snapshot is a queue nothing can autoscale
 * on: the KEDA metrics-api scaler addresses `queues.<key>.pending`, and an
 * unknown path yields no metric at all rather than an error.
 */
export interface QueueBacklogResponse {
  queues: Record<string, QueueDepthStats>;
  aggregates: {
    /**
     * Sum of `pending` for all queues EXCEPT scaAutofix.
     * This is the primary metric KEDA uses to scale the main worker.
     */
    workerPending: number;
    /**
     * `pending` for the scaAutofix queue only.
     * KEDA uses this to scale the autofix worker.
     */
    autofixPending: number;
  };
}
