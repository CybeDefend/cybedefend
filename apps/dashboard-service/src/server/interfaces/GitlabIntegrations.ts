/**
 * GitLab Integration Types
 * Contains all TypeScript interfaces for GitLab API communication
 */

export interface GitlabCallbackInstallDto {
  code: string;
  state: string;
}

export interface GitlabRepository {
  id: string;
  gitlabId: number;
  name: string;
  nameWithNamespace: string;
  path: string;
  pathWithNamespace: string;
  private: boolean;
  defaultBranch: string;
  scanBranch?: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitlabRepositoriesResponse {
  repositories: GitlabRepository[];
  organizationId: string;
}

export interface LinkGitlabRepositoryDto {
  repositoryId: string;
  /**
   * The space the repository is linked from (a product id). From another
   * space than AppSec the link builds the code graph only, with no AppSec
   * scan. Absent: AppSec, as before.
   */
  product?: string;
}

export interface StartScanGitlabBodyDto {
  /** Another space than AppSec: a graph-only analysis. Absent: AppSec. */
  product?: string;
  repositoryId: string;
  branch?: string;
}

export interface GitlabInstallationResponse {
  id: string;
  userId: string;
  organizationId: string;
  gitlabUserId: number;
  gitlabGroupId: number;
  createdAt: string;
  updatedAt: string;
}

export interface GitlabLinkRepositoryResponse {
  id: string;
  gitlabId: number;
  name: string;
  nameWithNamespace: string;
  path: string;
  pathWithNamespace: string;
  private: boolean;
  defaultBranch: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StartGitlabScanResponse {
  success: boolean;
  scanId: string;
  message: string;
  detectedLanguages: string[];
}
