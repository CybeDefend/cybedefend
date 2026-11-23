/**
 * GitHub installation information
 */
export interface GithubInstallation {
  id: string;
  installationId: number;
  userId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GitLab installation information
 */
export interface GitlabInstallation {
  id: string;
  userId: string;
  organizationId: string;
  gitlabUserId: number;
  gitlabGroupId?: number;
  createdAt: string;
  updatedAt: string;
  /** GitLab refused the connection's refresh token: it must be made again. */
  reconnectRequired?: boolean;
}

/**
 * Slack installation information
 */
export interface SlackInstallation {
  id: string;
  teamId: string;
  teamName: string;
  organizationId: string;
  installedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Jira installation information
 */
export interface JiraInstallation {
  id: string;
  cloudId: string;
  siteName: string;
  siteUrl: string;
  organizationId: string;
  installedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Linear installation information (a workspace connected to the organization)
 */
export interface LinearInstallation {
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

/**
 * Container registry type count
 */
export interface ContainerRegistryTypeCount {
  type: string;
  count: number;
}

/**
 * Container registry statistics
 */
export interface ContainerRegistryStats {
  total: number;
  byType: ContainerRegistryTypeCount[];
}

/**
 * Consolidated integrations overview response
 */
export interface IntegrationsOverviewResponse {
  github: GithubInstallation | null;
  gitlab: GitlabInstallation | null;
  slack: SlackInstallation | null;
  jira: JiraInstallation | null;
  /** Absent from a gateway older than the Linear integration. */
  linear?: LinearInstallation | null;
  containerRegistry: ContainerRegistryStats;
}
