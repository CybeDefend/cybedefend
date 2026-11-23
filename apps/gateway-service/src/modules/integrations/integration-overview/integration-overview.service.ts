import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  IntegrationOverviewResponseDto,
  GithubInstallationDto,
  GitlabInstallationDto,
  SlackInstallationDto,
  JiraInstallationDto,
  LinearInstallationDto,
  ContainerRegistryStatsDto,
} from './dto/integration-overview.dto';
import {
  GITHUB_SERVICE_NAME,
  GithubServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  GITLAB_SERVICE_NAME,
  GitlabServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  SLACK_SERVICE_NAME,
  SlackServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  JIRA_SERVICE_NAME,
  JiraServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  LINEAR_SERVICE_NAME,
  LinearServiceClient,
} from '@grpc/external-integrations/external_integrations';
import { GetInstallationForOrgaResponse } from '@grpc/external-integrations/github';
import { GetGitlabInstallationForOrgaResponse } from '@grpc/external-integrations/gitlab';
import { GetSlackInstallationForOrgaResponse } from '@grpc/external-integrations/slack';
import { GetJiraInstallationForOrgaResponse } from '@grpc/external-integrations/jira';
import { GetLinearInstallationForOrgaResponse } from '@grpc/external-integrations/linear';
import {
  CONTAINER_REGISTRIES_OVERVIEW_PORT,
  type ContainerRegistriesOverviewPort,
} from '../../../edition/ports/container-registries-overview.port';

/**
 * Integration Overview Service
 * Provides combined integration status information for an organization
 */
