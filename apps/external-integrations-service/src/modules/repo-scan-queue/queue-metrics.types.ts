/**
 * Shape of the GET /internal/queue-metrics payload consumed by KEDA's
 * metrics-api scaler. Integers only — no tenant data (no project/org/scan IDs).
 *
 * KEDA targets `queues.repoScan.pending` (waiting + prioritized + delayed),
 * i.e. work not yet being processed, which is the correct backlog signal for
 * scale-up decisions.
 */
export interface QueueDepthStats {
  waiting: number;
  prioritized: number;
  delayed: number;
  active: number;
  /** waiting + prioritized + delayed — what KEDA scales on. */
  pending: number;
  /** pending + active. */
  backlog: number;
}

export interface QueueBacklogResponse {
  queues: {
    repoScan: QueueDepthStats;
  };
  totals: {
    pending: number;
    active: number;
    backlog: number;
  };
}
