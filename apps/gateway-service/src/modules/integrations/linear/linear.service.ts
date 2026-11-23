import {
  LINEAR_SERVICE_NAME,
  LinearServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  DisconnectLinearRequest,
  GenerateLinearOAuthUrlRequest,
  GenerateLinearOAuthUrlResponse,
  GetLinearInstallationForOrgaRequest,
  GetLinearInstallationForOrgaResponse,
  GetLinearTeamOptionsRequest,
  GetLinearTeamOptionsResponse,
  GetProjectLinearConfigRequest,
  GetProjectLinearConfigResponse,
  LinearCallbackInstallRequest,
  LinearCallbackInstallResponse,
  LinearGenericResponse,
  LinearWebhookEventRequest,
  LinearWebhookResponse,
  ListLinearTeamsRequest,
  ListLinearTeamsResponse,
  RemoveProjectLinearConfigRequest,
  SetProjectLinearConfigRequest,
} from '@grpc/external-integrations/linear';
import {
  CreateLinearIssuesRequest,
  CreateLinearIssuesResponse,
  GetLinearProjectIssuesRequest,
  GetLinearProjectIssuesResponse,
  LINEAR_ISSUE_SERVICE_NAME,
  LinearIssueServiceClient,
  LinkLinearIssueRequest,
  LinkLinearIssueResponse,
  SyncLinearIssueStatusRequest,
  SyncLinearIssueStatusResponse,
} from '@grpc/external-integrations/issue';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

/**
 * Gateway-side forwarder for the Linear integration. Every call
 * goes through `safeGrpcCall`, so a refusal of external-integrations (the
 * closed list LINEAR_NOT_CONNECTED, LINEAR_NEEDS_RECONNECT, ...) reaches the
 * client as an HTTP error whose `message` is the code.
 */
@Injectable()
export class LinearService {
  private linearServiceClient!: LinearServiceClient;
  private linearIssueServiceClient!: LinearIssueServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.linearServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<LinearServiceClient>(LINEAR_SERVICE_NAME),
    );
    this.linearIssueServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<LinearIssueServiceClient>(
        LINEAR_ISSUE_SERVICE_NAME,
      ),
    );
  }

  // ========== Configuration ==========

  @Span()
  generateOAuthUrl(
    dto: GenerateLinearOAuthUrlRequest,
  ): Promise<GenerateLinearOAuthUrlResponse> {
    return safeGrpcCall(this.linearServiceClient.generateOAuthUrl(dto));
  }

  @Span()
  callbackInstall(
    dto: LinearCallbackInstallRequest,
  ): Promise<LinearCallbackInstallResponse> {
    return safeGrpcCall(this.linearServiceClient.callbackInstall(dto));
  }

  @Span()
  getInstallationForOrga(
    dto: GetLinearInstallationForOrgaRequest,
  ): Promise<GetLinearInstallationForOrgaResponse> {
    return safeGrpcCall(this.linearServiceClient.getInstallationForOrga(dto));
  }

  @Span()
  disconnect(dto: DisconnectLinearRequest): Promise<LinearGenericResponse> {
    return safeGrpcCall(this.linearServiceClient.disconnect(dto));
  }

  @Span()
  listTeams(dto: ListLinearTeamsRequest): Promise<ListLinearTeamsResponse> {
    return safeGrpcCall(this.linearServiceClient.listTeams(dto));
  }

  @Span()
  getTeamOptions(
    dto: GetLinearTeamOptionsRequest,
  ): Promise<GetLinearTeamOptionsResponse> {
    return safeGrpcCall(this.linearServiceClient.getTeamOptions(dto));
  }

  @Span()
  setProjectLinearConfig(
    dto: SetProjectLinearConfigRequest,
  ): Promise<LinearGenericResponse> {
    return safeGrpcCall(this.linearServiceClient.setProjectLinearConfig(dto));
  }

  @Span()
  getProjectLinearConfig(
    dto: GetProjectLinearConfigRequest,
  ): Promise<GetProjectLinearConfigResponse> {
    return safeGrpcCall(this.linearServiceClient.getProjectLinearConfig(dto));
  }

  @Span()
  removeProjectLinearConfig(
    dto: RemoveProjectLinearConfigRequest,
  ): Promise<LinearGenericResponse> {
    return safeGrpcCall(
      this.linearServiceClient.removeProjectLinearConfig(dto),
    );
  }

  // ========== Webhook ==========

  /**
   * Relays a Linear delivery to external-integrations, which verifies the
   * signature (HMAC-SHA256 of the raw body) and the timestamp. The gateway
   * only forwards the body exactly as received and the signature header.
   */
  @Span()
  handleWebhook(
    dto: LinearWebhookEventRequest,
  ): Promise<LinearWebhookResponse> {
    return safeGrpcCall(this.linearServiceClient.handleWebhook(dto));
  }

  // ========== Issue Management ==========

  @Span()
  createIssues(
    dto: CreateLinearIssuesRequest,
  ): Promise<CreateLinearIssuesResponse> {
    return safeGrpcCall(this.linearIssueServiceClient.createIssues(dto));
  }

  @Span()
  linkExistingIssue(
    dto: LinkLinearIssueRequest,
  ): Promise<LinkLinearIssueResponse> {
    return safeGrpcCall(this.linearIssueServiceClient.linkExistingIssue(dto));
  }

  @Span()
  getProjectIssues(
    dto: GetLinearProjectIssuesRequest,
  ): Promise<GetLinearProjectIssuesResponse> {
    return safeGrpcCall(this.linearIssueServiceClient.getProjectIssues(dto));
  }

  @Span()
  syncIssueStatus(
    dto: SyncLinearIssueStatusRequest,
  ): Promise<SyncLinearIssueStatusResponse> {
    return safeGrpcCall(this.linearIssueServiceClient.syncIssueStatus(dto));
  }
}
