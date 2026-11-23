/**
 * Branch Types for GitHub and GitLab Integration
 * Contains all TypeScript interfaces for branch management
 */

/**
 * Represents a single branch from a repository
 */
export interface Branch {
  name: string;
  isDefault: boolean;
  isProtected: boolean;
  archived?: boolean;
}

/**
 * Response from GET /github/repositories/:repositoryId/branches
 */
export interface GetGithubBranchesResponse {
  branches: Branch[];
  defaultBranch: string;
  scanBranch: string;
}

/**
 * Response from GET /gitlab/repositories/:repositoryId/branches
 */
export interface GetGitlabBranchesResponse {
  branches: Branch[];
  defaultBranch: string;
  scanBranch: string;
}

/**
 * Response from GET /project/:projectId/branches
 * Used for projects not linked to GitHub/GitLab integrations.
 * Returns branches extracted from vulnerability detections.
 */
export interface GetProjectBranchesResponse {
  projectId: string;
  /** List of distinct branch names found in SAST, SCA, IAC detections */
  branches: string[];
}

/**
 * Generic branch response type for unified handling
 */
export type GetBranchesResponse = GetGithubBranchesResponse | GetGitlabBranchesResponse;
