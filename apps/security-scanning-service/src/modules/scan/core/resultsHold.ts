import type { Scan } from '../../../entities/scan.entity';
import { isClosedStatus } from './scanPipeline';

/**
 * A scan whose containers are all closed is not over until analysis-reporting
 * has finalized the results its scanners sent. It ingests them
 * asynchronously, so a client reading the results as soon as the scan said
 * `completed` could get a part of them. Such a scan stays `running` until
 * analysis-reporting says its results are final.
 */

/** The states a scan computes when its scanners produced results. */
const RESULT_STATES: ReadonlySet<string> = new Set([
  'completed',
  'completed_degraded',
]);

/** Whether `state` is one a scan reaches when its scanners produced results. */
export function isResultState(state: string): boolean {
  return RESULT_STATES.has(state);
}

/**
 * The one NotifyScanEnded outcome saying analysis-reporting still finalizes
 * the scan's results. Every other outcome (`dispatched`,
 * `already_dispatched`, `deferred`, `diff_scan`, `nothing_finalized`, none)
 * means nothing is left to wait for.
 */
const RESULTS_NOT_FINAL_OUTCOME = 'waiting';

/** The reason a scan ends with when its results never became final. */
export const RESULTS_TIMED_OUT_ERROR_CATEGORY = 'results_processing';
export const RESULTS_TIMED_OUT_ERROR_MESSAGE =
  'Results processing did not finish in time; results may be incomplete';

export type FinalizeResultsOutcome =
  | 'finalized'
  | 'already_final'
  | 'containers_open'
  | 'not_running'
  | 'not_found';

/**
 * Whether a scan whose containers are all closed must stay `running` until its
 * results are final, rather than take `computedState` now.
 *
 * Only a scan with results waits: a failed scan has none, a graph-only scan
 * has no finding, an import scan ends through CompleteImportScan, which
 * analysis-reporting sends once its results are stored, and a scan whose
 * results are already final has nothing left to wait for.
 */
export function mustHoldForResults(
  scan: Pick<Scan, 'isGraphOnly' | 'importFormat' | 'resultsFinalizedAt'>,
  computedState: string,
): boolean {
  return (
    isResultState(computedState) &&
    // A TINYINT(1) may come back as 0/1: read by truthiness.
    !scan.isGraphOnly &&
    scan.importFormat == null &&
    scan.resultsFinalizedAt == null
  );
}

/** Whether a NotifyScanEnded outcome says the scan's results are final. */
export function isFinalOutcome(outcome: string | undefined): boolean {
  return outcome !== RESULTS_NOT_FINAL_OUTCOME;
}

/**
 * Whether a scan has containers and every one of them is closed. A scan with
 * none has not closed anything: its pods are still being launched.
 */
export function allContainersClosed(
  containers: readonly { status?: string | null }[] | null | undefined,
): boolean {
  return (
    (containers?.length ?? 0) > 0 &&
    containers.every((container) => isClosedStatus(container.status))
  );
}

/**
 * Whether a scan is held for its results right now: `running`, every
 * container closed, its results not final yet, and a scan that waits for
 * them (neither graph-only nor an import). Only a results signal or the
 * results sweeper ends it, never a pod watchdog.
 */
export function isHeldForResults(
  scan: Pick<
    Scan,
    'state' | 'isGraphOnly' | 'importFormat' | 'resultsFinalizedAt'
  > & { containers?: readonly { status?: string | null }[] | null },
): boolean {
  return (
    scan.state === 'running' &&
    scan.resultsFinalizedAt == null &&
    // A TINYINT(1) may come back as 0/1: read by truthiness.
    !scan.isGraphOnly &&
    scan.importFormat == null &&
    allContainersClosed(scan.containers)
  );
}
