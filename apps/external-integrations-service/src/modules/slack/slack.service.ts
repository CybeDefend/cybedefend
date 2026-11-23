import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import * as crypto from 'crypto';
import SecretsService from '../../core/secrets/secrets.service';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import { SlackChannelMapping } from '../../entities/slack-channel-mapping.entity';
import { SlackMessageService } from './slack-message.service';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
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

@Injectable()
export class SlackService implements OnModuleInit {
  private encryptionKey: Buffer | null = null;

  constructor(
    @InjectRepository(SlackIntegration)
    private readonly slackIntegrationRepo: Repository<SlackIntegration>,
    @InjectRepository(SlackChannelMapping)
    private readonly channelMappingRepo: Repository<SlackChannelMapping>,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly messageService: SlackMessageService,
    private readonly logger: Logger,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
  ) {}

  onModuleInit() {
    this.logger.log('SlackService initialized');
  }

  private getSecretOrEnv(key: string): string {
    const isDev = this.configService.get<string>('NODE_ENV') === 'development';
    if (isDev) {
      const envValue = this.configService.get<string>(key);
      if (envValue) return envValue;
    }
    return this.secretsService.getSecret(key);
  }

  // ========== Token Encryption (AES-256-GCM) ==========

  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) return this.encryptionKey;

    await this.secretsService.ensureCacheLoaded();
    const keyHex = this.secretsService.getSecret(
      'CONTAINER_REGISTRY_ENCRYPTION_KEY',
    );
    if (!keyHex) {
      throw new Error('Encryption key not found in secrets.');
    }
    this.encryptionKey = Buffer.from(keyHex, 'hex');
    if (this.encryptionKey.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes');
    }
    return this.encryptionKey;
  }

  private async encryptToken(token: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Store as iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private async decryptToken(encryptedData: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // ========== Slack API Helpers ==========

  private async slackApiCall(
    method: string,
    botToken: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `https://slack.com/api/${method}`;
    const options: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = (await response.json()) as Record<string, unknown>;

    if (!data.ok) {
      this.logger.error(
        { method, error: data.error },
        `Slack API error: ${data.error}`,
      );
      throw new RpcException({
        message: `Slack API error: ${data.error}`,
        code: status.INTERNAL,
      });
    }
    return data;
  }

  private async getBotTokenForOrga(organizationId: string): Promise<string> {
    const integration = await this.slackIntegrationRepo.findOne({
      where: { organizationId },
    });
    if (!integration) {
      throw new RpcException({
        message: 'Slack integration not found for this organization',
        code: status.NOT_FOUND,
      });
    }
    return await this.decryptToken(integration.accessToken);
  }

  // ========== OAuth2 Installation ==========

  @Span()
  async callbackInstall(
    request: SlackCallbackInstallRequest,
  ): Promise<SlackCallbackInstallResponse> {
    const { organizationId, userId, code, redirectUri } = request;

    const clientId = this.getSecretOrEnv('SLACK_CLIENT_ID');
    const clientSecret = this.getSecretOrEnv('SLACK_CLIENT_SECRET');

    // Exchange code for bot token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;

    if (!tokenData.ok) {
      this.logger.error(
        { error: tokenData.error },
        'Slack OAuth2 token exchange failed',
      );
      throw new RpcException({
        message: `Slack OAuth2 failed: ${tokenData.error}`,
        code: status.INVALID_ARGUMENT,
      });
    }

    const botToken = (tokenData as { access_token: string }).access_token;
    const team = tokenData.team as { id: string; name: string };

    // Encrypt the bot token before storage
    const encryptedToken = await this.encryptToken(botToken);

    // Upsert: if integration already exists for this org, update it
    let integration = await this.slackIntegrationRepo.findOne({
      where: { organizationId },
    });

    if (integration) {
      integration.accessToken = encryptedToken;
      integration.teamId = team.id;
      integration.teamName = team.name;
      integration.installedByUserId = userId;
    } else {
      integration = this.slackIntegrationRepo.create({
        organizationId,
        teamId: team.id,
        teamName: team.name,
        accessToken: encryptedToken,
        installedByUserId: userId,
      });
    }

    await this.slackIntegrationRepo.save(integration);

    this.logger.log(
      `Slack integration installed for org ${organizationId} (workspace: ${team.name})`,
    );

    return { returnUri: redirectUri };
  }

  // ========== Installation Management ==========

  @Span()
  async getInstallationForOrga(
    request: GetSlackInstallationForOrgaRequest,
  ): Promise<GetSlackInstallationForOrgaResponse> {
    const integration = await this.slackIntegrationRepo.findOne({
      where: { organizationId: request.organizationId },
    });

    // Absence of an installation is NOT an error — same rule as
    // gitlab.service.ts. The gateway's integrations overview probes all four
    // providers on every page load, so an org without Slack hits this on a
    // happy path. Throwing NOT_FOUND made all 6 spans of the chain error spans
    // (the nestjs-otel @Span decorator sets ERROR on any rejection, AND the
    // gRPC instrumentation marks any non-zero code on both client and server),
    // which is what drove the gateway error-rate alert. Proto fields are
    // non-optional, so absence travels as empty values; the gateway turns that
    // back into the HTTP 404 its clients expect.
    if (!integration) {
      return {
        isConfigured: false,
        id: '',
        teamId: '',
        teamName: '',
        organizationId: '',
        installedByUserId: '',
        createdAt: '',
        updatedAt: '',
      };
    }

    return {
      isConfigured: true,
      id: integration.id,
      teamId: integration.teamId,
      teamName: integration.teamName,
      organizationId: integration.organizationId,
      installedByUserId: integration.installedByUserId || '',
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };
  }

  @Span()
  async disconnect(
    request: DisconnectSlackRequest,
  ): Promise<SlackGenericResponse> {
    const integration = await this.slackIntegrationRepo.findOne({
      where: { organizationId: request.organizationId },
    });

    // Idempotent on purpose, same as JiraService.disconnect.
    // Disconnecting is the organization's only way to get rid of its Slack
    // integration, so a second click — or a retry after the row was already
    // swept by the org-deletion teardown — must not surface as an error.
    if (!integration) {
      this.logger.log(
        `Slack integration already disconnected for org ${request.organizationId}`,
      );
      return { success: true, message: 'Slack integration disconnected' };
    }

    // Delete all channel mappings first (cascade should handle this, but be explicit)
    await this.channelMappingRepo.delete({ integrationId: integration.id });
    await this.slackIntegrationRepo.remove(integration);

    this.logger.log(
      `Slack integration disconnected for org ${request.organizationId}`,
    );

    return { success: true, message: 'Slack integration disconnected' };
  }

  // ========== Channel Management ==========

  @Span()
  async listChannels(
    request: ListSlackChannelsRequest,
  ): Promise<ListSlackChannelsResponse> {
    const botToken = await this.getBotTokenForOrga(request.organizationId);

    const data = await this.slackApiCall('conversations.list', botToken, {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
    });

    const channels = (
      data.channels as Array<{
        id: string;
        name: string;
        is_private: boolean;
      }>
    ).map((ch) => ({
      channelId: ch.id,
      name: ch.name,
      isPrivate: ch.is_private,
    }));

    return { channels };
  }

  @Span()
  async setProjectChannel(
    request: SetProjectSlackChannelRequest,
  ): Promise<SetProjectSlackChannelResponse> {
    const integration = await this.slackIntegrationRepo.findOne({
      where: { organizationId: request.organizationId },
    });

    if (!integration) {
      throw new RpcException({
        message: 'Slack integration not found',
        code: status.NOT_FOUND,
      });
    }

    // Upsert channel mapping
    let mapping = await this.channelMappingRepo.findOne({
      where: { projectId: request.projectId },
    });

    if (mapping) {
      mapping.channelId = request.channelId;
      mapping.channelName = request.channelName;
      mapping.integrationId = integration.id;
    } else {
      mapping = this.channelMappingRepo.create({
        integrationId: integration.id,
        projectId: request.projectId,
        channelId: request.channelId,
        channelName: request.channelName,
      });
    }

    await this.channelMappingRepo.save(mapping);

    // Auto-join the channel so the bot can post messages
    const botToken = await this.decryptToken(integration.accessToken);
    try {
      await this.slackApiCall('conversations.join', botToken, {
        channel: request.channelId,
      });
    } catch (e) {
      this.logger.warn(
        `Could not auto-join channel #${request.channelName}: ${(e as Error).message}. The bot may need to be invited manually.`,
      );
    }

    return {
      success: true,
      message: `Channel #${request.channelName} linked to project`,
    };
  }

  @Span()
  async removeProjectChannel(
    request: RemoveProjectSlackChannelRequest,
  ): Promise<SlackGenericResponse> {
    const result = await this.channelMappingRepo.delete({
      projectId: request.projectId,
    });

    if (result.affected === 0) {
      throw new RpcException({
        message: 'No channel mapping found for this project',
        code: status.NOT_FOUND,
      });
    }

    return { success: true, message: 'Channel mapping removed' };
  }

  @Span()
  async getProjectChannel(
    request: GetProjectSlackChannelRequest,
  ): Promise<GetProjectSlackChannelResponse> {
    const mapping = await this.channelMappingRepo.findOne({
      where: { projectId: request.projectId },
    });

    if (!mapping) {
      return { channelId: '', channelName: '', isConfigured: false };
    }

    return {
      channelId: mapping.channelId,
      channelName: mapping.channelName,
      isConfigured: true,
    };
  }

  // ========== Notification Dispatch ==========

  @Span()
  async sendNotification(
    request: SendSlackNotificationRequest,
  ): Promise<SendSlackNotificationResponse> {
    const { projectId, notificationType, payloadJson } = request;

    // Find the channel mapping for this project
    const mapping = await this.channelMappingRepo.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!mapping) {
      return {
        success: false,
        message: 'No Slack channel configured for this project',
      };
    }

    // Gate Slack message dispatch behind the organization's writability.
    // The mapping's integration carries the organization id; if the org is
    // in read-only mode we must not push messages to Slack.
    await this.entitlements.assertWritable(mapping.integration.organizationId);

    const botToken = await this.decryptToken(mapping.integration.accessToken);
    const payload = JSON.parse(payloadJson);

    // Auto-join the channel if the bot is not already a member
    try {
      await this.slackApiCall('conversations.join', botToken, {
        channel: mapping.channelId,
      });
    } catch (e) {
      // Log but continue — for private channels, bot must be invited manually
      this.logger.warn(
        `Could not auto-join channel ${mapping.channelName}: ${(e as Error).message}`,
      );
    }

    // Build message payload (blocks + optional attachments with color)
    const messagePayload = this.messageService.buildMessage(
      notificationType,
      payload,
    );

    await this.slackApiCall('chat.postMessage', botToken, {
      channel: mapping.channelId,
      text: this.messageService.getFallbackText(notificationType, payload),
      ...(messagePayload.blocks ? { blocks: messagePayload.blocks } : {}),
      ...(messagePayload.attachments
        ? { attachments: messagePayload.attachments }
        : {}),
    });

    this.logger.log(
      `Slack notification sent: type=${notificationType} project=${projectId} channel=${mapping.channelName}`,
    );

    return { success: true, message: 'Notification sent' };
  }
}
