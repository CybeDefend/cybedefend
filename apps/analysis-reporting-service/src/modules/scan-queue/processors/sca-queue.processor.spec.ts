import { ScaQueueProcessor } from './sca-queue.processor';
import { ScanQueueService } from '../scan-queue.service';
import { ScanCompleteNotificationService } from '../scan-complete-notification.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { RealtimeBatchPublisher } from '../../../core/realtime/realtime-batch-publisher.service';

/**
 * In-memory state for the finalization gate. Lets the processor spec drive the
 * gate end-to-end (expected vs completed vs lock) without a real Redis, so the
 * out-of-order / exactly-once / retry / failure-safety semantics are exercised.
 */
function createGateState() {
  const expected = new Map<string, number>();
  const completed = new Map<string, Set<number>>();
  const locks = new Set<string>();
  const key = (scanId: string, scanner: string) => `${scanId}:${scanner}`;

  return {
    setExpectedBatches: jest.fn(
      async (_t: string, scanId: string, scanner: string, total: number) => {
        expected.set(key(scanId, scanner), total);
      },
    ),
    getExpectedBatches: jest.fn(
      async (_t: string, scanId: string, scanner: string) =>
        expected.has(key(scanId, scanner))
          ? expected.get(key(scanId, scanner))!
          : null,
    ),
    markBatchCompleted: jest.fn(
      async (_t: string, scanId: string, scanner: string, idx: number) => {
        const k = key(scanId, scanner);
        if (!completed.has(k)) completed.set(k, new Set());
        completed.get(k)!.add(idx);
        return completed.get(k)!.size;
      },
    ),
    getCompletedCount: jest.fn(
      async (_t: string, scanId: string, scanner: string) =>
        completed.get(key(scanId, scanner))?.size ?? 0,
    ),
    tryAcquireFinalizeLock: jest.fn(
      async (_t: string, scanId: string, scanner: string) => {
        const k = key(scanId, scanner);
        if (locks.has(k)) return false;
        locks.add(k);
        return true;
      },
    ),
    releaseFinalizeLock: jest.fn(
      async (_t: string, scanId: string, scanner: string) => {
        locks.delete(key(scanId, scanner));
      },
    ),
    clearBatchTracking: jest.fn(
      async (_t: string, scanId: string, scanner: string) => {
        const k = key(scanId, scanner);
        expected.delete(k);
        completed.delete(k);
        locks.delete(k);
      },
    ),
    incrementBatchProgress: jest.fn().mockResolvedValue(1),
  };
}

const makeJob = (
  overrides: Partial<{
    id: string;
    scanId: string;
    projectId: string;
    scannerName: string;
    batchIndex: number;
    isLast: boolean;
    attemptsMade: number;
    attempts: number;
  }> = {},
) => {
  const {
    id = 'job-1',
    scanId = 's1',
    projectId = 'p1',
    scannerName = 'scanlink-sca',
    batchIndex = 0,
    isLast = false,
    attemptsMade = 1,
    attempts = 3,
  } = overrides;
  return {
    id,
    attemptsMade,
    opts: { attempts },
    data: {
      scanId,
      projectId,
      scannerName,
      batchIndex,
      isLast,
      request: { isLastRequest: isLast, scanId, projectId, scannerName },
    },
  } as any;
};

