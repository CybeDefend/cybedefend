/**
 * BullMQ queue names for external-integrations background work.
 * Kept in a separate file to avoid circular dependencies.
 */
export const REPO_SCAN_QUEUE_NAMES = {
  /** Repo download → zip → upload → startScan for GitHub/GitLab scans. */
  REPO_SCAN: 'repo-scan-queue',
} as const;

/** BullMQ job name used for repo-scan jobs. */
export const REPO_SCAN_JOB_NAME = 'repo-scan';
