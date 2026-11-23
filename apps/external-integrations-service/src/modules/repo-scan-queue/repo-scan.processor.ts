import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { REPO_SCAN_QUEUE_NAMES } from './queue-names';
import { RepoScanJobData } from './repo-scan-job.types';
import { getRepoScanConcurrency } from './concurrency';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';

const STALLED_OUT_MESSAGE = 'stalled more than allowable limit';

/**
 * BullMQ processor for repo-scan jobs (runs only in the worker process).
 *
 * Dispatches to the GitHub/GitLab service which downloads the repo, rewrites
 * the archive (off the event loop in a worker thread), uploads it, and calls
 * startScan. On a worker death mid-job BullMQ re-queues the stalled job so
 * another worker resumes it. The terminal-failure handler marks the scan
 * failed so it never lingers in `waiting_for_file` until the 45-min watchdog.
 */
@Processor(REPO_SCAN_QUEUE_NAMES.REPO_SCAN, {
  concurrency: getRepoScanConcurrency(),
  // Download + git mirror clone + zip + upload can be slow for large repos.
  lockDuration: 600000, // 10 minutes
  lockRenewTime: 60000, // renew every minute
})
export class RepoScanProcessor extends WorkerHost {
  private readonly logger = new Logger(RepoScanProcessor.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly gitlabService: GitlabService,
  ) {
    super();
  }

  async process(job: Job<RepoScanJobData>): Promise<void> {
    const data = job.data;
    this.logger.log(
      `[RepoScan] Processing job ${job.id} provider=${data.provider} scan=${data.scanId}`,
    );

    if (data.provider === 'github') {
      await this.githubService.runRepoDownloadJob(data);
    } else {
      await this.gitlabService.runRepoDownloadJob(data);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<RepoScanJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    this.logger.error(
      `[RepoScan] Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`,
    );

    // BullMQ never retries a job it failed for stalling too often, whatever
    // attemptsMade says: waiting for a next attempt would leave the scan in
    // waiting_for_file until the watchdog.
    const stalledOut = error.message?.includes(STALLED_OUT_MESSAGE) === true;

    // Retries remain — let BullMQ re-run before we give up on the scan.
    if (!stalledOut && job.attemptsMade < maxAttempts) {
      return;
    }

    // Terminal failure (incl. repeated worker deaths / stalled retries): the
    // download/upload never completed, so the scan is still waiting_for_file.
    // Mark it failed now rather than waiting for the 45-min watchdog.
    const data = job.data;
    try {
      if (data.provider === 'github') {
        await this.githubService.markScanFailedFromJob(
          data.scanId,
          error.message,
        );
      } else {
        await this.gitlabService.markScanFailedFromJob(
          data.scanId,
          error.message,
        );
      }
    } catch (markError) {
      this.logger.error(
        `[RepoScan] Failed to mark scan ${data.scanId} as failed after terminal job failure: ${
          (markError as Error).message
        }`,
      );
    }
  }
}
