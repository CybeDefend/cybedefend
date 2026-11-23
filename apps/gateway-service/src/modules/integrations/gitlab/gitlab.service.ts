import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { Span } from 'nestjs-otel';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { relayWebhook } from '../webhook-relay';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  GITLAB_SERVICE_NAME,
  GitlabServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  GetGitlabInstallationForOrgaRequest,
  GetGitlabInstallationForOrgaResponse,
  GitlabCallbackInstallRequest,
  GitlabCallbackInstallResponse,
  GetGitlabRepositoriesRequest,
  GetGitlabRepositoriesResponse,
  LinkGitlabRepositoryRequest,
  UnlinkGitlabRepositoryRequest,
  GitlabLinkRepositoryResponse,
  StartGitlabScanRequest,
  StartGitlabScanResponse,
  GitlabWebhookEventRequest,
  GitlabWebhookResponse,
  GetGitlabBranchesRequest,
  GetGitlabBranchesResponse,
  DisconnectGitlabRequest,
  DisconnectGitlabResponse,
} from '@grpc/external-integrations/gitlab';

/**
 * GitLab Gateway Service
 * Proxy service for GitLab integration gRPC calls
 */
@Injectable()
export class GitlabService {
  private gitlabService: GitlabServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly client: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.gitlabService = wrapGrpcClientWithTracing(
      this.client.getService<GitlabServiceClient>(GITLAB_SERVICE_NAME),
    );
  }

  /**
   * Get GitLab installation for organization
   */
  @Span()
  async getInstallationForOrga(
    organizationId: string,
  ): Promise<GetGitlabInstallationForOrgaResponse> {
    const request: GetGitlabInstallationForOrgaRequest = {
      organizationId,
    };

    return await safeGrpcCall(
      this.gitlabService.getInstallationForOrga(
        request,
      ) as Observable<GetGitlabInstallationForOrgaResponse>,
    );
  }

  /**
   * Disconnect GitLab from an organization. Idempotent.
   */
  @Span()
  async disconnect(organizationId: string): Promise<DisconnectGitlabResponse> {
    const request: DisconnectGitlabRequest = { organizationId };

    return await safeGrpcCall(
      this.gitlabService.disconnect(
        request,
      ) as Observable<DisconnectGitlabResponse>,
    );
  }

  /**
   * Process OAuth callback installation
   */
  @Span()
  async callbackInstall(
    organizationId: string,
    userId: string,
    code: string,
    state: string,
  ): Promise<GitlabCallbackInstallResponse> {
    this.logger.log(
      `Processing GitLab OAuth callback for organization: ${organizationId}`,
      GitlabService.name,
    );

    const request: GitlabCallbackInstallRequest = {
      organizationId,
      userId,
      code,
      state,
    };

    return await safeGrpcCall(
      this.gitlabService.callbackInstall(
        request,
      ) as Observable<GitlabCallbackInstallResponse>,
    );
  }

  /**
   * Get GitLab repositories for organization
   */
  @Span()
  async getRepositories(
    organizationId: string,
  ): Promise<GetGitlabRepositoriesResponse> {
    const request: GetGitlabRepositoriesRequest = {
      organizationId,
    };

    return await safeGrpcCall(
      this.gitlabService.getRepositories(
        request,
      ) as Observable<GetGitlabRepositoriesResponse>,
    );
  }

  /**
   * Link GitLab repository to project
   */
  @Span()
  async linkProjectToRepository(
    organizationId: string,
    projectId: string,
    repositoryId: string,
    scanBranch?: string,
    product?: string,
  ): Promise<GitlabLinkRepositoryResponse> {
    this.logger.log(
      `Linking GitLab repository ${repositoryId} to project ${projectId}`,
      GitlabService.name,
    );

    const request: LinkGitlabRepositoryRequest = {
      organizationId,
      projectId,
      repositoryId,
      scanBranch: scanBranch || '',
      ...(product !== undefined ? { product } : {}),
    };

    return await safeGrpcCall(
      this.gitlabService.linkProjectToRepository(
        request,
      ) as Observable<GitlabLinkRepositoryResponse>,
    );
  }

  /**
   * Unlink GitLab repository from project
   */
  @Span()
  async unlinkProjectFromRepository(
    organizationId: string,
    projectId: string,
    repositoryId: string,
  ): Promise<GitlabLinkRepositoryResponse> {
    this.logger.log(
      `Unlinking GitLab repository ${repositoryId} from project ${projectId}`,
      GitlabService.name,
    );

    const request: UnlinkGitlabRepositoryRequest = {
      organizationId,
      projectId,
      repositoryId,
    };

    return await safeGrpcCall(
      this.gitlabService.unlinkProjectFromRepository(
        request,
      ) as Observable<GitlabLinkRepositoryResponse>,
    );
  }

  /**
   * Start scan for GitLab repository
   */
  @Span()
  async startScanForLastCommit(
    projectId: string,
    repositoryId: string,
    branch?: string,
    product?: string,
  ): Promise<StartGitlabScanResponse> {
    this.logger.log(
      `Starting scan for GitLab repository ${repositoryId} in project ${projectId}`,
      GitlabService.name,
    );

    const request: StartGitlabScanRequest = {
      projectId,
      repositoryId,
      branch: branch || '',
      ...(product ? { product } : {}),
    };

    return await safeGrpcCall(
      this.gitlabService.startScanForLastCommit(
        request,
      ) as Observable<StartGitlabScanResponse>,
    );
  }

  /**
   * Get branches for GitLab repository
   */
  @Span()
  async getBranches(
    organizationId: string,
    repositoryId: string,
  ): Promise<GetGitlabBranchesResponse> {
    const request: GetGitlabBranchesRequest = {
      organizationId,
      repositoryId,
    };

    return await safeGrpcCall(
      this.gitlabService.getBranches(
        request,
      ) as Observable<GetGitlabBranchesResponse>,
    );
  }

  /**
   * Handle Github webhook
   *
   * @param webhookEventDto Webhook event
   * @returns Webhook response
   */
  @Span()
  handleWebhookEvent(
    request: GitlabWebhookEventRequest,
  ): Promise<GitlabWebhookResponse> {
    // One retry on UNAVAILABLE, see relayWebhook; none for a
    // request without a token (the controller already refuses those).
    return relayWebhook(() => this.gitlabService.handleWebhook(request), {
      retryOnUnavailable: Boolean(request.gitlabToken),
    });
  }
}
