import { LinkRepositoryDto } from "@/server/interfaces/Integrations";
import gatewayAPI from "../../api/gatewayAPI";
import {
  GitlabRepositoriesResponse,
  GitlabCallbackInstallDto,
  LinkGitlabRepositoryDto,
  StartScanGitlabBodyDto,
  GitlabInstallationResponse,
  GitlabLinkRepositoryResponse,
  StartGitlabScanResponse,
} from "../../interfaces/GitlabIntegrations";
import { GetGitlabBranchesResponse } from "../../interfaces/Branch";
import type { Product } from "@/utils/product";

/**
 * Fetch branches for a GitLab repository
 * @param organizationId - The organization ID
 * @param repositoryId - The internal repository ID
 * @returns List of branches with default and scan branch info
 */
export const getGitlabRepositoryBranches = async (
  organizationId: string,
  repositoryId: string
): Promise<GetGitlabBranchesResponse> => {
  try {
    const response = await gatewayAPI.get<GetGitlabBranchesResponse>(
      `/integrations/gitlab/organization/${organizationId}/repositories/${repositoryId}/branches`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Generate GitLab OAuth installation URL
 */
export const generateGitlabInstallUrl = async (
  organizationId: string
): Promise<{ installUrl: string }> => {
  try {
    const response = await gatewayAPI.post<{ installUrl: string }>(
      `/integrations/gitlab/install/${organizationId}`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Get GitLab installation details for organization
 */
export const getGitlabInstallation = async (
  organizationId: string
): Promise<GitlabInstallationResponse> => {
  try {
    const response = await gatewayAPI.get<GitlabInstallationResponse>(
      `/integrations/gitlab/organization/${organizationId}/installation`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Handle GitLab OAuth callback installation
 */
export const installGitlabIntegration = async (
  organizationId: string,
  payload: GitlabCallbackInstallDto
): Promise<{ returnUri: string }> => {
  try {
    const response = await gatewayAPI.post<{ returnUri: string }>(
      `/integrations/gitlab/organization/${organizationId}/install/callback`,
      payload
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Get GitLab repositories for organization
 */
export const getGitlabRepositories = async (
  organizationId: string
): Promise<GitlabRepositoriesResponse> => {
  try {
    const response = await gatewayAPI.get<GitlabRepositoriesResponse>(
      `/integrations/gitlab/organization/${organizationId}/repositories`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Link GitLab repository to project
 */
export const linkGitlabRepository = async (
  organizationId: string,
  projectId: string,
  payload: LinkGitlabRepositoryDto
): Promise<GitlabLinkRepositoryResponse> => {
  try {
    const response = await gatewayAPI.post<GitlabLinkRepositoryResponse>(
      `/integrations/gitlab/organization/${organizationId}/project/${projectId}/link`,
      payload
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Unlinks a GitLab repository from a project.
 * When payload is not provided, the backend handles repository lookup by project ID.
 * @param organizationId - The organization ID
 * @param projectId - The project ID to unlink
 * @param payload - Optional: specific repository ID to unlink
 */
export const unlinkGitlabRepository = async (
  organizationId: string,
  projectId: string,
  payload?: LinkGitlabRepositoryDto
): Promise<GitlabLinkRepositoryResponse> => {
  try {
    const response = await gatewayAPI.delete<GitlabLinkRepositoryResponse>(
      `/integrations/gitlab/organization/${organizationId}/project/${projectId}/unlink`,
      payload ? { data: payload } : undefined
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Start scan for GitLab repository
 * @param projectId - The project ID
 * @param repositoryId - The repository ID
 * @param branch - Optional branch to scan (defaults to scanBranch or defaultBranch)
 */
export const startScanForLastCommitAndProjectGitlab = async (
  projectId: string,
  repositoryId: string,
  branch?: string,
  /** Another space than AppSec: a graph-only analysis (code graph and rules, no AppSec scanner, no counter). */
  product?: Product
): Promise<StartGitlabScanResponse> => {
  try {
    const payload: StartScanGitlabBodyDto = { repositoryId };

    if (branch) {
      payload.branch = branch;
    }
    if (product) {
      payload.product = product;
    }
    
    const response = await gatewayAPI.post<StartGitlabScanResponse>(
      `/integrations/gitlab/project/${projectId}/start-scan`,
      payload
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Unlink GitLab repository from project
 */
export const unlinkGitlabProject = async (
  projectId: string,
  organizationId: string,
  payload: LinkRepositoryDto
): Promise<void> => {
  try {
    const response = await gatewayAPI.delete(
      `/integrations/gitlab/organization/${organizationId}/project/${projectId}/unlink`,
      { data: payload }
    );
    if (![200, 201, 202, 204].includes(response.status)) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

/**
 * Disconnect GitLab from the organization: every project loses
 * its link to its GitLab repository. Idempotent on the server.
 */
export const disconnectGitlab = async (
  organizationId: string
): Promise<void> => {
  const response = await gatewayAPI.delete(
    `/integrations/gitlab/organization/${organizationId}/disconnect`
  );
  if (![200, 201, 202, 204].includes(response.status)) {
    throw new Error(`Unexpected status code: ${response.status}`);
  }
};