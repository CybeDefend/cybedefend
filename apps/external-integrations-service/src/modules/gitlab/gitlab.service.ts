import { Injectable, Logger, Inject } from '@nestjs/common';
import { ilike } from '@cybedefend/db-dialect';
import { RepositoryScanOptions } from '../../core/products/repository-link-product';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, IsNull, Not } from 'typeorm';
import { Span } from 'nestjs-otel';
import * as crypto from 'node:crypto';
import { status } from '@grpc/grpc-js';
import axios, { AxiosResponse } from 'axios';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import SecretsService from '../../core/secrets/secrets.service';
import { flagReconnectRequired, isRevokedGrant } from './gitlab-reconnect';
import { gitlabUrls, GitlabUrls } from './gitlab-urls';
import { publicAppUrl } from '../../core/config/public-app-url';
import {
  DisconnectGitlabResponse,
  GetGitlabInstallationForOrgaResponse,
  GitlabCallbackInstallRequest,
  GitlabCallbackInstallResponse,
  GetGitlabRepositoriesResponse,
  GitlabRepositoryDto,
  LinkGitlabRepositoryRequest,
  UnlinkGitlabRepositoryRequest,
  GitlabLinkRepositoryResponse,
  StartGitlabScanRequest,
  StartGitlabScanResponse,
  GitlabWebhookEventRequest,
  GitlabWebhookResponse,
  GetGitlabBranchesRequest,
  GetGitlabBranchesResponse,
  GitlabBranchDto,
  GetGitlabRepositoryBranchesPaginatedRequest,
  GetGitlabRepositoryBranchesPaginatedResponse,
} from '@grpc/external-integrations/gitlab';
import Redis from 'ioredis';
import { RpcException } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { v6 as uuidv6 } from 'uuid';
import { isGrpcClientError, safeGrpcCall } from '@grpc/wrapper-grpc.module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import {
  projectSettingsRequest,
  pushProjectSettings,
  PushProjectSettings,
  repositoryScanTypes,
} from '../../core/utils/project-settings.utils';
import { webhookIgnoredLabel } from '../../core/products/push-scan-product';
import { downloadArchiveWithRetry } from '../../core/utils/retry-download';
import {
  deleteStaleBranches,
  upsertBranches,
} from '../../core/utils/branch-upsert.util';
import { isCommitSha } from '../../core/utils/commit-sha.util';
import { ScanEnqueueFailedError } from '../repo-scan-queue/scan-enqueue-failed.error';
import {
  GitlabPendingRescan,
  PendingRescanOutcome,
  PendingRescanRequest,
  PendingRescanStore,
} from '../pending-rescan/pending-rescan.store';
import {
  branchHeadOutcomeOf,
  isGraphOnlyLimitReached,
  isScanAlreadyInProgress,
  pendingRescanOutcomeOf,
} from '../pending-rescan/pending-rescan.outcome';
import {
  SCAN_FAILURE_SOURCE_FETCH_FAILED,
  SCAN_FAILURE_SOURCE_INVALID,
  scanFailureCodeFromError,
} from '../../core/constants/scan-failure-codes';
import {
  runZipProcessing,
  addGitDirToArchive as addGitDirToArchiveImpl,
  runZipProcessingInWorker,
} from '../../core/utils/zip-processor';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import { GitlabRepoScanJobData } from '../repo-scan-queue/repo-scan-job.types';
import { constantTimeStringEquals } from '../../core/utils/webhook-verify.util';
import {
  generateWebhookToken,
  gitlabProjectIdOf,
  hashWebhookToken,
  legacyWebhookTokenAccepted,
  webhookTokenMatches,
} from './gitlab-webhook-token';
import {
  HISTORY_PROVIDER_TIMEOUT_MS,
  HistoryListOptions,
  ProviderCommit,
  ProviderCommitSummary,
} from '../../core/git-history/repository-history.types';

/** A GitLab commit as the repository history reads it (author fields ignored). */
interface GitlabHistoryCommit {
  id: string;
  message?: string;
  committed_date?: string;
}

/** One file of a GitLab commit diff. */
interface GitlabHistoryDiff {
  new_path: string;
  old_path?: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string;
}

/** Diff pages of 100 files read for one commit: 300 files, as GitHub returns. */
const GITLAB_HISTORY_DIFF_MAX_PAGES = 3;

function gitlabDiffStatus(d: GitlabHistoryDiff): string {
  if (d.new_file) return 'added';
  if (d.deleted_file) return 'removed';
  if (d.renamed_file) return 'renamed';
  return 'modified';
}

/** GitLab gives no counts: count the +/- lines of the hunk body (it has no file headers). */
function countDiffLines(diff: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}
import {
  isBranchRef,
  isBranchCreation,
  isBranchDeletion,
  extractBranchName,
} from './gitlab-branch.util';
import {
  signedUploadHeaders,
  uploadFileToSignedUrl,
} from '../../core/utils/signed-url-upload';
import {
  archiveGitDir,
  historyUnavailable,
  PreparedHistory,
  RepoHistoryService,
} from '../repo-scan-queue/git-history/repo-history.service';
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * The commit a push webhook checked out (`checkout_sha`), when the payload
 * carries a well-formed one. Anything else returns undefined and the scan
 * falls back to the branch's latest commit, as before.
 */
function pushedCommitSha(payload: {
  checkout_sha?: unknown;
}): string | undefined {
  const sha = payload?.checkout_sha;
  return isCommitSha(sha) ? sha : undefined;
}

/**
 * GitLab OAuth2 Token Response Interface
 */
interface GitlabTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * GitLab User Response Interface
 */
interface GitlabUser {
  id: number;
  username: string;
  name: string;
  email: string;
}

/**
 * GitLab Project Response Interface
 */
interface GitlabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  default_branch: string;
  description: string;
  web_url: string;
  ssh_url_to_repo: string;
  http_url_to_repo: string;
  visibility: string;
}

/** How `disconnect` bounds its calls to GitLab; the user is waiting. */
const DISCONNECT_WEBHOOK_CONCURRENCY = 5;
const DISCONNECT_CALL_TIMEOUT_MS = 10_000;
const DISCONNECT_WEBHOOK_BUDGET_MS = 20_000;
/** A hung GitLab token endpoint must not hold the caller (a disconnect, a scan) open. */
const GITLAB_TOKEN_REFRESH_TIMEOUT_MS = 10_000;

/** Identifies one GitLab hook: a hook id is unique within its project only. */
const webhookKey = (
  repository: Pick<GitlabRepository, 'gitlabId' | 'webhookId'>,
): string => `${repository.gitlabId}:${repository.webhookId}`;

/**
 * GitLab Integration Service
 * Handles OAuth2 authentication, repository synchronization, and webhook processing
 */
@Injectable()
export class GitlabService {
  private scanServiceClient!: ScanServiceClient;
  private fileServiceClient!: FileServiceClient;
  private projectServiceClient!: ProjectServiceClient;
  private gitlabApplicationId: string;
  private gitlabApplicationSecret: string;
  // Undefined when no public app URL is configured (neither
  // FRONTEND_URL nor APP_PUBLIC_URL) — the instance still boots.
  private gitlabRedirectUri: string | undefined;
  private keyHex: string;
  private readonly urls: GitlabUrls;
  private readonly gitlabApiUrl: string;

  constructor(
    @InjectRepository(GitlabIntegration)
    private readonly gitlabIntegrationRepository: Repository<GitlabIntegration>,
    @InjectRepository(GitlabRepository)
    private readonly gitlabRepositoryRepository: Repository<GitlabRepository>,
    @InjectRepository(GitlabBranch)
    private readonly gitlabBranchRepository: Repository<GitlabBranch>,
    private readonly dataSource: DataSource,
    private readonly secretsService: SecretsService,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly scanningClient: ClientGrpc,
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileManagementClient: ClientGrpc,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    private readonly repoScanQueue: RepoScanQueueService,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
    private readonly pendingRescans: PendingRescanStore,
    private readonly repoHistory: RepoHistoryService,
  ) {
    // Every GitLab URL derives from GITLAB_API_URL (default gitlab.com).
    this.urls = gitlabUrls(configService.get<string>('GITLAB_API_URL'));
    this.gitlabApiUrl = this.urls.api;
  }

  async onModuleInit() {
    this.scanServiceClient =
      this.scanningClient.getService<ScanServiceClient>(SCAN_SERVICE_NAME);
    this.fileServiceClient =
      this.fileManagementClient.getService<FileServiceClient>(
        FILE_SERVICE_NAME,
      );
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
    this.gitlabApplicationId = await this.secretsService.getSecret(
      'GITLAB_APPLICATION_ID',
    );
    this.gitlabApplicationSecret = await this.secretsService.getSecret(
      'GITLAB_APPLICATION_SECRET',
    );
    this.keyHex = await this.secretsService.getSecret('GITLAB_ENCRYPTION_KEY');
    // FRONTEND_URL (cloud) else APP_PUBLIC_URL (community); without
    // either, gitlabRedirectUri stays undefined and the OAuth calls are
    // refused with GITLAB_NOT_CONFIGURED.
    const appUrl = publicAppUrl(this.configService);
    this.gitlabRedirectUri = appUrl
      ? `${appUrl}/integrations/gitlab/callback`
      : undefined;
  }

  /**
   * True when a GitLab OAuth app is configured — application id,
   * application secret and a public app URL for the redirect — so the
   * instance boots without GitLab and refuses the OAuth calls instead.
   */
  isGitlabConfigured(): boolean {
    return Boolean(
      this.gitlabApplicationId &&
      this.gitlabApplicationSecret &&
      publicAppUrl(this.configService),
    );
  }

  private assertGitlabConfigured(): void {
    if (!this.isGitlabConfigured()) {
      throw new RpcException({
        message: 'GITLAB_NOT_CONFIGURED',
        code: status.FAILED_PRECONDITION,
      });
    }
  }

  /**
   * Returns a valid OAuth access token for the GitLab repo linked to the given project id.
   * - Finds the linked repository, resolves its integration
   * - Decrypts the current access token; if missing/expired or rejected, refreshes using existing logic
   */
  @Span()
  async getAccessTokenForProject(projectId: string): Promise<{
    accessToken: string;
    cloneUrl: string;
    repositoryFullName: string;
    defaultBranch: string;
  }> {
    // Find a GitLab repository linked to this project
    const repository = await this.gitlabRepositoryRepository.findOne({
      where: { projectId: projectId },
      relations: ['integration'],
      order: { updatedAt: 'DESC' },
    });

    if (!repository || !repository.integration) {
      throw new RpcException({
        message: 'No GitLab repository linked to this project',
        code: status.NOT_FOUND,
      });
    }

    const integration = repository.integration;

    // Validate scopes: we require at least write_repository for git push
    const scopes = (integration.scope || '').split(/\s+/).filter(Boolean);
    const hasWrite = scopes.includes('write_repository');
    if (!hasWrite) {
      this.logger.warn(
        `GitLab token for org ${integration.organizationId} is missing required scope write_repository (scopes=${integration.scope || ''})`,
        GitlabService.name,
      );
      throw new RpcException({
        message:
          'GitLab integration is missing the write_repository scope. Please reinstall the GitLab integration with write access.',
        code: status.PERMISSION_DENIED,
      });
    }

    // Try decrypting current token
    let accessToken = await this.decryptToken(integration.accessToken);
    if (!accessToken) {
      // If decrypt failed or empty, attempt refresh
      accessToken = await this.refreshAccessToken(integration);
    } else {
      // If token expiry is near/past, refresh proactively
      const expiresAt = integration.tokenExpiresAt
        ? new Date(integration.tokenExpiresAt).getTime()
        : 0;
      const now = Date.now();
      const skewMs = 60 * 1000; // 60s safety window
      if (!expiresAt || expiresAt <= now + skewMs) {
        accessToken = await this.refreshAccessToken(integration);
      } else {
        this.logger.debug(
          `Returning cached GitLab token for org ${integration.organizationId} (expiresAt=${integration.tokenExpiresAt?.toISOString() || 'n/a'})`,
          GitlabService.name,
        );
      }
    }

    // Build the clone URL - use httpUrlToRepo from repository or construct it
    const cloneUrl =
      repository.httpUrlToRepo ||
      this.urls.cloneUrl(repository.pathWithNamespace);

    return {
      accessToken,
      cloneUrl,
      repositoryFullName: repository.pathWithNamespace,
      defaultBranch: repository.defaultBranch || 'main',
    };
  }

  /**
   * Get GitLab installation for organization
   */
  @Span()
  async getInstallationForOrga(
    organizationId: string,
  ): Promise<GetGitlabInstallationForOrgaResponse> {
    const installation = await this.gitlabIntegrationRepository.findOne({
      where: { organizationId },
    });

    // Behaviour change: absence of an installation is NOT an error anymore.
    // We now return an "empty" response so callers can distinguish between
    // (a) no integration configured yet and (b) an actual transport / server error.
    // Proto fields are non-optional, so we convey absence via empty/zero values.
    if (!installation) {
      return {
        id: '',
        userId: '',
        organizationId: '',
        gitlabUserId: 0,
        gitlabGroupId: 0,
        createdAt: '',
        updatedAt: '',
        reconnectRequired: false,
      };
    }

    return {
      id: installation.id,
      userId: installation.userId || '',
      organizationId: installation.organizationId || '',
      gitlabUserId: installation.gitlabUserId || 0,
      gitlabGroupId: installation.gitlabGroupId || 0,
      createdAt: installation.createdAt.toISOString(),
      updatedAt: installation.updatedAt.toISOString(),
      reconnectRequired: installation.reconnectRequiredAt != null,
    };
  }

