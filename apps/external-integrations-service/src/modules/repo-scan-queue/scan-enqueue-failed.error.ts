/**
 * The scan record was created (createScan, waiting_for_file) but its
 * repo-scan job could not be enqueued. Distinguished from a
 * failure before createScan because retrying the start would create one more
 * scan record on every attempt: a deferred rescan drops it instead.
 *
 * Not an RpcException: a push meeting it keeps the former answer (INTERNAL).
 */
export class ScanEnqueueFailedError extends Error {
  constructor(
    readonly scanId: string,
    readonly reason: unknown,
  ) {
    super(
      `Scan ${scanId} created but its repo-scan job was not enqueued: ${reason}`,
    );
    this.name = 'ScanEnqueueFailedError';
  }
}
