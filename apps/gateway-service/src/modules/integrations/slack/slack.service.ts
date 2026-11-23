import {
  SLACK_SERVICE_NAME,
  SlackServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  DisconnectSlackRequest,
  GetProjectSlackChannelRequest,
  GetProjectSlackChannelResponse,
  GetSlackInstallationForOrgaRequest,
  GetSlackInstallationForOrgaResponse,
  ListSlackChannelsRequest,
  ListSlackChannelsResponse,
  RemoveProjectSlackChannelRequest,
  SetProjectSlackChannelRequest,
  SetProjectSlackChannelResponse,
  SlackCallbackInstallRequest,
  SlackCallbackInstallResponse,
  SlackGenericResponse,
} from '@grpc/external-integrations/slack';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

@Injectable()
export class SlackService {
  private slackServiceClient!: SlackServiceClient;

  constructor(
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.slackServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<SlackServiceClient>(SLACK_SERVICE_NAME),
    );
  }

  /**
   * Handle Slack OAuth callback install
   *
   * @param callbackInstallDto Callback install request
   * @returns Callback install response
   */
  @Span()
  callbackInstall(
    callbackInstallDto: SlackCallbackInstallRequest,
  ): Promise<SlackCallbackInstallResponse> {
    return safeGrpcCall(
      this.slackServiceClient.callbackInstall(callbackInstallDto),
    );
  }

  /**
   * Get Slack installation for organization
   *
   * @param getInstallationDto Get installation request
   * @returns Get installation response
   */
  @Span()
  getInstallationForOrga(
    getInstallationDto: GetSlackInstallationForOrgaRequest,
  ): Promise<GetSlackInstallationForOrgaResponse> {
    return safeGrpcCall(
      this.slackServiceClient.getInstallationForOrga(getInstallationDto),
    );
  }

  /**
   * Disconnect Slack from organization
   *
   * @param disconnectDto Disconnect request
   * @returns Generic response
   */
  @Span()
  disconnect(
    disconnectDto: DisconnectSlackRequest,
  ): Promise<SlackGenericResponse> {
    return safeGrpcCall(this.slackServiceClient.disconnect(disconnectDto));
  }

  /**
   * List Slack channels for organization workspace
   *
   * @param listChannelsDto List channels request
   * @returns List channels response
   */
  @Span()
  listChannels(
    listChannelsDto: ListSlackChannelsRequest,
  ): Promise<ListSlackChannelsResponse> {
    return safeGrpcCall(this.slackServiceClient.listChannels(listChannelsDto));
  }

  /**
   * Set Slack channel for a project
   *
   * @param setChannelDto Set channel request
   * @returns Set channel response
   */
  @Span()
  setProjectChannel(
    setChannelDto: SetProjectSlackChannelRequest,
  ): Promise<SetProjectSlackChannelResponse> {
    return safeGrpcCall(
      this.slackServiceClient.setProjectChannel(setChannelDto),
    );
  }

  /**
   * Remove Slack channel mapping from a project
   *
   * @param removeChannelDto Remove channel request
   * @returns Generic response
   */
  @Span()
  removeProjectChannel(
    removeChannelDto: RemoveProjectSlackChannelRequest,
  ): Promise<SlackGenericResponse> {
    return safeGrpcCall(
      this.slackServiceClient.removeProjectChannel(removeChannelDto),
    );
  }

  /**
   * Get current Slack channel mapping for a project
   *
   * @param getChannelDto Get channel request
   * @returns Get channel response
   */
  @Span()
  getProjectChannel(
    getChannelDto: GetProjectSlackChannelRequest,
  ): Promise<GetProjectSlackChannelResponse> {
    return safeGrpcCall(
      this.slackServiceClient.getProjectChannel(getChannelDto),
    );
  }
}
