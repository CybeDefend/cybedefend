import gatewayAPI from "../../api/gatewayAPI";

export interface JiraInstallation {
  /**
   * false => the organization has no integration. The endpoint answers 200,
   * so a rejected promise now means a REAL failure (backend down, auth) and
   * must not be rendered as "not installed".
   */
  isConfigured: boolean;
  id: string;
  cloudId: string;
  siteName: string;
  siteUrl: string;
  organizationId: string;
  installedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface JiraProject {
  projectId: string;
  key: string;
  name: string;
  avatarUrl: string;
}

export interface JiraProjectConfig {
  jiraProjectId: string;
  jiraProjectKey: string;
  jiraProjectName: string;
  allowedBranches: string[];
  isConfigured: boolean;
  autoCreateEnabled: boolean;
}

export interface JiraIssueInfo {
  issueId: string;
  issueNumber: number;
  title: string;
  url: string;
  state: string;
  vulnerabilityIds: string[];
  createdAt: string;
  updatedAt: string;
  jiraProjectKey?: string;
  jiraPriority?: string;
  jiraAssignee?: string;
}

export interface JiraIssueStatus {
  issueKey: string;
  status: string;
  statusCategory: string;
  issueUrl: string;
  hasPullRequest: boolean;
}

// ========== Configuration ==========

// Concurrent callers (the issue map hook + page useEffect) historically each
// fired GET /organization/:orgId/jira/installation. Coalesce in-flight
// requests by org so they share one HTTP call. Mirrors the
// pendingProjectRequests pattern in projectService.ts.
const pendingJiraInstallationRequests = new Map<string, Promise<JiraInstallation>>();

export const getJiraInstallation = async (
  organizationId: string
): Promise<JiraInstallation> => {
  const inflight = pendingJiraInstallationRequests.get(organizationId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const response = await gatewayAPI.get<JiraInstallation>(
        `/organization/${organizationId}/jira/installation`
      );
      if ([200, 201, 202].includes(response.status)) {
        return response.data;
      }
      throw new Error(`Unexpected status code: ${response.status}`);
    } finally {
      pendingJiraInstallationRequests.delete(organizationId);
    }
  })();

  pendingJiraInstallationRequests.set(organizationId, promise);
  return promise;
};

export const getJiraOAuthUrl = async (
  organizationId: string
): Promise<{ installUrl: string }> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/jira/oauth/url`
  );
  return response.data;
};

export const installJiraIntegration = async (
  organizationId: string,
  payload: { code: string; redirectUri: string; state: string }
): Promise<any> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/jira/install/callback`,
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

export const disconnectJira = async (
  organizationId: string
): Promise<any> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/jira/disconnect`
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

export const listJiraProjects = async (
  organizationId: string
): Promise<JiraProject[]> => {
  try {
    const response = await gatewayAPI.get<{ projects: JiraProject[] }>(
      `/organization/${organizationId}/jira/projects`
    );
    if ([200, 201, 202].includes(response.status)) {
      return response.data.projects;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error: any) {
    throw error;
  }
};

// ========== Project Config ==========

export const setProjectJiraConfig = async (
  organizationId: string,
  projectId: string,
  config: {
    jiraProjectId: string;
    jiraProjectKey: string;
    jiraProjectName: string;
    allowedBranches?: string[];
    autoCreateEnabled?: boolean;
  }
): Promise<any> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/${projectId}/jira/config`,
      config
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

export const getProjectJiraConfig = async (
  organizationId: string,
  projectId: string
): Promise<JiraProjectConfig> => {
  try {
    const response = await gatewayAPI.get<JiraProjectConfig>(
      `/organization/${organizationId}/project/${projectId}/jira/config`
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

export const removeProjectJiraConfig = async (
  organizationId: string,
  projectId: string
): Promise<any> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/project/${projectId}/jira/config`
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

// ========== Issue Management ==========

export const createJiraIssues = async (
  organizationId: string,
  projectId: string,
  payload: {
    scanId: string;
    mode: number;
    vulnerabilities: any[];
    cybedefendBaseUrl: string;
    jiraProjectKey?: string;
  }
): Promise<{ success: boolean; issues: JiraIssueInfo[]; failedVulnerabilityIds: string[] }> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/${projectId}/jira/issues`,
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

export const linkJiraIssue = async (
  organizationId: string,
  projectId: string,
  payload: {
    jiraIssueKey: string;
    vulnerabilityIds: string[];
    scannerType: string;
    vulnerabilities?: Array<{
      vulnerabilityId: string;
      scannerType: string;
      severity: string;
      name: string;
      filePath?: string;
      startLine?: number;
    }>;
    cybedefendBaseUrl?: string;
  }
): Promise<{ success: boolean; issue: JiraIssueInfo }> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/${projectId}/jira/issues/link`,
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

export const getJiraProjectIssues = async (
  organizationId: string,
  projectId: string
): Promise<{ success: boolean; issues: JiraIssueInfo[] }> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/project/${projectId}/jira/issues`
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

export const syncJiraIssueStatus = async (
  organizationId: string,
  projectId: string,
  externalIssueKeys: string[]
): Promise<{ success: boolean; statuses: JiraIssueStatus[] }> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/project/${projectId}/jira/issues/sync-status`,
      { externalIssueKeys }
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
