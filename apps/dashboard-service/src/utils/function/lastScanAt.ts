import type { ScanInfo } from '@/server/interfaces/Scan';

/** Scan states after which the scan's analyses have been produced. */
const FINISHED_STATES = new Set(['completed', 'completed_degraded']);

/**
 * Creation date of the project's latest scan, as far as the given
 * finding family is concerned, or null when there is none to compare against.
 *
 * The detail drawer compares an agent verdict's `exploitabilityUpdatedAt`
 * with this date to say "this analysis dates from a previous scan". Only a
 * FINISHED scan that actually ran the family counts:
 *  - a running/queued scan is still producing its analysis, not making the
 *    current one stale;
 *  - `scanType` is the comma-separated list of families the scan ran
 *    (`sast,secret`, `container`, …): a container-only scan says nothing
 *    about a SAST verdict. A scan with no recorded type is taken as a full
 *    scan covering every family.
 */
export function resolveLastScanAt(
  scanInfo: Pick<ScanInfo, 'state' | 'createAt' | 'scanType'> | null | undefined,
  family: 'sast' | 'iac' | 'cicd',
): string | null {
  if (!scanInfo || !scanInfo.createAt) return null;
  if (!FINISHED_STATES.has(scanInfo.state)) return null;
  const families = (scanInfo.scanType ?? '')
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0);
  if (families.length > 0 && !families.includes(family)) return null;
  return scanInfo.createAt;
}

export default resolveLastScanAt;