describe('ScaQueueProcessor', () => {
  let processor: ScaQueueProcessor;
  let scaService: { processScaBatch: jest.Mock; finalizeScan: jest.Mock };
  let scanQueueService: ReturnType<typeof createGateState>;
  let scanCompleteNotificationService: {
    onScannerFinalized: jest.Mock;
    onScannerAbandoned: jest.Mock;
  };
  let realtime: { publish: jest.Mock };
  let realtimeBatch: { publishDebounced: jest.Mock; publishNow: jest.Mock };

  beforeEach(() => {
    scaService = {
      processScaBatch: jest.fn().mockResolvedValue(undefined),
      finalizeScan: jest.fn().mockResolvedValue(undefined),
    };
    scanQueueService = createGateState();
    scanCompleteNotificationService = {
      onScannerFinalized: jest.fn().mockResolvedValue(undefined),
      onScannerAbandoned: jest.fn().mockResolvedValue(undefined),
    };
    realtime = { publish: jest.fn().mockResolvedValue(undefined) };
    realtimeBatch = { publishDebounced: jest.fn(), publishNow: jest.fn() };

    processor = new ScaQueueProcessor(
      scaService as any,
      scanQueueService as unknown as ScanQueueService,
      scanCompleteNotificationService as unknown as ScanCompleteNotificationService,
      realtime as unknown as RealtimeEventPublisher,
      realtimeBatch as unknown as RealtimeBatchPublisher,
    );
  });

  it('routes VULNERABILITY_BATCH_APPENDED through the debounced publisher (per project/scan/scanner)', async () => {
    await processor.process(makeJob());

    expect(realtimeBatch.publishDebounced).toHaveBeenCalledWith(
      'vuln:p1:s1:sca',
      expect.objectContaining({
        type: 'VULNERABILITY_BATCH_APPENDED',
        scope: expect.objectContaining({ projectId: 'p1' }),
        payload: expect.objectContaining({
          vulnerabilityBatchAppended: expect.objectContaining({
            scanId: 's1',
            scannerType: 'sca',
          }),
        }),
      }),
    );
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it('does not publish when processing fails', async () => {
    scaService.processScaBatch.mockRejectedValue(new Error('DB error'));

    await expect(processor.process(makeJob({ id: 'job-2' }))).rejects.toThrow(
      'DB error',
    );
    expect(realtimeBatch.publishDebounced).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it('NEVER finalizes inline: processScaBatch is always called with isLastRequest=false', async () => {
    await processor.process(makeJob({ batchIndex: 2, isLast: true }));

    expect(scaService.processScaBatch).toHaveBeenCalledWith(
      expect.objectContaining({ isLastRequest: false }),
    );
  });

  it('out-of-order: isLast batch completing before earlier batches does NOT finalize early', async () => {
    // expected=3 set when isLast was enqueued.
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 3);

    // isLast (batchIndex 2) completes FIRST.
    await processor.process(makeJob({ batchIndex: 2, isLast: true }));
    expect(scaService.finalizeScan).not.toHaveBeenCalled();

    // Then batch 0.
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    expect(scaService.finalizeScan).not.toHaveBeenCalled();

    // Finally batch 1 → all 3 done → finalize exactly now.
    await processor.process(makeJob({ batchIndex: 1, isLast: false }));
    expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);
    expect(scaService.finalizeScan).toHaveBeenCalledWith('p1', 's1');
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).toHaveBeenCalledTimes(1);
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).toHaveBeenCalledWith('s1', 'p1', 'sca', 'scanlink-sca');
    expect(scanQueueService.clearBatchTracking).toHaveBeenCalledWith(
      'sca',
      's1',
      'scanlink-sca',
    );
  });

  it('exactly-once: a stray completion after finalization does not re-finalize (lock)', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);

    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    await processor.process(makeJob({ batchIndex: 1, isLast: true }));
    expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);

    // A duplicate/stray completion of an already-counted batch.
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).toHaveBeenCalledTimes(1);
  });

  it('retry idempotency: same batchIndex twice does not inflate count nor finalize early', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);

    // Batch 0 processed twice (retry).
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    expect(scaService.finalizeScan).not.toHaveBeenCalled();
    expect(
      await scanQueueService.getCompletedCount('sca', 's1', 'scanlink-sca'),
    ).toBe(1);

    // Now the actual last batch.
    await processor.process(makeJob({ batchIndex: 1, isLast: true }));
    expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);
  });

  it('expected-not-yet-set: batches before isLast enqueue do NOT finalize; finalize once expected set + reached', async () => {
    // No expected set yet (isLast not enqueued).
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    await processor.process(makeJob({ batchIndex: 1, isLast: false }));
    expect(scaService.finalizeScan).not.toHaveBeenCalled();

    // isLast enqueued late → expected becomes 3, and the isLast batch completes.
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 3);
    await processor.process(makeJob({ batchIndex: 2, isLast: true }));

    expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);
  });

  it('permanent failure safety net: a terminally failed batch still allows finalization', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);

    // Batch 0 succeeds.
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    expect(scaService.finalizeScan).not.toHaveBeenCalled();

    // Batch 1 (the isLast) fails terminally (attemptsMade >= attempts).
    await processor.onFailed(
      makeJob({ batchIndex: 1, isLast: true, attemptsMade: 3, attempts: 3 }),
      new Error('permanent DB failure'),
    );

    // Finalization proceeds despite the failed batch.
    expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).toHaveBeenCalledTimes(1);
  });

  // a finalization that fails in the onFailed gate,
  // the batch retries spent, never comes back, and security-scanning tells
  // the end of the scan once: the end must stop waiting for this scanner.
  it('gives the scanner up to the scan end when its finalization fails for good', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 1);
    scaService.finalizeScan.mockRejectedValue(new Error('DB finalize boom'));

    await processor.onFailed(
      makeJob({ batchIndex: 0, isLast: true, attemptsMade: 3, attempts: 3 }),
      new Error('DB finalize boom'),
    );

    expect(
      scanCompleteNotificationService.onScannerAbandoned,
    ).toHaveBeenCalledWith('s1', 'p1', 'sca', 'scanlink-sca');
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).not.toHaveBeenCalled();
  });

  // A lock release that fails must not replace the
  // finalization's own error: the scanner is still given up.
  it('gives the scanner up even when releasing the finalize lock fails', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 1);
    scaService.finalizeScan.mockRejectedValue(new Error('DB finalize boom'));
    scanQueueService.releaseFinalizeLock.mockRejectedValue(
      new Error('ECONNRESET'),
    );

    await processor.onFailed(
      makeJob({ batchIndex: 0, isLast: true, attemptsMade: 3, attempts: 3 }),
      new Error('DB finalize boom'),
    );

    expect(
      scanCompleteNotificationService.onScannerAbandoned,
    ).toHaveBeenCalledWith('s1', 'p1', 'sca', 'scanlink-sca');
  });

  // Only an error of the finalization itself gives the
  // scanner up; a Redis read of the gate that fails says nothing about it.
  it('does not give the scanner up when the gate cannot read its tracking', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 1);
    scanQueueService.getExpectedBatches.mockRejectedValueOnce(
      new Error('ECONNRESET'),
    );

    await processor.onFailed(
      makeJob({ batchIndex: 0, isLast: true, attemptsMade: 3, attempts: 3 }),
      new Error('permanent DB failure'),
    );

    expect(
      scanCompleteNotificationService.onScannerAbandoned,
    ).not.toHaveBeenCalled();
  });

  // Retries left, the finalization may still succeed.
  it('never gives the scanner up while the batch has retries left', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 1);
    scaService.finalizeScan.mockRejectedValue(new Error('DB finalize boom'));

    await processor.onFailed(
      makeJob({ batchIndex: 0, isLast: true, attemptsMade: 1, attempts: 3 }),
      new Error('DB finalize boom'),
    );

    expect(scaService.finalizeScan).not.toHaveBeenCalled();
    expect(
      scanCompleteNotificationService.onScannerAbandoned,
    ).not.toHaveBeenCalled();
  });

  it('non-terminal failure (retry pending) does NOT count the batch nor finalize', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));

    // Batch 1 fails but has retries left.
    await processor.onFailed(
      makeJob({ batchIndex: 1, isLast: true, attemptsMade: 1, attempts: 3 }),
      new Error('transient'),
    );

    expect(scanQueueService.markBatchCompleted).toHaveBeenCalledTimes(1); // only batch 0
    expect(scaService.finalizeScan).not.toHaveBeenCalled();
  });

  it('onCompleted no longer finalizes (gate owns finalization)', async () => {
    await processor.onCompleted(makeJob({ batchIndex: 2, isLast: true }));
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).not.toHaveBeenCalled();
  });

  it('releases the finalize lock when finalizeScan throws so a retry can re-acquire and finalize exactly once', async () => {
    await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);

    // First non-last batch completes normally.
    await processor.process(makeJob({ batchIndex: 0, isLast: false }));
    expect(scaService.finalizeScan).not.toHaveBeenCalled();

    // The completion that reaches the gate throws inside finalizeScan: the
    // lock is acquired, finalization fails, the whole job must fail (re-throw)
    // so BullMQ retries it — and the lock must NOT stay held.
    scaService.finalizeScan.mockRejectedValueOnce(
      new Error('DB finalize boom'),
    );
    await expect(
      processor.process(makeJob({ batchIndex: 1, isLast: true })),
    ).rejects.toThrow('DB finalize boom');

    // The lock was released on failure → it is re-acquirable.
    expect(scanQueueService.releaseFinalizeLock).toHaveBeenCalledTimes(1);
    expect(
      await scanQueueService.tryAcquireFinalizeLock(
        'sca',
        's1',
        'scanlink-sca',
      ),
    ).toBe(true);
    // Free the lock again so the retry below can actually re-acquire it.
    await scanQueueService.releaseFinalizeLock('sca', 's1', 'scanlink-sca');

    // BullMQ retries the isLast batch — this time finalizeScan succeeds.
    await processor.process(makeJob({ batchIndex: 1, isLast: true }));

    // finalizeScan was retried and ultimately succeeded; the scanner-finalized
    // notification fires exactly once across the whole sequence.
    expect(scaService.finalizeScan).toHaveBeenCalledTimes(2);
    expect(
      scanCompleteNotificationService.onScannerFinalized,
    ).toHaveBeenCalledTimes(1);
    expect(scanQueueService.clearBatchTracking).toHaveBeenCalledTimes(1);
  });
  describe('post-finalization realtime event', () => {
    // The last throttled VULNERABILITY_BATCH_APPENDED fires ~1.5s after the
    // last batch, i.e. DURING finalization; SCAN_STATUS_CHANGED "completed"
    // comes from security-scanning when the pods exit, BEFORE ingestion is
    // even done. Without a trailing event the dashboard's final refetch shows
    // pre-finalization data until a manual reload.
    it('publishes an immediate VULNERABILITY_BATCH_APPENDED once finalization succeeds', async () => {
      await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 2);

      await processor.process(makeJob({ batchIndex: 0, isLast: false }));
      expect(realtimeBatch.publishNow).not.toHaveBeenCalled();

      await processor.process(makeJob({ batchIndex: 1, isLast: true }));
      expect(scaService.finalizeScan).toHaveBeenCalledTimes(1);
      expect(realtimeBatch.publishNow).toHaveBeenCalledTimes(1);
      expect(realtimeBatch.publishNow).toHaveBeenCalledWith(
        'vuln:p1:s1:sca',
        expect.objectContaining({
          type: 'VULNERABILITY_BATCH_APPENDED',
          scope: expect.objectContaining({ projectId: 'p1' }),
          payload: expect.objectContaining({
            vulnerabilityBatchAppended: expect.objectContaining({
              scanId: 's1',
              scannerType: 'sca',
            }),
          }),
        }),
      );
      // It must fire AFTER finalization, never before — that is the whole point.
      expect(
        realtimeBatch.publishNow.mock.invocationCallOrder[0],
      ).toBeGreaterThan(scaService.finalizeScan.mock.invocationCallOrder[0]);
    });

    it('does NOT publish the post-finalization event when finalization throws', async () => {
      await scanQueueService.setExpectedBatches('sca', 's1', 'scanlink-sca', 1);
      scaService.finalizeScan.mockRejectedValueOnce(new Error('finalize boom'));

      await expect(
        processor.process(makeJob({ batchIndex: 0, isLast: true })),
      ).rejects.toThrow('finalize boom');

      expect(realtimeBatch.publishNow).not.toHaveBeenCalled();
    });
  });
});
