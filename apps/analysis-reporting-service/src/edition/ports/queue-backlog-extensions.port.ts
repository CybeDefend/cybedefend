import type { Queue } from 'bullmq';

/**
 * Extension token: closed queues whose backlog the KEDA
 * metrics-api scaler still reads after the queue left ScanQueueService (the
 * keys queues.aibom, queues.agentReanalysis and queues.scaAutofix). Only an ee module supplies the list; when the token is
 * absent — the Community Edition — the 10 core queues are reported.
 */
export const QUEUE_BACKLOG_EXTENSIONS = 'QUEUE_BACKLOG_EXTENSIONS';

export interface QueueBacklogExtension {
  /** The key under `queues` in QueueBacklogResponse, e.g. 'aibom'. */
  key: string;
  queue: Pick<Queue, 'getJobCounts'>;
  /** The aggregate its `pending` is counted in. */
  aggregate: 'workerPending' | 'autofixPending';
}
