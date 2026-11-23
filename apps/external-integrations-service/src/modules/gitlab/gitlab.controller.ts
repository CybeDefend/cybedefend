import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';
import {
  DisconnectGitlabRequest,
  DisconnectGitlabResponse,
  GetGitlabAccessTokenForProjectRequest,
  GetGitlabAccessTokenForProjectResponse,
  GetGitlabInstallationForOrgaRequest,
  GetGitlabInstallationForOrgaResponse,
  GitlabCallbackInstallRequest,
  GitlabCallbackInstallResponse,
  GetGitlabRepositoriesRequest,
  GetGitlabRepositoriesResponse,
  GetGitlabBranchesRequest,
  GetGitlabBranchesResponse,
  GetGitlabRepositoryBranchesPaginatedRequest,
  GetGitlabRepositoryBranchesPaginatedResponse,
  LinkGitlabRepositoryRequest,
  UnlinkGitlabRepositoryRequest,
  GitlabLinkRepositoryResponse,
  StartGitlabScanRequest,
  StartGitlabScanResponse,
  DeleteGitlabProjectRequest,
  GitlabWebhookEventRequest,
  GitlabWebhookResponse,
  GetBatchGitlabProjectLinkStatusRequest,
  GetBatchGitlabProjectLinkStatusResponse,
} from '@grpc/external-integrations/gitlab';
import { GitlabService } from './gitlab.service';

/**
 * GitLab gRPC Controller
 * Handles all GitLab integration gRPC requests (except Container Registry which has its own controller)
 */
@Controller()
export class GitlabController {
  constructor(
    private readonly gitlabService: GitlabService,
    private readonly logger: Logger,
  ) {}

  /**
   * Get GitLab installation for organization
   */
  @GrpcMethod('GitlabService', 'GetInstallationForOrga')
  @Span()
  async getInstallationForOrga(
    request: GetGitlabInstallationForOrgaRequest,
  ): Promise<GetGitlabInstallationForOrgaResponse> {
    return await this.gitlabService.getInstallationForOrga(
      request.organizationId,
    );
  }

  /**
   * Handle OAuth callback installation
   */
  @GrpcMethod('GitlabService', 'CallbackInstall')
  @Span()
  async callbackInstall(
    request: GitlabCallbackInstallRequest,
  ): Promise<GitlabCallbackInstallResponse> {
    this.logger.log(
      `Processing GitLab OAuth callback for organization: ${request.organizationId}`,
      GitlabController.name,
    );
    return await this.gitlabService.callbackInstall(request);
  }

  /**
   * Get synchronized GitLab repositories
   */
  @GrpcMethod('GitlabService', 'GetRepositories')
  @Span()
  async getRepositories(
    request: GetGitlabRepositoriesRequest,
  ): Promise<GetGitlabRepositoriesResponse> {
    return await this.gitlabService.getRepositories(request.organizationId);
  }

  /**
   * Get branches for GitLab repository
   */
  @GrpcMethod('GitlabService', 'GetBranches')
  @Span()
  async getBranches(
    request: GetGitlabBranchesRequest,
  ): Promise<GetGitlabBranchesResponse> {
    return await this.gitlabService.getBranches(request);
  }

  /**
   * Get a paginated, searchable list of branches for a GitLab repository by project ID
   */
  @GrpcMethod('GitlabService', 'GetGitlabRepositoryBranchesPaginated')
  @Span()
  async getGitlabRepositoryBranchesPaginated(
    request: GetGitlabRepositoryBranchesPaginatedRequest,
  ): Promise<GetGitlabRepositoryBranchesPaginatedResponse> {
    return await this.gitlabService.getGitlabRepositoryBranchesPaginated(
      request,
    );
  }

  /**
   * Link GitLab repository to CybeDefend project
   */
  @GrpcMethod('GitlabService', 'LinkProjectToRepository')
  @Span()
  async linkProjectToRepository(
    request: LinkGitlabRepositoryRequest,
  ): Promise<GitlabLinkRepositoryResponse> {
    this.logger.log(
      `Linking GitLab repository ${request.repositoryId} to project ${request.projectId}`,
      GitlabController.name,
    );
    return await this.gitlabService.linkProjectToRepository(request);
  }

