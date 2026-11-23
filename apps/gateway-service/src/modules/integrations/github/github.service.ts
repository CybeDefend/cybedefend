import {
  GITHUB_SERVICE_NAME,
  GithubServiceClient,
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
  StartScanRequest,
  StartScanResponse,
  UnlinkRepositoryRequest,
  WebhookEventRequest,
  WebhookResponse,
} from '@grpc/external-integrations/github';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { GITHUB_SIGNATURE_PATTERN, relayWebhook } from '../webhook-relay';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

@Injectable()
export class GithubService {
  private githubServiceClient!: GithubServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.githubServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<GithubServiceClient>(GITHUB_SERVICE_NAME),
    );
  }

  /**
   * Get installation for organization
   *
   * @param getInstallationForOrgaDto Get installation for organization request
   * @returns Get installation for organization response
   */
  @Span()
  getInstallationForOrga(
    getInstallationForOrgaDto: GetInstallationForOrgaRequest,
  ): Promise<GetInstallationForOrgaResponse> {
    return safeGrpcCall(
      this.githubServiceClient.getInstallationForOrga(
        getInstallationForOrgaDto,
      ),
    );
  }

  /**
   * Start scan for last commit and project
   *
   * @param data Start scan for last commit and project request
   * @returns Start scan for last commit and project response
   */
  @Span()
  handleStartScanForLastCommitAndProject(
    data: StartScanRequest,
  ): Promise<StartScanResponse> {
    return safeGrpcCall(this.githubServiceClient.startScanForLastCommit(data));
  }

  /**
   * Handle Github webhook
   *
   * @param webhookEventDto Webhook event
   * @returns Webhook response
   */
  @Span()
  handleWebhookEvent(
    webhookEventDto: WebhookEventRequest,
  ): Promise<WebhookResponse> {
    // One retry on UNAVAILABLE, see relayWebhook; none for a
    // request whose signature cannot be GitHub's.
    return relayWebhook(
      () => this.githubServiceClient.handleWebhook(webhookEventDto),
      {
        retryOnUnavailable: GITHUB_SIGNATURE_PATTERN.test(
          webhookEventDto.signature ?? '',
        ),
      },
    );
  }

  /**
   * Link project
   *
   * @param linkRepositoryDto Link project request
   * @returns Link project response
   */
  @Span()
  linkProject(
    linkRepositoryDto: LinkRepositoryRequest,
  ): Promise<LinkRepositoryResponse> {
    return safeGrpcCall(
      this.githubServiceClient.linkProjectToRepository(linkRepositoryDto),
    );
  }

  /**
   * Unlink project
   *
   * @param unlinkRepositoryDto Unlink project request
   * @returns Unlink project response
   */
  @Span()
  unLinkProject(
    unlinkRepositoryDto: UnlinkRepositoryRequest,
  ): Promise<LinkRepositoryResponse> {
    return safeGrpcCall(
      this.githubServiceClient.unlinkProjectFromRepository(unlinkRepositoryDto),
    );
  }

  /**
   * Callback install
   *
   * @param callbackInstallDto Callback install request
   * @returns Callback install response
   */
  @Span()
  callbackInstall(
    callbackInstallDto: CallbackInstallRequest,
  ): Promise<CallbackInstallResponse> {
    return safeGrpcCall(
      this.githubServiceClient.callbackInstall(callbackInstallDto),
    );
  }

  /**
   * Get repositories
   *
   * @param getRepositoriesDto Get repositories request
   * @returns Get repositories response
   */
  @Span()
  getRepositories(
    getRepositoriesDto: GetRepositoriesRequest,
  ): Promise<GetRepositoriesResponse> {
    return safeGrpcCall(
      this.githubServiceClient.getRepositories(getRepositoriesDto),
    );
  }

  /**
   * Get branches for a repository
   *
   * @param getBranchesDto Get branches request
   * @returns Get branches response
   */
  @Span()
  getBranches(
    getBranchesDto: GetBranchesRequest,
  ): Promise<GetBranchesResponse> {
    return safeGrpcCall(this.githubServiceClient.getBranches(getBranchesDto));
  }
}
