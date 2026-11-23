/**
 * How the git history of a repository reaches the scanners that read it
 * (secret detection).
 */
export const GIT_HISTORY_MODE_PORT = 'GIT_HISTORY_MODE_PORT';

/**
 * `in_archive`: the history travels inside the source archive.
 * `incremental_artifact`: it is shipped as a separate, size-bounded artifact
 * and extended from one scan to the next.
 */
export type GitHistoryMode = 'in_archive' | 'incremental_artifact';

export interface GitHistoryModePort {
  /** Community: `in_archive`. */
  mode(): GitHistoryMode;
}