  /**
   * Unlink GitLab repository from CybeDefend project
   */
  @GrpcMethod('GitlabService', 'UnlinkProjectFromRepository')
  @Span()
  async unlinkProjectFromRepository(
    request: UnlinkGitlabRepositoryRequest,
  ): Promise<GitlabLinkRepositoryResponse> {
    this.logger.log(
      `Unlinking GitLab repository ${request.repositoryId} from project ${request.projectId}`,
      GitlabController.name,
    );
    return await this.gitlabService.unlinkProjectFromRepository(request);
  }

  /**
   * Delete project and unlink all GitLab repositories
   */
  @GrpcMethod('GitlabService', 'DeleteProject')
  @Span()
  async deleteProject(
    request: DeleteGitlabProjectRequest,
  ): Promise<GitlabLinkRepositoryResponse> {
    this.logger.log(
      `Deleting GitLab project: ${request.projectId}`,
      GitlabController.name,
    );
    return await this.gitlabService.deleteProject(request.projectId);
  }

  /**
   * Start scan for last commit of linked repository
   */
  @GrpcMethod('GitlabService', 'StartScanForLastCommit')
  @Span()
  async startScanForLastCommit(
    request: StartGitlabScanRequest,
  ): Promise<StartGitlabScanResponse> {
    this.logger.log(
      `Starting GitLab scan for project ${request.projectId}, repository ${request.repositoryId}`,
      GitlabController.name,
    );
    return await this.gitlabService.startScanForLastCommit(request);
  }

  /**
   * Get a valid GitLab OAuth access token for a project (internal use by agents)
   */
  @GrpcMethod('GitlabService', 'GetAccessTokenForProject')
  @Span()
  async getAccessTokenForProject(
    request: GetGitlabAccessTokenForProjectRequest,
  ): Promise<GetGitlabAccessTokenForProjectResponse> {
    return await this.gitlabService.getAccessTokenForProject(request.projectId);
  }

  /**
   * Handle GitLab webhook events
   */
  @GrpcMethod('GitlabService', 'HandleWebhook')
  @Span()
  async handleWebhook(
    request: GitlabWebhookEventRequest,
  ): Promise<GitlabWebhookResponse> {
    this.logger.log(
      `Processing GitLab webhook event: ${request.event}`,
      GitlabController.name,
    );
    return await this.gitlabService.handleWebhook(request);
  }

  /**
   * Check if a project has a linked GitLab repository.
   *
   * @param request - The request containing the projectId.
   * @returns The link status with repository info if linked.
   */
  @GrpcMethod('GitlabService', 'GetProjectLinkStatus')
  @Span()
  async getProjectLinkStatus(request: { projectId: string }): Promise<{
    isLinked: boolean;
    repositoryId: string;
    repositoryName: string;
    repositoryFullName: string;
  }> {
    return await this.gitlabService.getProjectLinkStatus(request.projectId);
  }

  /**
   * Batch check if multiple projects have linked GitLab repositories.
   *
   * @param request - The request containing an array of projectIds.
   * @returns Array of link status entries for each project.
   */
  @GrpcMethod('GitlabService', 'GetBatchProjectLinkStatus')
  @Span()
  async getBatchProjectLinkStatus(
    request: GetBatchGitlabProjectLinkStatusRequest,
  ): Promise<GetBatchGitlabProjectLinkStatusResponse> {
    return await this.gitlabService.getBatchProjectLinkStatus(
      request.projectIds,
    );
  }

  /**
   * Disconnect GitLab from an organization. Idempotent.
   */
  @GrpcMethod('GitlabService', 'Disconnect')
  @Span()
  async disconnect(
    request: DisconnectGitlabRequest,
  ): Promise<DisconnectGitlabResponse> {
    return await this.gitlabService.disconnect(request.organizationId);
  }
}
