import { isAgentContainer, isClosedStatus } from './scanPipeline';

export type ResultsStatus = 'pending' | 'processing' | 'ready';

const READY_STATES: ReadonlySet<string> = new Set([
  'completed',
  'completed_degraded',
  'failed',
  'cancelled',
]);

/**
 * Where a scan's results stand, for a client deciding when to read them.
 *
 * - `ready`: the scan ended, so its results are final (a legacy row that
 *   ended before results were tracked is ready too).
 * - `processing`: the scan runs and every scanner container is closed, so
 *   what is left is the ingestion of the results (the agent may still run).
 * - `pending`: a scanner is still working, or the scan has not started.
 */
export function resultsStatusOf(
  scan: { state: string },
  containers: { status?: string; image?: string; podName?: string }[],
): ResultsStatus {
  if (READY_STATES.has(scan.state)) return 'ready';
  if (scan.state !== 'running' || !containers?.length) return 'pending';
  const scannersClosed = containers
    .filter((container) => !isAgentContainer(container))
    .every((container) => isClosedStatus(container.status));
  return scannersClosed ? 'processing' : 'pending';
}