@Injectable()
export class IntegrationOverviewService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationOverviewService.name);

  private githubServiceClient: GithubServiceClient;
  private gitlabServiceClient: GitlabServiceClient;
  private slackServiceClient: SlackServiceClient;
  private jiraServiceClient: JiraServiceClient;
  private linearServiceClient: LinearServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly externalIntegrationsClient: ClientGrpc,
    @Inject(CONTAINER_REGISTRIES_OVERVIEW_PORT)
    private readonly containerRegistries: ContainerRegistriesOverviewPort,
  ) {}

  onModuleInit() {
    this.githubServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<GithubServiceClient>(
        GITHUB_SERVICE_NAME,
      ),
    );
    this.gitlabServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<GitlabServiceClient>(
        GITLAB_SERVICE_NAME,
      ),
    );
    this.slackServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<SlackServiceClient>(
        SLACK_SERVICE_NAME,
      ),
    );
    this.jiraServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<JiraServiceClient>(
        JIRA_SERVICE_NAME,
      ),
    );
    this.linearServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<LinearServiceClient>(
        LINEAR_SERVICE_NAME,
      ),
    );
  }

  /**
   * Get combined integration overview for an organization
   * Fetches the GitHub, GitLab, Slack, Jira and Linear installations and the container registry stats in parallel
   *
   * @param organizationId Organization identifier
   * @returns Combined integration overview response
   */
  @Span()
  async getIntegrationOverview(
    organizationId: string,
  ): Promise<IntegrationOverviewResponseDto> {
    this.logger.log(
      `Fetching integration overview for organization ${organizationId}`,
    );

    // Fetch all data in parallel for better performance. The GitHub
    // installation is read once: it is also what the GHCR count is.
    const githubInstallationRead = this.getGithubInstallation(organizationId);
    const [
      githubInstallation,
      gitlabInstallation,
      slackInstallation,
      jiraInstallation,
      linearInstallation,
      containerRegistryStats,
    ] = await Promise.all([
      githubInstallationRead,
      this.getGitlabInstallation(organizationId),
      this.getSlackInstallation(organizationId),
      this.getJiraInstallation(organizationId),
      this.getLinearInstallation(organizationId),
      // Fail-soft, as each count was before the registries moved behind the
      // port: a stats read that fails never fails the overview.
      this.getContainerRegistryStats(organizationId, githubInstallationRead),
    ]);

    return {
      github: githubInstallation,
      gitlab: gitlabInstallation,
      slack: slackInstallation,
      jira: jiraInstallation,
      linear: linearInstallation,
      containerRegistry: containerRegistryStats,
    };
  }

  /**
   * The container registry stats through CONTAINER_REGISTRIES_OVERVIEW_PORT,
   * fail-soft: an exception answers an empty aggregate, as a failing count
   * did before the registries moved behind the port.
   */
  private async getContainerRegistryStats(
    organizationId: string,
    githubInstallation: Promise<GithubInstallationDto | null>,
  ): Promise<ContainerRegistryStatsDto> {
    try {
      return await this.containerRegistries.collectStats(
        organizationId,
        githubInstallation,
      );
    } catch (error) {
      this.logger.debug(
        `Failed to get container registry stats for organization ${organizationId}`,
        error,
      );
      return { total: 0, byType: [] };
    }
  }

  /**
   * Get GitHub installation for organization
   * Returns null if not installed
   */
  @Span()
  private async getGithubInstallation(
    organizationId: string,
  ): Promise<GithubInstallationDto | null> {
    try {
      const response: GetInstallationForOrgaResponse = await safeGrpcCall(
        this.githubServiceClient.getInstallationForOrga({ organizationId }),
      );

      // Check if the response is empty (gRPC returns default values when not found)
      if (!response.id || response.id === '') {
        return null;
      }

      return {
        id: response.id,
        installationId: response.installationId,
        userId: response.userId,
        organizationId: response.organizationId,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
      };
    } catch (error) {
      this.logger.debug(
        `GitHub installation not found for organization ${organizationId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get GitLab installation for organization
   * Returns null if not connected
   */
  @Span()
  private async getGitlabInstallation(
    organizationId: string,
  ): Promise<GitlabInstallationDto | null> {
    try {
      const response: GetGitlabInstallationForOrgaResponse = await safeGrpcCall(
        this.gitlabServiceClient.getInstallationForOrga({ organizationId }),
      );

      // Check if the response is empty (gRPC returns default values when not found)
      if (!response.id || response.id === '') {
        return null;
      }

      return {
        id: response.id,
        userId: response.userId,
        organizationId: response.organizationId,
        gitlabUserId: response.gitlabUserId,
        gitlabGroupId: response.gitlabGroupId,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
        // Absent from an older external-integrations during a deploy: healthy.
        reconnectRequired: response.reconnectRequired === true,
      };
    } catch (error: any) {
      this.logger.debug(
        `GitLab installation not found for organization ${organizationId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get Slack installation for organization
   * Returns null if not connected
   */
  @Span()
  private async getSlackInstallation(
    organizationId: string,
  ): Promise<SlackInstallationDto | null> {
    try {
      const response: GetSlackInstallationForOrgaResponse = await safeGrpcCall(
        this.slackServiceClient.getInstallationForOrga({ organizationId }),
      );

      // Check if the response is empty (gRPC returns default values when not found)
      if (!response.id || response.id === '') {
        return null;
      }

      return {
        id: response.id,
        teamId: response.teamId,
        teamName: response.teamName,
        organizationId: response.organizationId,
        installedByUserId: response.installedByUserId,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
      };
    } catch (error: any) {
      this.logger.debug(
        `Slack installation not found for organization ${organizationId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get Jira installation for organization
   * Returns null if not connected
   */
  @Span()
  private async getJiraInstallation(
    organizationId: string,
  ): Promise<JiraInstallationDto | null> {
    try {
      const response: GetJiraInstallationForOrgaResponse = await safeGrpcCall(
        this.jiraServiceClient.getInstallationForOrga({ organizationId }),
      );

      // Check if the response is empty (gRPC returns default values when not found)
      if (!response.id || response.id === '') {
        return null;
      }

      return {
        id: response.id,
        cloudId: response.cloudId,
        siteName: response.siteName,
        siteUrl: response.siteUrl,
        organizationId: response.organizationId,
        installedByUserId: response.installedByUserId,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
      };
    } catch (error: any) {
      this.logger.debug(
        `Jira installation not found for organization ${organizationId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get Linear installation for organization
   * Returns null if not connected. Unlike Jira, external-integrations answers
   * a normal 200 with `isConfigured=false` when the organization has no Linear
   * installation, so that flag (not an empty id) is the "not connected" signal.
   */
  @Span()
  private async getLinearInstallation(
    organizationId: string,
  ): Promise<LinearInstallationDto | null> {
    try {
      const response: GetLinearInstallationForOrgaResponse = await safeGrpcCall(
        this.linearServiceClient.getInstallationForOrga({ organizationId }),
      );

      if (!response.isConfigured) {
        return null;
      }

      return {
        id: response.id,
        linearOrganizationId: response.linearOrganizationId,
        workspaceName: response.workspaceName,
        workspaceUrlKey: response.workspaceUrlKey,
        organizationId: response.organizationId,
        installedByUserId: response.installedByUserId,
        needsReconnect: response.needsReconnect === true,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
      };
    } catch (error: any) {
      this.logger.debug(
        `Linear installation not found for organization ${organizationId}`,
        error,
      );
      return null;
    }
  }
}
