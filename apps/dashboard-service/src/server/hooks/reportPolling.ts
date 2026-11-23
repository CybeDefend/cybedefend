// Fallback polling for async report generation.
//
// The fast path is the realtime REPORT_READY event, but that event can be lost
// (publisher token-bucket drop — not even persisted to the Redis stream, so
// Last-Event-ID cannot recover it — or a race before the SSE connection is
// established). This poller guarantees convergence by re-checking the
// authorized `GET /project/:id/reports/:reportId` endpoint until the report
// settles or a timeout elapses.

export interface PollableReport {
  status: string;
}

const TERMINAL_STATUSES = new Set(["ready", "failed"]);

export interface PollOptions {
  /** Delay between polls while the report is still queued. */
  intervalMs: number;
  /** Hard cap after which polling gives up and rejects. */
  timeoutMs: number;
  /**
   * Grace period awaited BEFORE the first poll. The realtime *_REPORT_READY
   * event is the primary path; we wait this long before engaging the poll so
   * that, in the normal case, the event resolves the report first and the
   * caller's `fetchReport` short-circuits (its "claimed elsewhere" sentinel)
   * WITHOUT ever hitting the network — no `queued` request is made. The poll
   * is thus a true safety net (dropped event, race, unusually slow render),
   * not an eager parallel poller. Defaults to 0 (poll immediately).
   */
  startDelayMs?: number;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
  /** Injectable sleep (tests). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls `fetchReport` until it returns a terminal status (`ready`/`failed`) or
 * the timeout elapses. Transient fetch errors (e.g. a 404 before the row is
 * persisted) are treated as retryable; the last error is rethrown only if the
 * timeout is reached without ever settling.
 */
export async function pollReportUntilSettled<T extends PollableReport>(
  fetchReport: () => Promise<T>,
  opts: PollOptions,
): Promise<T> {
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Measured from enqueue (includes the grace) so the overall budget stays
  // bounded regardless of the startDelay.
  const deadline = now() + opts.timeoutMs;

  // Safety-net grace: let the realtime event win the normal case before the
  // poll engages (see PollOptions.startDelayMs).
  if (opts.startDelayMs && opts.startDelayMs > 0) {
    await sleep(opts.startDelayMs);
  }

  let lastError: unknown;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const report = await fetchReport();
      if (TERMINAL_STATUSES.has(report.status)) {
        return report;
      }
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }

    if (now() >= deadline) {
      if (lastError !== undefined) {
        throw lastError;
      }
      throw new Error("Report polling timed out");
    }
    await sleep(opts.intervalMs);
  }
}
