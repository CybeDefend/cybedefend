import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { ulid } from 'ulid';
import { QUEUE_NAMES } from '../queue-names';
import { ScaJobData, ScanQueueService } from '../scan-queue.service';
import { ScanCompleteNotificationService } from '../scan-complete-notification.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { RealtimeBatchPublisher } from '../../../core/realtime/realtime-batch-publisher.service';
import { getQueueConcurrency } from '../concurrency.config';
import { ScannerFinalizationError } from './scanner-finalization.error';

// Forward reference type to avoid circular dependency
type ScaServiceType = {
  processScaBatch: (request: any) => Promise<any>;
  finalizeScan: (projectId: string, scanId: string) => Promise<void>;
};

/**
 * BullMQ Processor for SCA scan result jobs.
 *
 * Key features:
 * - Processes SCA batches asynchronously without blocking the event loop
 * - Finalization is order-independent and multi-consumer safe: it runs via a
 *   Redis-backed gate (expected vs distinct-completed + a SET NX lock), NOT
 *   inline in the batch handler. The queue path always calls processScaBatch
 *   with isLastRequest=false so a single batch can never finalize on its own.
 * - The gate guarantees finalization fires exactly once per (scanId, scanner),
 *   only after ALL batches have completed, regardless of completion order or
 *   the number of worker pods / per-pod concurrency.
 */
