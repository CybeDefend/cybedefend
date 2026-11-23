import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REPO_SCAN_JOB_NAME, REPO_SCAN_QUEUE_NAMES } from './queue-names';
import { RepoScanJobData } from './repo-scan-job.types';
import { QueueBacklogResponse, QueueDepthStats } from './queue-metrics.types';

function toStats(counts: Record<string, number>): QueueDepthStats {
  const waiting = counts['wait'] ?? 0;
  const prioritized = counts['prioritized'] ?? 0;
  const delayed = counts['delayed'] ?? 0;
  const active = counts['active'] ?? 0;
  const pending = waiting + prioritized + delayed;
  return {
    waiting,
    prioritized,
    delayed,
    active,
    pending,
    backlog: pending + active,
  };
}

/**
 * Producer + metrics surface for the repo-scan queue.
 *
 * Enqueued by the gRPC path (github/gitlab scan triggers); consumed by the
 * dedicated worker process. Durability: if a worker dies mid-job, BullMQ
 * re-queues the stalled job so another worker resumes it — the scan is no
 * longer orphaned in `waiting_for_file`.
 */
@Injectable()
export class RepoScanQueueService {
  private readonly logger = new Logger(RepoScanQueueService.name);

  constructor(
    @InjectQueue(REPO_SCAN_QUEUE_NAMES.REPO_SCAN)
    private readonly repoScanQueue: Queue<RepoScanJobData>,
  ) {}

  /**
   * Enqueue a repo download/zip/upload/startScan job. Uses jobId=scanId so a
   * retried trigger for the same scan is de-duplicated by BullMQ.
   */
  async enqueueRepoScan(data: RepoScanJobData): Promise<void> {
    await this.repoScanQueue.add(REPO_SCAN_JOB_NAME, data, {
      jobId: data.scanId,
    });
    this.logger.log(
      `Enqueued repo-scan job for scan ${data.scanId} (provider=${data.provider})`,
    );
  }

  /** Per-queue depth snapshot for KEDA's metrics-api scaler. */
  async getQueueBacklog(): Promise<QueueBacklogResponse> {
    const counts = await this.repoScanQueue.getJobCounts(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
    const repoScan = toStats(counts);
    return {
      queues: { repoScan },
      totals: {
        pending: repoScan.pending,
        active: repoScan.active,
        backlog: repoScan.backlog,
      },
    };
  }
}
