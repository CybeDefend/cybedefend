/**
 * What GithubService / GitlabService hand RepositoryHistoryService. These are
 * in-process shapes, not a wire contract (the wire contract is
 * libs/protos/external-integrations/repository_history.proto). They carry no
 * author or committer name or e-mail on purpose: the miner needs the message
 * and the change, not the person.
 */

/** Bound of every provider call made for the repository history (the caller's deadline is 20 s). */
export const HISTORY_PROVIDER_TIMEOUT_MS = 15_000;

export interface HistoryListOptions {
  /** empty: the provider's default branch */
  branch: string;
  /** empty: every commit */
  path: string;
  page: number;
  perPage: number;
}

export interface ProviderCommitSummary {
  sha: string;
  /** committer date, ISO 8601 */
  date: string;
  message: string;
}

export interface ProviderCommitFile {
  path: string;
  /** set on a rename only */
  oldPath: string;
  /** the provider's status, normalised by RepositoryHistoryService */
  status: string;
  additions: number;
  deletions: number;
  /** '' when the provider gives none (binary, too large) */
  patch: string;
}

export interface ProviderCommit extends ProviderCommitSummary {
  files: ProviderCommitFile[];
  /** the provider has files beyond those returned */
  moreFiles: boolean;
}
