import gatewayAPI from "../../api/gatewayAPI";

export interface LinearInstallation {
  /**
   * false => the organization has no integration. The endpoint answers 200,
   * so a rejected promise means a REAL failure (backend down, auth) and must
   * not be rendered as "not installed".
   */
  isConfigured: boolean;
  id: string;
  linearOrganizationId: string;
  workspaceName: string;
  workspaceUrlKey: string;
  organizationId: string;
  installedByUserId: string;
  /** Linear revoked the app or the refresh failed: the workspace must be connected again. */
  needsReconnect: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export interface LinearOption {
  id: string;
  name: string;
}

export interface LinearMember {
  id: string;
  name: string;
  displayName: string;
}

export interface LinearTeamOptions {
  projects: LinearOption[];
  labels: LinearOption[];
  members: LinearMember[];
}

export interface LinearProjectConfig {
  isConfigured: boolean;
  teamId: string;
  teamKey: string;
  teamName: string;
  linearProjectId: string;
  linearProjectName: string;
  labels: LinearOption[];
  allowedBranches: string[];
  autoCreateEnabled: boolean;
}

export interface LinearIssueInfo {
  issueId: string;
  issueNumber: number;
  title: string;
  url: string;
  state: string;
  vulnerabilityIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Human identifier of the ticket (e.g. ENG-142); changes when the ticket moves to another team. */
  linearIdentifier?: string;
  linearTeamKey?: string;
  linearPriority?: string;
  linearAssignee?: string;
  /** Linear workflow state type: triage, backlog, unstarted, started, completed, canceled. */
  linearStateType?: string;
}

/** The answer of a Linear route that only reports whether it worked. */
export interface LinearGenericResult {
  success: boolean;
  message?: string;
}

/** What the server reads of a finding to write its ticket (the `VulnerabilityInfo` contract). */
export interface LinearVulnerabilityInput {
  vulnerabilityId: string;
  scannerType: string;
  severity?: string;
  name?: string;
  shortDescription?: string;
  description?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  cwe?: string[];
  owaspTop10?: string[];
  cvssScore?: number;
  packageName?: string;
  packageVersion?: string;
  fixedVersion?: string;
  externalId?: string;
  cybedefendUrl?: string;
  branch?: string;
}

// ========== Refusals ==========

/**
 * The refusals the server gives for a Linear route, a closed list carried by
 * the `message` of the error. Each is read as a fixed translated sentence
 * (`linearRefusalKey`); the server's text is never shown.
 */
export const LINEAR_REFUSALS = [
  "LINEAR_NOT_CONNECTED",
  "LINEAR_NEEDS_RECONNECT",
  "LINEAR_WORKSPACE_TAKEN",
  "LINEAR_NO_TEAM",
  "LINEAR_TEAM_NOT_FOUND",
  "LINEAR_ISSUE_NOT_FOUND",
] as const;
export type LinearRefusal = (typeof LINEAR_REFUSALS)[number];

const isLinearRefusal = (value: unknown): value is LinearRefusal =>
  typeof value === "string" && (LINEAR_REFUSALS as readonly string[]).includes(value);

/**
 * The refusal an error from a Linear route carries: its response `message`
 * when that is exactly one code of the closed list. Anything else (another
 * message, a code inside a longer text, no response) is null and keeps the
 * caller's usual handling.
 */
export function linearRefusalOf(error: unknown): LinearRefusal | null {
  const message = (error as { response?: { data?: { message?: unknown } } } | null | undefined)?.response?.data
    ?.message;
  return isLinearRefusal(message) ? message : null;
}

/** The translation key of the sentence shown for a refusal. */
export const linearRefusalKey = (code: LinearRefusal): string => `components.linearRefusals.${code}`;

// ========== Helpers ==========

const ACCEPTED_STATUSES = [200, 201, 202];

/** The body of a response that succeeded; any other status is an error. */
const bodyOf = <T>(response: { status: number; data: T }): T => {
  if (ACCEPTED_STATUSES.includes(response.status)) {
    return response.data;
  }
  throw new Error(`Unexpected status code: ${response.status}`);
};

// ========== Configuration ==========

// Concurrent callers (the results pages' ticket map, the settings page, the
// connection modal) each want GET /organization/:orgId/linear/installation.
// Coalesce in-flight requests by org so they share one HTTP call, as the Jira
// client does.
const pendingLinearInstallationRequests = new Map<string, Promise<LinearInstallation>>();

export const getLinearInstallation = async (organizationId: string): Promise<LinearInstallation> => {
  const inflight = pendingLinearInstallationRequests.get(organizationId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const response = await gatewayAPI.get<LinearInstallation>(`/organization/${organizationId}/linear/installation`);
      return bodyOf(response);
    } finally {
      pendingLinearInstallationRequests.delete(organizationId);
    }
  })();

  pendingLinearInstallationRequests.set(organizationId, promise);
  return promise;
};

