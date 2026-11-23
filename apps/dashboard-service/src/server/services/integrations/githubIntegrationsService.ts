import gatewayAPI from "../../api/gatewayAPI";
import {
  GithubRepositoriesResponse,
  InstallGithubIntegrationDto,
  LinkRepositoryDto,
  GithubInstallationDetails,
} from "../../interfaces/Integrations";
import { StartScanResponseDto } from "../../interfaces/Scan";
import { GetGithubBranchesResponse } from "../../interfaces/Branch";
import type { Product } from "@/utils/product";

/**
 * Fetch branches for a GitHub repository
 * @param organizationId - The organization ID
 * @param repositoryId - The internal repository ID
 * @returns List of branches with default and scan branch info
 */
export const getGithubRepositoryBranches = async (
  organizationId: string,
  repositoryId: string
): Promise<GetGithubBranchesResponse> => {
  try {
    const response = await gatewayAPI.get<GetGithubBranchesResponse>(
      `/organization/${organizationId}/github/repositories/${repositoryId}/branches`
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
 * Start a scan for a GitHub repository
 * @param projectId - The project ID
 * @param repositoryId - The repository ID
 * @param organizationId - The organization ID
 * @param branch - Optional branch to scan (defaults to scanBranch or defaultBranch)
 */
export const startScanForLastCommitAndProject = async (
  projectId: string,
  repositoryId: string,
  organizationId: string,
  branch?: string,
  /** Another space than AppSec: a graph-only analysis (code graph and rules, no AppSec scanner, no counter). */
  product?: Product
): Promise<StartScanResponseDto> => {
  try {
    const payload: {
      repositoryId: string;
      organizationId: string;
      branch?: string;
      product?: Product;
    } = {
      repositoryId,
      organizationId,
    };

    if (branch) {
      payload.branch = branch;
    }
    if (product) {
      payload.product = product;
    }
    
    const response = await gatewayAPI.post<StartScanResponseDto>(
      `/project/${projectId}/github/start-scan`,
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
 * Asks the gateway for a single-use installation `state` bound to the current
 * user and this organization. It goes on the GitHub App installation URL;
 * GitHub hands it back to the callback page, which sends it with the code:
 * the gateway refuses a callback whose state it did not issue to that user
 * for that organization (CSRF on the install flow).
 */
export const createGithubInstallState = async (
  organizationId: string
): Promise<string> => {
  const response = await gatewayAPI.post<{ state: string }>(
    `/organization/${organizationId}/github/install/state`
  );
  if ([200, 201, 202].includes(response.status)) {
    return response.data.state;
  }
  throw new Error(`Unexpected status code: ${response.status}`);
};

export const installGithubIntegration = async (
  organizationId: string,
  payload: InstallGithubIntegrationDto
): Promise<any> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/github/install/callback`,
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

export const getGithubRepositories = async (
  organizationId: string
): Promise<GithubRepositoriesResponse> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/github/repositories`
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

// Get installation details for an organization (used to detect if GitHub is linked and by whom)
export const getGithubInstallation = async (
  organizationId: string
): Promise<GithubInstallationDetails> => {
  try {
    const response = await gatewayAPI.get<GithubInstallationDetails>(
      `/organization/${organizationId}/github/installation`
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

export const linkGithubRepository = async (
  organizationId: string,
  projectId: string,
  payload: LinkRepositoryDto
): Promise<any> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/${projectId}/github/link`,
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
 * Unlinks a GitHub repository from a project.
 * When payload is not provided, the backend handles repository lookup by project ID.
 * @param organizationId - The organization ID
 * @param projectId - The project ID to unlink
 * @param payload - Optional: specific repository ID to unlink
 */
export const unlinkGithubRepository = async (
  organizationId: string,
  projectId: string,
  payload?: LinkRepositoryDto
): Promise<any> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/project/${projectId}/github/unlink`,
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
