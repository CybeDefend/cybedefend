/**
 * The error of a scanner's own finalization (`finalizeScan` and its kin), as
 * the finalize gate of a scan queue processor rethrows it. Only this one
 * gives the scanner up once the batch retries are spent: a
 * Redis read of the gate that fails says nothing about the finalization,
 * which may still run on another batch's gate.
 *
 * It keeps the message and the stack of the error it wraps, so the logs and
 * the failed job read as before.
 */
export class ScannerFinalizationError extends Error {
  readonly finalizationError: unknown;

  constructor(finalizationError: unknown) {
    super(
      finalizationError instanceof Error
        ? finalizationError.message
        : String(finalizationError),
    );
    this.name = 'ScannerFinalizationError';
    this.finalizationError = finalizationError;
    if (finalizationError instanceof Error && finalizationError.stack) {
      this.stack = finalizationError.stack;
    }
  }
}
