import { Controller } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import {
  LinearServiceController,
  LinearServiceControllerMethods,
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
import { LinearService } from './linear.service';
import { LinearWebhookService } from './linear-webhook.service';

/**
 * gRPC face of the Linear connection: the OAuth install, the
 * workspace's teams and options, the project settings and Linear's webhook.
 * No logic of its own: the services own the behaviour and the refusals (the
 * LINEAR_* codes carried by their RpcException messages).
 */
@Controller()
@LinearServiceControllerMethods()
export class LinearController implements LinearServiceController {
  constructor(
    private readonly linearService: LinearService,
    private readonly webhookService: LinearWebhookService,
  ) {}

  @Span()
  generateOAuthUrl(
    request: GenerateLinearOAuthUrlRequest,
  ): GenerateLinearOAuthUrlResponse {
    return this.linearService.generateOAuthUrl(request);
  }

  @Span()
  async callbackInstall(
    request: LinearCallbackInstallRequest,
  ): Promise<LinearCallbackInstallResponse> {
    return await this.linearService.callbackInstall(request);
  }

  @Span()
  async getInstallationForOrga(
    request: GetLinearInstallationForOrgaRequest,
  ): Promise<GetLinearInstallationForOrgaResponse> {
    return await this.linearService.getInstallationForOrga(request);
  }

  @Span()
  async disconnect(
    request: DisconnectLinearRequest,
  ): Promise<LinearGenericResponse> {
    return await this.linearService.disconnect(request);
  }

  @Span()
  async listTeams(
    request: ListLinearTeamsRequest,
  ): Promise<ListLinearTeamsResponse> {
    return await this.linearService.listTeams(request);
  }

  @Span()
  async getTeamOptions(
    request: GetLinearTeamOptionsRequest,
  ): Promise<GetLinearTeamOptionsResponse> {
    return await this.linearService.getTeamOptions(request);
  }

  @Span()
  async setProjectLinearConfig(
    request: SetProjectLinearConfigRequest,
  ): Promise<LinearGenericResponse> {
    return await this.linearService.setProjectLinearConfig(request);
  }

  @Span()
  async getProjectLinearConfig(
    request: GetProjectLinearConfigRequest,
  ): Promise<GetProjectLinearConfigResponse> {
    return await this.linearService.getProjectLinearConfig(request);
  }

  @Span()
  async removeProjectLinearConfig(
    request: RemoveProjectLinearConfigRequest,
  ): Promise<LinearGenericResponse> {
    return await this.linearService.removeProjectLinearConfig(request);
  }

  @Span()
  async handleWebhook(
    request: LinearWebhookEventRequest,
  ): Promise<LinearWebhookResponse> {
    return await this.webhookService.handleWebhook(request);
  }
}
