/**
 * Whether a finding is raised for the scan: its catalogue severity must be one
 * of the severities the scan asked for (`ScanAddResultRequest.vulnerabilityType`,
 * a CSV such as `CRITICAL,HIGH,MEDIUM`). The full scan (`processVulnerability`)
 * and the diff scan (`DiffScanFindingService.ingestBatch`) both decide with it,
 * so a diff scan never reports a finding the full scan would not.
 *
 * @param severity - `vulnerability.severity` of the catalogue rule, never the
 *   scanner's own severity.
 * @param requestedSeverities - The scan's severities, case-insensitive.
 */
export function isCatalogSeverityRequested(
  severity: string | null | undefined,
  requestedSeverities: string | null | undefined,
): boolean {
  if (!severity) return false;
  return (requestedSeverities ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(severity.toLowerCase());
}