export const getLinearOAuthUrl = async (organizationId: string): Promise<{ installUrl: string }> => {
  const response = await gatewayAPI.get(`/organization/${organizationId}/linear/oauth/url`);
  return response.data;
};

export const installLinearIntegration = async (
  organizationId: string,
  payload: { code: string; redirectUri: string; state: string },
): Promise<unknown> => {
  const response = await gatewayAPI.post(`/organization/${organizationId}/linear/install/callback`, payload);
  return bodyOf(response);
};

export const disconnectLinear = async (organizationId: string): Promise<LinearGenericResult> => {
  const response = await gatewayAPI.delete(`/organization/${organizationId}/linear/disconnect`);
  return bodyOf(response);
};

export const listLinearTeams = async (organizationId: string): Promise<LinearTeam[]> => {
  const response = await gatewayAPI.get<{ teams: LinearTeam[] }>(`/organization/${organizationId}/linear/teams`);
  return bodyOf(response).teams;
};

export const getLinearTeamOptions = async (organizationId: string, teamId: string): Promise<LinearTeamOptions> => {
  const response = await gatewayAPI.get<LinearTeamOptions>(
    `/organization/${organizationId}/linear/teams/${teamId}/options`,
  );
  return bodyOf(response);
};

// ========== Project Config ==========

export const setProjectLinearConfig = async (
  organizationId: string,
  projectId: string,
  config: {
    teamId: string;
    linearProjectId?: string;
    labelIds?: string[];
    allowedBranches?: string[];
    autoCreateEnabled?: boolean;
  },
): Promise<LinearGenericResult> => {
  const response = await gatewayAPI.post(`/organization/${organizationId}/project/${projectId}/linear/config`, config);
  return bodyOf(response);
};

export const getProjectLinearConfig = async (
  organizationId: string,
  projectId: string,
): Promise<LinearProjectConfig> => {
  const response = await gatewayAPI.get<LinearProjectConfig>(
    `/organization/${organizationId}/project/${projectId}/linear/config`,
  );
  return bodyOf(response);
};

export const removeProjectLinearConfig = async (
  organizationId: string,
  projectId: string,
): Promise<LinearGenericResult> => {
  const response = await gatewayAPI.delete(`/organization/${organizationId}/project/${projectId}/linear/config`);
  return bodyOf(response);
};

// ========== Issue Management ==========

export const createLinearIssues = async (
  organizationId: string,
  projectId: string,
  payload: {
    scanId: string;
    mode: number;
    vulnerabilities: LinearVulnerabilityInput[];
    cybedefendBaseUrl: string;
    /** Empty or absent: the team configured for the project. */
    teamId?: string;
    linearProjectId?: string;
    labelIds?: string[];
    assigneeId?: string;
    /** 0 (none) to 4 (low); absent: deduced from the severity. */
    priority?: number;
  },
): Promise<{ success: boolean; issues: LinearIssueInfo[]; failedVulnerabilityIds: string[] }> => {
  const response = await gatewayAPI.post(`/organization/${organizationId}/project/${projectId}/linear/issues`, payload);
  return bodyOf(response);
};

export const linkLinearIssue = async (
  organizationId: string,
  projectId: string,
  payload: {
    /** A Linear identifier (ENG-142) or the https://linear.app URL of the ticket. */
    issueRef: string;
    vulnerabilityIds: string[];
    scannerType: string;
    vulnerabilities?: LinearVulnerabilityInput[];
    cybedefendBaseUrl?: string;
  },
): Promise<{ success: boolean; issue: LinearIssueInfo }> => {
  const response = await gatewayAPI.post(
    `/organization/${organizationId}/project/${projectId}/linear/issues/link`,
    payload,
  );
  return bodyOf(response);
};

export const getLinearProjectIssues = async (
  organizationId: string,
  projectId: string,
): Promise<{ success: boolean; issues: LinearIssueInfo[] }> => {
  const response = await gatewayAPI.get(`/organization/${organizationId}/project/${projectId}/linear/issues`);
  return bodyOf(response);
};

/**
 * Asks the server to read the project's tickets again from Linear (it catches
 * up on a webhook Linear switched off). The request names no ticket: the
 * server reads every ticket of the project.
 */
export const syncLinearIssueStatus = async (
  organizationId: string,
  projectId: string,
): Promise<{ success: boolean; updated: number }> => {
  const response = await gatewayAPI.post(`/organization/${organizationId}/project/${projectId}/linear/issues/sync-status`);
  return bodyOf(response);
};
