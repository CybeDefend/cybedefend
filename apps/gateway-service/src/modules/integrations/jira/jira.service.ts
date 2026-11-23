import {
  JIRA_SERVICE_NAME,
  JiraServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  GenerateJiraOAuthUrlRequest,
  GenerateJiraOAuthUrlResponse,
  JiraCallbackInstallRequest,
  JiraCallbackInstallResponse,
  GetJiraInstallationForOrgaRequest,
  GetJiraInstallationForOrgaResponse,
  DisconnectJiraRequest,
  JiraGenericResponse,
  ListJiraProjectsRequest,
  ListJiraProjectsResponse,
  SetProjectJiraConfigRequest,
  SetProjectJiraConfigResponse,
  GetProjectJiraConfigResponse,
  RemoveProjectJiraConfigRequest,
  JiraWebhookEventRequest,
  JiraWebhookResponse,
} from '@grpc/external-integrations/jira';
import {
  JIRA_ISSUE_SERVICE_NAME,
  JiraIssueServiceClient,
  CreateJiraIssuesRequest,
  CreateJiraIssuesResponse,
  LinkJiraIssueRequest,
  LinkJiraIssueResponse,
  GetJiraProjectIssuesRequest,
  GetJiraProjectIssuesResponse,
  GetJiraIssueStatusRequest,
  GetJiraIssueStatusResponse,
} from '@grpc/external-integrations/issue';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

@Injectable()
export class JiraService {
  private jiraServiceClient!: JiraServiceClient;
  private jiraIssueServiceClient!: JiraIssueServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.jiraServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<JiraServiceClient>(JIRA_SERVICE_NAME),
    );
    this.jiraIssueServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<JiraIssueServiceClient>(JIRA_ISSUE_SERVICE_NAME),
    );
  }

  // ========== Configuration ==========

  @Span()
  generateOAuthUrl(
    dto: GenerateJiraOAuthUrlRequest,
  ): Promise<GenerateJiraOAuthUrlResponse> {
    return safeGrpcCall(this.jiraServiceClient.generateOAuthUrl(dto));
  }

  @Span()
  callbackInstall(
    dto: JiraCallbackInstallRequest,
  ): Promise<JiraCallbackInstallResponse> {
    return safeGrpcCall(this.jiraServiceClient.callbackInstall(dto));
  }

  @Span()
  getInstallationForOrga(
    dto: GetJiraInstallationForOrgaRequest,
  ): Promise<GetJiraInstallationForOrgaResponse> {
    return safeGrpcCall(this.jiraServiceClient.getInstallationForOrga(dto));
  }

  @Span()
  disconnect(dto: DisconnectJiraRequest): Promise<JiraGenericResponse> {
    return safeGrpcCall(this.jiraServiceClient.disconnect(dto));
  }

  @Span()
  listJiraProjects(
    dto: ListJiraProjectsRequest,
  ): Promise<ListJiraProjectsResponse> {
    return safeGrpcCall(this.jiraServiceClient.listJiraProjects(dto));
  }

  @Span()
  setProjectJiraConfig(
    dto: SetProjectJiraConfigRequest,
  ): Promise<SetProjectJiraConfigResponse> {
    return safeGrpcCall(this.jiraServiceClient.setProjectJiraConfig(dto));
  }

  @Span()
  getProjectJiraConfig(dto: {
    organizationId: string;
    projectId: string;
  }): Promise<GetProjectJiraConfigResponse> {
    return safeGrpcCall(this.jiraServiceClient.getProjectJiraConfig(dto));
  }

  @Span()
  removeProjectJiraConfig(
    dto: RemoveProjectJiraConfigRequest,
  ): Promise<JiraGenericResponse> {
    return safeGrpcCall(this.jiraServiceClient.removeProjectJiraConfig(dto));
  }

  @Span()
  handleWebhook(dto: JiraWebhookEventRequest): Promise<JiraWebhookResponse> {
    return safeGrpcCall(this.jiraServiceClient.handleWebhook(dto));
  }

  // ========== Issue Management ==========

  @Span()
  createIssues(
    dto: CreateJiraIssuesRequest,
  ): Promise<CreateJiraIssuesResponse> {
    return safeGrpcCall(this.jiraIssueServiceClient.createIssues(dto));
  }

  @Span()
  linkExistingIssue(dto: LinkJiraIssueRequest): Promise<LinkJiraIssueResponse> {
    return safeGrpcCall(this.jiraIssueServiceClient.linkExistingIssue(dto));
  }

  @Span()
  getProjectIssues(
    dto: GetJiraProjectIssuesRequest,
  ): Promise<GetJiraProjectIssuesResponse> {
    return safeGrpcCall(this.jiraIssueServiceClient.getProjectIssues(dto));
  }

  @Span()
  getIssueStatus(
    dto: GetJiraIssueStatusRequest,
  ): Promise<GetJiraIssueStatusResponse> {
    return safeGrpcCall(this.jiraIssueServiceClient.getIssueStatus(dto));
  }
}
