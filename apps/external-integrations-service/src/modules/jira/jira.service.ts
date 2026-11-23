import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import * as crypto from 'crypto';
import SecretsService from '../../core/secrets/secrets.service';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import {
  VulnerabilityIssueMapping,
  IssuePlatform,
} from '../../entities/vulnerability-issue-mapping.entity';
import {
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

/** The refusal of the Jira routes on an instance without a Jira OAuth app. */
export const JIRA_NOT_CONFIGURED = 'JIRA_NOT_CONFIGURED';

const JIRA_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const JIRA_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources';

@Injectable()
export class JiraService implements OnModuleInit {
  private encryptionKey: Buffer | null = null;

  constructor(
    @InjectRepository(JiraIntegration)
    private readonly jiraIntegrationRepo: Repository<JiraIntegration>,
    @InjectRepository(JiraProjectMapping)
    private readonly projectMappingRepo: Repository<JiraProjectMapping>,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.logger.log('JiraService initialized');
  }

  private getSecretOrEnv(key: string): string {
    const isDev = this.configService.get<string>('NODE_ENV') === 'development';
    if (isDev) {
      const envValue = this.configService.get<string>(key);
      if (envValue) return envValue;
    }
    return this.secretsService.getSecret(key);
  }

  /**
   * True when this instance has a Jira OAuth app (client id and secret).
   * Jira is optional: without it, the connect route and the public webhook
   * route answer JIRA_NOT_CONFIGURED instead of failing further down.
   */
  isConfigured(): boolean {
    return Boolean(
      this.getSecretOrEnv('JIRA_CLIENT_ID') &&
      this.getSecretOrEnv('JIRA_CLIENT_SECRET'),
    );
  }

  // ========== OAuth URL Generation ==========

  generateOAuthUrl(request: { redirectUri: string; state: string }): {
    installUrl: string;
  } {
    if (!this.isConfigured()) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: JIRA_NOT_CONFIGURED,
      });
    }
    const clientId = this.getSecretOrEnv('JIRA_CLIENT_ID');
    const scopes = [
      'read:jira-work',
      'write:jira-work',
      'read:jira-user',
      'manage:jira-webhook',
      'offline_access',
    ].join(' ');

    const installUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(request.redirectUri)}&state=${request.state}&response_type=code&prompt=consent`;

    return { installUrl };
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

  /**
   * Compute HMAC-SHA256 hash of a webhook secret using the JIRA_CLIENT_SECRET as key.
   * This prevents rainbow-table attacks (unlike plain SHA-256) and provides keyed verification.
   */
  private computeWebhookSecretHash(secret: string): string {
    const hmacKey = this.getSecretOrEnv('JIRA_CLIENT_SECRET');
    return crypto.createHmac('sha256', hmacKey).update(secret).digest('hex');
  }

  // ========== Error Sanitization ==========

  /**
   * Sanitize Jira API error data before logging to prevent exposure of
   * internal URLs, tokens, or configuration details.
   */
  private sanitizeErrorForLog(data: unknown, maxLength = 500): string {
    if (typeof data === 'string') {
      return data.substring(0, maxLength);
    }
    if (typeof data === 'object' && data !== null) {
      const safe: Record<string, unknown> = {};
      const allowedKeys = [
        'error',
        'error_description',
        'message',
        'status',
        'statusCode',
      ];
      for (const key of allowedKeys) {
        if (key in (data as Record<string, unknown>)) {
          safe[key] = String((data as Record<string, unknown>)[key]).substring(
            0,
            maxLength,
          );
        }
      }
      return JSON.stringify(safe);
    }
    return String(data).substring(0, maxLength);
  }

  private async readJsonResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  private jiraHttpStatusToGrpc(httpStatus: number): number {
    switch (httpStatus) {
      case 400:
      case 422:
        return status.INVALID_ARGUMENT;
      case 401:
        return status.UNAUTHENTICATED;
      case 403:
        return status.PERMISSION_DENIED;
      case 404:
        return status.NOT_FOUND;
      case 409:
        return status.ALREADY_EXISTS;
      case 412:
        return status.FAILED_PRECONDITION;
      case 429:
        return status.RESOURCE_EXHAUSTED;
      case 502:
      case 503:
        return status.UNAVAILABLE;
      case 504:
        return status.DEADLINE_EXCEEDED;
      default:
        return httpStatus >= 400 && httpStatus < 500
          ? status.INVALID_ARGUMENT
          : status.INTERNAL;
    }
  }

  private logJiraHttpFailure(
    httpStatus: number,
    context: string,
    metadata: Record<string, unknown>,
  ): void {
    if (httpStatus >= 500) {
      this.logger.error(metadata, context);
      return;
    }
    this.logger.warn(metadata, context);
  }

  private throwJiraHttpException(httpStatus: number, message: string): never {
    throw new RpcException({
      message,
      code: this.jiraHttpStatusToGrpc(httpStatus),
    });
  }

  // ========== Jira API Helpers ==========

  /**
   * Wraps fetch with retry logic for 5xx and 429 responses.
   * Uses exponential backoff for server errors, Retry-After header for 429.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
  ): Promise<Response> {
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, options);

      if (
        response.ok ||
        response.status === 204 ||
        response.status === 202 ||
        (response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429)
      ) {
        return response;
      }

      lastResponse = response;

      if (attempt < maxRetries) {
        let delayMs: number;
        if (response.status === 429) {
          const retryAfter = parseInt(
            response.headers?.get?.('retry-after') || '',
            10,
          );
          delayMs = Math.min(
            (Number.isNaN(retryAfter) ? 1 : retryAfter) * 1000,
            60_000,
          );
        } else {
          delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        }
        this.logger.warn(
          `Jira API returned ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return lastResponse!;
  }

  private static readonly TOKEN_EXPIRY_BUFFER_MS = 300_000; // 5 minutes

  /**
   * Ensures the access token is valid, refreshing if expired.
   * Returns the decrypted access token.
   * Uses pessimistic locking to prevent concurrent refresh races.
   */
  async getValidAccessToken(integration: JiraIntegration): Promise<string> {
    // Fast path: token is still valid with buffer
    if (
      integration.tokenExpiresAt &&
      integration.tokenExpiresAt.getTime() >
        Date.now() + JiraService.TOKEN_EXPIRY_BUFFER_MS
    ) {
      return await this.decryptToken(integration.accessToken);
    }

    // Acquire row-level lock to prevent concurrent refreshes
    return await this.jiraIntegrationRepo.manager.transaction(
      async (entityManager) => {
        const locked = await entityManager.findOne(JiraIntegration, {
          where: { id: integration.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!locked) {
          throw new RpcException({
            message: 'Jira integration not found',
            code: status.NOT_FOUND,
          });
        }

        // Double-check: another thread may have refreshed already
        if (
          locked.tokenExpiresAt &&
          locked.tokenExpiresAt.getTime() >
            Date.now() + JiraService.TOKEN_EXPIRY_BUFFER_MS
        ) {
          return await this.decryptToken(locked.accessToken);
        }

        return await this.refreshAccessToken(locked, entityManager);
      },
    );
  }

  private async refreshAccessToken(
    integration: JiraIntegration,
    entityManager?: import('typeorm').EntityManager,
  ): Promise<string> {
    if (!integration.refreshToken) {
      throw new RpcException({
        message: 'No refresh token available. Please reconnect Jira.',
        code: status.UNAUTHENTICATED,
      });
    }

    const clientId = this.getSecretOrEnv('JIRA_CLIENT_ID');
    const clientSecret = this.getSecretOrEnv('JIRA_CLIENT_SECRET');
    const refreshToken = await this.decryptToken(integration.refreshToken);

    const response = await fetch(JIRA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    const responseData = await this.readJsonResponse(response);
    const data =
      responseData &&
      typeof responseData === 'object' &&
      !Array.isArray(responseData)
        ? (responseData as Record<string, unknown>)
        : {};

    if (!response.ok) {
      this.logJiraHttpFailure(response.status, 'Jira token refresh failed', {
        error: this.sanitizeErrorForLog(data),
      });

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        throw new RpcException({
          message: 'Jira token refresh failed. Please reconnect Jira.',
          code: status.UNAUTHENTICATED,
        });
      }

      this.throwJiraHttpException(response.status, 'Jira token refresh failed');
    }

    if (typeof data.access_token !== 'string' || !data.access_token) {
      this.logger.error(
        { response: this.sanitizeErrorForLog(data) },
        'Jira token refresh response is missing access_token',
      );
      throw new RpcException({
        message: 'Jira token refresh returned an invalid response',
        code: status.INTERNAL,
      });
    }

    const newAccessToken = data.access_token as string;
    const newRefreshToken = (data.refresh_token as string) || refreshToken;
    const expiresIn = (data.expires_in as number) || 3600;

    // Update stored tokens
    integration.accessToken = await this.encryptToken(newAccessToken);
    integration.refreshToken = await this.encryptToken(newRefreshToken);
    integration.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const repo = entityManager
      ? entityManager.getRepository(JiraIntegration)
      : this.jiraIntegrationRepo;
    await repo.save(integration);

    return newAccessToken;
  }

  /**
   * Generic Jira REST API call with automatic token refresh on 401.
   */
  async jiraApiCall(
    integration: JiraIntegration,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.getValidAccessToken(integration);
    const url = `https://api.atlassian.com/ex/jira/${integration.cloudId}/rest/api/3${path}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await this.fetchWithRetry(url, options);

    // Retry once on 401 with refreshed token
    if (response.status === 401) {
      const newToken = await this.refreshAccessToken(integration);
      const retryOptions: RequestInit = {
        ...options,
        headers: {
          Authorization: `Bearer ${newToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };
      const retryResponse = await this.fetchWithRetry(url, retryOptions);
      if (!retryResponse.ok) {
        const errorData = await retryResponse.text();
        this.logJiraHttpFailure(
          retryResponse.status,
          'Jira API error after token refresh',
          {
            method,
            path,
            status: retryResponse.status,
            error: this.sanitizeErrorForLog(errorData),
          },
        );
        this.throwJiraHttpException(
          retryResponse.status,
          `Jira API error: ${retryResponse.status}`,
        );
      }
      if (retryResponse.status === 204 || retryResponse.status === 202) {
        return { success: true };
      }
      return (await retryResponse.json()) as Record<string, unknown>;
    }

    if (!response.ok) {
      const errorData = await response.text();
      this.logJiraHttpFailure(response.status, 'Jira API error', {
        method,
        path,
        status: response.status,
        error: this.sanitizeErrorForLog(errorData),
      });
      this.throwJiraHttpException(
        response.status,
        `Jira API error: ${response.status}`,
      );
    }

    // Some Jira endpoints return 204 No Content or 202 Accepted with empty body
    if (response.status === 204 || response.status === 202) {
      return { success: true };
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Generic Jira Dev Status API call with automatic token refresh on 401.
   * Uses a different base URL than the standard REST API.
   */
  async jiraDevStatusCall(
    integration: JiraIntegration,
    method: string,
    path: string,
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.getValidAccessToken(integration);
    const url = `https://api.atlassian.com/ex/jira/${integration.cloudId}/rest/dev-status/latest${path}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    const response = await this.fetchWithRetry(url, options);

    // Retry once on 401 with refreshed token
    if (response.status === 401) {
      const newToken = await this.refreshAccessToken(integration);
      const retryOptions: RequestInit = {
        ...options,
        headers: {
          Authorization: `Bearer ${newToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };
      const retryResponse = await this.fetchWithRetry(url, retryOptions);
      if (!retryResponse.ok) {
        const errorData = await retryResponse.text();
        this.logJiraHttpFailure(
          retryResponse.status,
          'Jira Dev Status API error after token refresh',
          {
            method,
            path,
            status: retryResponse.status,
            error: this.sanitizeErrorForLog(errorData),
          },
        );
        this.throwJiraHttpException(
          retryResponse.status,
          `Jira Dev Status API error: ${retryResponse.status}`,
        );
      }
      return (await retryResponse.json()) as Record<string, unknown>;
    }

    if (!response.ok) {
      const errorData = await response.text();
      this.logJiraHttpFailure(response.status, 'Jira Dev Status API error', {
        method,
        path,
        status: response.status,
        error: this.sanitizeErrorForLog(errorData),
      });
      this.throwJiraHttpException(
        response.status,
        `Jira Dev Status API error: ${response.status}`,
      );
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return { success: true };
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Finds the integration for an org, throwing if not found.
   */
  async getIntegrationForOrga(
    organizationId: string,
  ): Promise<JiraIntegration> {
    const integration = await this.jiraIntegrationRepo.findOne({
      where: { organizationId },
    });
    if (!integration) {
      throw new RpcException({
        message: 'Jira integration not found for this organization',
        code: status.NOT_FOUND,
      });
    }
    return integration;
  }

  // ========== OAuth2 Installation ==========

  @Span()
  async callbackInstall(
    request: JiraCallbackInstallRequest,
  ): Promise<JiraCallbackInstallResponse> {
    const { organizationId, userId, code, redirectUri } = request;

    const clientId = this.getSecretOrEnv('JIRA_CLIENT_ID');
    const clientSecret = this.getSecretOrEnv('JIRA_CLIENT_SECRET');

    // Exchange code for tokens
    const tokenResponse = await fetch(JIRA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const rawTokenData = await this.readJsonResponse(tokenResponse);
    const tokenData =
      rawTokenData &&
      typeof rawTokenData === 'object' &&
      !Array.isArray(rawTokenData)
        ? (rawTokenData as Record<string, unknown>)
        : {};

    if (!tokenResponse.ok) {
      this.logJiraHttpFailure(
        tokenResponse.status,
        'Jira OAuth2 token exchange failed',
        { error: this.sanitizeErrorForLog(tokenData) },
      );
      this.throwJiraHttpException(
        tokenResponse.status,
        `Jira OAuth2 failed: ${tokenData.error || tokenData.error_description || 'Unknown error'}`,
      );
    }

    if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
      this.logger.error(
        { response: this.sanitizeErrorForLog(tokenData) },
        'Jira OAuth2 token response is missing access_token',
      );
      throw new RpcException({
        message: 'Jira OAuth2 returned an invalid response',
        code: status.INTERNAL,
      });
    }

    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string;
    const expiresIn = (tokenData.expires_in as number) || 3600;

    // Get accessible resources to find cloudId and site info
    const resourcesResponse = await fetch(JIRA_RESOURCES_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const resourcesData = await this.readJsonResponse(resourcesResponse);

    if (!resourcesResponse.ok) {
      this.logJiraHttpFailure(
        resourcesResponse.status,
        'Jira accessible resources request failed',
        { error: this.sanitizeErrorForLog(resourcesData) },
      );
      this.throwJiraHttpException(
        resourcesResponse.status,
        `Jira accessible resources request failed: ${resourcesResponse.status}`,
      );
    }

    const resources = resourcesData as Array<{
      id: string;
      name: string;
      url: string;
    }>;

    if (!Array.isArray(resources) || resources.length === 0) {
      throw new RpcException({
        message:
          'No Jira Cloud sites accessible with this account. Please ensure you have access to at least one Jira site.',
        code: status.INVALID_ARGUMENT,
      });
    }

    // Use the first accessible site (most common case)
    const site = resources[0];
    const encryptedAccessToken = await this.encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken
      ? await this.encryptToken(refreshToken)
      : null;

    // Upsert: if integration already exists for this org, update it
    let integration = await this.jiraIntegrationRepo.findOne({
      where: { organizationId },
    });

    if (integration) {
      integration.accessToken = encryptedAccessToken;
      integration.refreshToken = encryptedRefreshToken;
      integration.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      integration.cloudId = site.id;
      integration.siteName = site.name;
      integration.siteUrl = site.url;
      integration.installedByUserId = userId;
    } else {
      integration = this.jiraIntegrationRepo.create({
        organizationId,
        cloudId: site.id,
        siteName: site.name,
        siteUrl: site.url,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        installedByUserId: userId,
      });
    }

    await this.jiraIntegrationRepo.save(integration);

    this.logger.log(
      `Jira integration installed for org ${organizationId} (site: ${site.name})`,
    );

    // Register webhook for real-time updates (fire-and-forget)
    this.registerWebhook(integration).catch((err) => {
      this.logger.warn(
        `Failed to register Jira webhook for org ${organizationId}: ${err.message}`,
      );
    });

    return { returnUri: redirectUri };
  }

  /**
   * Register a Jira webhook to receive issue updates in real-time.
   * Uses Jira REST API webhooks endpoint with the public GATEWAY_URL.
   */
  private async registerWebhook(integration: JiraIntegration): Promise<void> {
    const gatewayUrl =
      this.configService.get<string>('GATEWAY_URL') || 'http://localhost:3000';
    this.logger.log(`Registering Jira webhook with gateway URL: ${gatewayUrl}`);

    // Generate a random secret for authenticating webhook callbacks
    // Store as HMAC-SHA256 hash (keyed by JIRA_CLIENT_SECRET), send plain secret in URL path
    const secret = crypto.randomBytes(32).toString('hex');
    const secretHash = this.computeWebhookSecretHash(secret);
    integration.webhookSecret = secretHash;
    await this.jiraIntegrationRepo.save(integration);

    const webhookUrl = `${gatewayUrl}/webhooks/jira/${secret}`;
    const accessToken = await this.getValidAccessToken(integration);
    // Use the Jira Cloud Platform dynamic webhooks API (requires manage:jira-webhook scope)
    const baseUrl = `https://api.atlassian.com/ex/jira/${integration.cloudId}/rest/api/3/webhook`;

    // Delete existing webhooks registered by our OAuth app
    try {
      const listRes = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      if (listRes.ok) {
        const data = (await listRes.json()) as {
          values?: { id: number }[];
        };
        const webhookIds = (data.values || []).map((w) => w.id);
        this.logger.log(`Found ${webhookIds.length} existing webhooks`);
        if (webhookIds.length > 0) {
          await fetch(baseUrl, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ webhookIds }),
          });
          this.logger.log(`Deleted ${webhookIds.length} old webhooks`);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not clean up old webhooks: ${(err as Error).message}`,
      );
    }

    // Fetch all Jira project keys to build a catch-all JQL filter
    // (dynamic webhooks API requires a non-empty, valid JQL expression)
    let jqlFilter: string;
    try {
      const projectData = await this.jiraApiCall(
        integration,
        'GET',
        '/project/search?maxResults=100',
      );
      const projectKeys = (
        (projectData.values || []) as Array<{ key: string }>
      ).map((p) => p.key);
      if (projectKeys.length > 0) {
        jqlFilter = `project IN (${projectKeys.join(', ')})`;
      } else {
        this.logger.warn(
          'No Jira projects found — cannot build JQL filter for webhook',
        );
        return;
      }
    } catch (err) {
      this.logger.warn(
        `Could not fetch Jira projects for webhook JQL: ${(err as Error).message}`,
      );
      return;
    }

    // Register new webhook using the dynamic webhooks API
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          webhooks: [
            {
              events: ['jira:issue_updated', 'jira:issue_deleted'],
              jqlFilter,
            },
          ],
          url: webhookUrl,
        }),
      });
      const body = await res.text();
      if (res.ok) {
        this.logger.log(
          `Jira webhook registered: ${gatewayUrl}/webhooks/jira — response: ${body}`,
        );
        // Store the webhook ID for future refresh calls
        try {
          const result = JSON.parse(body) as {
            webhookRegistrationResult?: Array<{
              createdWebhookId?: number;
              errors?: string[];
            }>;
          };
          const webhookResult = result.webhookRegistrationResult?.[0];
          if (webhookResult?.createdWebhookId) {
            integration.webhookId = webhookResult.createdWebhookId;
            await this.jiraIntegrationRepo.save(integration);
            this.logger.log(
              `Stored Jira webhook ID: ${webhookResult.createdWebhookId}`,
            );
          } else if (webhookResult?.errors?.length) {
            this.logger.warn(
              `Jira webhook registration errors: ${webhookResult.errors.join(', ')}`,
            );
          }
        } catch {
          // Non-critical — webhook was registered, just couldn't parse ID
        }
      } else {
        this.logger.warn(
          `Jira webhook registration failed (${res.status}): ${this.sanitizeErrorForLog(body)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not register Jira webhook: ${(err as Error).message}`,
      );
    }
  }

  // ========== Webhook Refresh ==========

  /**
   * Refresh all dynamic webhooks across all Jira integrations.
   * Called periodically to prevent 30-day expiration.
   */
  async refreshAllWebhooks(): Promise<void> {
    const integrations = await this.jiraIntegrationRepo.find();
    const withWebhook = integrations.filter((i) => i.webhookId != null);
    if (withWebhook.length === 0) return;

    this.logger.log(`Refreshing ${withWebhook.length} Jira webhook(s)...`);

    for (const integration of withWebhook) {
      try {
        await this.refreshWebhook(integration);
      } catch (err) {
        this.logger.warn(
          `Failed to refresh Jira webhook for org ${integration.organizationId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Extend the life of a single dynamic webhook via PUT /rest/api/3/webhook/refresh.
   */
  private async refreshWebhook(integration: JiraIntegration): Promise<void> {
    const accessToken = await this.getValidAccessToken(integration);
    const url = `https://api.atlassian.com/ex/jira/${integration.cloudId}/rest/api/3/webhook/refresh`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ webhookIds: [integration.webhookId] }),
    });

    if (res.ok) {
      this.logger.log(
        `Refreshed Jira webhook ${integration.webhookId} for org ${integration.organizationId}`,
      );
    } else {
      const body = await res.text();
      this.logger.warn(
        `Jira webhook refresh failed (${res.status}): ${this.sanitizeErrorForLog(body)}`,
      );
    }
  }

  // ========== Installation Management ==========

  @Span()
  async getInstallationForOrga(
    request: GetJiraInstallationForOrgaRequest,
  ): Promise<GetJiraInstallationForOrgaResponse> {
    const integration = await this.jiraIntegrationRepo.findOne({
      where: { organizationId: request.organizationId },
    });

    // Absence is not an error — see slack.service.ts.getInstallationForOrga for
    // the full rationale, and gitlab.service.ts for the original precedent.
    // NOTE: the private getIntegrationForOrga helper below keeps throwing on
    // purpose — its callers (listJiraProjects, setProjectJiraConfig) genuinely
    // cannot proceed without an installation, whereas this method is a
    // presence probe.
    if (!integration) {
      return {
        isConfigured: false,
        id: '',
        cloudId: '',
        siteName: '',
        siteUrl: '',
        organizationId: '',
        installedByUserId: '',
        createdAt: '',
        updatedAt: '',
      };
    }

    return {
      isConfigured: true,
      id: integration.id,
      cloudId: integration.cloudId,
      siteName: integration.siteName,
      siteUrl: integration.siteUrl,
      organizationId: integration.organizationId,
      installedByUserId: integration.installedByUserId || '',
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };
  }

  @Span()
  async disconnect(
    request: DisconnectJiraRequest,
  ): Promise<JiraGenericResponse> {
    const integration = await this.jiraIntegrationRepo.findOne({
      where: { organizationId: request.organizationId },
    });

    // Idempotent on purpose. Disconnecting is the organization's only
    // way to get rid of its Jira integration, so a second click — or a retry
    // after the row was already swept by the org-deletion teardown — must not
    // surface as an error.
    if (!integration) {
      this.logger.log(
        `Jira integration already disconnected for org ${request.organizationId}`,
      );
      return { success: true, message: 'Jira integration disconnected' };
    }

    // Clean up Jira vulnerability-issue mappings for all projects in this org
    const projectMappings = await this.projectMappingRepo.find({
      where: { integrationId: integration.id },
      select: ['projectId'],
    });
    if (projectMappings.length > 0) {
      const vulnMappingRepo = this.jiraIntegrationRepo.manager.getRepository(
        VulnerabilityIssueMapping,
      );
      for (const pm of projectMappings) {
        await vulnMappingRepo.delete({
          projectId: pm.projectId,
          platform: IssuePlatform.JIRA,
        });
      }
    }

    // Delete all project mappings (cascade should handle this, but be explicit)
    await this.projectMappingRepo.delete({ integrationId: integration.id });
    await this.jiraIntegrationRepo.remove(integration);

    this.logger.log(
      `Jira integration disconnected for org ${request.organizationId}`,
    );

    return { success: true, message: 'Jira integration disconnected' };
  }

  // ========== Jira Project Listing ==========

  @Span()
  async listJiraProjects(
    request: ListJiraProjectsRequest,
  ): Promise<ListJiraProjectsResponse> {
    const integration = await this.getIntegrationForOrga(
      request.organizationId,
    );

    const data = await this.jiraApiCall(
      integration,
      'GET',
      '/project/search?maxResults=100&orderBy=name',
    );

    const values = (data.values || []) as Array<{
      id: string;
      key: string;
      name: string;
      avatarUrls?: { '48x48'?: string };
    }>;

    const projects = values.map((p) => ({
      projectId: p.id,
      key: p.key,
      name: p.name,
      avatarUrl: p.avatarUrls?.['48x48'] || '',
    }));

    return { projects };
  }

  // ========== Per-Project Jira Config ==========

  @Span()
  async setProjectJiraConfig(
    request: SetProjectJiraConfigRequest,
  ): Promise<SetProjectJiraConfigResponse> {
    const integration = await this.getIntegrationForOrga(
      request.organizationId,
    );

    // Upsert project mapping
    let mapping = await this.projectMappingRepo.findOne({
      where: { projectId: request.projectId },
    });

    const allowedBranches =
      request.allowedBranches && request.allowedBranches.length > 0
        ? JSON.stringify(request.allowedBranches)
        : null;

    if (mapping) {
      mapping.jiraProjectId = request.jiraProjectId;
      mapping.jiraProjectKey = request.jiraProjectKey;
      mapping.jiraProjectName = request.jiraProjectName;
      mapping.allowedBranches = allowedBranches;
      mapping.autoCreateEnabled = request.autoCreateEnabled ?? false;
      mapping.integrationId = integration.id;
    } else {
      mapping = this.projectMappingRepo.create({
        integrationId: integration.id,
        projectId: request.projectId,
        jiraProjectId: request.jiraProjectId,
        jiraProjectKey: request.jiraProjectKey,
        jiraProjectName: request.jiraProjectName,
        allowedBranches,
        autoCreateEnabled: request.autoCreateEnabled ?? false,
      });
    }

    await this.projectMappingRepo.save(mapping);

    return {
      success: true,
      message: `Jira project ${request.jiraProjectKey} linked to CybeDefend project`,
    };
  }

  @Span()
  async getProjectJiraConfig(
    request: GetProjectJiraConfigRequest,
  ): Promise<GetProjectJiraConfigResponse> {
    const mapping = await this.projectMappingRepo.findOne({
      where: { projectId: request.projectId },
      relations: ['integration'],
    });

    if (!mapping) {
      return {
        jiraProjectId: '',
        jiraProjectKey: '',
        jiraProjectName: '',
        allowedBranches: [],
        isConfigured: false,
        autoCreateEnabled: false,
      };
    }

    // Verify organization ownership
    if (
      request.organizationId &&
      mapping.integration?.organizationId !== request.organizationId
    ) {
      return {
        jiraProjectId: '',
        jiraProjectKey: '',
        jiraProjectName: '',
        allowedBranches: [],
        isConfigured: false,
        autoCreateEnabled: false,
      };
    }

    let allowedBranches: string[] = [];
    if (mapping.allowedBranches) {
      try {
        allowedBranches = JSON.parse(mapping.allowedBranches);
      } catch {
        allowedBranches = [];
      }
    }

    return {
      jiraProjectId: mapping.jiraProjectId,
      jiraProjectKey: mapping.jiraProjectKey,
      jiraProjectName: mapping.jiraProjectName,
      allowedBranches,
      isConfigured: true,
      autoCreateEnabled: !!mapping.autoCreateEnabled,
    };
  }

  @Span()
  async removeProjectJiraConfig(
    request: RemoveProjectJiraConfigRequest,
  ): Promise<JiraGenericResponse> {
    const mapping = await this.projectMappingRepo.findOne({
      where: { projectId: request.projectId },
      relations: ['integration'],
    });

    if (!mapping) {
      throw new RpcException({
        message: 'No Jira config found for this project',
        code: status.NOT_FOUND,
      });
    }

    if (mapping.integration?.organizationId !== request.organizationId) {
      throw new RpcException({
        message: 'Permission denied',
        code: status.PERMISSION_DENIED,
      });
    }

    await this.projectMappingRepo.remove(mapping);

    return { success: true, message: 'Jira project config removed' };
  }

  // ========== Webhook Handling ==========

  @Span()
  async handleWebhook(
    request: JiraWebhookEventRequest,
  ): Promise<JiraWebhookResponse> {
    // The webhook route is public: on an instance without Jira, no delivery
    // can be genuine, and the secret hash needs the client secret as its key.
    if (!this.isConfigured()) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: JIRA_NOT_CONFIGURED,
      });
    }

    if (!request.secret) {
      this.logger.warn('Jira webhook received without token — rejecting');
      return { success: false, message: 'Unauthorized' };
    }

    // Try HMAC-SHA256 first (new format)
    const hmacHash = this.computeWebhookSecretHash(request.secret);
    let integration = await this.jiraIntegrationRepo.findOne({
      where: { webhookSecret: hmacHash },
    });

    if (!integration) {
      // Backward compatibility: try plain SHA-256 for old webhooks
      const legacyHash = crypto
        .createHash('sha256')
        .update(request.secret)
        .digest('hex');
      integration = await this.jiraIntegrationRepo.findOne({
        where: { webhookSecret: legacyHash },
      });
    }

    if (!integration) {
      this.logger.warn('Jira webhook received with invalid token — rejecting');
      return { success: false, message: 'Unauthorized' };
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(request.rawBody) as Record<string, unknown>;
    } catch {
      return { success: false, message: 'Invalid JSON' };
    }

    const webhookEvent = event.webhookEvent as string;
    this.logger.log(`Jira webhook received: ${webhookEvent}`);

    if (
      webhookEvent === 'jira:issue_updated' ||
      webhookEvent === 'jira:issue_deleted'
    ) {
      await this.processIssueWebhook(event, webhookEvent, integration);
    }

    return { success: true, message: 'Webhook processed' };
  }

  /**
   * Process a Jira issue webhook event.
   * Updates VulnerabilityIssueMapping with fresh status, assignee, priority, project key.
   */
  private async processIssueWebhook(
    event: Record<string, unknown>,
    webhookEvent: string,
    integration: JiraIntegration,
  ): Promise<void> {
    const issue = event.issue as Record<string, unknown> | undefined;
    if (!issue) return;

    const issueKey = issue.key as string;
    const fields = issue.fields as Record<string, unknown> | undefined;
    if (!issueKey || !fields) return;

    const statusObj = fields.status as Record<string, unknown> | undefined;
    const priorityObj = fields.priority as Record<string, unknown> | undefined;
    const assigneeObj = fields.assignee as
      | Record<string, unknown>
      | null
      | undefined;
    const projectObj = fields.project as Record<string, unknown> | undefined;

    const statusName = (statusObj?.name as string) || '';
    const priorityName = (priorityObj?.name as string) || '';
    const assigneeName = (assigneeObj?.displayName as string) || '';
    const projectKey = (projectObj?.key as string) || '';

    // Detect if ticket was moved between projects (key changed)
    const changelog = event.changelog as Record<string, unknown> | undefined;
    let oldKey: string | null = null;
    if (changelog) {
      const items = (changelog.items || []) as Array<{
        field?: string;
        fromString?: string;
        toString?: string;
      }>;
      const keyChange = items.find((item) => item.field === 'Key');
      if (keyChange?.fromString) {
        oldKey = keyChange.fromString;
        this.logger.log(`Jira ticket moved: ${oldKey} → ${issueKey}`);
      }
    }

    this.logger.log(
      `Processing Jira webhook for ${issueKey}: status=${statusName}, assignee=${assigneeName || 'unassigned'}, priority=${priorityName}, project=${projectKey}`,
    );

    // Build update payload
    const updateData: Record<string, string> = {};
    if (webhookEvent === 'jira:issue_deleted') {
      updateData.issueState = 'deleted';
    } else {
      if (statusName) updateData.issueState = statusName.toLowerCase();
      if (priorityName) updateData.jiraPriority = priorityName;
      updateData.jiraAssignee = assigneeName;
      if (projectKey) updateData.jiraProjectKey = projectKey;
    }

    if (Object.keys(updateData).length === 0 && !oldKey) return;

    // Tenant isolation: a Jira issue key (e.g. "SEC-123") is only unique within
    // a single Jira site, so it can collide across tenants. Scope every mapping
    // update to the CybeDefend projects owned by the integration that this
    // webhook token resolved to, otherwise a low-privilege tenant could overwrite
    // another tenant's mappings by reusing the same key from their own Jira.
    const projectMappings = await this.projectMappingRepo.find({
      where: { integrationId: integration.id },
      select: ['projectId'],
    });
    const projectIds = projectMappings.map((m) => m.projectId);
    if (projectIds.length === 0) {
      this.logger.log(
        `No CybeDefend projects mapped to Jira integration ${integration.id}; skipping webhook update for ${issueKey}`,
      );
      return;
    }

    // Wrap both operations in a single transaction
    await this.jiraIntegrationRepo.manager.transaction(
      async (entityManager) => {
        const repo = entityManager.getRepository(VulnerabilityIssueMapping);

        // If ticket was moved, update the old key to the new key first
        if (oldKey) {
          const moveResult = await repo.update(
            {
              projectId: In(projectIds),
              externalIssueId: oldKey,
              platform: IssuePlatform.JIRA,
            },
            {
              externalIssueId: issueKey,
              issueUrl: `${integration.siteUrl}/browse/${issueKey}`,
            },
          );

          if (moveResult.affected && moveResult.affected > 0) {
            this.logger.log(
              `Moved ${moveResult.affected} mapping(s) from ${oldKey} to ${issueKey}`,
            );
          }
        }

        // Update all mappings for this Jira issue key (new key after move)
        if (Object.keys(updateData).length > 0) {
          const result = await repo.update(
            {
              projectId: In(projectIds),
              externalIssueId: issueKey,
              platform: IssuePlatform.JIRA,
            },
            updateData,
          );

          this.logger.log(
            `Updated ${result.affected || 0} mapping(s) for Jira issue ${issueKey}`,
          );
        }
      },
    );
  }
}
