/**
 * Serializable job payloads for the repo-scan queue. Everything here must be
 * JSON-serializable (BullMQ persists it in Redis), so we pass identifiers and
 * primitives — never TypeORM entities. The GitLab consumer re-fetches the
 * GitlabRepository (with its integration) by id.
 */

export interface GithubRepoScanJobData {
  provider: 'github';
  scanId: string;
  projectId: string;
  organizationId: string;
  branch: string;
  typeScan: string;
  owner: string;
  repo: string;
  commitSha: string;
  installationId: number;
}

export interface GitlabRepoScanJobData {
  provider: 'gitlab';
  scanId: string;
  projectId: string;
  organizationId: string;
  branch: string;
  typeScan: string;
  /** GitlabRepository primary key (uuid) — re-fetched in the worker. */
  repositoryId: string;
  commitSha: string;
}

export type RepoScanJobData = GithubRepoScanJobData | GitlabRepoScanJobData;
