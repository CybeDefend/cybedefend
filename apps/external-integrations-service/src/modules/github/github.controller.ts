import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { GithubService } from './github.service';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  GithubServiceController,
  GithubServiceControllerMethods,
} from '@grpc/external-integrations/external_integrations';
import {
  CallbackInstallRequest,
  CallbackInstallResponse,
  GetBranchesRequest,
  GetBranchesResponse,
  GetInstallationForOrgaRequest,
  GetInstallationForOrgaResponse,
  GetRepositoriesRequest,
  GetRepositoriesResponse,
  LinkRepositoryRequest,
  LinkRepositoryResponse,
  DeleteProjectRequest,
  StartScanRequest,
  StartScanResponse,
  UnlinkRepositoryRequest,
  WebhookEventRequest,
  WebhookResponse,
  GetGithubAccessTokenForProjectRequest,
  GetGithubAccessTokenForProjectResponse,
  GetBatchProjectLinkStatusRequest,
  GetBatchProjectLinkStatusResponse,
  GetRepositoryBranchesPaginatedRequest,
  GetRepositoryBranchesPaginatedResponse,
} from '@grpc/external-integrations/github';

@Controller()
@GithubServiceControllerMethods()
export class GithubController implements GithubServiceController {
  constructor(
    private readonly githubService: GithubService,
    private readonly logger: Logger,
  ) {}

  /**
   * Get the installation for an organization.
   *
   * @param message - The message containing the data with organizationId.
   * @returns The installation for the organization or an error.
   */
  @Span()
  async getInstallationForOrga(
    request: GetInstallationForOrgaRequest,
  ): Promise<GetInstallationForOrgaResponse> {
    return await this.githubService.getInstallationForOrga(request);
  }

  /**
   * Start the scan for the last commit and project.
   *
   * @param message - The message containing the data with projectId and commitSha.
   * @returns The result of the scan or an error.
   */
  @Span()
  async startScanForLastCommit(
    request: StartScanRequest,
  ): Promise<StartScanResponse> {
    return await this.githubService.startScanForLastCommitAndProject(request);
  }

  /**
   * Link a project to a repository.
   *
   * @param message - The message containing the data with projectId and repositoryId.
   * @returns The result of the link or an error.
   */
  @Span()
  @MessagePattern('github.linkProject')
  async linkProjectToRepository(
    request: LinkRepositoryRequest,
  ): Promise<LinkRepositoryResponse> {
    return await this.githubService.linkProject(request);
  }

  /**
   * Unlink a project from a repository.
   *
   * @param message - The message containing the data with projectId and repositoryId.
   * @returns The result of the unlink or an error.
   */
  @Span()
  async unlinkProjectFromRepository(
    request: UnlinkRepositoryRequest,
  ): Promise<LinkRepositoryResponse> {
    return await this.githubService.unlinkProject(request);
  }

  /**
   * Delete a project.
   *
   * @param message - The message containing the data with projectId.
   * @returns The result of the delete or an error.
   */
  @Span()
  async deleteProject(
    request: DeleteProjectRequest,
  ): Promise<LinkRepositoryResponse> {
    return await this.githubService.deleteProject(request);
  }

  /**
   * Callback for the installation of the Github App.
   *
   * @param message - The message containing the data with installationId.
   * @returns The result of the callback or an error.
   */
  @Span()
  async callbackInstall(
    request: CallbackInstallRequest,
  ): Promise<CallbackInstallResponse> {
    return await this.githubService.callbackInstall(request);
  }

  /**
   * Get the repositories of an organization.
   *
   * @param request - The request containing the data with organizationId.
   * @returns The repositories of the organization or an error.
   */
  @Span()
  async getRepositories(
    request: GetRepositoriesRequest,
  ): Promise<GetRepositoriesResponse> {
    return await this.githubService.getRepositories(request);
  }

  /**
   * Get branches for a repository.
   *
   * @param request - The request containing repositoryId and organizationId.
   * @returns The branches of the repository or an error.
   */
  @Span()
  async getBranches(request: GetBranchesRequest): Promise<GetBranchesResponse> {
    return await this.githubService.getBranches(request);
  }

  /**
   * Get a paginated, searchable list of branches for a repository looked up by projectId.
   *
   * @param request - Contains organizationId, projectId, search, page, pageSize, includeArchived, archivedNames.
   * @returns Paginated branch list with total count and repository metadata.
   */
  @Span()
  async getRepositoryBranchesPaginated(
    request: GetRepositoryBranchesPaginatedRequest,
  ): Promise<GetRepositoryBranchesPaginatedResponse> {
    return this.githubService.getRepositoryBranchesPaginated(request);
  }

  /**
   * Handle the Github Webhook.
   *
   * @param message - The message containing the data with the webhook event.
   * @returns The result of the handling or an error.
   */
  @Span()
  async handleWebhook(request: WebhookEventRequest): Promise<WebhookResponse> {
    return await this.githubService.handleWebhookEvent(request);
  }

  /**
   * Check if a project has a linked GitHub repository.
   *
   * @param request - The request containing the projectId.
   * @returns The link status with repository info if linked.
   */
  @Span()
  async getProjectLinkStatus(request: { projectId: string }): Promise<{
    isLinked: boolean;
    repositoryId: string;
    repositoryName: string;
    repositoryFullName: string;
  }> {
    return await this.githubService.getProjectLinkStatus(request);
  }

  /**
   * Batch check if multiple projects have linked GitHub repositories.
   *
   * @param request - The request containing an array of projectIds.
   * @returns Array of link status entries for each project.
   */
  @Span()
  async getBatchProjectLinkStatus(
    request: GetBatchProjectLinkStatusRequest,
  ): Promise<GetBatchProjectLinkStatusResponse> {
    return await this.githubService.getBatchProjectLinkStatus(
      request.projectIds,
    );
  }

  /**
   * Get a valid GitHub installation access token for a project.
   * Used for internal service operations like git clone.
   *
   * @param request - The request containing the projectId.
   * @returns Access token and repository metadata for git operations.
   */
  @Span()
  async getAccessTokenForProject(
    request: GetGithubAccessTokenForProjectRequest,
  ): Promise<GetGithubAccessTokenForProjectResponse> {
    return await this.githubService.getAccessTokenForProject(request.projectId);
  }
}
