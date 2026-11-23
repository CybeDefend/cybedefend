/**
 * Queue names for different scan types.
 * Defined in a separate file to avoid circular dependencies.
 */
export const QUEUE_NAMES = {
  SCA: 'sca-scan-queue',
  SAST_IAC: 'sast-iac-scan-queue',
  CONTAINER: 'container-scan-queue',
  // SCA_AUTOFIX moved to the closed queues with the SCA autofix
  // feature.
  CVSS_RECALCULATION: 'cvss-recalculation-queue',
  // AGENT_REANALYSIS moved to the closed queues with the agent
  // re-analysis feature.
  CYBERISK_RECOMPUTE: 'cyberisk-recompute-queue',
  ORG_STATISTICS_RECOMPUTE: 'org-statistics-recompute-queue',
  REPORTS: 'reports-queue',
  AGGREGATED_REPORTS: 'aggregated-reports-queue',
  VULN_BATCH_UPDATE: 'vuln-batch-update-queue',
  // The delayed re-evaluation of a scan's end after one of
  // its scanners was given up (its finalization failed for good).
  SCAN_END_EVALUATION: 'scan-end-evaluation-queue',
  // SARIF imports, one job per import scan. No cloud scan
  // carries an import format, so this queue stays idle there.
  RESULTS_IMPORT: 'results-import',
} as const;