@Processor(QUEUE_NAMES.SCA, {
  concurrency: getQueueConcurrency('SCA'),
  lockDuration: 300000, // 5 minutes - long enough for large batches
  lockRenewTime: 60000, // Renew lock every minute
})
export class ScaQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ScaQueueProcessor.name);

  constructor(
    @Inject('SCA_SERVICE')
    private readonly scaService: ScaServiceType,
    private readonly scanQueueService: ScanQueueService,
    private readonly scanCompleteNotificationService: ScanCompleteNotificationService,
    private readonly realtime: RealtimeEventPublisher,
    private readonly realtimeBatch: RealtimeBatchPublisher,
  ) {
    super();
  }

  /**
   * Process a SCA scan result job.
   *
   * The flow:
   * 1. Process the packages and find vulnerabilities (NEVER inline finalize —
   *    isLastRequest is forced to false; the gate owns finalization).
   * 2. Publish the debounced realtime batch-appended event.
   * 3. Mark this batch index as completed (idempotent on retry).
   * 4. Run the finalize gate: finalize exactly once when ALL batches done.
   */
  async process(job: Job<ScaJobData>): Promise<void> {
    const { request, isLast, batchIndex, scanId, projectId, scannerName } =
      job.data;

    this.logger.log(
      `[SCA Processor] Starting job ${job.id} for scan=${scanId}, scanner=${scannerName}, batch=${batchIndex}, isLast=${isLast}`,
    );

    const startTime = Date.now();

    try {
      // The queue path must NEVER finalize inline: with multiple consumers a
      // batch can complete out of order, so finalization is owned by the gate
      // (maybeFinalize) below. Always pass isLastRequest=false here.
      const modifiedRequest = {
        ...request,
        isLastRequest: false,
      };

      await this.scaService.processScaBatch(modifiedRequest);

      // Debounced per (project, scan, scanner) — see RealtimeBatchPublisher.
      this.realtimeBatch.publishDebounced(
        `vuln:${projectId}:${scanId}:sca`,
        this.batchAppendedEnvelope(scanId, projectId),
      );

      // Mark this batch as completed (idempotent on retry via SADD).
      const distinct = await this.scanQueueService.markBatchCompleted(
        'sca',
        scanId,
        scannerName,
        batchIndex,
      );

      this.logger.log(
        `[SCA Processor] Batch ${batchIndex} completed for scan=${scanId}, scanner=${scannerName}. Distinct completed batches: ${distinct}`,
      );

      // Order-independent, multi-consumer-safe finalization gate.
      await this.maybeFinalize(scanId, scannerName, projectId);

      const duration = Date.now() - startTime;
      this.logger.log(
        `[SCA Processor] Job ${job.id} completed in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `[SCA Processor] Error processing job ${job.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error; // Re-throw to trigger retry
    }
  }

  /**
   * Finalize gate: runs finalization exactly once per (scanId, scanner), only
   * when ALL expected batches have completed. Safe to call from any consumer
   * and from the terminal-failure path — guarded by a SET NX lock.
   */
  private async maybeFinalize(
    scanId: string,
    scannerName: string,
    projectId: string,
  ): Promise<void> {
    const expected = await this.scanQueueService.getExpectedBatches(
      'sca',
      scanId,
      scannerName,
    );
    // isLast job not enqueued yet → don't know how many batches to wait for.
    if (expected == null) return;

    const completed = await this.scanQueueService.getCompletedCount(
      'sca',
      scanId,
      scannerName,
    );
    if (completed < expected) return;

    // Single winner runs finalization; everyone else short-circuits.
    if (
      !(await this.scanQueueService.tryAcquireFinalizeLock(
        'sca',
        scanId,
        scannerName,
      ))
    ) {
      return;
    }

    this.logger.log(
      `[SCA Processor] All ${expected} batches complete for scan=${scanId}, scanner=${scannerName}. Finalizing.`,
    );

    // Lock is held: if any post-lock step throws, release the lock before
    // re-throwing so the job's normal retry path can re-acquire and finalize.
    // Otherwise the 24h-TTL lock would stay held and the scanner would never
    // be finalized (every retry would short-circuit at tryAcquireFinalizeLock).
    // On success, clearBatchTracking deletes the finalize-lock key as well.
    try {
      try {
        await this.scaService.finalizeScan(projectId, scanId);
      } catch (error) {
        throw new ScannerFinalizationError(error);
      }
      // The data is final only now. Publish immediately (bypassing
      // the throttle window) so the dashboard's last refetch lands AFTER
      // finalization instead of in the middle of it.
      this.realtimeBatch.publishNow(
        `vuln:${projectId}:${scanId}:sca`,
        this.batchAppendedEnvelope(scanId, projectId),
      );
      await this.scanCompleteNotificationService.onScannerFinalized(
        scanId,
        projectId,
        'sca',
        scannerName,
      );
      await this.scanQueueService.clearBatchTracking(
        'sca',
        scanId,
        scannerName,
      );
    } catch (error) {
      // A release that fails must not replace the finalization's own error
      // : onFailed gives the scanner up on that error only, and
      // the give-up's clear removes the lock left behind. From process(),
      // attempts left, a lock left behind makes the retry stop at
      // tryAcquireFinalizeLock, without finalizing and without a give-up, as
      // before L27b; the lock expires after 24 h.
      try {
        await this.scanQueueService.releaseFinalizeLock(
          'sca',
          scanId,
          scannerName,
        );
      } catch (releaseError) {
        this.logger.error(
          `[SCA Processor] Could not release the finalize lock for scan=${scanId}, scanner=${scannerName}: ${(releaseError as Error).message}`,
        );
      }
      this.logger.error(
        `[SCA Processor] Finalization failed for scan=${scanId}, scanner=${scannerName}; released finalize lock for retry: ${(error as Error).message}`,
      );
      throw error;
    }

    this.logger.log(
      `[SCA Processor] Finalization complete and tracking cleared for scan=${scanId}, scanner=${scannerName}.`,
    );
  }

  /** VULNERABILITY_BATCH_APPENDED envelope for this scanner type (ids-only, the
   * dashboard refetches). Shared by the per-batch throttled publish and the
   * immediate post-finalization publish. */
  private batchAppendedEnvelope(scanId: string, projectId: string) {
    return {
      eventId: ulid(),
      type: 'VULNERABILITY_BATCH_APPENDED',
      scope: { projectId },
      payload: {
        vulnerabilityBatchAppended: {
          scanId,
          scannerType: 'sca',
          addedCount: 0,
          sampleVulnerabilityIds: [],
        },
      },
    };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ScaJobData>) {
    // Finalization (and its scanner-finalized notification) is owned by the
    // finalize gate in process()/maybeFinalize — it fires when the scanner is
    // actually finalized, not when the isLast job happens to complete.
    this.logger.debug(`[SCA Processor] Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ScaJobData>, error: Error) {
    this.logger.error(
      `[SCA Processor] Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    // Safety net: a batch that exhausts its retries would otherwise leave
    // completed < expected forever, blocking finalization for the whole
    // scanner. On terminal failure, count the batch (accepting partial data —
    // the pre-existing behavior on failure) and run the same gate so the
    // scanner can still finalize.
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      // Retries remain — do not count this batch yet.
      return;
    }

    const { scanId, scannerName, projectId, batchIndex } = job.data;
    this.logger.warn(
      `[SCA Processor] Batch ${batchIndex} for scan=${scanId}, scanner=${scannerName} failed permanently after ${job.attemptsMade} attempts. Counting it so finalization can still proceed (partial data).`,
    );

    try {
      await this.scanQueueService.markBatchCompleted(
        'sca',
        scanId,
        scannerName,
        batchIndex,
      );
      await this.maybeFinalize(scanId, scannerName, projectId);
    } catch (gateError) {
      this.logger.error(
        `[SCA Processor] Failed to run finalize gate after terminal batch failure for scan=${scanId}, scanner=${scannerName}: ${(gateError as Error).message}`,
      );
      // The retries are spent and the finalization itself failed: nothing
      // will finalize this scanner any more. Give it up, or the end of the
      // scan waits for it for good. Never throws. A gate that
      // could not read its tracking says nothing about the finalization.
      if (gateError instanceof ScannerFinalizationError) {
        await this.scanCompleteNotificationService.onScannerAbandoned(
          scanId,
          projectId,
          'sca',
          scannerName,
        );
      }
    }
  }
}
