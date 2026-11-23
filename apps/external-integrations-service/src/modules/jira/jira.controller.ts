import { Controller } from '@nestjs/common';
import { JiraService } from './jira.service';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  JiraServiceController,
  JiraServiceControllerMethods,
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
  RemoveProjectJiraConfigRequest,
  GetProjectJiraConfigRequest,
  GetProjectJiraConfigResponse,
  JiraWebhookEventRequest,
  JiraWebhookResponse,
} from '@grpc/external-integrations/jira';

@Controller()
@JiraServiceControllerMethods()
export class JiraController implements JiraServiceController {
  constructor(
    private readonly jiraService: JiraService,
    private readonly logger: Logger,
  ) {}

  @Span()
  async generateOAuthUrl(
    request: GenerateJiraOAuthUrlRequest,
  ): Promise<GenerateJiraOAuthUrlResponse> {
    return this.jiraService.generateOAuthUrl(request);
  }

  @Span()
  async callbackInstall(
    request: JiraCallbackInstallRequest,
  ): Promise<JiraCallbackInstallResponse> {
    return await this.jiraService.callbackInstall(request);
  }

  @Span()
  async getInstallationForOrga(
    request: GetJiraInstallationForOrgaRequest,
  ): Promise<GetJiraInstallationForOrgaResponse> {
    return await this.jiraService.getInstallationForOrga(request);
  }

  @Span()
  async disconnect(
    request: DisconnectJiraRequest,
  ): Promise<JiraGenericResponse> {
    return await this.jiraService.disconnect(request);
  }

  @Span()
  async listJiraProjects(
    request: ListJiraProjectsRequest,
  ): Promise<ListJiraProjectsResponse> {
    return await this.jiraService.listJiraProjects(request);
  }

  @Span()
  async setProjectJiraConfig(
    request: SetProjectJiraConfigRequest,
  ): Promise<SetProjectJiraConfigResponse> {
    return await this.jiraService.setProjectJiraConfig(request);
  }

  @Span()
  async getProjectJiraConfig(
    request: GetProjectJiraConfigRequest,
  ): Promise<GetProjectJiraConfigResponse> {
    return await this.jiraService.getProjectJiraConfig(request);
  }

  @Span()
  async removeProjectJiraConfig(
    request: RemoveProjectJiraConfigRequest,
  ): Promise<JiraGenericResponse> {
    return await this.jiraService.removeProjectJiraConfig(request);
  }

  @Span()
  async handleWebhook(
    request: JiraWebhookEventRequest,
  ): Promise<JiraWebhookResponse> {
    return await this.jiraService.handleWebhook(request);
  }
}
