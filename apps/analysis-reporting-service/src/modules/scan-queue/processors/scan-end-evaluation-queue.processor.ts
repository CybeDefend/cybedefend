import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Span } from 'nestjs-otel';
import { QUEUE_NAMES } from '../queue-names';
import { getQueueConcurrency } from '../concurrency.config';
import {
  ScanCompleteNotificationService,
  ScanEndEvaluationJobData,
  ScanEndOutcome,
} from '../scan-complete-notification.service';

/**
 * The delayed re-evaluation of a scan's end after one of its scanners was
 * given up: its finalization failed for good, and the first
 * attempt at giving it up failed too (an outage, mostly MySQL). The job
 * fails, and BullMQ retries it with its backoff, as long as the end cannot
 * be evaluated; any outcome ends it (a dispatch, or one already done, or a
 * wait for another scanner, whose finalization dispatches).
 */
@Processor(QUEUE_NAMES.SCAN_END_EVALUATION, {
  concurrency: getQueueConcurrency('SCAN_END_EVALUATION'),
  lockDuration: 120000, // 2 min: the dispatch (mail, Slack, issues) included
})
export class ScanEndEvaluationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanEndEvaluationQueueProcessor.name);

  constructor(
    private readonly scanCompleteNotificationService: ScanCompleteNotificationService,
  ) {
    super();
  }

  @Span()
  async process(job: Job<ScanEndEvaluationJobData>): Promise<ScanEndOutcome> {
    return this.scanCompleteNotificationService.giveUpScanner(job.data);
  }

  /**
   * A failure BullMQ will not replay is an error: its attempts are spent, or
   * it stalled past maxStalledCount, which moves it to "failed" with attempts
   * left. Otherwise a warning: the next attempt is scheduled.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ScanEndEvaluationJobData>, error: Error) {
    const attempts = job.opts?.attempts ?? 1;
    const state = await job.getState().catch(() => 'unknown');
    const last = job.attemptsMade >= attempts || state === 'failed';
    const line = `[ScanEndEvaluation] Job ${job.id} for scan=${job.data.scanId}, scanner=${job.data.scannerName} failed (attempt ${job.attemptsMade}/${attempts}): ${error.message}`;
    if (last) {
      this.logger.error(
        `${line}. Giving up: the end of this scan is not dispatched.`,
      );
    } else {
      this.logger.warn(line);
    }
  }
}