  /**
   * Disconnects GitLab from an organization, on its user's explicit request
   * only. For each of the organization's connections (an index,
   * not a constraint, keeps them to one: two concurrent installs can leave
   * two), GitLab's side first, best effort and only while a token works:
   * delete the webhooks we registered, revoke the token. Then the rows go,
   * and the `ON DELETE CASCADE` foreign keys take every repository link and
   * branch with them. Scan history, vulnerabilities, issue links and the
   * GitLab Container Registry credentials live elsewhere and stay.
   *
   * Idempotent: an organization without GitLab gets the same success.
   */
  @Span()
  async disconnect(organizationId: string): Promise<DisconnectGitlabResponse> {
    // TypeORM drops an undefined or null where-value: without this guard the
    // read below, and the deletion after it, would span every organization.
    if (!organizationId) {
      throw new RpcException({
        message: 'organizationId is required',
        code: status.INVALID_ARGUMENT,
      });
    }
    const integrations = await this.gitlabIntegrationRepository.find({
      where: { organizationId },
    });
    if (integrations.length === 0) {
      this.logger.log(
        `GitLab already disconnected for org ${organizationId}`,
        GitlabService.name,
      );
      return { success: true, message: 'GitLab integration disconnected' };
    }

    const integrationIds = integrations.map((integration) => integration.id);
    const released = {
      webhooksDeleted: 0,
      webhooksFailed: 0,
      webhooksSkipped: 0,
      webhooksShared: 0,
      tokensRevoked: 0,
    };
    for (const integration of integrations) {
      const outcome = await this.releaseOnGitlab(integration, integrationIds);
      released.webhooksDeleted += outcome.webhooksDeleted;
      released.webhooksFailed += outcome.webhooksFailed;
      released.webhooksSkipped += outcome.webhooksSkipped;
      released.webhooksShared += outcome.webhooksShared;
      released.tokensRevoked += outcome.tokenRevoked ? 1 : 0;
    }

    try {
      await this.gitlabIntegrationRepository.delete({
        id: In(integrationIds),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to delete the GitLab integration of org ${organizationId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
        GitlabService.name,
      );
      throw new RpcException({
        message: 'Failed to disconnect GitLab',
        code: status.INTERNAL,
      });
    }

    this.logger.log(
      `GITLAB_DISCONNECTED org=${organizationId} integrations=${integrations.length} webhooks_deleted=${released.webhooksDeleted} webhooks_failed=${released.webhooksFailed} webhooks_skipped=${released.webhooksSkipped} webhooks_shared=${released.webhooksShared} tokens_revoked=${released.tokensRevoked}`,
      GitlabService.name,
    );
    return { success: true, message: 'GitLab integration disconnected' };
  }

  /**
   * GitLab's side of a disconnection. GitLab failures (the token refresh, a
   * webhook deletion, the revocation) are swallowed: counted and logged,
   * never thrown. A database error reading the repositories propagates, and
   * it does so before any row is deleted. Nothing is attempted for a
   * connection GitLab already refused (its token is dead) nor when no token
   * can be obtained, and a hook another connection still references is left
   * in place (`webhooksShared`).
   */
  private async releaseOnGitlab(
    integration: GitlabIntegration,
    disconnectedIntegrationIds: string[],
  ): Promise<{
    webhooksDeleted: number;
    webhooksFailed: number;
    webhooksSkipped: number;
    webhooksShared: number;
    tokenRevoked: boolean;
  }> {
    const nothing = {
      webhooksDeleted: 0,
      webhooksFailed: 0,
      webhooksSkipped: 0,
      webhooksShared: 0,
      tokenRevoked: false,
    };
    if (integration.reconnectRequiredAt) return nothing;
    const accessToken = await this.getRefreshedAccessToken(integration);
    if (!accessToken) return nothing;

    const repositories = await this.gitlabRepositoryRepository.find({
      where: { integrationId: integration.id, webhookId: Not(IsNull()) },
    });
    const shared = await this.webhooksReferencedElsewhere(
      repositories,
      disconnectedIntegrationIds,
    );
    const ownWebhooks = repositories.filter(
      (repository) => !shared.has(webhookKey(repository)),
    );
    const webhooks = await this.deleteWebhooksWithinBudget(
      accessToken,
      ownWebhooks,
    );
    const tokenRevoked = await this.revokeAccessToken(accessToken);
    return {
      ...webhooks,
      webhooksShared: repositories.length - ownWebhooks.length,
      tokenRevoked,
    };
  }

  /**
   * The hooks of `repositories` that a connection NOT being disconnected
   * still references. Every organization registers the same hook URL and
   * `createProjectWebhook` reuses a hook already there, so a GitLab project
   * linked by two organizations carries ONE hook both rely on: deleting it
   * would silently stop the other organization's push scans.
   */
  private async webhooksReferencedElsewhere(
    repositories: GitlabRepository[],
    disconnectedIntegrationIds: string[],
  ): Promise<Set<string>> {
    if (repositories.length === 0) return new Set();
    const elsewhere = await this.gitlabRepositoryRepository.find({
      where: {
        gitlabId: In([
          ...new Set(repositories.map((repository) => repository.gitlabId)),
        ]),
        webhookId: Not(IsNull()),
        integrationId: Not(In(disconnectedIntegrationIds)),
      },
      select: { gitlabId: true, webhookId: true },
    });
    return new Set(elsewhere.map(webhookKey));
  }

  /**
   * Deletes the webhooks we registered, DISCONNECT_WEBHOOK_CONCURRENCY at a
   * time, each call bounded, and starts none past the budget. A webhook left
   * on GitLab only posts pushes that no longer match a repository here.
   */
  private async deleteWebhooksWithinBudget(
    accessToken: string,
    repositories: GitlabRepository[],
  ): Promise<{
    webhooksDeleted: number;
    webhooksFailed: number;
    webhooksSkipped: number;
  }> {
    const deadline = Date.now() + DISCONNECT_WEBHOOK_BUDGET_MS;
    let next = 0;
    let webhooksDeleted = 0;
    let webhooksFailed = 0;

    const worker = async (): Promise<void> => {
      while (next < repositories.length && Date.now() < deadline) {
        const repository = repositories[next];
        next += 1;
        try {
          await axios.delete(
            `${this.gitlabApiUrl}/projects/${repository.gitlabId}/hooks/${repository.webhookId}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              timeout: DISCONNECT_CALL_TIMEOUT_MS,
            },
          );
          webhooksDeleted += 1;
        } catch (error: unknown) {
          if (
            (error as { response?: { status?: number } } | null)?.response
              ?.status === 404
          ) {
            webhooksDeleted += 1;
            continue;
          }
          webhooksFailed += 1;
          const message =
            error instanceof Error
              ? error.message
              : ((error as { message?: string } | null)?.message ??
                String(error));
          this.logger.warn(
            `Could not delete webhook ${repository.webhookId} of GitLab project ${repository.gitlabId}: ${message}`,
            GitlabService.name,
          );
        }
      }
    };

    const workers = Math.min(
      DISCONNECT_WEBHOOK_CONCURRENCY,
      repositories.length,
    );
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return {
      webhooksDeleted,
      webhooksFailed,
      webhooksSkipped: repositories.length - webhooksDeleted - webhooksFailed,
    };
  }

  /** Revokes the token at GitLab (RFC 7009), best effort. */
  private async revokeAccessToken(accessToken: string): Promise<boolean> {
    const params = new URLSearchParams();
    params.append('client_id', this.gitlabApplicationId);
    params.append('client_secret', this.gitlabApplicationSecret);
    params.append('token', accessToken);
    try {
      await axios.post(this.urls.oauthRevoke, params, {
        timeout: DISCONNECT_CALL_TIMEOUT_MS,
      });
      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : ((error as { message?: string } | null)?.message ?? String(error));
      this.logger.warn(
        `Could not revoke the GitLab token: ${message}`,
        GitlabService.name,
      );
      return false;
    }
  }

  /**
   * Handle OAuth callback and create GitLab integration
   */
  @Span()
  async callbackInstall(
    request: GitlabCallbackInstallRequest,
  ): Promise<GitlabCallbackInstallResponse> {
    try {
      const redisKey = `gitlab_oauth_state:${request.organizationId}`;
      const savedState = await this.redisClient.get(redisKey);

      if (savedState) {
        await this.redisClient.del(redisKey);
      }

      if (!savedState || savedState !== request.state) {
        // Neither state is logged: the expected one is a CSRF secret.
        this.logger.warn(
          `GITLAB_OAUTH_STATE_MISMATCH org=${request.organizationId} stored=${Boolean(savedState)}`,
          GitlabService.name,
        );
        throw new RpcException({
          message: 'Invalid state parameter. CSRF attack may be in progress.',
          code: status.INVALID_ARGUMENT,
        });
      }

      // Exchange authorization code for access token
      const tokenResponse = await this.exchangeCodeForToken(request.code);

      // Get GitLab user information
      const gitlabUser = await this.getGitlabUser(tokenResponse.access_token);

      // Create or update GitLab integration
      const integration = await this.createOrUpdateIntegration(
        request.organizationId,
        request.userId,
        gitlabUser,
        tokenResponse,
      );

      // Sync repositories for the first time
      await this.syncRepositories(integration);

      this.logger.log(
        `GitLab integration successfully created for organization: ${request.organizationId}`,
        GitlabService.name,
      );

      return {
        returnUri: `/organizations/${request.organizationId}/integrations`,
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }

      this.logger.error(
        `Failed to process GitLab callback: ${error.message}`,
        error.stack,
        GitlabService.name,
      );
      throw new RpcException({
        message: 'Failed to complete GitLab integration',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get synchronized GitLab repositories for organization
   */
  @Span()
  async getRepositories(
    organizationId: string,
  ): Promise<GetGitlabRepositoriesResponse> {
    try {
      // Rule: absence of installation should NOT raise an error.
      const installation = await this.gitlabIntegrationRepository.findOne({
        where: { organizationId },
      });

      if (!installation) {
        this.logger.log(
          `No GitLab integration for org ${organizationId}, returning empty repository list`,
          GitlabService.name,
        );
        return { repositories: [], organizationId };
      }

      const repositories = await this.gitlabRepositoryRepository.find({
        where: { integrationId: installation.id },
        order: { name: 'ASC' },
      });

      const repositoryDtos: GitlabRepositoryDto[] = repositories.map(
        (repo) => ({
          id: repo.id,
          gitlabId: repo.gitlabId,
          name: repo.name,
          nameWithNamespace: repo.nameWithNamespace,
          path: repo.path,
          pathWithNamespace: repo.pathWithNamespace,
          private: repo.private,
          defaultBranch: repo.defaultBranch || '',
          projectId: repo.projectId || '',
          createdAt: repo.createdAt.toISOString(),
          updatedAt: repo.updatedAt.toISOString(),
          scanBranch: repo.scanBranch || '',
        }),
      );

      return {
        repositories: repositoryDtos,
        organizationId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get GitLab repositories: ${error.message}`,
        error.stack,
        GitlabService.name,
      );
      throw error;
    }
  }

  /**
   * Get branches for a specific GitLab repository.
   *
   * Branches are persisted in the `gitlab_branches` table. On the first call
   * for a repository (`branchesSyncedAt` is NULL) we lazy-fill from the GitLab
   * API in a single transaction. Subsequent calls are served entirely from
   * MySQL — no GitLab round-trip — until the next webhook-driven sync.
   */
  @Span()
  async getBranches(
    request: GetGitlabBranchesRequest,
  ): Promise<GetGitlabBranchesResponse> {
    try {
      const repository = await this.gitlabRepositoryRepository.findOne({
        where: { id: request.repositoryId },
        relations: ['integration'],
      });

      if (!repository) {
        throw new RpcException({
          message: 'GitLab repository not found',
          code: status.NOT_FOUND,
        });
      }

      if (repository.integration.organizationId !== request.organizationId) {
        throw new RpcException({
          message: 'Unauthorized access to repository',
          code: status.PERMISSION_DENIED,
        });
      }

      // Lazy-fill on the first read for this repository. If the sync fails the
      // transaction rolls back, `branchesSyncedAt` stays NULL, and the next
      // call retries automatically.
      if (repository.branchesSyncedAt === null) {
        await this.lazyFillGitlabBranches(repository);
      }

      const rows = await this.gitlabBranchRepository.find({
        where: { repositoryId: repository.id },
        order: { name: 'ASC' },
      });

      const branches: GitlabBranchDto[] = rows.map((row) => ({
        name: row.name,
        isDefault: row.name === repository.defaultBranch,
        isProtected: row.isProtected,
      }));

      return {
        branches,
        repositoryId: request.repositoryId,
        defaultBranch: repository.defaultBranch || '',
        scanBranch: repository.scanBranch || '',
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }

      this.logger.error(
        `Failed to get GitLab branches: ${error.message}`,
        error.stack,
        GitlabService.name,
      );
      throw new RpcException({
        message: `Failed to get GitLab branches`,
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get a paginated, searchable list of branches for a GitLab repository identified
   * by its linked project ID. Mirrors GitHub's getRepositoryBranchesPaginated.
   */
  @Span()
  async getGitlabRepositoryBranchesPaginated(
    request: GetGitlabRepositoryBranchesPaginatedRequest,
  ): Promise<GetGitlabRepositoryBranchesPaginatedResponse> {
    try {
      const repository = await this.gitlabRepositoryRepository.findOne({
        where: { projectId: request.projectId },
        relations: ['integration'],
      });
      if (!repository) {
        throw new RpcException({
          message: 'GitLab repository not found for project',
          code: status.NOT_FOUND,
        });
      }
      if (!repository.integration) {
        throw new RpcException({
          message: 'Integration not found for repository',
          code: status.NOT_FOUND,
        });
      }
      if (repository.integration.organizationId !== request.organizationId) {
        throw new RpcException({
          message: 'Unauthorized access to repository',
          code: status.PERMISSION_DENIED,
        });
      }
      if (repository.branchesSyncedAt === null) {
        await this.lazyFillGitlabBranches(repository);
      }
      const pageSize = Math.min(Math.max(request.pageSize || 30, 1), 100);
      const page = Math.max(request.page || 1, 1);
      const qb = this.gitlabBranchRepository
        .createQueryBuilder('branch')
        .where('branch.repositoryId = :id', { id: repository.id });
      if (request.search) {
        // Case-insensitive on both engines: LIKE under MySQL's collation,
        // ILIKE on PostgreSQL.
        qb.andWhere(ilike('branch.name', ':search').text, {
          search: `%${request.search}%`,
        });
      }
      if (!request.includeArchived && request.archivedNames?.length) {
        qb.andWhere('branch.name NOT IN (:...archivedNames)', {
          archivedNames: request.archivedNames,
        });
      }
      qb.orderBy('CASE WHEN branch.name = :def THEN 0 ELSE 1 END', 'ASC')
        .setParameter('def', repository.defaultBranch)
        .addOrderBy('branch.name', 'ASC')
        .skip((page - 1) * pageSize)
        .take(pageSize);
      const [rows, total] = await qb.getManyAndCount();
      const archivedSet = new Set(request.archivedNames || []);
      return {
        branches: rows.map((r) => ({
          name: r.name,
          isDefault: r.name === repository.defaultBranch,
          isProtected: r.isProtected,
          archived: archivedSet.has(r.name),
        })),
        total,
        defaultBranch: repository.defaultBranch || '',
        scanBranch: repository.scanBranch || '',
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Failed paginated gitlab branches for project ${request.projectId}: ${error?.message ?? error}`,
        error?.stack,
        GitlabService.name,
      );
      throw new RpcException({
        message: 'Failed to get GitLab branches',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Lazy-fill the `gitlab_branches` table for a repository on first read.
   *
   * Fetches the full branch list from the GitLab API (via `callGitlabApi` for
   * automatic token refresh handling) and reconciles it with our DB inside a
   * single transaction:
   *   1. update `defaultBranch` on the parent repo if GitLab reports a drift
   *      (using the `default: true` flag returned per branch)
   *   2. upsert one row per fresh branch (idempotent on the unique
   *      `(repositoryId, name)` index), 500 rows per statement
   *   3. delete orphan rows that no longer exist on GitLab
   *   4. stamp `branchesSyncedAt = now` and save the parent repo
   *
   * If any step throws, the whole transaction rolls back and
   * `branchesSyncedAt` stays NULL — the next call will retry.
   */
  @Span()
  private async lazyFillGitlabBranches(repo: GitlabRepository): Promise<void> {
    const startedAt = Date.now();

    // GitLab paginates with offset + the `X-Next-Page` response header (empty on
    // the last page). Follow it to fetch the full branch list and accumulate
    // every branch BEFORE the reconciliation below — otherwise a repo with >100
    // branches would only sync page 1 and the orphan delete would then
    // permanently drop branches 101+ from the DB cache. A MAX_PAGES guard caps a
    // pathological/looping API response.
    const PER_PAGE = 100;
    const MAX_PAGES = 100;
    const apiBranches: {
      name: string;
      default: boolean;
      protected: boolean;
    }[] = [];
    let page = 1;
    // The next-page value is server-controlled, so it CANNOT be trusted to bound
    // the loop (a constant/cyclic `X-Next-Page` would spin forever). Count
    // iterations locally and cap on that instead. When the cap trips the list is
    // incomplete: we must NOT reconcile/stamp against it (see below).
    let pagesFetched = 0;
    let truncated = false;

    while (true) {
      const response = await this.callGitlabApi<
        { name: string; default: boolean; protected: boolean }[]
      >(repo.integration, (accessToken) =>
        axios.get(
          `${this.gitlabApiUrl}/projects/${repo.gitlabId}/repository/branches`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { per_page: PER_PAGE, page },
          },
        ),
      );
      apiBranches.push(...response.data);
      pagesFetched++;
      // Axios lower-cases response header keys, so `x-next-page` is canonical.
      const nextPage = Number(response.headers?.['x-next-page']);
      if (!nextPage) break;
      if (pagesFetched >= MAX_PAGES) {
        truncated = true;
        this.logger.warn(
          `BRANCHES_LAZY_FILL repo=${repo.id} provider=gitlab hit page cap ${MAX_PAGES}; branch list is truncated — skipping orphan reconciliation and leaving branchesSyncedAt unset so the next read retries`,
          GitlabService.name,
        );
        break;
      }
      page = nextPage;
    }

    // GitLab returns `default: true` on the default branch directly.
    const newDefault = apiBranches.find((b) => b.default)?.name;

    await this.dataSource.transaction(async (manager) => {
      const repoRepo = manager.getRepository(GitlabRepository);

      // 1. Default-branch drift — update on the entity, save inside the tx.
      if (newDefault && newDefault !== repo.defaultBranch) {
        repo.defaultBranch = newDefault;
        await repoRepo.save(repo);
      }

      // 2. Upsert the branches (idempotent on unique (repositoryId, name)),
      //    in multi-row statements.
      await upsertBranches(
        manager,
        GitlabBranch,
        apiBranches.map((branch) => ({
          repositoryId: repo.id,
          name: branch.name,
          isProtected: branch.protected,
        })),
      );

      // 3 & 4 only run for a COMPLETE sync. A truncated list (MAX_PAGES cap hit)
      // must never drive the destructive NOT IN reconciliation — that would
      // delete real branches beyond the fetched tail — and must not be cached,
      // so branchesSyncedAt stays NULL and the next read retries. Upserts above
      // are safe to keep (they only add the branches we did fetch).
      if (!truncated) {
        // 3. Orphan reconciliation — drop rows that no longer exist on GitLab.
        const names = apiBranches.map((b) => b.name);
        await deleteStaleBranches(manager, GitlabBranch, repo.id, names);

        // 4. Stamp branchesSyncedAt and save.
        repo.branchesSyncedAt = new Date();
        await repoRepo.save(repo);
      }
    });

    this.logger.log(
      `BRANCHES_LAZY_FILL repo=${repo.id} provider=gitlab count=${apiBranches.length} durationMs=${Date.now() - startedAt}`,
      GitlabService.name,
    );
  }

  /**
   * Link GitLab repository to CybeDefend project
   */
  @Span()
  async linkProjectToRepository(
    request: LinkGitlabRepositoryRequest,
  ): Promise<GitlabLinkRepositoryResponse> {
    try {
      // A repository linked from a closed product builds the code graph only,
      // even when the organisation has AppSec too.
      // Validated before anything is linked: an unknown product is
      // INVALID_ARGUMENT.
      const link = this.entitlements.decideLinkScan(request.product);
      const repository = await this.gitlabRepositoryRepository.findOne({
        where: { id: request.repositoryId },
        relations: ['integration'],
      });

      if (!repository) {
        throw new RpcException({
          message: 'GitLab repository not found',
          code: status.NOT_FOUND,
        });
      }

      if (repository.integration.organizationId !== request.organizationId) {
        throw new RpcException({
          message: 'Repository does not belong to this organization',
          code: status.INVALID_ARGUMENT,
        });
      }

      // Validate branch exists if provided
      if (request.scanBranch) {
        const branches = await this.getBranches({
          organizationId: request.organizationId,
          repositoryId: request.repositoryId,
        });
        const branchExists = branches.branches.some(
          (b) => b.name === request.scanBranch,
        );
        if (!branchExists) {
          throw new RpcException({
            message: `Branch '${request.scanBranch}' not found in repository`,
            code: status.INVALID_ARGUMENT,
          });
        }
      }

      // Update repository with project ID and optional scan branch
      repository.projectId = request.projectId;
      repository.scanBranch = request.scanBranch || null;
      await this.gitlabRepositoryRepository.save(repository);

      this.logger.log(
        `GitLab repository ${repository.name} linked to project ${request.projectId} (scanBranch: ${repository.scanBranch || 'default'})`,
        GitlabService.name,
      );

      // Execute webhook creation and initial scan SEQUENTIALLY to avoid
      // concurrent token refresh race conditions (GitLab refresh tokens are single-use)
      // Run in background but sequentially
      (async () => {
        try {
          // First: create webhook (usually faster)
          await this.createProjectWebhook(repository);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (isGrpcClientError(error)) {
            this.logger.warn(
              `Webhook creation rejected for repo ${repository.id}: ${message}`,
            );
          } else {
            this.logger.error(
              `Webhook creation failed for repo ${repository.id}: ${message}`,
            );
          }
        }

        try {
          // Then: start initial scan, unless the link's product starts none
          // (Community Edition: the link and the webhook still save, no scan
          // starts).
          if (link.scan === 'none') {
            this.logger.log(
              `LINK_SCAN_SKIPPED reason=${link.reason} repo=${repository.id} project=${request.projectId}`,
              GitlabService.name,
            );
          } else {
            await this.startScanForLastCommit(
              {
                projectId: request.projectId,
                repositoryId: repository.id,
                branch: repository.scanBranch || '',
              },
              { graphOnly: link.scan === 'graph_only' },
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (isGrpcClientError(error)) {
            this.logger.warn(
              `Initial scan not started for repo ${repository.id}: ${message}`,
            );
          } else {
            this.logger.error(
              `Initial scan failed for repo ${repository.id}: ${message}`,
            );
          }
        }
      })();

      return this.mapRepositoryToResponse(repository);
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Failed to link GitLab repository: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
        GitlabService.name,
      );
      throw new RpcException({
        message: 'Failed to link GitLab repository',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Unlink GitLab repository from CybeDefend project
   */
  @Span()
  async unlinkProjectFromRepository(
    request: UnlinkGitlabRepositoryRequest,
  ): Promise<GitlabLinkRepositoryResponse> {
    try {
      const repository = await this.gitlabRepositoryRepository.findOne({
        where: {
          id: request.repositoryId,
          projectId: request.projectId,
        },
        relations: ['integration'],
      });

      if (!repository) {
        throw new RpcException({
          message: 'GitLab repository not found or not linked to this project',
          code: status.NOT_FOUND,
        });
      }

      if (repository.integration.organizationId !== request.organizationId) {
        throw new RpcException({
          message: 'Repository does not belong to this organization',
          code: status.INVALID_ARGUMENT,
        });
      }

      void this.deleteProjectWebhook(repository).catch((err) =>
        this.logger.error(
          `Webhook deletion failed for repo ${repository.id}: ${err.message}`,
        ),
      );

      // Remove project ID from repository
      repository.projectId = null;
      await this.gitlabRepositoryRepository.save(repository);

      this.logger.log(
        `GitLab repository ${repository.name} unlinked from project ${request.projectId}`,
        GitlabService.name,
      );

      return this.mapRepositoryToResponse(repository);
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to unlink GitLab repository: ${message}`,
        error instanceof Error ? error.stack : undefined,
        GitlabService.name,
      );
      throw new RpcException({
        message: 'Failed to unlink GitLab repository',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Delete project and unlink all associated GitLab repositories
   */
  @Span()
  async deleteProject(
    projectId: string,
  ): Promise<GitlabLinkRepositoryResponse> {
    try {
      const repositories = await this.gitlabRepositoryRepository.find({
        where: { projectId },
      });

      // Unlink all repositories from the project and reset scanBranch
      for (const repository of repositories) {
        repository.projectId = null;
        repository.scanBranch = null;
        await this.gitlabRepositoryRepository.save(repository);
      }

      this.logger.log(
        `All GitLab repositories unlinked from deleted project: ${projectId}`,
        GitlabService.name,
      );

      // Return empty response as required by proto
      return {
        id: '',
        gitlabId: 0,
        name: '',
        nameWithNamespace: '',
        path: '',
        pathWithNamespace: '',
        private: false,
        defaultBranch: '',
        projectId: '',
        createdAt: '',
        updatedAt: '',
        scanBranch: '',
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete GitLab project: ${error.message}`,
        error.stack,
        GitlabService.name,
      );
      throw error;
    }
  }

  // ============================================================================
  // SCAN WORKFLOW HELPER METHODS
  // ============================================================================

  /**
   * Creates a failed scan record in the database.
   */
  @Span()
  private async createFailedScan(
    projectId: string,
    organizationId: string,
    errorMessage: string,
  ): Promise<void> {
    await safeGrpcCall(
      this.scanServiceClient.createFailedScan({
        projectId,
        organizationId,
        errorMessage,
      }),
    );
    this.logger.log(
      `Created failed scan record for project ${projectId} with error: ${errorMessage}`,
    );
  }

  /**
   * Marks an existing scan as failed, with the reason the dashboard shows.
   *
   * Reported through the scan-level `UpdateScanData` RPC, never through the
   * container-level `UpdateScan`: the latter resolves a container row from
   * `podName` and rejects a scan-level failure with "Container not found", so
   * the scan stayed `running` with no reason at all. Security-
   * scanning derives `errorCategory` from `errorCode` on its side.
   *
   * Never throws: this method is called from fire-and-forget background
   * handlers where an unhandled rejection would crash the process. If the
   * scan no longer exists on the security-scanning-service (e.g. it was
   * cleaned up between the failure and this call), the error is logged
   * and swallowed so the caller can continue its cleanup.
   */
  @Span()
  private async markScanAsFailed(
    scanId: string,
    errorMessage: string,
    errorCode: number = SCAN_FAILURE_SOURCE_FETCH_FAILED,
  ): Promise<void> {
    try {
      await safeGrpcCall(
        this.scanServiceClient.updateScanData({
          scanId,
          state: 'failed',
          errorMessage,
          errorCode,
        }),
      );
      this.logger.log(
        `Marked scan ${scanId} as failed with error: ${errorMessage}`,
      );
    } catch (markErr) {
      this.logger.warn(
        `Failed to mark scan ${scanId} as failed (swallowed to avoid unhandled rejection): ${
          (markErr as Error).message
        }`,
      );
    }
  }

  /**
   * Check if a scan already exists for the project/branch.
   */
  private async ensureNoExistingScan(
    projectId: string,
    branch: string,
  ): Promise<void> {
    await safeGrpcCall(
      this.scanServiceClient.checkExistingScan({ projectId, branch }),
    );
  }

  /**
   * Decrypt and validate access token for an integration.
   */
  private async getValidAccessToken(
    integration: GitlabIntegration,
    projectId: string,
    organizationId: string,
  ): Promise<string> {
    const accessToken = await this.decryptToken(integration.accessToken);
    if (!accessToken) {
      const msg = `Failed to decrypt access token for integration ${integration.id}`;
      this.logger.warn(msg);
      await this.createFailedScan(projectId, organizationId, msg);
      throw new RpcException({
        message: 'Failed to start scan due to invalid access token',
        code: status.UNAUTHENTICATED,
      });
    }
    return accessToken;
  }

  /**
   * What a push webhook reads from the project, in one lean read: the
   * per-project opt-out of the scan triggered by a push, and the scan
   * types the scan will run.
   *
   * The opt-out fails OPEN on every uncertainty — an absent field (a
   * global-management running behind this service) or a failed lookup keeps
   * the project being scanned, because a silently missed scan is a security
   * gap, whereas an unwanted scan is only noise. A failed lookup leaves the
   * types unread: the scan start reads them itself and fails closed, as before.
   */
  private async readPushProjectSettings(
    projectId: string,
  ): Promise<PushProjectSettings> {
    try {
      const projectInfo = await safeGrpcCall(
        this.projectServiceClient.get(projectSettingsRequest(projectId)),
      );
      return pushProjectSettings(
        projectInfo,
        this.entitlements.projectProductMark(projectInfo),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to read scanOnCommitEnabled for project ${projectId}, defaulting to enabled: ${error}`,
        GitlabService.name,
      );
      return { scanOnCommitEnabled: true };
    }
  }

  /**
   * Build scan type string from project settings.
   */
  private async getProjectScanTypes(projectId: string): Promise<string> {
    try {
      const projectInfo = await safeGrpcCall(
        this.projectServiceClient.get(projectSettingsRequest(projectId)),
      );
      return repositoryScanTypes(projectInfo);
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(`Failed to get project info: ${error}`);
      throw new RpcException({
        message: 'Failed to retrieve project information',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get signed upload URL from file service.
   */
  private async getSignedUploadUrl(
    scanId: string,
    projectId: string,
    typeScan: string,
  ): Promise<string> {
    try {
      const response = await safeGrpcCall(
        this.fileServiceClient.uploadFile({ scanId, projectId, typeScan }),
      );
      this.logger.log(`Received signed URL for scan ${scanId}`);
      return response.url;
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(`Failed to get upload URL: ${error}`);
      throw new RpcException({
        message: 'Failed to get upload URL',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Create scan record in waiting_for_file state.
   */
  private async createScanRecord(
    scanId: string,
    projectId: string,
    branch: string,
    graphOnly: boolean,
  ): Promise<void> {
    try {
      await safeGrpcCall(
        this.scanServiceClient.createScan({
          scanId,
          projectId,
          privateScan: false,
          vulnerabilityTypes: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
          initializerUserId: 'gitlab-integration',
          branch,
          sourceType: 'gitlab',
          graphOnly,
        }),
      );
      this.logger.log(`Created scan record ${scanId} for project ${projectId}`);
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(`Failed to create scan record: ${error}`);
      throw new RpcException({
        message: 'Failed to create scan record',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Recursively walk `gitDir` and add every regular file (skipping symlinks and
   * path-traversal attempts) to `zip` under the `.git/` prefix.
   *
   * Extracted as a separate method for testability.
   */
  private addGitDirToArchive(zip: AdmZip, gitDir: string): void {
    addGitDirToArchiveImpl(zip, gitDir);
  }

  /**
   * Process zip: remove top-level directory, optionally inject a .git,
   * and write the cleaned version.
   *
   * @param gitDir - Optional absolute path to the bounded bare repository of
   *   the scanned branch. When provided and present on disk, its contents are
   *   injected under .git/ in the output archive so the scanner can run
   *   gitleaks over that history.
   */
  private processZipFile(
    inputPath: string,
    outputPath: string,
    gitDir?: string,
  ): Promise<void> {
    return runZipProcessing(inputPath, outputPath, gitDir);
  }

  /**
   * Off-thread variant of {@link processZipFile}: runs the zip rewrite in a
   * worker thread so it never blocks the main event loop. A large repository
   * would otherwise block the loop long enough to fail the gRPC liveness probe
   * and get the pod SIGKILLed, orphaning the scan in `waiting_for_file`.
   */
  private processZipInWorker(
    inputPath: string,
    outputPath: string,
    gitDir?: string,
  ): Promise<void> {
    return runZipProcessingInWorker(inputPath, outputPath, gitDir);
  }

  /**
   * Build upload headers for cloud storage.
   */
  private buildUploadHeaders(uploadUrl: string): Record<string, string> {
    return signedUploadHeaders(uploadUrl, 'application/zip');
  }

  private async uploadToSignedUrl(
    uploadUrl: string,
    filePath: string,
  ): Promise<void> {
    await uploadFileToSignedUrl(
      uploadUrl,
      filePath,
      this.buildUploadHeaders(uploadUrl),
    );
  }

  /**
   * Clean up temporary files safely.
   */
  private cleanupTempFiles(...paths: string[]): void {
    for (const filePath of paths) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        this.logger.warn(`Failed to cleanup ${filePath}`);
      }
    }
  }

  /**
   * Generate temp file paths for zip processing.
   */
  private generateTempPaths(
    repo: string,
    commit: string,
  ): { tmpPath: string; cleanedPath: string } {
    const sanitizedRepo = repo.replaceAll(/[^\w.-]/g, '_');
    const sanitizedCommit = commit.replaceAll(/[^\w-]/g, '_');
    const ts = Date.now();
    return {
      tmpPath: path.join(
        os.tmpdir(),
        `${sanitizedRepo}-${sanitizedCommit}-${ts}.zip`,
      ),
      cleanedPath: path.join(
        os.tmpdir(),
        `cleaned-${sanitizedRepo}-${sanitizedCommit}-${ts}.zip`,
      ),
    };
  }

  /**
   * Returns a valid, decrypted access token for the given integration,
   * proactively refreshing it if it is near or past expiry.
   * Persists the refreshed token back to the entity before returning.
   *
   * This is the non-throwing counterpart of `callGitlabApi`'s token
   * resolution path, intended for shell-out code paths (e.g. git fetch)
   * that cannot use the REST-wrapper retry machinery.
   *
   * @returns The plain-text token, or `null` if the token is unrecoverable.
   *          Never throws.
   */
  private async getRefreshedAccessToken(
    integration: GitlabIntegration,
  ): Promise<string | null> {
    const expiresAt = integration.tokenExpiresAt
      ? new Date(integration.tokenExpiresAt).getTime()
      : 0;
    const now = Date.now();
    const skewMs = 60 * 1000; // 60 s safety window

    if (!expiresAt || expiresAt <= now + skewMs) {
      // Token is expired or expiring soon — refresh proactively
      try {
        return await this.refreshAccessToken(integration);
      } catch (err: any) {
        this.logger.warn(
          `getRefreshedAccessToken: proactive refresh failed for integration ${integration.id}: ${err.message}`,
          GitlabService.name,
        );
        return null;
      }
    }

    // Token is still fresh — just decrypt and return it
    const decrypted = await this.decryptToken(integration.accessToken);
    if (!decrypted) {
      // Decrypt failed (malformed ciphertext?) — attempt a refresh as fallback
      try {
        return await this.refreshAccessToken(integration);
      } catch (err: any) {
        this.logger.warn(
          `getRefreshedAccessToken: fallback refresh failed for integration ${integration.id}: ${err.message}`,
          GitlabService.name,
        );
        return null;
      }
    }

    return decrypted;
  }

  /**
   * The authenticated clone URL of the history fetch, or `null` (with a
   * warning) when no OAuth token can be had or the instance's URL cannot be
   * parsed: the scan then goes without history. Never throws.
   */
  private async historyCloneUrl(
    repository: GitlabRepository,
  ): Promise<string | null> {
    try {
      const token = await this.getRefreshedAccessToken(repository.integration);
      if (!token) {
        this.logger.warn(
          `No access token to fetch the history of ${repository.pathWithNamespace} (integration ${repository.integration?.id})`,
        );
        return null;
      }
      // Under the instance's base URL, which may carry a path.
      const url = new URL(this.urls.cloneUrl(repository.pathWithNamespace));
      url.username = 'oauth2';
      url.password = token;
      return url.toString();
    } catch (err) {
      // The URL is parsed before the token is set: no message carries it.
      this.logger.warn(
        `No clone URL to fetch the history of ${repository.pathWithNamespace}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** The history of the scanned branch, fetched while the archive downloads. */
  private async prepareHistory(
    repository: GitlabRepository,
    repositoryKey: string,
    scanId: string,
    projectId: string,
    branch: string,
  ): Promise<PreparedHistory> {
    return this.repoHistory.prepare({
      scanId,
      projectId,
      branch,
      repositoryKey,
      cloneUrl: await this.historyCloneUrl(repository),
    });
  }

  // ============================================================================
  // MAIN SCAN METHODS
  // ============================================================================

  /**
   * Downloads, processes, and triggers a scan for a specific commit.
   * Uses gRPC directly and processes the download/upload in background.
   */
  @Span()
  private async startScanForCommit(
    repository: GitlabRepository,
    commitSha: string,
    branch: string,
    options: RepositoryScanOptions = {},
    // The scan types a push webhook already read with the
    // project; read here when absent.
    prefetchedTypeScan?: string,
  ): Promise<StartGitlabScanResponse> {
    const { projectId, integration } = repository;
    const { organizationId } = integration;
    // A repository linked from a closed product: the scan is
    // stored graph-only and runs no scanner, so it is not checked against a
    // scan in flight on the branch.
    const graphOnly = options.graphOnly === true;
    // When this start began, to supersede a push refused
    // earlier (see supersedePendingRescan).
    const startedAt = Date.now();

    // 1. Validate no existing scan
    if (!graphOnly) {
      await this.ensureNoExistingScan(projectId, branch);
    }

    // 2. Validate access token
    await this.getValidAccessToken(integration, projectId, organizationId);

    // 3. Prepare scan (get types, create record)
    const typeScan =
      prefetchedTypeScan ?? (await this.getProjectScanTypes(projectId));
    const scanId = uuidv6();
    await this.createScanRecord(scanId, projectId, branch, graphOnly);

    // 4. Enqueue the download/zip/upload/startScan as a durable BullMQ job.
    //    A dedicated worker consumes it; if a worker dies mid-job BullMQ
    //    re-queues it, so the scan is never orphaned in waiting_for_file.
    try {
      await this.repoScanQueue.enqueueRepoScan({
        provider: 'gitlab',
        scanId,
        projectId,
        organizationId,
        branch,
        typeScan,
        repositoryId: repository.id,
        commitSha,
      });
    } catch (error: unknown) {
      throw new ScanEnqueueFailedError(scanId, error);
    }
    // A graph-only scan runs no scanner: it does not stand for the AppSec
    // scan a refused push waits for, so that push keeps its rescan.
    if (!graphOnly) {
      await this.supersedePendingRescan(
        projectId,
        branch,
        startedAt,
        commitSha,
      );
    }

    return {
      success: true,
      message: 'GitLab scan initiated. Download queued in background.',
      scanId,
      detectedLanguages: [],
    };
  }

  /**
   * Consumer of a deferred rescan: the push of
   * `entry.commitSha` was refused because a scan of the branch was running.
   *
   * Only a cheap check runs while that scan is not over (security-scanning's
   * CheckExistingScan, the same one the push hit). Once the branch is free,
   * the push's gates are read again, since the wait may have changed them,
   * and the branch head is read from GitLab: it is the commit scanned,
   * unless it is the one whose scan last started. The scan starts exactly as
   * the push would have started it: createScan, then the repo-scan job, then
   * StartScan in security-scanning, which still enforces writability.
   * Nothing here starts a diff scan.
   */
  @Span()
  async runPendingRescan(
    entry: GitlabPendingRescan,
  ): Promise<PendingRescanOutcome> {
    try {
      await this.ensureNoExistingScan(entry.projectId, entry.branch);
    } catch (error: unknown) {
      return pendingRescanOutcomeOf(error);
    }

    const repository = await this.gitlabRepositoryRepository.findOne({
      where: { id: entry.gitlabRepositoryId },
      relations: ['integration'],
    });
    if (
      !repository?.integration ||
      repository.projectId !== entry.projectId ||
      (repository.scanBranch || repository.defaultBranch) !== entry.branch
    ) {
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=repository_changed project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}`,
        GitlabService.name,
      );
      return 'dropped';
    }

    const settings = await this.readPushProjectSettings(entry.projectId);
    if (!settings.scanOnCommitEnabled) {
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=scan_on_commit_disabled project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}`,
        GitlabService.name,
      );
      return 'dropped';
    }

    // The push's product rule, read again: the organisation may have lost
    // AppSec or the graph-only product, or the project become an AppSec one,
    // while the push waited.
    const { organizationId } = repository.integration;
    const rescan = await this.entitlements.decidePushScan(
      organizationId,
      settings.appsecProject,
    );
    if (rescan.scan === 'none') {
      // The entitlements could not say whether the graph-only product is
      // active: nothing starts, and the rescan is checked again later.
      if (rescan.reason === 'products_unknown') {
        this.logger.log(
          `PENDING_RESCAN_BUSY reason=products_unknown org=${organizationId} project=${entry.projectId} commit=${entry.commitSha}`,
          GitlabService.name,
        );
        return 'busy';
      }
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=${rescan.reason} org=${organizationId} project=${entry.projectId} commit=${entry.commitSha}`,
        GitlabService.name,
      );
      return 'dropped';
    }

    // The commit to scan is the branch head NOW: a newer
    // push may have replaced the claimed one, or pushes may have been
    // delivered out of order. If that head is the commit whose scan last
    // started, it is scanned already.
    let headSha: string;
    try {
      headSha = await this.readLatestCommitSha(repository, entry.branch);
    } catch (error: unknown) {
      const outcome = branchHeadOutcomeOf(error);
      if (outcome === 'dropped') {
        this.logger.log(
          `PENDING_RESCAN_DROPPED reason=branch_head_unavailable project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}: ${error}`,
          GitlabService.name,
        );
      }
      return outcome;
    }
    const startedSha = await this.pendingRescans.startedCommit(
      entry.projectId,
      entry.branch,
    );
    if (startedSha === headSha) {
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=already_scanned project=${entry.projectId} branch=${entry.branch} head=${headSha} refused=${entry.commitSha}`,
        GitlabService.name,
      );
      return 'dropped';
    }

    try {
      // startScanForCommit, not startScanForLastCommit: the latter writes a
      // failed scan row on an unexpected error, i.e. one row per retry here.
      await this.startScanForCommit(
        repository,
        headSha,
        entry.branch,
        { graphOnly: rescan.scan === 'graph_only' },
        settings.typeScan,
      );
      return 'started';
    } catch (error: unknown) {
      if (error instanceof ScanEnqueueFailedError) {
        // A retry would create one more scan record on every attempt.
        this.logger.log(
          `PENDING_RESCAN_DROPPED reason=enqueue_failed_after_create project=${entry.projectId} branch=${entry.branch} commit=${headSha} scan=${error.scanId}: ${error.reason}`,
          GitlabService.name,
        );
        return 'dropped';
      }
      return pendingRescanOutcomeOf(error);
    }
  }

  /**
   * A push was refused because a scan of its branch is running: record it so
   * the pending-rescan consumer scans it once that scan ends.
   * Returns false, leaving the former handling (a failed scan row) to the
   * caller, when the refusal is something else, the push named no commit, or
   * Redis failed.
   */
  private async deferRefusedPush(
    error: unknown,
    request: PendingRescanRequest,
  ): Promise<boolean> {
    // A running scan, or a graph-only push at the project's or
    // the organisation's graph-only limit.
    const reason = isScanAlreadyInProgress(error)
      ? 'scan_running'
      : isGraphOnlyLimitReached(error)
        ? 'graph_only_limit'
        : null;
    if (reason === null || !isCommitSha(request.commitSha)) {
      return false;
    }
    let recorded: boolean;
    try {
      recorded = await this.pendingRescans.record(request);
    } catch (recordError: unknown) {
      this.logger.warn(
        `Could not defer the push of ${request.commitSha} on project ${request.projectId} (branch ${request.branch}): ${recordError}`,
        GitlabService.name,
      );
      return false;
    }
    if (!recorded) {
      // This very commit's scan is the one that started (a retry of a call
      // EI did process, a redelivery): it is being scanned already.
      this.logger.log(
        `WEBHOOK_PUSH_RESCAN_SKIPPED reason=already_started project=${request.projectId} branch=${request.branch} commit=${request.commitSha}`,
        GitlabService.name,
      );
      return true;
    }
    this.logger.log(
      `WEBHOOK_PUSH_RESCAN_DEFERRED project=${request.projectId} branch=${request.branch} commit=${request.commitSha} reason=${reason}`,
      GitlabService.name,
    );
    return true;
  }

  /**
   * A scan of `commitSha` was just started on the branch: it is remembered,
   * so a refused push of that same commit is not rescanned, and a push
   * refused before `startedAt` no longer needs its own rescan.
   * Never fails the start.
   */
  private async supersedePendingRescan(
    projectId: string,
    branch: string,
    startedAt: number,
    commitSha: string,
  ): Promise<void> {
    try {
      await this.pendingRescans.supersede(
        projectId,
        branch,
        startedAt,
        commitSha,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Could not clear the pending rescan of project ${projectId} (branch ${branch}): ${error}`,
        GitlabService.name,
      );
    }
  }

  /**
   * Worker entrypoint for a queued GitLab repo-scan job: re-fetches the
   * repository (with its integration) and runs the download → zip → upload →
   * startScan flow. Called only by the BullMQ processor in the worker process.
   */
  async runRepoDownloadJob(data: GitlabRepoScanJobData): Promise<void> {
    const repository = await this.gitlabRepositoryRepository.findOne({
      where: { id: data.repositoryId },
      relations: ['integration'],
    });
    if (!repository) {
      throw new Error(
        `GitlabRepository ${data.repositoryId} not found for scan ${data.scanId}`,
      );
    }
    await this.downloadAndUploadInBackground(
      repository,
      data.commitSha,
      data.scanId,
      data.projectId,
      data.organizationId,
      data.branch,
      data.typeScan,
    );
  }

  /**
   * Public hook for the queue's terminal-failure handler to fail a scan that
   * never completed (e.g. after exhausted retries / repeated worker deaths).
   */
  async markScanFailedFromJob(scanId: string, reason: string): Promise<void> {
    await this.markScanAsFailed(scanId, reason);
  }

  /**
   * Background task: download from GitLab, process zip, upload, trigger scan.
   */
  private async downloadAndUploadInBackground(
    repository: GitlabRepository,
    commitSha: string,
    scanId: string,
    projectId: string,
    organizationId: string,
    branch: string,
    typeScan: string,
  ): Promise<void> {
    const { tmpPath, cleanedPath } = this.generateTempPaths(
      repository.name,
      commitSha,
    );

    this.logger.log(`[Background] Starting download for scan ${scanId}`);

    const repositoryKey = `gitlab:${repository.id}`;
    let history: PreparedHistory | null = null;

    try {
      // The archive and the history of the scanned branch are fetched in
      // parallel. allSettled, not all: the history is always awaited, so a
      // failed download never leaves a fetch running whose files the finally
      // below could not see.
      const [archive, prepared] = await Promise.allSettled([
        this.downloadRepositoryArchive(
          repository.integration,
          repository.gitlabId,
          commitSha,
          tmpPath,
        ),
        this.prepareHistory(
          repository,
          repositoryKey,
          scanId,
          projectId,
          branch,
        ),
      ]);
      if (prepared.status === 'fulfilled') {
        history = prepared.value;
      } else {
        // prepare never throws; should it, a pass of mode none is still
        // recorded, so finalize never reads the scan as one without history.
        this.logger.warn(
          `[Background] History of scan ${scanId} not prepared: ${(prepared.reason as Error)?.message}`,
        );
        history = historyUnavailable(repositoryKey);
      }
      if (archive.status === 'rejected') {
        throw archive.reason;
      }

      const stats = fs.statSync(tmpPath);
      // Size is gated on the archive's UNCOMPRESSED total, read from the
      // central directory just before the rewrite — see `core/utils/zip-size-gate`.
      // The rewrite rejects with that gate's message, and the catch below
      // reports it as SCAN_FAILURE_SOURCE_INVALID, same as this pre-check did.

      // Validate ZIP magic bytes (PK header) by reading only first 4 bytes
      const fd = fs.openSync(tmpPath, 'r');
      const headerBuffer = Buffer.alloc(4);
      fs.readSync(fd, headerBuffer, 0, 4, 0);
      fs.closeSync(fd);

      if (headerBuffer[0] !== 0x50 || headerBuffer[1] !== 0x4b) {
        this.logger.error(
          `[Background] Invalid ZIP file for scan ${scanId}: missing PK header. First bytes: ${headerBuffer.toString('hex')}`,
        );
        this.cleanupTempFiles(tmpPath);
        await this.markScanAsFailed(
          scanId,
          'Invalid archive format received from GitLab. Expected ZIP file.',
          SCAN_FAILURE_SOURCE_INVALID,
        );
        return;
      }

      this.logger.log(
        `[Background] Downloaded ${stats.size} bytes for scan ${scanId}`,
      );

      try {
        // An `in_archive` history goes into the zip as .git; an incremental
        // one never does (it is uploaded on its own). Runs in a worker thread
        // so the heavy zip work never blocks the event loop (and thus never
        // trips the gRPC liveness probe).
        await this.processZipInWorker(
          tmpPath,
          cleanedPath,
          archiveGitDir(history),
        );
      } catch (zipError: any) {
        this.logger.error(
          `[Background] Failed to process ZIP for scan ${scanId}: ${zipError?.message}`,
        );
        this.cleanupTempFiles(tmpPath, cleanedPath);
        await this.markScanAsFailed(
          scanId,
          `Failed to process archive: ${zipError?.message || 'Unknown ZIP error'}`,
          SCAN_FAILURE_SOURCE_INVALID,
        );
        return;
      }
      this.cleanupTempFiles(tmpPath);

      // The archive upload starts the scan: the history it reads is uploaded
      // and its pass recorded first.
      if (history) {
        await this.repoHistory.publish(history, {
          scanId,
          projectId,
          typeScan,
        });
      }

      // Upload to bucket - generate URL right before upload
      const uploadStats = fs.statSync(cleanedPath);
      this.logger.log(
        `[Background] Uploading ${uploadStats.size} bytes for scan ${scanId}`,
      );
      const uploadUrl = await this.getSignedUploadUrl(
        scanId,
        projectId,
        typeScan,
      );
      await this.uploadToSignedUrl(uploadUrl, cleanedPath);
      this.cleanupTempFiles(cleanedPath);

      this.logger.log(`[Background] Upload complete for scan ${scanId}`);
    } catch (error: any) {
      this.cleanupTempFiles(tmpPath, cleanedPath);
      const msg =
        error?.message || 'Failed to download or upload repository archive';
      this.logger.error(`[Background] Error for scan ${scanId}: ${msg}`);
      await this.markScanAsFailed(scanId, msg, scanFailureCodeFromError(error));
    } finally {
      // The history's files go on every exit path (success, early return or
      // any throw).
      if (history) this.repoHistory.cleanup(history);
    }
  }

  /**
   * Start scan for last commit of GitLab repository
   */
  @Span()
  async startScanForLastCommit(
    request: StartGitlabScanRequest,
    options: RepositoryScanOptions = {},
    // The scan types a push webhook already read with the
    // project. The gRPC handler passes none and they are read at scan start.
    prefetchedTypeScan?: string,
    // The commit a push webhook names (`checkout_sha`). When
    // given, GitLab is not asked for the branch's latest commit.
    pushedCommitSha?: string,
  ): Promise<StartGitlabScanResponse> {
    this.logger.log(
      `Starting scan for last commit for repo ID: ${request.repositoryId}`,
    );
    // A re-analysis started from a closed product (`product`) is graph-only,
    // like the scan its link starts. Validated before anything is read: an
    // unknown product is INVALID_ARGUMENT. In the Community Edition a link product starts no scan at all, and a
    // manual repository scan is refused SCANNERS_NOT_AVAILABLE first.
    let graphOnly = options.graphOnly === true;
    if (!graphOnly) {
      const link = this.entitlements.decideLinkScan(request.product);
      if (link.scan === 'none') {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'SCANNERS_NOT_AVAILABLE',
        });
      }
      graphOnly = link.scan === 'graph_only';
    }

    const repository = await this.gitlabRepositoryRepository.findOne({
      where: {
        id: request.repositoryId,
        projectId: request.projectId,
      },
      relations: ['integration'],
    });

    if (!repository || !repository.integration) {
      throw new RpcException({
        message: `GitLab repository not found or not linked.`,
        code: status.NOT_FOUND,
      });
    }

    try {
      // Determine target branch: request.branch > repository.scanBranch > defaultBranch
      const targetBranch =
        request.branch ||
        repository.scanBranch ||
        repository.defaultBranch ||
        'main';
      this.logger.log(
        `Target branch for scan: ${targetBranch} (requested: ${request.branch || 'none'}, configured: ${repository.scanBranch || 'none'}, default: ${repository.defaultBranch || 'main'})`,
      );

      const commitSha =
        pushedCommitSha ??
        (await this.readLatestCommitSha(repository, targetBranch));

      return await this.startScanForCommit(
        repository,
        commitSha,
        targetBranch,
        { graphOnly },
        prefetchedTypeScan,
      );
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected internal error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to start GitLab scan for repo ${repository.id}: ${message}`,
        stack,
        GitlabService.name,
      );
      await this.createFailedScan(
        repository.projectId,
        repository.integration.organizationId,
        `Failed to get latest commit or start scan: ${message}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to start GitLab scan',
      });
    }
  }

  /**
   * Main entry point for handling all GitLab webhook events.
   * It verifies the signature and routes the event to the appropriate handler.
   */
  @Span()
  async handleWebhook(
    request: GitlabWebhookEventRequest,
  ): Promise<GitlabWebhookResponse> {
    try {
      // Parsed before the token check: the token is verified against the
      // project the payload names. An unparseable body is refused like a
      // wrong token.
      let payload: any;
      try {
        payload = JSON.parse(request.bodyJson);
      } catch {
        payload = null;
      }
      const matchedRowIds =
        payload === null
          ? []
          : await this.verifyWebhookSignature(payload, request.gitlabToken);

      if (matchedRowIds.length === 0) {
        throw new RpcException({
          message: 'Invalid webhook signature',
          code: status.UNAUTHENTICATED,
        });
      }

      // The event type is now correctly identified from the payload
      const eventType = payload.object_kind || payload.event_name;

      this.logger.log(
        `Processing GitLab webhook event: ${eventType}`,
        GitlabService.name,
      );

      switch (eventType) {
        case 'push':
          await this.handlePushEvent(payload, matchedRowIds);
          break;

        // No `project_create` case: that event comes only from a system
        // hook, which this instance never registers. A project hook's token
        // proves nothing about the user the event names, so the event is
        // ignored like any other unhandled kind.

        case 'project_destroy':
          // The payload for project_destroy contains the project_id
          await this.handleProjectDestroyEvent(
            payload.project_id,
            matchedRowIds,
          );
          break;

        case 'project_rename':
        case 'project_transfer':
          await this.handleProjectUpdateEvent(payload, matchedRowIds);
          break;

        default:
          this.logger.log(
            `Unhandled GitLab webhook event type: ${eventType}`,
            GitlabService.name,
          );
      }

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected internal error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to handle GitLab webhook: ${message}`,
        stack,
        GitlabService.name,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to handle GitLab webhook',
      });
    }
  }

  /**
   * Verifies the `X-Gitlab-Token` of a webhook delivery.
   *
   * Each project hook is registered with its own random token and only its
   * SHA-256 is stored on the project's rows (`webhookTokenHash`). The token
   * is checked against the hashes of the project the payload names, never
   * against a deployment-wide secret: a token authenticates the events of
   * one project only. A payload naming no project, or two different ones, or
   * an untracked project, is refused.
   *
   * Hooks registered by earlier versions carried the OAuth application
   * secret. That token is accepted only for a project none of whose rows
   * holds a hash yet, and only while GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED is
   * on (off by default); each acceptance is logged, without the token. The
   * `gitlab-webhook-token-migration` task gives every such hook its own
   * token.
   *
   * Every comparison runs in constant time; a missing token or secret
   * refuses the webhook.
   *
   * Several organisations may track the same GitLab project, each row with
   * its own hook and token. The answer is the ids of the rows the token
   * authenticates (empty when refused), and the event acts on those rows
   * only, never on another organisation's.
   */
  private async verifyWebhookSignature(
    payload: unknown,
    token: string | undefined,
  ): Promise<string[]> {
    if (!token) {
      return [];
    }
    const gitlabProjectId = gitlabProjectIdOf(payload);
    if (gitlabProjectId === null) {
      return [];
    }

    const rows = await this.gitlabRepositoryRepository.find({
      where: { gitlabId: gitlabProjectId },
      select: { id: true, webhookTokenHash: true },
    });
    if (rows.length === 0) {
      return [];
    }

    if (rows.some((row) => row.webhookTokenHash)) {
      // Every row is compared: no early return.
      return rows
        .filter((row) => webhookTokenMatches(token, [row.webhookTokenHash]))
        .map((row) => row.id);
    }

    if (
      !legacyWebhookTokenAccepted(
        this.configService.get('GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED'),
      )
    ) {
      return [];
    }
    const applicationSecret = await this.secretsService.getSecret(
      'GITLAB_APPLICATION_SECRET',
    );
    if (!constantTimeStringEquals(token, applicationSecret)) {
      return [];
    }
    this.logger.warn(
      `GITLAB_WEBHOOK_LEGACY_TOKEN accepted gitlabProject=${gitlabProjectId}`,
      GitlabService.name,
    );
    // The deployment-wide secret authenticates every row of the project.
    return rows.map((row) => row.id);
  }

  /**
   * Handles the 'project_destroy' event.
   * Deletes the repository rows the delivery's token authenticated.
   * @param gitlabProjectId The ID of the destroyed GitLab project.
   * @param rowIds The rows the webhook token matched.
   */
  private async handleProjectDestroyEvent(
    gitlabProjectId: number,
    rowIds: string[],
  ): Promise<void> {
    this.logger.log(
      `Handling project_destroy event for project ID: ${gitlabProjectId}`,
      GitlabService.name,
    );
    // This is a safe deletion. It will only remove the repository if it exists.
    const result = await this.gitlabRepositoryRepository.delete({
      id: In(rowIds),
    });
    if (result.affected > 0) {
      this.logger.log(
        `Successfully deleted repository record for project ID: ${gitlabProjectId}`,
      );
    }
  }

  /**
   * Handles 'project_rename' and 'project_transfer' events.
   * Updates the repository rows the delivery's token authenticated.
   * @param payload The webhook payload containing the project update details.
   * @param rowIds The rows the webhook token matched.
   */
  private async handleProjectUpdateEvent(
    payload: any,
    rowIds: string[],
  ): Promise<void> {
    const { project_id, path_with_namespace, name } = payload;
    this.logger.log(
      `Handling project update event for project ID: ${project_id}`,
      GitlabService.name,
    );

    const repositories = await this.gitlabRepositoryRepository.find({
      where: { id: In(rowIds) },
    });
    if (repositories.length === 0) {
      this.logger.warn(
        `Received update event for untracked project ID: ${project_id}. It might need to be created first.`,
      );
      return;
    }

    for (const repository of repositories) {
      repository.name = name;
      repository.path = payload.path;
      repository.nameWithNamespace = path_with_namespace;
      repository.pathWithNamespace = path_with_namespace;
      await this.gitlabRepositoryRepository.save(repository);
    }
    this.logger.log(
      `Successfully updated repository record for project: ${name}`,
    );
  }

  /**
   * Private method: Exchange OAuth authorization code for access token
   */
  private async exchangeCodeForToken(
    code: string,
  ): Promise<GitlabTokenResponse> {
    // Refuse before any HTTP call when no GitLab OAuth app is set.
    this.assertGitlabConfigured();
    const tokenUrl = this.urls.oauthToken;

    const response: AxiosResponse<GitlabTokenResponse> = await axios.post(
      tokenUrl,
      {
        client_id: this.gitlabApplicationId,
        client_secret: this.gitlabApplicationSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.gitlabRedirectUri,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data;
  }

  /**
   * Private method: Get GitLab user information
   */
  private async getGitlabUser(accessToken: string): Promise<GitlabUser> {
    const response = await axios.get<GitlabUser>(`${this.gitlabApiUrl}/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  /**
   * Private method: Create or update GitLab integration
   */
  private async createOrUpdateIntegration(
    organizationId: string,
    userId: string,
    gitlabUser: GitlabUser,
    tokenResponse: GitlabTokenResponse,
  ): Promise<GitlabIntegration> {
    let integration = await this.gitlabIntegrationRepository.findOne({
      where: { organizationId },
    });

    if (!integration) {
      integration = new GitlabIntegration();
      integration.organizationId = organizationId;
    }

    integration.userId = userId;
    integration.gitlabUserId = gitlabUser.id;
    integration.accessToken = await this.encryptToken(
      tokenResponse.access_token,
    );
    integration.refreshToken = await this.encryptToken(
      tokenResponse.refresh_token,
    );
    integration.tokenExpiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000,
    );
    integration.refreshTokenExpiresAt = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 an
    );
    integration.scope = tokenResponse.scope;
    integration.reconnectRequiredAt = null;

    return await this.gitlabIntegrationRepository.save(integration);
  }

  /**
   * Private method: Synchronize GitLab repositories
   */
  private async syncRepositories(
    integration: GitlabIntegration,
  ): Promise<void> {
    const projects = await this.fetchUserProjects(integration); // MODIFICATION
    let failed = 0;

    for (const project of projects) {
      // Importing ONE repository is never worth failing the whole install for.
      // A single unpersistable project used to escape this loop, abort the
      // OAuth callback and hand the user an HTTP 500 at the end of an install
      // that had otherwise succeeded — the integration was created and every
      // earlier repository was already committed (each save() is its own
      // transaction). Skip the project, keep the import going, and leave a log
      // line that names it.
      try {
        await this.createOrUpdateRepository(integration, project);
      } catch (error) {
        failed++;
        this.logger.error(
          `GITLAB_SYNC_REPO_FAILED org=${integration.organizationId} project=${
            project.path_with_namespace || project.id
          } (gitlabId=${project.id}): ${error?.message}`,
          error?.stack,
          GitlabService.name,
        );
      }
    }

    if (failed > 0) {
      this.logger.warn(
        `GITLAB_SYNC_PARTIAL org=${integration.organizationId}: ${
          projects.length - failed
        }/${projects.length} repositories imported, ${failed} skipped`,
        GitlabService.name,
      );
    }
  }

  /**
   * Private method: Fetch user projects from GitLab API
   */
  private async fetchUserProjects(
    integration: GitlabIntegration,
  ): Promise<GitlabProject[]> {
    // GitLab paginates the /projects listing (100 per page max). Follow the
    // `X-Next-Page` response header to import EVERY project, not just the first
    // page — otherwise a user with >100 projects never gets the rest imported.
    // The next-page value is server-controlled, so the loop is bounded by a
    // LOCAL iteration counter (a constant/cyclic header would otherwise spin
    // forever). syncRepositories only upserts, so a truncated page list simply
    // means a partial import this run — never a destructive delete.
    const PER_PAGE = 100;
    const MAX_PAGES = 100;
    const projects: GitlabProject[] = [];
    let page = 1;
    let pagesFetched = 0;

    while (true) {
      const response = await this.callGitlabApi<GitlabProject[]>(
        integration,
        (accessToken) =>
          axios.get(
            `${this.gitlabApiUrl}/projects?membership=true&per_page=${PER_PAGE}&page=${page}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          ),
      );
      projects.push(...response.data);
      pagesFetched++;
      // Axios lower-cases response header keys, so `x-next-page` is canonical.
      const nextPage = Number(response.headers?.['x-next-page']);
      if (!nextPage) break;
      if (pagesFetched >= MAX_PAGES) {
        this.logger.warn(
          `GITLAB_SYNC_PROJECTS org=${integration.organizationId} hit page cap ${MAX_PAGES}; project list may be truncated`,
          GitlabService.name,
        );
        break;
      }
      page = nextPage;
    }

    return projects;
  }

  /**
   * Maximum number of characters `gitlab_repositories` stores for each
   * DISPLAY-ONLY column, mirroring
   * {@link ../../core/migrations/1785110400000-WidenGitlabRepositoryTextColumns}.
   *
   * Only display fields appear here. Truncating an identifier — `path`,
   * `pathWithNamespace`, a clone URL, the default branch — would store a
   * repository we can no longer clone or scan, turning a loud INSERT rejection
   * into silent corruption. Those are left verbatim; if one still does not fit,
   * the per-repository guard in {@link syncRepositories} skips that project and
   * logs it.
   *
   * `description` is capped at GitLab's own 2000-character limit even though
   * the column is now TEXT, so an upstream limit change cannot reach MySQL as
   * an oversized value.
   */
  private static readonly DISPLAY_COLUMN_LIMITS: Record<string, number> = {
    name: 255,
    nameWithNamespace: 512,
    description: 2000,
  };

  /**
   * Clamps a GitLab-supplied string to what the column can store, counting
   * CODE POINTS rather than UTF-16 units: MySQL counts a 4-byte character (an
   * emoji) as one character, and a naive `slice` could cut a surrogate pair in
   * half and produce a lone surrogate MySQL rejects outright.
   */
  private clampToColumn<T>(value: T, max: number): T {
    if (typeof value !== 'string') {
      return value;
    }
    const codePoints = Array.from(value);
    if (codePoints.length <= max) {
      return value;
    }
    return codePoints.slice(0, max).join('') as unknown as T;
  }

  /**
   * Private method: Create or update repository record
   */
  private async createOrUpdateRepository(
    integration: GitlabIntegration,
    project: GitlabProject,
  ): Promise<void> {
    let repository = await this.gitlabRepositoryRepository.findOne({
      where: {
        gitlabId: project.id,
        integrationId: integration.id,
      },
    });

    if (!repository) {
      repository = new GitlabRepository();
      repository.integrationId = integration.id;
      repository.gitlabId = project.id;
    }

    const limits = GitlabService.DISPLAY_COLUMN_LIMITS;
    repository.name = this.clampToColumn(project.name, limits.name);
    repository.nameWithNamespace = this.clampToColumn(
      project.name_with_namespace,
      limits.nameWithNamespace,
    );
    repository.path = project.path;
    repository.pathWithNamespace = project.path_with_namespace;
    repository.private = project.visibility === 'private';
    repository.defaultBranch = project.default_branch;
    repository.description = this.clampToColumn(
      project.description,
      limits.description,
    );
    repository.webUrl = project.web_url;
    repository.sshUrlToRepo = project.ssh_url_to_repo;
    repository.httpUrlToRepo = project.http_url_to_repo;

    await this.gitlabRepositoryRepository.save(repository);
  }

  /**
   * Private method: Map repository entity to response DTO
   */
  private mapRepositoryToResponse(
    repository: GitlabRepository,
  ): GitlabLinkRepositoryResponse {
    return {
      id: repository.id,
      gitlabId: repository.gitlabId,
      name: repository.name,
      nameWithNamespace: repository.nameWithNamespace,
      path: repository.path,
      pathWithNamespace: repository.pathWithNamespace,
      private: repository.private,
      defaultBranch: repository.defaultBranch || '',
      projectId: repository.projectId || '',
      createdAt: repository.createdAt.toISOString(),
      updatedAt: repository.updatedAt.toISOString(),
      scanBranch: repository.scanBranch || '',
    };
  }

  /**
   * The latest commit of a branch, from the GitLab API. Used when the caller
   * does not name the commit: a manual scan, the initial scan of a linked
   * repository, or a push payload without a usable `checkout_sha`.
   */
  @Span()
  private async readLatestCommitSha(
    repository: GitlabRepository,
    branch: string,
  ): Promise<string> {
    const accessToken = await this.decryptToken(
      repository.integration.accessToken,
    );
    if (!accessToken) {
      throw new TypeError('Failed to decrypt access token for API call.');
    }

    const latestCommit = await this.getLatestCommit(
      repository.integration,
      repository.gitlabId,
      branch,
    );

    if (!latestCommit || !latestCommit.id) {
      throw new TypeError(`No commits found on branch ${branch}.`);
    }

    this.logger.log(
      `Found latest commit: ${latestCommit.id} for repo ${repository.name} on branch ${branch}`,
    );
    return latestCommit.id;
  }

  /**
   * The repository's branch named `branch`, spelled as the repository spells
   * it, or null when it has none, as GithubService.findBranch: the
   * synced branches first, then GitLab for a branch a webhook has not brought
   * yet (kept, best effort). Only GitLab's "404 Branch Not Found" is null;
   * another 404 (the project is gone or out of reach) is FAILED_PRECONDITION;
   * any other failure is UNAVAILABLE, never null.
   */
  @Span()
  async findBranch(
    repository: GitlabRepository,
    branch: string,
  ): Promise<string | null> {
    const synced = await this.gitlabBranchRepository.findOne({
      where: { repositoryId: repository.id, name: branch },
    });
    if (synced) return synced.name;

    let data: { name?: unknown; protected?: unknown };
    try {
      ({ data } = await this.callGitlabApi(repository.integration, (token) =>
        axios.get(
          `${this.gitlabApiUrl}/projects/${repository.gitlabId}/repository/branches/${encodeURIComponent(branch)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      ));
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        const answer = (error.response.data as { message?: unknown })?.message;
        if (answer === '404 Branch Not Found') return null;
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `The GitLab project linked to this project (${repository.pathWithNamespace}) cannot be read; check the GitLab integration.`,
        });
      }
      this.logger.warn(
        `BRANCH_CHECK provider=gitlab outcome=unavailable repo=${repository.id}: ${(error as Error)?.message}`,
        GitlabService.name,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: `Could not check branch "${branch}" with GitLab; retry later.`,
      });
    }

    const name = typeof data?.name === 'string' ? data.name : branch;
    await this.gitlabBranchRepository
      .upsert(
        {
          repositoryId: repository.id,
          name,
          isProtected: data?.protected === true,
        },
        { conflictPaths: ['repositoryId', 'name'] },
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `BRANCH_CHECK provider=gitlab outcome=not_kept repo=${repository.id}: ${(error as Error)?.message}`,
          GitlabService.name,
        ),
      );
    return name;
  }

  /**
   * Private method: Get latest commit from GitLab API
   */
  private async getLatestCommit(
    integration: GitlabIntegration,
    projectId: number,
    branch: string,
  ): Promise<any> {
    const encodedBranch = encodeURIComponent(branch);
    const response = await this.callGitlabApi(integration, (accessToken) =>
      axios.get(
        `${this.gitlabApiUrl}/projects/${projectId}/repository/commits?ref_name=${encodedBranch}&per_page=1`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );

    if (!response.data || response.data.length === 0) {
      return null;
    }
    return response.data[0];
  }

  /**
   * Private method: Download repository archive directly to disk (streaming).
   * Prevents memory saturation for large repositories.
   *
   * Wrapped in `downloadArchiveWithRetry` so GitLab's 429 (and any 5xx) is
   * retried with the delay GitLab asks for instead of failing the scan on the
   * first refusal; it throws a coded `ArchiveDownloadError` once it gives up.
   * Each attempt goes through `callGitlabApi`, so a retry also gets a freshly
   * refreshed access token.
   */
  private async downloadRepositoryArchive(
    integration: GitlabIntegration,
    projectId: number,
    sha: string,
    outputPath: string,
  ): Promise<void> {
    await downloadArchiveWithRetry({
      label: 'GitLab',
      outputPath,
      logger: this.logger,
      attempt: (timeoutMs) =>
        this.callGitlabApi(integration, (accessToken) =>
          axios.get(
            `${this.gitlabApiUrl}/projects/${projectId}/repository/archive.zip?sha=${sha}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              responseType: 'stream',
              timeout: timeoutMs,
            },
          ),
        ),
    });
  }

  /**
   * Private method: Handle push webhook events.
   *
   * GitLab signals branch lifecycle inside the regular `push` event:
   *   - `before === SHA_ZERO` → branch creation
   *   - `after === SHA_ZERO`  → branch deletion
   *   - otherwise             → normal push (refresh `lastSeenAt`)
   *
   * Branch tracking happens for every push to a known repository, including
   * unlinked repos (no CybeDefend `projectId`). The scan trigger is gated on
   * `projectId` being set and the pushed branch matching `scanBranch ||
   * defaultBranch` — preserving the legacy behaviour for linked repos.
   *
   * Webhook events incrementally maintain branch rows but never set
   * `branchesSyncedAt`. That stamp belongs to the lazy-fill path (Task C):
   * the first `getBranches` call still reconciles the full list from the
   * GitLab API; webhooks keep it fresh after that.
   */
  @Span()
  private async handlePushEvent(
    payload: any,
    rowIds?: string[],
  ): Promise<void> {
    const projectId = payload?.project?.id;
    const ref = payload?.ref;

    if (!projectId || !ref) {
      return;
    }

    // Find the repository regardless of CybeDefend linkage — we still want
    // to track branches on repos that haven't been linked yet. Only among
    // the rows the delivery's token authenticated, when given.
    const repository = await this.gitlabRepositoryRepository.findOne({
      where: {
        gitlabId: projectId,
        ...(rowIds ? { id: In(rowIds) } : {}),
      },
      relations: ['integration'],
    });

    if (!repository) {
      this.logger.warn(
        `BRANCHES_WEBHOOK event=push provider=gitlab outcome=skipped reason=unknown_repo gitlabId=${projectId}`,
        GitlabService.name,
      );
      return;
    }

    // Branch-lifecycle short-circuits. Tag refs and non-branch refs fall
    // through unchanged so the legacy scan-trigger logic still applies.
    if (isBranchRef(ref)) {
      const branchName = extractBranchName(ref);

      if (isBranchCreation(payload)) {
        await this.gitlabBranchRepository.upsert(
          {
            repositoryId: repository.id,
            name: branchName,
            isProtected: false,
          },
          { conflictPaths: ['repositoryId', 'name'] },
        );
        this.logger.log(
          `BRANCHES_WEBHOOK event=create provider=gitlab outcome=upserted repo=${repository.id} branch=${branchName}`,
          GitlabService.name,
        );
        // Branch creation alone doesn't trigger a scan — the next push with
        // real commits will.
        return;
      }

      if (isBranchDeletion(payload)) {
        await this.gitlabBranchRepository.delete({
          repositoryId: repository.id,
          name: branchName,
        });
        this.logger.log(
          `BRANCHES_WEBHOOK event=delete provider=gitlab outcome=deleted repo=${repository.id} branch=${branchName}`,
          GitlabService.name,
        );
        return;
      }

      // Normal push to an existing branch — refresh the row so `lastSeenAt`
      // gets bumped. Idempotent on the (repositoryId, name) unique index.
      await this.gitlabBranchRepository.upsert(
        {
          repositoryId: repository.id,
          name: branchName,
          isProtected: false,
        },
        { conflictPaths: ['repositoryId', 'name'] },
      );
      this.logger.log(
        `BRANCHES_WEBHOOK event=push provider=gitlab outcome=upserted repo=${repository.id} branch=${branchName}`,
        GitlabService.name,
      );
    }

    // Legacy scan-trigger logic — unchanged in behaviour, but now gated
    // inline on `projectId` so we don't trigger scans for unlinked repos.
    if (!repository.projectId) {
      return;
    }

    const pushBranch = extractBranchName(ref);
    const targetBranch = repository.scanBranch || repository.defaultBranch;

    if (pushBranch !== targetBranch) {
      this.logger.log(
        `GitLab push to ${pushBranch} ignored, scanning only ${targetBranch}`,
        GitlabService.name,
      );
      return;
    }

    // Per-project opt-out: the owner disabled scan-on-commit for this project.
    // Checked here rather than inside startScanForLastCommit so that manual
    // scans and the initial scan fired when a repository is linked keep working.
    const pushSettings = await this.readPushProjectSettings(
      repository.projectId,
    );
    if (!pushSettings.scanOnCommitEnabled) {
      this.logger.log(
        `WEBHOOK_IGNORED_SCAN_ON_COMMIT_DISABLED project=${repository.projectId} repo=${repository.name}`,
        GitlabService.name,
      );
      return;
    }

    // As on GitHub, the push scans what the PROJECT is. An AppSec project
    // whose AppSec is writable (failing open when the entitlements cannot be
    // read) gets an AppSec scan;
    // otherwise a graph-only scan when the graph-only product is active; otherwise
    // nothing. An unreadable mark or product state keeps the former AppSec
    // path behind its writability gate.
    const organizationId = repository.integration?.organizationId;
    const pushScan = await this.entitlements.decidePushScan(
      organizationId,
      pushSettings.appsecProject,
    );
    if (pushScan.scan === 'none') {
      this.logger.log(
        `WEBHOOK_IGNORED_${webhookIgnoredLabel(pushScan.reason)} org=${organizationId} project=${repository.projectId} repo=${repository.name}`,
        GitlabService.name,
      );
      return;
    }

    const commitSha = pushedCommitSha(payload);
    if (pushScan.scan === 'graph_only') {
      await this.startGraphOnlyPushScan(
        repository,
        targetBranch,
        pushSettings.typeScan,
        commitSha,
      );
      return;
    }

    this.logger.log(
      `GitLab push event to target branch ${pushBranch}, triggering scan for repository ${repository.name}`,
      GitlabService.name,
    );

    try {
      await this.startScanForLastCommit(
        {
          repositoryId: repository.id,
          projectId: repository.projectId,
          branch: targetBranch,
        },
        {},
        pushSettings.typeScan,
        commitSha,
      );
    } catch (error: unknown) {
      // A scan of the branch is running. The pushed commit is
      // scanned once it ends, instead of a failed scan row.
      if (
        commitSha &&
        (await this.deferRefusedPush(error, {
          provider: 'gitlab',
          projectId: repository.projectId,
          branch: targetBranch,
          commitSha,
          gitlabRepositoryId: repository.id,
        }))
      ) {
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Unexpected internal error';
      const stack = error instanceof Error ? error.stack : undefined;

      if (isGrpcClientError(error)) {
        this.logger.warn(
          `Scan not started for repository ${repository.name}: ${message}`,
          GitlabService.name,
        );
      } else {
        this.logger.error(
          `Failed to start scan for repository ${repository.name}: ${message}`,
          stack,
          GitlabService.name,
        );
      }
      await this.createFailedScan(
        repository.projectId,
        repository.integration.organizationId,
        `Failed to start scan for push event: ${message}`,
      );
    }
  }

  /**
   * A push on a project that is not an AppSec project, or whose AppSec is not
   * writable, while the graph-only product is active: a
   * graph-only scan of the pushed commit keeps the code graph fresh.
   *
   * A refusal by the graph-only limits (one in flight per project, three per
   * organisation) is deferred with the pushed commit, like an AppSec push
   * refused by a running scan: the graph-only scan
   * in flight parses an EARLIER commit, so dropping the push would leave the
   * graph behind the branch. When it cannot be deferred (no commit in the
   * payload, Redis failed), one line says so. It is not an AppSec scan, so no
   * failure writes a failed scan row here, as for the graph-only scan a link
   * starts.
   */
  private async startGraphOnlyPushScan(
    repository: GitlabRepository,
    branch: string,
    typeScan: string | undefined,
    commitSha: string | undefined,
  ): Promise<void> {
    const organizationId = repository.integration?.organizationId;
    const where = `org=${organizationId} project=${repository.projectId} repo=${repository.name} commit=${commitSha ?? 'latest'}`;
    this.logger.log(`WEBHOOK_PUSH_GRAPH_ONLY ${where}`, GitlabService.name);
    try {
      await this.startScanForLastCommit(
        {
          repositoryId: repository.id,
          projectId: repository.projectId,
          branch,
        },
        { graphOnly: true },
        typeScan,
        commitSha,
      );
    } catch (error: unknown) {
      if (isGraphOnlyLimitReached(error)) {
        const deferred =
          commitSha !== undefined &&
          (await this.deferRefusedPush(error, {
            provider: 'gitlab',
            projectId: repository.projectId,
            branch,
            commitSha,
            gitlabRepositoryId: repository.id,
          }));
        if (!deferred) {
          this.logger.log(
            `WEBHOOK_IGNORED_GRAPH_ONLY_LIMIT ${where}`,
            GitlabService.name,
          );
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (isGrpcClientError(error)) {
        this.logger.warn(
          `Graph-only scan not started for repository ${repository.name}: ${message}`,
          GitlabService.name,
        );
      } else {
        this.logger.error(
          `Graph-only scan failed for repository ${repository.name}: ${message}`,
          error instanceof Error ? error.stack : undefined,
          GitlabService.name,
        );
      }
    }
  }

  /**
   * Private method: Handle repository webhook events
   */
  private async handleRepositoryEvent(payload: any): Promise<void> {
    const projectId = payload.project?.id;
    const action = payload.action;

    if (!projectId) {
      return;
    }

    this.logger.log(
      `GitLab repository event: ${action} for project ${projectId}`,
      GitlabService.name,
    );

    // Handle repository deletion, renaming, etc.
    if (action === 'delete') {
      await this.gitlabRepositoryRepository.delete({ gitlabId: projectId });
    }
  }

  /**
   * Encrypts a string using AES-256-GCM.
   * The output format is "iv:authTag:encryptedData" in hex encoding.
   * @param token The plaintext string to encrypt.
   * @returns The encrypted string, or null if encryption fails.
   */
  private async encryptToken(token: string): Promise<string | null> {
    try {
      const key = Buffer.from(this.keyHex, 'hex');

      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      });

      const encrypted = Buffer.concat([
        cipher.update(token, 'utf8'),
        cipher.final(),
      ]);

      const authTag = cipher.getAuthTag();

      return `${iv.toString('hex')}:${authTag.toString(
        'hex',
      )}:${encrypted.toString('hex')}`;
    } catch (error) {
      this.logger.error(
        'Failed to encrypt token',
        error.stack,
        GitlabService.name,
      );
      return null;
    }
  }

  /**
   * Decrypts a string encrypted with AES-256-GCM.
   * Expects the input format "iv:authTag:encryptedData" in hex encoding.
   * @param encryptedToken The encrypted string to decrypt.
   * @returns The decrypted plaintext string, or null if decryption fails.
   */
  private async decryptToken(encryptedToken: string): Promise<string | null> {
    if (!encryptedToken) {
      return null;
    }

    try {
      const key = Buffer.from(this.keyHex, 'hex');

      const parts = encryptedToken.split(':');
      if (parts.length !== 3) {
        throw new TypeError('Invalid encrypted token format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');

      if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
        throw new TypeError(`Auth-tag length is invalid`);
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      });

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error(
        'Failed to decrypt token. The token may be malformed or tampered with.',
        error.stack,
        GitlabService.name,
      );
      return null;
    }
  }

  /**
   * Refreshes the GitLab access token using the refresh token.
   * Uses a Redis lock to prevent concurrent refresh attempts (GitLab invalidates
   * refresh tokens after single use, so concurrent refreshes cause failures).
   * @param integration The GitLabIntegration entity.
   * @returns The new, valid access token.
   * @throws RpcException if the refresh fails.
   */
  private async refreshAccessToken(
    integration: GitlabIntegration,
  ): Promise<string> {
    // Refuse before taking the refresh lock when GitLab is not set.
    this.assertGitlabConfigured();
    const lockKey = `gitlab_token_refresh:${integration.id}`;
    const lockTTL = 30; // 30 seconds max lock duration

    // Try to acquire lock with SET NX EX (atomic operation)
    const lockAcquired = await this.redisClient.set(
      lockKey,
      'locked',
      'EX',
      lockTTL,
      'NX',
    );

    if (!lockAcquired) {
      // Another process is refreshing, wait and retry with fresh data from DB
      this.logger.log(
        `Token refresh already in progress for org ${integration.organizationId}, waiting...`,
      );

      // Wait for the other refresh to complete (poll every 500ms, max 10s)
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check if lock is released
        const stillLocked = await this.redisClient.get(lockKey);
        if (!stillLocked) {
          break;
        }
      }

      // Reload integration from DB to get the freshly refreshed token
      const freshIntegration = await this.gitlabIntegrationRepository.findOne({
        where: { id: integration.id },
      });

      if (!freshIntegration) {
        throw new RpcException({
          message: 'GitLab integration not found',
          code: status.NOT_FOUND,
        });
      }

      // Check if token was actually refreshed
      const tokenExpiresAt = freshIntegration.tokenExpiresAt
        ? new Date(freshIntegration.tokenExpiresAt).getTime()
        : 0;
      const now = Date.now();

      if (tokenExpiresAt > now + 60000) {
        // Token was refreshed by the other process, decrypt and return it
        const decryptedToken = await this.decryptToken(
          freshIntegration.accessToken,
        );
        if (decryptedToken) {
          this.logger.log(
            `Using token refreshed by another process for org ${integration.organizationId}`,
          );
          return decryptedToken;
        }
      }

      // Token still expired, try to refresh ourselves (recursive call will acquire lock)
      return this.refreshAccessToken(freshIntegration);
    }

    // We have the lock, proceed with refresh
    this.logger.log(
      `Refreshing access token for organization ${integration.organizationId}`,
    );

    // The encrypted refresh token sent to GitLab, so a refusal marks the
    // connection only while the row still holds it.
    let sentRefreshToken: string | null = null;

    try {
      // Reload from DB to ensure we have the latest refresh token
      const latestIntegration = await this.gitlabIntegrationRepository.findOne({
        where: { id: integration.id },
      });

      if (!latestIntegration) {
        throw new RpcException({
          message: 'GitLab integration not found',
          code: status.NOT_FOUND,
        });
      }

      const decryptedRefreshToken = await this.decryptToken(
        latestIntegration.refreshToken,
      );
      if (!decryptedRefreshToken) {
        throw new TypeError('Failed to decrypt refresh token.');
      }

      sentRefreshToken = latestIntegration.refreshToken;

      const tokenUrl = this.urls.oauthToken;

      const params = new URLSearchParams();
      params.append('client_id', this.gitlabApplicationId);
      params.append('client_secret', this.gitlabApplicationSecret);
      params.append('refresh_token', decryptedRefreshToken);
      params.append('grant_type', 'refresh_token');
      params.append('redirect_uri', this.gitlabRedirectUri);

      const response: AxiosResponse<GitlabTokenResponse> = await axios.post(
        tokenUrl,
        params,
        { timeout: GITLAB_TOKEN_REFRESH_TIMEOUT_MS },
      );

      const tokenResponse = response.data;

      latestIntegration.accessToken = await this.encryptToken(
        tokenResponse.access_token,
      );
      latestIntegration.refreshToken = await this.encryptToken(
        tokenResponse.refresh_token,
      );
      latestIntegration.tokenExpiresAt = new Date(
        Date.now() + tokenResponse.expires_in * 1000,
      );
      latestIntegration.reconnectRequiredAt = null;

      await this.gitlabIntegrationRepository.save(latestIntegration);
      this.logger.log(
        `Successfully refreshed and saved new token for organization ${integration.organizationId}`,
      );

      return tokenResponse.access_token;
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }

      if (sentRefreshToken && isRevokedGrant(error)) {
        await flagReconnectRequired(
          this.gitlabIntegrationRepository,
          this.logger,
          integration,
          sentRefreshToken,
        );
      }

      const message =
        error instanceof Error ? error.message : 'Unexpected internal error';
      const stack = error instanceof Error ? error.stack : undefined;
      const httpStatus = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;

      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        this.logger.warn(
          `GitLab rejected the token refresh for organization ${integration.organizationId}: ${message}`,
        );
      } else {
        this.logger.error(
          `Failed to refresh GitLab token for organization ${integration.organizationId}: ${message}`,
          stack,
        );
      }
      const code =
        httpStatus === 429
          ? status.RESOURCE_EXHAUSTED
          : httpStatus === 502 || httpStatus === 503
            ? status.UNAVAILABLE
            : httpStatus === 504
              ? status.DEADLINE_EXCEEDED
              : httpStatus !== undefined && httpStatus >= 500
                ? status.INTERNAL
                : status.UNAUTHENTICATED;
      throw new RpcException({
        message:
          code === status.UNAUTHENTICATED
            ? 'Failed to refresh GitLab access token. Please reinstall the integration.'
            : code === status.RESOURCE_EXHAUSTED
              ? 'GitLab token refresh rate limit exceeded'
              : 'GitLab token refresh is temporarily unavailable',
        code,
      });
    } finally {
      // Always release the lock
      await this.redisClient.del(lockKey);
    }
  }

  /**
   * Creates a webhook in the GitLab project for continuous scanning, or
   * takes over the hook of ours already there (another connection may have
   * linked the same project). Either way the hook gets a fresh random token,
   * whose hash is stored on every row of the project.
   * @param repository The repository entity to create the webhook for.
   */
  private async createProjectWebhook(
    repository: GitlabRepository,
  ): Promise<void> {
    const { integration, gitlabId } = repository;
    this.logger.log(
      `Attempting to create webhook for GitLab project ID: ${gitlabId}`,
    );
    try {
      const webhookUrl = this.webhookEndpoint();

      // 1. Check if a webhook for our URL already exists
      const existingHooksResponse = await this.callGitlabApi(
        integration,
        (accessToken) =>
          axios.get(`${this.gitlabApiUrl}/projects/${gitlabId}/hooks`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
      );

      const existingHook = (existingHooksResponse.data || []).find(
        (hook: any) => hook?.url === webhookUrl,
      );

      if (existingHook) {
        const hash = await this.withFreshWebhookToken(gitlabId, (token) =>
          this.callGitlabApi(integration, (accessToken) =>
            axios.put(
              `${this.gitlabApiUrl}/projects/${gitlabId}/hooks/${existingHook.id}`,
              this.hookSettings(webhookUrl, token),
              { headers: { Authorization: `Bearer ${accessToken}` } },
            ),
          ),
        );
        this.logger.log(
          `Webhook already exists for project ${gitlabId} with ID ${existingHook.id}. Token renewed, ID stored.`,
        );
        repository.webhookId = existingHook.id;
        repository.webhookTokenHash = hash;
        await this.gitlabRepositoryRepository.save(repository);
        return;
      }

      // 2. If not, create a new one
      let newHookId: number;
      const hash = await this.withFreshWebhookToken(gitlabId, async (token) => {
        const createHookResponse = await this.callGitlabApi(
          integration,
          (accessToken) =>
            axios.post(
              `${this.gitlabApiUrl}/projects/${gitlabId}/hooks`,
              this.hookSettings(webhookUrl, token),
              { headers: { Authorization: `Bearer ${accessToken}` } },
            ),
        );
        newHookId = createHookResponse.data.id;
      });

      repository.webhookId = newHookId;
      repository.webhookTokenHash = hash;
      await this.gitlabRepositoryRepository.save(repository);
      this.logger.log(
        `Successfully created webhook ${newHookId} for project ${gitlabId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create webhook for GitLab project ${gitlabId}: ${error.message}`,
        error.stack,
      );
      // We don't throw an error here to avoid failing the entire link operation.
    }
  }

  /** Our webhook endpoint on the gateway. */
  private webhookEndpoint(): string {
    const gatewayUrl = this.configService
      .get<string>('GATEWAY_URL')
      .replaceAll(/\/$/g, '');
    return `${gatewayUrl}/webhooks/gitlab`;
  }

  /** The settings every hook of ours is registered with. */
  private hookSettings(url: string, token: string) {
    return {
      url,
      token,
      push_events: true,
      merge_requests_events: true,
      enable_ssl_verification: true,
    };
  }

  /**
   * Draws a fresh webhook token, hands it to `register` (the POST or PUT of
   * the hook on GitLab), then stores its hash on every row of the GitLab
   * project, which all share that one hook. Nothing is stored when the
   * registration fails, so the hook keeps answering with its previous token.
   * Returns the stored hash; the token itself never leaves this call.
   */
  private async withFreshWebhookToken(
    gitlabProjectId: number,
    register: (token: string) => Promise<unknown>,
  ): Promise<string> {
    const token = generateWebhookToken();
    await register(token);
    const hash = hashWebhookToken(token);
    await this.gitlabRepositoryRepository.update(
      { gitlabId: gitlabProjectId },
      { webhookTokenHash: hash },
    );
    return hash;
  }

  /**
   * Gives the webhook of one GitLab project a fresh random token: the
   * migration of the hooks registered with the OAuth application secret
   * (task `gitlab-webhook-token-migration`).
   *
   * Tries each connection that tracks the project until one can read its
   * hooks; the hook of ours keeps its event settings and gets a new token,
   * whose hash goes on every row of the project. Without a hook of ours the
   * rows get the hash of a token no one holds, so the legacy token stops
   * being accepted for them too.
   *
   * Never throws: `failed` leaves the rows as they were, for a later run.
   */
  async rotateWebhookToken(
    gitlabProjectId: number,
  ): Promise<'rotated' | 'no_hook' | 'failed'> {
    const rows = await this.gitlabRepositoryRepository.find({
      where: { gitlabId: gitlabProjectId },
      relations: ['integration'],
    });
    const integrations = new Map<string, GitlabIntegration>();
    for (const row of rows) {
      if (row.integration)
        integrations.set(row.integration.id, row.integration);
    }

    const webhookUrl = this.webhookEndpoint();
    for (const integration of integrations.values()) {
      try {
        const hooks = await this.callGitlabApi<any[]>(
          integration,
          (accessToken) =>
            axios.get(
              `${this.gitlabApiUrl}/projects/${gitlabProjectId}/hooks`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              },
            ),
        );
        const hook = (hooks.data || []).find((h: any) => h?.url === webhookUrl);
        if (!hook) {
          await this.withFreshWebhookToken(gitlabProjectId, async () => {});
          return 'no_hook';
        }
        await this.withFreshWebhookToken(gitlabProjectId, (token) =>
          this.callGitlabApi(integration, (accessToken) =>
            axios.put(
              `${this.gitlabApiUrl}/projects/${gitlabProjectId}/hooks/${hook.id}`,
              {
                url: webhookUrl,
                token,
                push_events: hook.push_events ?? true,
                merge_requests_events: hook.merge_requests_events ?? true,
                enable_ssl_verification: hook.enable_ssl_verification ?? true,
              },
              { headers: { Authorization: `Bearer ${accessToken}` } },
            ),
          ),
        );
        return 'rotated';
      } catch (error) {
        // The next connection may have the rights this one lacks.
        this.logger.warn(
          `GITLAB_WEBHOOK_TOKEN_ROTATION outcome=retry gitlabProject=${gitlabProjectId} integration=${integration.id} error=${error instanceof Error ? error.message : 'unknown'}`,
          GitlabService.name,
        );
      }
    }
    return 'failed';
  }

  /**
   * Deletes a webhook from the GitLab project.
   * @param repository The repository entity to delete the webhook from.
   */
  private async deleteProjectWebhook(
    repository: GitlabRepository,
  ): Promise<void> {
    const { integration, gitlabId, webhookId } = repository;

    if (!webhookId) {
      this.logger.warn(
        `No webhook ID found for GitLab project ${gitlabId}, skipping deletion.`,
      );
      return;
    }

    this.logger.log(
      `Attempting to delete webhook ${webhookId} from GitLab project ${gitlabId}`,
    );
    try {
      await this.callGitlabApi(integration, (accessToken) =>
        axios.delete(
          `${this.gitlabApiUrl}/projects/${gitlabId}/hooks/${webhookId}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        ),
      );

      repository.webhookId = null;
      await this.gitlabRepositoryRepository.save(repository);
      this.logger.log(
        `Successfully deleted webhook ${webhookId} from project ${gitlabId}`,
      );
    } catch (error) {
      // If the hook is already gone (404), that's fine.
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(
          `Webhook ${webhookId} not found on GitLab project ${gitlabId}. It may have been deleted manually.`,
        );
        repository.webhookId = null; // Clean up our DB record
        await this.gitlabRepositoryRepository.save(repository);
      } else {
        this.logger.error(
          `Failed to delete webhook ${webhookId} from GitLab project ${gitlabId}: ${error.message}`,
          error.stack,
        );
        // Do not re-throw, to ensure the unlink operation completes in our system.
      }
    }
  }

  /**
   * Commits of the linked repository (read by a closed rule miner), newest
   * first, read through `callGitlabApi` (which holds the token refresh). Only
   * sha, committer date and message are mapped: no author or committer name
   * or e-mail. Provider errors are thrown as raised; RepositoryHistoryService
   * maps them to gRPC codes.
   */
  @Span()
  async listCommitsForRepository(
    repoEntity: GitlabRepository,
    options: HistoryListOptions,
  ): Promise<ProviderCommitSummary[]> {
    const response = await this.callGitlabApi<GitlabHistoryCommit[]>(
      repoEntity.integration,
      (accessToken) =>
        axios.get(
          `${this.gitlabApiUrl}/projects/${repoEntity.gitlabId}/repository/commits`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
              ...(options.branch ? { ref_name: options.branch } : {}),
              ...(options.path ? { path: options.path } : {}),
              page: options.page,
              per_page: options.perPage,
            },
            timeout: HISTORY_PROVIDER_TIMEOUT_MS,
          },
        ),
    );
    return (Array.isArray(response.data) ? response.data : []).map((c) => ({
      sha: c.id,
      date: c.committed_date ?? '',
      message: c.message ?? '',
    }));
  }

  /**
   * One commit of the linked repository with its diff, read page by page (100
   * files a page, at most GITLAB_HISTORY_DIFF_MAX_PAGES pages).
   */
  @Span()
  async getCommitForRepository(
    repoEntity: GitlabRepository,
    sha: string,
  ): Promise<ProviderCommit> {
    const base = `${this.gitlabApiUrl}/projects/${repoEntity.gitlabId}/repository/commits/${sha}`;
    const commit = await this.callGitlabApi<GitlabHistoryCommit>(
      repoEntity.integration,
      (accessToken) =>
        axios.get(base, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: HISTORY_PROVIDER_TIMEOUT_MS,
        }),
    );

    const diffs: GitlabHistoryDiff[] = [];
    let moreFiles = false;
    for (let page = 1; page <= GITLAB_HISTORY_DIFF_MAX_PAGES; page++) {
      const response = await this.callGitlabApi<GitlabHistoryDiff[]>(
        repoEntity.integration,
        (accessToken) =>
          axios.get(`${base}/diff`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { page, per_page: 100 },
            timeout: HISTORY_PROVIDER_TIMEOUT_MS,
          }),
      );
      diffs.push(...(Array.isArray(response.data) ? response.data : []));
      // Axios lower-cases response header keys; empty on the last page.
      const hasNext = Boolean(Number(response.headers?.['x-next-page']));
      if (!hasNext) break;
      if (page === GITLAB_HISTORY_DIFF_MAX_PAGES) moreFiles = true;
    }

    return {
      sha: commit.data.id,
      date: commit.data.committed_date ?? '',
      message: commit.data.message ?? '',
      files: diffs.map((d) => {
        const patch = d.diff ?? '';
        const { additions, deletions } = countDiffLines(patch);
        return {
          path: d.new_path,
          oldPath: d.renamed_file ? (d.old_path ?? '') : '',
          status: gitlabDiffStatus(d),
          additions,
          deletions,
          patch,
        };
      }),
      moreFiles,
    };
  }

  /**
   * A wrapper for making authenticated GitLab API calls that automatically handles token refreshes.
   * This method proactively refreshes tokens that are about to expire and handles 401 errors.
   * @param integration The GitLabIntegration entity.
   * @param apiCall A function that performs the desired Axios API call. It will receive a valid access token.
   * @returns The result of the API call.
   */
  private async callGitlabApi<T>(
    integration: GitlabIntegration,
    apiCall: (accessToken: string) => Promise<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    // Proactively refresh token if it's about to expire (within 60 seconds)
    const expiresAt = integration.tokenExpiresAt
      ? new Date(integration.tokenExpiresAt).getTime()
      : 0;
    const now = Date.now();
    const skewMs = 60 * 1000; // 60s safety window

    let accessToken: string | null;

    if (!expiresAt || expiresAt <= now + skewMs) {
      this.logger.log(
        `Token expired or about to expire for org ${integration.organizationId}. Proactively refreshing.`,
      );
      accessToken = await this.refreshAccessToken(integration);
    } else {
      accessToken = await this.decryptToken(integration.accessToken);
      if (!accessToken) {
        this.logger.warn(
          `Could not decrypt access token for org ${integration.organizationId}. Attempting refresh.`,
        );
        accessToken = await this.refreshAccessToken(integration);
      }
    }

    try {
      return await apiCall(accessToken);
    } catch (error) {
      // Handle network errors (AggregateError from DNS/connection issues)
      if (
        error.name === 'AggregateError' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND'
      ) {
        this.logger.error(
          `Network error calling GitLab API for org ${integration.organizationId}: ${error.message}`,
          error.stack,
        );
        throw new RpcException({
          message: `Network error connecting to GitLab`,
          code: status.UNAVAILABLE,
        });
      }

      // Handle 401 - token might have been revoked or there's a race condition
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.logger.log(
          `API call failed with 401 for org ${integration.organizationId}. Attempting token refresh.`,
        );

        // Reload the integration from DB to get the latest tokens (avoid race conditions)
        const freshIntegration = await this.gitlabIntegrationRepository.findOne(
          {
            where: { id: integration.id },
          },
        );

        if (!freshIntegration) {
          throw new RpcException({
            message: 'GitLab integration not found. Please reinstall.',
            code: status.NOT_FOUND,
          });
        }

        const newAccessToken = await this.refreshAccessToken(freshIntegration);
        this.logger.log(
          `Retrying API call with new token for org ${integration.organizationId}.`,
        );
        return await apiCall(newAccessToken);
      }

      throw error;
    }
  }

  /**
   * Check if a project has a linked GitLab repository.
   * @param projectId - The project ID to check.
   * @returns The link status with repository info if linked.
   */
  @Span()
  async getProjectLinkStatus(projectId: string): Promise<{
    isLinked: boolean;
    repositoryId: string;
    repositoryName: string;
    repositoryFullName: string;
  }> {
    try {
      const repository = await this.gitlabRepositoryRepository.findOne({
        where: { projectId: projectId },
      });

      if (!repository) {
        return {
          isLinked: false,
          repositoryId: '',
          repositoryName: '',
          repositoryFullName: '',
        };
      }

      return {
        isLinked: true,
        repositoryId: repository.id,
        repositoryName: repository.name,
        repositoryFullName: repository.nameWithNamespace || repository.name,
      };
    } catch (error) {
      this.logger.error(
        `Failed to check GitLab link status for project ${projectId}: ${error}`,
      );
      // Return not linked on error to avoid blocking the flow
      return {
        isLinked: false,
        repositoryId: '',
        repositoryName: '',
        repositoryFullName: '',
      };
    }
  }

  /**
   * Batch check if multiple projects have linked GitLab repositories.
   * More efficient than calling getProjectLinkStatus for each project individually.
   * @param projectIds - Array of project IDs to check.
   * @returns Array of link status entries for each project.
   */
  @Span()
  async getBatchProjectLinkStatus(projectIds: string[]): Promise<{
    statuses: Array<{
      projectId: string;
      isLinked: boolean;
      repositoryId: string;
      repositoryName: string;
      repositoryFullName: string;
    }>;
  }> {
    if (!projectIds || projectIds.length === 0) {
      return { statuses: [] };
    }

    try {
      // Query all repositories for the given project IDs in a single query
      const repositories = await this.gitlabRepositoryRepository.find({
        where: { projectId: In(projectIds) },
      });

      // Create a map for quick lookup
      const repoMap = new Map<
        string,
        { id: string; name: string; nameWithNamespace: string }
      >();
      for (const repo of repositories) {
        repoMap.set(repo.projectId, {
          id: repo.id,
          name: repo.name,
          nameWithNamespace: repo.nameWithNamespace || repo.name,
        });
      }

      // Build the response for all requested projects
      const statuses = projectIds.map((projectId) => {
        const repo = repoMap.get(projectId);
        if (repo) {
          return {
            projectId,
            isLinked: true,
            repositoryId: repo.id,
            repositoryName: repo.name,
            repositoryFullName: repo.nameWithNamespace,
          };
        }
        return {
          projectId,
          isLinked: false,
          repositoryId: '',
          repositoryName: '',
          repositoryFullName: '',
        };
      });

      return { statuses };
    } catch (error) {
      this.logger.error(`Failed to batch check GitLab link status: ${error}`);
      // Return not linked on error to avoid blocking the flow
      return {
        statuses: projectIds.map((projectId) => ({
          projectId,
          isLinked: false,
          repositoryId: '',
          repositoryName: '',
          repositoryFullName: '',
        })),
      };
    }
  }
}
