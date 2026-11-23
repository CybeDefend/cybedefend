import { ApiProperty } from '@nestjs/swagger';

/**
 * GitHub installation details for organization
 */
export class GithubInstallationDto {
  @ApiProperty({
    description: 'Installation record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'GitHub App installation ID',
    example: 12345678,
  })
  installationId: number;

  @ApiProperty({
    description: 'User who installed the GitHub App',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  userId: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  organizationId: string;

  @ApiProperty({
    description: 'Installation creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Installation last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt: string;
}

/**
 * GitLab installation details for organization
 */
export class GitlabInstallationDto {
  @ApiProperty({
    description: 'Installation record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'User who connected GitLab',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  userId: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  organizationId: string;

  @ApiProperty({
    description: 'GitLab user ID',
    example: 987654,
  })
  gitlabUserId: number;

  @ApiProperty({
    description: 'GitLab group ID',
    example: 123456,
  })
  gitlabGroupId: number;

  @ApiProperty({
    description: 'Installation creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Installation last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt: string;

  @ApiProperty({
    description:
      "GitLab refused the connection's refresh token (the application was revoked on GitLab): the connection must be made again",
    example: false,
  })
  reconnectRequired: boolean;
}

/**
 * Slack installation details for organization
 */
export class SlackInstallationDto {
  @ApiProperty({
    description: 'Installation record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Slack workspace ID',
    example: 'T0123456789',
  })
  teamId: string;

  @ApiProperty({
    description: 'Slack workspace name',
    example: 'My Company',
  })
  teamName: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  organizationId: string;

  @ApiProperty({
    description: 'User who installed the Slack App',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  installedByUserId: string;

  @ApiProperty({
    description: 'Installation creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Installation last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt: string;
}

/**
 * Jira installation details for organization
 */
export class JiraInstallationDto {
  @ApiProperty({
    description: 'Installation record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Jira Cloud site ID',
    example: 'cloud-12345',
  })
  cloudId: string;

  @ApiProperty({
    description: 'Jira workspace name (e.g. "mycompany.atlassian.net")',
    example: 'mycompany.atlassian.net',
  })
  siteName: string;

  @ApiProperty({
    description: 'Full URL to the Jira instance',
    example: 'https://mycompany.atlassian.net',
  })
  siteUrl: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  organizationId: string;

  @ApiProperty({
    description: 'User who installed the Jira integration',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  installedByUserId: string;

  @ApiProperty({
    description: 'Installation creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Installation last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt: string;
}

/**
 * Linear installation details for organization
 */
export class LinearInstallationDto {
  @ApiProperty({
    description: 'Installation record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Linear workspace (organization) ID',
    example: '2d1f3c4e-5a6b-7c8d-9e0f-a1b2c3d4e5f6',
  })
  linearOrganizationId: string;

  @ApiProperty({
    description: 'Linear workspace name',
    example: 'Acme',
  })
  workspaceName: string;

  @ApiProperty({
    description: 'Linear workspace URL key (linear.app/<key>)',
    example: 'acme',
  })
  workspaceUrlKey: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  organizationId: string;

  @ApiProperty({
    description: 'User who installed the Linear integration',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  installedByUserId: string;

  @ApiProperty({
    description:
      'True when Linear rejected the refresh token (revoked, app uninstalled on the Linear side): the workspace must be connected again',
    example: false,
  })
  needsReconnect: boolean;

  @ApiProperty({
    description: 'Installation creation timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Installation last update timestamp',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt: string;
}

/**
 * Container registry count by type
 */
export class ContainerRegistryCountDto {
  @ApiProperty({
    description: 'Container registry type',
    example: 'gitlab',
  })
  type: string;

  @ApiProperty({
    description: 'Number of credentials',
    example: 5,
  })
  count: number;
}

/**
 * Container registry statistics
 */
export class ContainerRegistryStatsDto {
  @ApiProperty({
    description: 'Total number of container registry credentials',
    example: 12,
  })
  total: number;

  @ApiProperty({
    description: 'Breakdown by container registry type',
    type: [ContainerRegistryCountDto],
  })
  byType: ContainerRegistryCountDto[];
}

/**
 * Combined integration overview response
 * Contains all integration status information for an organization
 */
export class IntegrationOverviewResponseDto {
  @ApiProperty({
    description: 'GitHub App installation details (null if not installed)',
    type: GithubInstallationDto,
    nullable: true,
    required: false,
  })
  github: GithubInstallationDto | null;

  @ApiProperty({
    description: 'GitLab integration details (null if not connected)',
    type: GitlabInstallationDto,
    nullable: true,
    required: false,
  })
  gitlab: GitlabInstallationDto | null;

  @ApiProperty({
    description: 'Slack integration details (null if not connected)',
    type: SlackInstallationDto,
    nullable: true,
    required: false,
  })
  slack: SlackInstallationDto | null;

  @ApiProperty({
    description: 'Jira integration details (null if not connected)',
    type: JiraInstallationDto,
    nullable: true,
    required: false,
  })
  jira: JiraInstallationDto | null;

  @ApiProperty({
    description: 'Linear integration details (null if not connected)',
    type: LinearInstallationDto,
    nullable: true,
    required: false,
  })
  linear: LinearInstallationDto | null;

  @ApiProperty({
    description: 'Container registry statistics',
    type: ContainerRegistryStatsDto,
  })
  containerRegistry: ContainerRegistryStatsDto;
}
