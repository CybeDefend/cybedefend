import { Controller } from '@nestjs/common';
import { SlackService } from './slack.service';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  SlackServiceController,
  SlackServiceControllerMethods,
} from '@grpc/external-integrations/external_integrations';
import {
  SlackCallbackInstallRequest,
  SlackCallbackInstallResponse,
  GetSlackInstallationForOrgaRequest,
  GetSlackInstallationForOrgaResponse,
  DisconnectSlackRequest,
  SlackGenericResponse,
  ListSlackChannelsRequest,
  ListSlackChannelsResponse,
  SetProjectSlackChannelRequest,
  SetProjectSlackChannelResponse,
  RemoveProjectSlackChannelRequest,
  GetProjectSlackChannelRequest,
  GetProjectSlackChannelResponse,
  SendSlackNotificationRequest,
  SendSlackNotificationResponse,
} from '@grpc/external-integrations/slack';

@Controller()
@SlackServiceControllerMethods()
export class SlackController implements SlackServiceController {
  constructor(
    private readonly slackService: SlackService,
    private readonly logger: Logger,
  ) {}

  @Span()
  async callbackInstall(
    request: SlackCallbackInstallRequest,
  ): Promise<SlackCallbackInstallResponse> {
    return await this.slackService.callbackInstall(request);
  }

  @Span()
  async getInstallationForOrga(
    request: GetSlackInstallationForOrgaRequest,
  ): Promise<GetSlackInstallationForOrgaResponse> {
    return await this.slackService.getInstallationForOrga(request);
  }

  @Span()
  async disconnect(
    request: DisconnectSlackRequest,
  ): Promise<SlackGenericResponse> {
    return await this.slackService.disconnect(request);
  }

  @Span()
  async listChannels(
    request: ListSlackChannelsRequest,
  ): Promise<ListSlackChannelsResponse> {
    return await this.slackService.listChannels(request);
  }

  @Span()
  async setProjectChannel(
    request: SetProjectSlackChannelRequest,
  ): Promise<SetProjectSlackChannelResponse> {
    return await this.slackService.setProjectChannel(request);
  }

  @Span()
  async removeProjectChannel(
    request: RemoveProjectSlackChannelRequest,
  ): Promise<SlackGenericResponse> {
    return await this.slackService.removeProjectChannel(request);
  }

  @Span()
  async getProjectChannel(
    request: GetProjectSlackChannelRequest,
  ): Promise<GetProjectSlackChannelResponse> {
    return await this.slackService.getProjectChannel(request);
  }

  @Span()
  async sendNotification(
    request: SendSlackNotificationRequest,
  ): Promise<SendSlackNotificationResponse> {
    return await this.slackService.sendNotification(request);
  }
}
