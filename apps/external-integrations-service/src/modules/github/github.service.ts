// github/github.service.ts

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import AdmZip from 'adm-zip';
const OctokitWithPlugins = Octokit.plugin(retry, throttling);
import axios from 'axios';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { ilike, isUniqueViolation } from '@cybedefend/db-dialect';
import { status } from '@grpc/grpc-js';
import { DataSource, Repository, Not, IsNull, In } from 'typeorm';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubBranch } from '../../entities/github-branch.entity';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runZipProcessing,
  addGitDirToArchive as addGitDirToArchiveImpl,
  runZipProcessingInWorker,
} from '../../core/utils/zip-processor';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import { GithubRepoScanJobData } from '../repo-scan-queue/repo-scan-job.types';
import { v6 as uuidv6 } from 'uuid';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import {
  CallbackInstallRequest,
  CallbackInstallResponse,
  GetInstallationForOrgaRequest,
  GetInstallationForOrgaResponse,
  GetRepositoriesRequest,
  GetRepositoriesResponse,
  LinkRepositoryRequest,
  LinkRepositoryResponse,
  DeleteProjectRequest,
  StartScanRequest,
  StartScanResponse,
  UnlinkRepositoryRequest,
  WebhookEventRequest,
  WebhookResponse,
  GetBranchesRequest,
  GetBranchesResponse,
  BranchDto,
  GetRepositoryBranchesPaginatedRequest,
  GetRepositoryBranchesPaginatedResponse,
} from '@grpc/external-integrations/github';
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
import { isGrpcClientError, safeGrpcCall } from '@grpc/wrapper-grpc.module';
import SecretsService from 'src/core/secrets/secrets.service';
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
import {
  SCAN_FAILURE_SOURCE_FETCH_FAILED,
  SCAN_FAILURE_SOURCE_INVALID,
  scanFailureCodeFromError,
} from '../../core/constants/scan-failure-codes';
import { verifyHmacSignature } from '../../core/utils/webhook-verify.util';
import { RepositoryScanOptions } from '../../core/products/repository-link-product';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import {
  PRODUCT_LINKS_PORT,
  type ProductLinksPort,
} from '../../edition/ports/product-links.port';
import {
  GithubPendingRescan,
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
import { isCommitSha } from '../../core/utils/commit-sha.util';
import { ScanEnqueueFailedError } from '../repo-scan-queue/scan-enqueue-failed.error';
import {
  HISTORY_PROVIDER_TIMEOUT_MS,
  HistoryListOptions,
  ProviderCommit,
  ProviderCommitSummary,
} from '../../core/git-history/repository-history.types';
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

/** GitHub returns at most this many files of a commit without pagination. */
const GITHUB_COMMIT_FILES_PAGE = 300;
/**
 * How long a repository-history octokit is reused for one installation. Its
 * auth strategy caches the installation token per instance (tokens live 1 h),
 * so a mining's ~85 history reads mint one token instead of one per read.
 */
const HISTORY_OCTOKIT_TTL_MS = 10 * 60 * 1000;

/** The fields of `GET /app/installations/{id}` the proof of administration reads. */
type InstallationProofDetails = {
  account?: {
    id?: number | null;
    login?: string | null;
    type?: string | null;
  } | null;
} | null;

/** A repository as GitHub describes it in webhook payloads and REST responses. */
type GithubRepositoryPayload = {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
};

/**
 * The login of the GitHub account an installation belongs to, from an
 * installation object (REST `GET /app/installations/{id}` or a webhook
 * payload), or null when it does not carry one.
 */
function installationAccountLogin(
  installation: { account?: { login?: unknown } | null } | null | undefined,
): string | null {
  const login = installation?.account?.login;
  return typeof login === 'string' && login !== '' ? login : null;
}

/**
 * `repository` webhook actions that rewrite a field stored in
 * `github_repositories` (name, full name, visibility).
 */
const REPOSITORY_METADATA_ACTIONS = new Set([
  'renamed',
  'transferred',
  'privatized',
  'publicized',
]);

@Injectable()
export class GithubService implements OnModuleInit {
  private scanServiceClient!: ScanServiceClient;
  private fileServiceClient!: FileServiceClient;
  private projectServiceClient!: ProjectServiceClient;

  private appId: number;
  private privateKey: string;

  /**
   * When each installation's stored repository list was last reconciled with
   * GitHub (epoch ms), keyed by installationId. It only throttles the GitHub
   * calls made while serving GetRepositories, so per-pod memory is enough: a
   * restart costs one extra sync.
   */
  private readonly repositoriesSyncedAt = new Map<number, number>();
  private readonly repositoriesSyncTtlMs = 15 * 60 * 1000;
  /**
   * Installations whose reconciliation is running in the background. Reads no
   * longer wait for it, so without this every read arriving before it ends
   * would start another one against GitHub.
   */
  private readonly repositoriesSyncInFlight = new Set<number>();

  constructor(
    @InjectRepository(GithubIntegration)
    private readonly githubIntegrationRepository: Repository<GithubIntegration>,
    @InjectRepository(GithubRepository)
    private readonly githubRepositoryIntegration: Repository<GithubRepository>,
    @InjectRepository(GithubBranch)
    private readonly githubBranchRepository: Repository<GithubBranch>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly scanningClient: ClientGrpc,
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileManagementClient: ClientGrpc,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    private readonly repoScanQueue: RepoScanQueueService,
    private readonly pendingRescans: PendingRescanStore,
    @Inject(PRODUCT_LINKS_PORT)
    private readonly productLinks: ProductLinksPort,
    private readonly repoHistory: RepoHistoryService,
  ) {
    // Environment variables in development, the secrets store otherwise.
    // Both default to '' so a Community instance without a GitHub
    // App boots; isGithubAppConfigured() gates every call that needs the App.
    this.appId = Number(this.getSecretOrEnv('GITHUB_APP_ID') ?? '');
    this.privateKey = (
      this.getSecretOrEnv('GITHUB_PRIVATE_KEY') ?? ''
    ).replaceAll(String.raw`\n`, '\n');
  }

  /**
   * True when a GitHub App is configured (a positive integer app id
   * and a non-empty private key). A Community instance without one still
   * boots and still serves the stored data; it refuses the calls that need
   * the App with GITHUB_APP_NOT_CONFIGURED.
   */
  isGithubAppConfigured(): boolean {
    return (
      Number.isInteger(this.appId) &&
      this.appId > 0 &&
      this.privateKey.length > 0
    );
  }

  private assertGithubAppConfigured(): void {
    if (!this.isGithubAppConfigured()) {
      throw new RpcException({
        message: 'GITHUB_APP_NOT_CONFIGURED',
        code: status.FAILED_PRECONDITION,
      });
    }
  }

  /**
   * Get a secret value from environment variables (in dev) or the secrets store.
   * @param key - The secret key to retrieve
   * @returns The secret value
   */
  private getSecretOrEnv(key: string): string {
    const isDev = this.configService.get<string>('NODE_ENV') === 'development';
    if (isDev) {
      const envValue = this.configService.get<string>(key);
      if (envValue) {
        this.logger.log(`[DEV MODE] Using environment variable for ${key}`);
        return envValue;
      }
      this.logger.warn(
        `[DEV MODE] Environment variable ${key} not found, falling back to secrets`,
      );
    }
    return this.secretsService.getSecret(key);
  }

  onModuleInit() {
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
  }

  /**
   * Get the installation for an organization.
   *
   * @param dto - The data containing the organizationId.
   * @returns The installation for the organization or an error.
   */
  @Span()
  async getInstallationForOrga(
    dto: GetInstallationForOrgaRequest,
  ): Promise<GetInstallationForOrgaResponse> {
    try {
      const integration = await this.githubIntegrationRepository.findOne({
        where: { organizationId: dto.organizationId },
      });

      if (!integration) {
        throw new RpcException({
          message: `No GitHub integration found`,
          code: status.NOT_FOUND,
        });
      }

      return {
        id: integration.id,
        installationId: integration.installationId,
        userId: integration.userId,
        organizationId: integration.organizationId,
        createdAt: integration.createdAt
          ? integration.createdAt.toISOString()
          : '',
        updatedAt: integration.updatedAt
          ? integration.updatedAt.toISOString()
          : '',
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve GitHub installation for organization ID ${dto.organizationId} : ${error}`,
      );
      throw new RpcException({
        message: 'Failed to retrieve GitHub installation for organization',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get available branches for a GitHub repository.
   *
   * Branches are persisted in the `github_branches` table. On the first call
   * for a repository (`branchesSyncedAt` is NULL) we lazy-fill from the GitHub
   * API in a single transaction. Subsequent calls are served entirely from
   * MySQL — no GitHub round-trip — until the next webhook-driven sync.
   *
   * @param request - The data containing the organizationId and repositoryId.
   * @returns The list of branches with metadata.
   */
  @Span()
  async getBranches(request: GetBranchesRequest): Promise<GetBranchesResponse> {
    try {
      const repository = await this.githubRepositoryIntegration.findOne({
        where: { id: request.repositoryId },
        relations: ['integration'],
      });

      if (!repository || !repository.integration) {
        throw new RpcException({
          message: `Repository not found or no integration`,
          code: status.NOT_FOUND,
        });
      }

      if (repository.integration.organizationId !== request.organizationId) {
        throw new RpcException({
          message: `Repository does not belong to organization`,
          code: status.PERMISSION_DENIED,
        });
      }

      const [owner, repo] = repository.fullName.split('/');

      if (!owner || !repo) {
        throw new RpcException({
          message: `Invalid repository full name`,
          code: status.INTERNAL,
        });
      }

      // Lazy-fill on the first read for this repository. If the sync fails the
      // transaction rolls back, `branchesSyncedAt` stays NULL, and the next
      // call retries automatically.
      if (repository.branchesSyncedAt === null) {
        await this.lazyFillBranches(repository);
      }

      const rows = await this.githubBranchRepository.find({
        where: { repositoryId: repository.id },
        order: { name: 'ASC' },
      });

      const branches: BranchDto[] = rows.map((row) => ({
        name: row.name,
        isDefault: row.name === repository.defaultBranch,
        isProtected: row.isProtected,
      }));

      return { branches };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve branches for repository ${request.repositoryId}: ${error}`,
      );
      throw new RpcException({
        message: `Failed to retrieve branches`,
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get a paginated, searchable list of branches for a repository looked up by projectId.
   *
   * Reuses the existing lazyFillBranches on the first call (branchesSyncedAt === null).
   * Subsequent calls are served entirely from MySQL with optional filtering and pagination.
   *
   * @param request - Contains organizationId, projectId, search, page, pageSize, includeArchived, archivedNames
   * @returns Paginated branch list with total count, defaultBranch and scanBranch metadata
   */
  @Span()
  async getRepositoryBranchesPaginated(
    request: GetRepositoryBranchesPaginatedRequest,
  ): Promise<GetRepositoryBranchesPaginatedResponse> {
    try {
      const repository = await this.githubRepositoryIntegration.findOne({
        where: { projectId: request.projectId },
        relations: ['integration'],
      });
      if (!repository || !repository.integration) {
        throw new RpcException({
          message: 'Repository not found for project',
          code: status.NOT_FOUND,
        });
      }
      if (repository.integration.organizationId !== request.organizationId) {
        throw new RpcException({
          message: 'Repository does not belong to organization',
          code: status.PERMISSION_DENIED,
        });
      }
      if (repository.branchesSyncedAt === null) {
        await this.lazyFillBranches(repository);
      }
      const pageSize = Math.min(Math.max(request.pageSize || 30, 1), 100);
      const page = Math.max(request.page || 1, 1);
      const qb = this.githubBranchRepository
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
        `Failed paginated branches for project ${request.projectId}: ${error}`,
      );
      throw new RpcException({
        message: 'Failed to retrieve branches',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Lazy-fill the `github_branches` table for a repository on first read.
   *
   * Fetches the full branch list from the GitHub API and reconciles it with
   * our DB inside a single transaction:
   *   1. update `defaultBranch` on the parent repo if GitHub reports a drift
   *   2. upsert one row per fresh branch (idempotent on the unique
   *      `(repositoryId, name)` index), 500 rows per statement
   *   3. delete orphan rows that no longer exist on GitHub
   *   4. stamp `branchesSyncedAt = now` and save the parent repo
   *
   * If any step throws, the whole transaction rolls back and
   * `branchesSyncedAt` stays NULL — the next call will retry.
   */
  @Span()
  private async lazyFillBranches(repo: GithubRepository): Promise<void> {
    const startedAt = Date.now();
    const installationOctokit = this.createInstallationOctokit(
      repo.integration.installationId,
    );
    const [owner, repo_name] = repo.fullName.split('/');

    const { data: repoData } = await installationOctokit.request(
      'GET /repos/{owner}/{repo}',
      { owner, repo: repo_name },
    );

    // GitHub caps `per_page` at 100 for the branches endpoint and paginates the
    // rest. Page through the full list (stopping on the first short page) and
    // accumulate every branch BEFORE the reconciliation below — otherwise a repo
    // with >100 branches would only sync page 1 and the orphan delete would then
    // permanently drop branches 101+ from the DB cache. A MAX_PAGES guard caps a
    // pathological/looping API response.
    const PER_PAGE = 100;
    const MAX_PAGES = 100;
    const branchesData: { name: string; protected: boolean }[] = [];
    let page = 1;
    // `page` is incremented locally, so it doubles as the iteration counter that
    // bounds the loop at MAX_PAGES. When that cap trips the list is incomplete:
    // we must NOT reconcile/stamp against it (see below).
    let truncated = false;

    while (true) {
      const { data } = await installationOctokit.request(
        'GET /repos/{owner}/{repo}/branches',
        { owner, repo: repo_name, per_page: PER_PAGE, page },
      );
      branchesData.push(...data);
      if (data.length < PER_PAGE) break;
      if (page >= MAX_PAGES) {
        truncated = true;
        this.logger.warn(
          `BRANCHES_LAZY_FILL repo=${repo.id} provider=github hit page cap ${MAX_PAGES}; branch list is truncated — skipping orphan reconciliation and leaving branchesSyncedAt unset so the next read retries`,
        );
        break;
      }
      page++;
    }

    await this.dataSource.transaction(async (manager) => {
      const repoRepo = manager.getRepository(GithubRepository);

      // 1. Default-branch drift — update on the entity, save inside the tx.
      if (repo.defaultBranch !== repoData.default_branch) {
        repo.defaultBranch = repoData.default_branch;
        await repoRepo.save(repo);
      }

      // 2. Upsert the branches (idempotent on unique (repositoryId, name)),
      //    in multi-row statements.
      await upsertBranches(
        manager,
        GithubBranch,
        branchesData.map((branch) => ({
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
        // 3. Orphan reconciliation — drop rows that no longer exist on GitHub.
        const names = branchesData.map((b) => b.name);
        await deleteStaleBranches(manager, GithubBranch, repo.id, names);

        // 4. Stamp branchesSyncedAt and save.
        repo.branchesSyncedAt = new Date();
        await repoRepo.save(repo);
      }
    });

    this.logger.log(
      `BRANCHES_LAZY_FILL repo=${repo.id} provider=github count=${branchesData.length} durationMs=${Date.now() - startedAt}`,
    );
  }

  // ============================================================================
  // SCAN WORKFLOW HELPER METHODS
  // ============================================================================

  /**
   * Verify that a repository entity exists and is properly configured.
   * @throws RpcException if validation fails
   */
  private validateRepositoryForScan(
    repoEntity: GithubRepository | null,
    ref: string,
    expectedRef: string,
  ): asserts repoEntity is GithubRepository & {
    projectId: string;
    integration: GithubIntegration;
  } {
    if (ref !== expectedRef) {
      throw new RpcException({
        message: 'Push ref does not match expected ref',
        code: status.INVALID_ARGUMENT,
      });
    }

    if (!repoEntity?.integration) {
      throw new RpcException({
        message: 'Repository not found or no integration',
        code: status.NOT_FOUND,
      });
    }

    if (!repoEntity.projectId) {
      throw new RpcException({
        message: 'Repository is not linked to a project',
        code: status.NOT_FOUND,
      });
    }

    if (!repoEntity.integration.installationId) {
      throw new RpcException({
        message: 'Installation not found for repository',
        code: status.NOT_FOUND,
      });
    }
  }

  /**
   * Parse owner and repo from full repository name.
   */
  private parseRepoFullName(fullName: string): { owner: string; repo: string } {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) {
      throw new RpcException({
        message: 'Invalid repository full name',
        code: status.INTERNAL,
      });
    }
    return { owner, repo };
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
   * What a push webhook reads from the project, in one lean read: the per-project opt-out of the scan triggered by a push, and the scan
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
          initializerUserId: 'github-integration',
          branch,
          sourceType: 'github',
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
   * Create an Octokit instance for a GitHub App installation.
   * Includes retry logic, throttling, and extended timeout for reliability.
   */
  private createInstallationOctokit(
    installationId: number,
    options: { retryOnRateLimit?: boolean } = {},
  ): Octokit {
    // A caller bound by a short deadline (the repository history) asks for no
    // rate-limit retry: waiting out a Retry-After would outlive its deadline,
    // and the rate limit is better reported as such.
    const retryOnRateLimit = options.retryOnRateLimit !== false;
    this.assertGithubAppConfigured();
    return new OctokitWithPlugins({
      authStrategy: createAppAuth,
      auth: {
        appId: this.appId,
        privateKey: this.privateKey,
        installationId,
      },
      request: {
        timeout: 30000, // 30 seconds timeout instead of default 10s
      },
      retry: {
        enabled: true,
        retries: 3,
        doNotRetry: [400, 401, 403, 404, 422],
      },
      throttle: {
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          this.logger.warn(
            `Rate limit hit for ${(options as { method: string; url: string }).method} ${(options as { method: string; url: string }).url}, retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
          );
          // Retry up to 3 times on rate limit
          return retryOnRateLimit && retryCount < 3;
        },
        onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
          this.logger.warn(
            `Secondary rate limit hit for ${(options as { method: string; url: string }).method} ${(options as { method: string; url: string }).url}, retrying after ${retryAfter}s`,
          );
          // Retry once on secondary rate limit
          return retryOnRateLimit && retryCount < 1;
        },
      },
    });
  }

  /**
   * Download repository archive from GitHub directly to disk (streaming).
   * Prevents memory saturation for large repositories.
   *
   * The zipball endpoint carries GitHub's secondary rate limit, and the
   * `retry`/`throttle` plugins configured on the Octokit instance do NOT cover
   * it — this is a raw axios stream and Octokit only mints the token. So the
   * request goes through `downloadArchiveWithRetry`, which honours
   * `Retry-After` / `x-ratelimit-reset`, bounds the headers phase, and throws
   * a coded `ArchiveDownloadError` once it gives up.
   */
  private async downloadGithubArchive(
    octokit: Octokit,
    owner: string,
    repo: string,
    ref: string,
    outputPath: string,
  ): Promise<void> {
    // Get the archive download URL with authentication
    const archiveUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;

    // Get the installation token from octokit
    const auth = await octokit.auth({ type: 'installation' });
    const token = (auth as { token: string }).token;

    // Use axios with stream response type to avoid loading entire file in
    // memory; the helper pipes the response straight to disk.
    await downloadArchiveWithRetry({
      label: 'GitHub',
      outputPath,
      logger: this.logger,
      attempt: (timeoutMs) =>
        axios.get(archiveUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'CybeDefend-Integration',
          },
          responseType: 'stream',
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: timeoutMs,
        }),
    });
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
   * worker thread so it never blocks the main event loop. This is what the
   * background scan flow uses — a large repository would otherwise block the
   * loop long enough to fail the gRPC liveness probe and get the pod
   * SIGKILLed, orphaning the scan in `waiting_for_file`.
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

  // ============================================================================
  // MAIN SCAN METHODS
  // ============================================================================

  /**
   * Start a scan for a specific commit on a repository.
   * Validates inputs, prepares scan record, and triggers background download/upload.
   *
   * `options.graphOnly` (a repository linked from a closed product): the scan
   * is stored graph-only, so security-scanning only triggers
   * the code-graph ingestion. It runs no scanner, so it is not checked
   * against a scan in flight on the branch either.
   */
  @Span()
  async startScanForCommitAndProject(
    repositoryId: number,
    commitSha: string,
    masterBranch: string,
    ref: string,
    organizationId: string,
    options: RepositoryScanOptions = {},
    // The scan types a push webhook already read with the
    // project; read here when absent.
    prefetchedTypeScan?: string,
  ): Promise<StartScanResponse> {
    const graphOnly = options.graphOnly === true;
    // When this start began, to supersede a push refused
    // earlier (see supersedePendingRescan).
    const startedAt = Date.now();

    // 1. Fetch and validate repository
    const repoEntity = await this.githubRepositoryIntegration.findOne({
      where: { githubId: repositoryId },
      relations: ['integration'],
    });

    this.validateRepositoryForScan(
      repoEntity,
      ref,
      `refs/heads/${masterBranch}`,
    );

    const { projectId } = repoEntity;
    const { owner, repo } = this.parseRepoFullName(repoEntity.fullName);

    // 2. Ensure no existing scan
    if (!graphOnly) {
      await this.ensureNoExistingScan(projectId, masterBranch);
    }

    // 3. Prepare scan (get types, create record)
    const typeScan =
      prefetchedTypeScan ?? (await this.getProjectScanTypes(projectId));
    const scanId = uuidv6();
    await this.createScanRecord(scanId, projectId, masterBranch, graphOnly);

    // 4. Enqueue the download/zip/upload/startScan as a durable BullMQ job.
    //    A dedicated worker consumes it; if a worker dies mid-job BullMQ
    //    re-queues it, so the scan is never orphaned in waiting_for_file.
    try {
      await this.repoScanQueue.enqueueRepoScan({
        provider: 'github',
        scanId,
        projectId,
        organizationId,
        branch: masterBranch,
        typeScan,
        owner,
        repo,
        commitSha,
        installationId: repoEntity.integration.installationId,
      });
    } catch (error: unknown) {
      throw new ScanEnqueueFailedError(scanId, error);
    }
    // A graph-only scan runs no scanner: it does not stand for the AppSec
    // scan a refused push waits for, so that push keeps its rescan.
    if (!graphOnly) {
      await this.supersedePendingRescan(
        projectId,
        masterBranch,
        startedAt,
        commitSha,
      );
    }

    return {
      success: true,
      message: 'GitHub scan initiated. Download queued in background.',
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
   * the push's own gates are read again, since the wait may have changed
   * them, and the branch head is read from GitHub: it is the commit scanned,
   * unless it is the one whose scan last started. The scan starts exactly as
   * the push would have started it: createScan, then the repo-scan job, then
   * StartScan in security-scanning, which still enforces writability.
   * Nothing here starts a diff scan.
   */
  @Span()
  async runPendingRescan(
    entry: GithubPendingRescan,
  ): Promise<PendingRescanOutcome> {
    try {
      await this.ensureNoExistingScan(entry.projectId, entry.branch);
    } catch (error: unknown) {
      return pendingRescanOutcomeOf(error);
    }

    const repository = await this.githubRepositoryIntegration.findOne({
      where: { githubId: entry.githubRepositoryId, projectId: Not(IsNull()) },
      relations: ['integration'],
    });
    if (
      !repository?.integration ||
      repository.projectId !== entry.projectId ||
      (repository.scanBranch && repository.scanBranch !== entry.branch)
    ) {
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=repository_changed project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}`,
      );
      return 'dropped';
    }

    const settings = await this.readPushProjectSettings(entry.projectId);
    if (!settings.scanOnCommitEnabled) {
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=scan_on_commit_disabled project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}`,
      );
      return 'dropped';
    }

    // The push's product rule, read again: the
    // project or its organisation's products may have changed meanwhile.
    const { organizationId } = repository.integration;
    const rescan = await this.entitlements.decidePushScan(
      organizationId,
      settings.appsecProject,
    );
    if (rescan.scan === 'none') {
      // Billing could not say whether the graph-only product is active:
      // nothing starts, and the rescan is checked again later.
      if (rescan.reason === 'products_unknown') {
        this.logger.log(
          `PENDING_RESCAN_BUSY reason=products_unknown org=${organizationId} project=${entry.projectId} commit=${entry.commitSha}`,
        );
        return 'busy';
      }
      this.logger.log(
        `PENDING_RESCAN_DROPPED reason=${rescan.reason} org=${organizationId} project=${entry.projectId} commit=${entry.commitSha}`,
      );
      return 'dropped';
    }

    // The commit to scan is the branch head NOW: a newer
    // push may have replaced the claimed one, or pushes may have been
    // delivered out of order. If that head is the commit whose scan last
    // started, it is scanned already.
    let headSha: string;
    try {
      headSha = await this.readBranchHead(repository, entry.branch);
    } catch (error: unknown) {
      const outcome = branchHeadOutcomeOf(error);
      if (outcome === 'dropped') {
        this.logger.log(
          `PENDING_RESCAN_DROPPED reason=branch_head_unavailable project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}: ${error}`,
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
      );
      return 'dropped';
    }

    try {
      await this.startScanForCommitAndProject(
        entry.githubRepositoryId,
        headSha,
        entry.branch,
        `refs/heads/${entry.branch}`,
        organizationId,
        { graphOnly: rescan.scan === 'graph_only' },
        settings.typeScan,
      );
      return 'started';
    } catch (error: unknown) {
      if (error instanceof ScanEnqueueFailedError) {
        // A retry would create one more scan record on every attempt.
        this.logger.log(
          `PENDING_RESCAN_DROPPED reason=enqueue_failed_after_create project=${entry.projectId} branch=${entry.branch} commit=${headSha} scan=${error.scanId}: ${error.reason}`,
        );
        return 'dropped';
      }
      return pendingRescanOutcomeOf(error);
    }
  }

  /**
   * The repository's branch named `branch`, spelled as the repository spells
   * it, or null when it has none (a container scan's branch must be
   * one, or its results land on a branch the dashboard never offers). The
   * synced branches answer first; a miss asks GitHub, since a branch created
   * a moment ago may not have reached us through its webhook, and a branch
   * GitHub has is kept (best effort: GitHub's answer stands).
   *
   * Only GitHub's "Branch not found" is null (a tag, a typo). Any other 404
   * means the App cannot see the repository (access removed, App
   * uninstalled): FAILED_PRECONDITION, so the link is blamed, not the
   * branch. Any other failure is UNAVAILABLE, never null.
   */
  @Span()
  async findBranch(
    repository: GithubRepository,
    branch: string,
  ): Promise<string | null> {
    const synced = await this.githubBranchRepository.findOne({
      where: { repositoryId: repository.id, name: branch },
    });
    if (synced) return synced.name;

    const { owner, repo } = this.parseRepoFullName(repository.fullName);
    let data: { name?: unknown; protected?: unknown };
    try {
      const octokit = this.createInstallationOctokit(
        repository.integration.installationId,
      );
      ({ data } = await octokit.request(
        'GET /repos/{owner}/{repo}/branches/{branch}',
        { owner, repo, branch },
      ));
    } catch (error) {
      const failure = error as {
        status?: unknown;
        message?: unknown;
        response?: { data?: { message?: unknown } };
      };
      if (failure?.status === 404) {
        if (failure.response?.data?.message === 'Branch not found') {
          return null;
        }
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `The GitHub repository linked to this project (${repository.fullName}) cannot be read; check the GitHub integration.`,
        });
      }
      this.logger.warn(
        `BRANCH_CHECK provider=github outcome=unavailable repo=${repository.id}: ${String(failure?.message)}`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: `Could not check branch "${branch}" with GitHub; retry later.`,
      });
    }

    const name = typeof data?.name === 'string' ? data.name : branch;
    await this.githubBranchRepository
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
          `BRANCH_CHECK provider=github outcome=not_kept repo=${repository.id}: ${(error as Error)?.message}`,
        ),
      );
    return name;
  }

  /**
   * The commit a branch points to now, from GitHub (one installation-token
   * call, the same `contents: read` access the archive download uses).
   */
  @Span()
  private async readBranchHead(
    repository: GithubRepository,
    branch: string,
  ): Promise<string> {
    const { owner, repo } = this.parseRepoFullName(repository.fullName);
    const octokit = this.createInstallationOctokit(
      repository.integration.installationId,
    );
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/branches/{branch}',
      { owner, repo, branch },
    );
    const sha = (data as { commit?: { sha?: unknown } })?.commit?.sha;
    if (!isCommitSha(sha)) {
      throw new TypeError(`GitHub reported no commit for branch ${branch}`);
    }
    return sha;
  }

  /**
   * A push on a project that is not an AppSec project, or whose AppSec is not
   * writable, while the graph-only product is active: a
   * graph-only scan keeps the code graph fresh.
   *
   * A refusal by the graph-only limits (one in flight per project, three per
   * organisation) is deferred with the pushed commit, like an AppSec push
   * refused by a running scan: the graph-only scan
   * in flight parses an EARLIER commit, so dropping the push would leave the
   * graph behind the branch. When the deferral cannot be recorded, one line
   * says so. Any other failure is the push's, as for an AppSec scan.
   */
  private async startGraphOnlyPushScan(
    repositoryId: number,
    commitSha: string,
    branch: string,
    ref: string,
    organizationId: string,
    projectId: string,
    typeScan: string | undefined,
  ): Promise<void> {
    this.logger.log(
      `WEBHOOK_PUSH_GRAPH_ONLY org=${organizationId} project=${projectId} commit=${commitSha} repo=${repositoryId}`,
    );
    try {
      await this.startScanForCommitAndProject(
        repositoryId,
        commitSha,
        branch,
        ref,
        organizationId,
        { graphOnly: true },
        typeScan,
      );
    } catch (error: unknown) {
      if (!isGraphOnlyLimitReached(error)) throw error;
      const deferred = await this.deferRefusedPush(error, {
        provider: 'github',
        projectId,
        branch,
        commitSha,
        githubRepositoryId: repositoryId,
      });
      if (!deferred) {
        this.logger.log(
          `WEBHOOK_IGNORED_GRAPH_ONLY_LIMIT org=${organizationId} project=${projectId} commit=${commitSha} repo=${repositoryId}`,
        );
      }
    }
  }

  /**
   * A push was refused because a scan of its branch is running, or a
   * graph-only push because the project or the organisation is at its
   * graph-only limit: record it so the
   * pending-rescan consumer scans it once that scan ends. Returns false,
   * leaving the former answer to the caller, when the refusal is something
   * else, the commit id is not one, or Redis failed.
   */
  private async deferRefusedPush(
    error: unknown,
    request: PendingRescanRequest,
  ): Promise<boolean> {
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
      );
      return false;
    }
    if (!recorded) {
      // This very commit's scan is the one that started (a retry of a call
      // EI did process, a redelivery): it is being scanned already.
      this.logger.log(
        `WEBHOOK_PUSH_RESCAN_SKIPPED reason=already_started project=${request.projectId} branch=${request.branch} commit=${request.commitSha}`,
      );
      return true;
    }
    this.logger.log(
      `WEBHOOK_PUSH_RESCAN_DEFERRED project=${request.projectId} branch=${request.branch} commit=${request.commitSha} reason=${reason}`,
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
      );
    }
  }

  /**
   * Worker entrypoint for a queued GitHub repo-scan job: runs the actual
   * download → zip → upload → startScan flow. Called only by the BullMQ
   * processor in the worker process.
   */
  async runRepoDownloadJob(data: GithubRepoScanJobData): Promise<void> {
    await this.downloadAndUploadInBackground(
      data.owner,
      data.repo,
      data.commitSha,
      data.installationId,
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
   * The authenticated clone URL of the history fetch, or `null` (with a
   * warning) when no installation token can be had: the scan then goes
   * without history.
   */
  private async historyCloneUrl(
    octokit: Octokit,
    owner: string,
    repo: string,
  ): Promise<string | null> {
    try {
      const auth = await octokit.auth({ type: 'installation' });
      const token = (auth as { token: string }).token;
      return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    } catch (err) {
      this.logger.warn(
        `No installation token to fetch the history of ${owner}/${repo}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** The history of the scanned branch, fetched while the zipball downloads. */
  private async prepareHistory(
    octokit: Octokit,
    owner: string,
    repo: string,
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
      cloneUrl: await this.historyCloneUrl(octokit, owner, repo),
    });
  }

  /**
   * Background task: download from GitHub, process zip, upload, trigger scan.
   */
  private async downloadAndUploadInBackground(
    owner: string,
    repo: string,
    commitSha: string,
    installationId: number,
    scanId: string,
    projectId: string,
    organizationId: string,
    branch: string,
    typeScan: string,
  ): Promise<void> {
    const { tmpPath, cleanedPath } = this.generateTempPaths(repo, commitSha);
    const octokit = this.createInstallationOctokit(installationId);

    this.logger.log(`[Background] Starting download for scan ${scanId}`);

    const repositoryKey = `github:${owner}/${repo}`;
    let history: PreparedHistory | null = null;

    try {
      // The zipball and the history of the scanned branch are fetched in
      // parallel. allSettled, not all: the history is always awaited, so a
      // failed download never leaves a fetch running whose files the finally
      // below could not see.
      const [archive, prepared] = await Promise.allSettled([
        this.downloadGithubArchive(octokit, owner, repo, commitSha, tmpPath),
        this.prepareHistory(
          octokit,
          owner,
          repo,
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
          'Invalid archive format received from GitHub. Expected ZIP file.',
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
        // so the zip rewrite never blocks the event loop (and thus never trips
        // the gRPC liveness probe).
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
   * Start a scan for the last commit on the default branch of a repository
   * @param data - The data containing the repository ID and organization ID
   * @returns The result of the scan or an error
   */
  @Span()
  async startScanForLastCommitAndProject(
    data: StartScanRequest,
    options: RepositoryScanOptions = {},
  ): Promise<StartScanResponse> {
    // A re-analysis started from a closed product (`product`) is graph-only, like the scan its link starts. Validated
    // before anything is read: an unknown product is INVALID_ARGUMENT. In
    // the Community Edition a link product starts no scan at all, and a
    // manual repository scan is refused SCANNERS_NOT_AVAILABLE first.
    let graphOnly = options.graphOnly === true;
    if (!graphOnly) {
      const link = this.entitlements.decideLinkScan(data.product);
      if (link.scan === 'none') {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'SCANNERS_NOT_AVAILABLE',
        });
      }
      graphOnly = link.scan === 'graph_only';
    }
    // Read within the request project: the gateway checks the permission on
    // that project only, so a repository linked to another project (another
    // organisation's included) must not be reachable by its id alone.
    const repoEntity = await this.githubRepositoryIntegration.findOne({
      where: { id: data.repositoryId, projectId: data.projectId },
      relations: ['integration'],
    });

    if (!repoEntity || !repoEntity.integration) {
      throw new RpcException({
        message: `Repository not found or no integration`,
        code: status.NOT_FOUND,
      });
    }

    if (!repoEntity.projectId) {
      throw new RpcException({
        message: `Repository is not linked to a project`,
        code: status.NOT_FOUND,
      });
    }

    const installationId = repoEntity.integration.installationId;
    if (!installationId) {
      throw new RpcException({
        message: `Installation not found for repository`,
        code: status.NOT_FOUND,
      });
    }

    const [owner, repo] = repoEntity.fullName.split('/');
    if (!owner || !repo) {
      throw new RpcException({
        message: `Invalid repository full name`,
        code: status.INTERNAL,
      });
    }

    const installationOctokit = this.createInstallationOctokit(installationId);

    let defaultBranch: string;
    try {
      const { data: repoData } = await installationOctokit.request(
        'GET /repos/{owner}/{repo}',
        {
          owner,
          repo,
        },
      );
      defaultBranch = repoData.default_branch;
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve repository data for ${repoEntity.fullName} : ${error}`,
      );
      throw new RpcException({
        message: `Failed to retrieve repository data`,
        code: status.INTERNAL,
      });
    }

    // Determine target branch: request.branch > entity.scanBranch > defaultBranch
    const targetBranch = data.branch || repoEntity.scanBranch || defaultBranch;
    this.logger.log(
      `Target branch for scan: ${targetBranch} (requested: ${data.branch || 'none'}, configured: ${repoEntity.scanBranch || 'none'}, default: ${defaultBranch})`,
    );

    let lastCommitSha: string;
    try {
      const { data: commitsData } = await installationOctokit.request(
        'GET /repos/{owner}/{repo}/commits',
        {
          owner,
          repo,
          sha: targetBranch,
          per_page: 1,
        },
      );
      if (!commitsData || commitsData.length === 0) {
        throw new RpcException({
          message: `No commits found for repository on branch`,
          code: status.NOT_FOUND,
        });
      }
      lastCommitSha = commitsData[0].sha;
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve last commit for repository ${repoEntity.fullName} on branch ${targetBranch} : ${error}`,
      );
      throw new RpcException({
        message: `Failed to retrieve last commit for repository on branch`,
        code: status.INTERNAL,
      });
    }

    const ref = `refs/heads/${targetBranch}`;

    // Await the scan initiation to get the scanId
    const scanResult = await this.startScanForCommitAndProject(
      repoEntity.githubId,
      lastCommitSha,
      targetBranch,
      ref,
      repoEntity.integration.organizationId,
      { graphOnly },
    );

    return {
      success: scanResult.success,
      message: scanResult.message,
      scanId: scanResult.scanId,
      detectedLanguages: scanResult.detectedLanguages,
    };
  }

  /**
   * Link a project to a repository github
   * @param linkProject - The data containing the repository ID, project ID, organization ID, and optional scanBranch
   * @returns The result of the link or an error
   */
  @Span()
  async linkProject(
    linkProject: LinkRepositoryRequest,
  ): Promise<LinkRepositoryResponse> {
    try {
      // A repository linked from a closed product builds the code graph only,
      // even when the organisation has AppSec too.
      // Validated before anything is linked: an unknown product is
      // INVALID_ARGUMENT.
      const link = this.entitlements.decideLinkScan(linkProject.product);
      const repository = await this.githubRepositoryIntegration.findOne({
        where: {
          id: linkProject.repositoryId,
        },
        relations: ['integration'],
      });

      if (!repository || !repository.integration) {
        throw new RpcException({
          message: `Repository not found or no integration`,
          code: status.NOT_FOUND,
        });
      }

      if (repository.projectId) {
        throw new RpcException({
          message: `Repository is already linked to a project`,
          code: status.ALREADY_EXISTS,
        });
      }

      const projectCheck = await this.githubRepositoryIntegration.findOne({
        where: {
          projectId: linkProject.projectId,
        },
      });

      if (projectCheck) {
        throw new RpcException({
          message: `Project is already linked to a repository`,
          code: status.ALREADY_EXISTS,
        });
      }

      if (
        repository.integration.organizationId !== linkProject.organizationId
      ) {
        throw new RpcException({
          message: `Repository does not belong to organization`,
          code: status.FAILED_PRECONDITION,
        });
      }

      // Validate branch exists if provided
      if (linkProject.scanBranch) {
        const branches = await this.getBranches({
          organizationId: linkProject.organizationId,
          repositoryId: linkProject.repositoryId,
        });
        const branchExists = branches.branches.some(
          (b) => b.name === linkProject.scanBranch,
        );
        if (!branchExists) {
          throw new RpcException({
            message: `Branch not found in repository`,
            code: status.INVALID_ARGUMENT,
          });
        }
      }

      repository.projectId = linkProject.projectId;
      repository.scanBranch = linkProject.scanBranch || null;

      try {
        await this.githubRepositoryIntegration.save(repository);
      } catch {
        throw new RpcException({
          message: `Failed to update repository in database`,
          code: status.INTERNAL,
        });
      }

      // Start initial scan with configured branch, unless the link's
      // product starts none (Community Edition: the link still saves, the
      // webhook still syncs, no scan starts).
      if (link.scan === 'none') {
        this.logger.log(
          `LINK_SCAN_SKIPPED reason=${link.reason} repo=${repository.id} project=${repository.projectId}`,
        );
      } else {
        void this.startScanForLastCommitAndProject(
          {
            repositoryId: repository.id,
            projectId: repository.projectId,
            branch: repository.scanBranch || '',
          },
          { graphOnly: link.scan === 'graph_only' },
        ).catch((error: unknown) => {
          if (isGrpcClientError(error)) {
            this.logger.warn(
              `Initial GitHub scan not started for repository ${repository.id}: ${error}`,
            );
            return;
          }
          this.logger.error(
            `Initial GitHub scan failed for repository ${repository.id}: ${error}`,
          );
        });
      }

      return {
        name: repository.name,
        fullName: repository.fullName,
        id: repository.id,
        githubId: repository.githubId,
        private: repository.private,
        projectId: repository.projectId,
        createdAt: repository.createdAt
          ? repository.createdAt.toISOString()
          : '',
        updatedAt: repository.updatedAt
          ? repository.updatedAt.toISOString()
          : '',
        defaultBranch: repository.defaultBranch || '',
        scanBranch: repository.scanBranch || '',
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error in linkProject while linking project ${linkProject.projectId} to repository ${linkProject.repositoryId} : ${error}`,
      );
      throw new RpcException({
        message: `An unexpected error occurred while linking project to repository`,
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Unlink every repository of a deleted project. The rows belong to the
   * GitHub App installation and stay; only `projectId` and `scanBranch` are
   * cleared. A project with no repository linked is not an error: deletion
   * is retried, and a second call finds nothing to unlink.
   * @param deleteProject - The data containing the project ID
   * @returns The first repository unlinked, or an empty answer when none was
   */
  @Span()
  async deleteProject(
    deleteProject: DeleteProjectRequest,
  ): Promise<LinkRepositoryResponse> {
    try {
      const repositories = await this.githubRepositoryIntegration.find({
        where: {
          projectId: deleteProject.projectId,
        },
      });

      if (repositories.length === 0) {
        return {
          name: '',
          fullName: '',
          id: '',
          githubId: 0,
          private: false,
          projectId: '',
          createdAt: '',
          updatedAt: '',
          defaultBranch: '',
          scanBranch: '',
        };
      }

      for (const repository of repositories) {
        repository.projectId = null;
        repository.scanBranch = null; // Reset scan branch when unlinking
      }

      await this.githubRepositoryIntegration.save(repositories);

      const repository = repositories[0];
      return {
        name: repository.name,
        fullName: repository.fullName,
        id: repository.id,
        githubId: repository.githubId,
        private: repository.private,
        projectId: '',
        createdAt: repository.createdAt
          ? repository.createdAt.toISOString()
          : '',
        updatedAt: repository.updatedAt
          ? repository.updatedAt.toISOString()
          : '',
        defaultBranch: repository.defaultBranch || '',
        scanBranch: repository.scanBranch || '',
      };
    } catch (error) {
      // An RpcException is rethrown as is.
      if (error instanceof RpcException) {
        throw error;
      }

      // Anything else is an unexpected error
      this.logger.error(
        `Unexpected error in deleteProject while deleting project ${deleteProject.projectId} : ${error}`,
      );
      throw new RpcException({
        message: `An unexpected error occurred while deleting project`,
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Unlink a project from a repository
   * @param unlinkProject - The data containing the repository ID
   * @returns The result of the unlink or an error
   */
  @Span()
  async unlinkProject(
    unlinkProject: UnlinkRepositoryRequest,
  ): Promise<LinkRepositoryResponse> {
    try {
      // The caller's permissions were checked on the project and organisation
      // of the path, so the row must belong to both: a repository id taken
      // from another organisation is answered as not found.
      const repository = await this.githubRepositoryIntegration.findOne({
        where: {
          id: unlinkProject.repositoryId,
          projectId: unlinkProject.projectId,
        },
        relations: ['integration'],
      });

      if (
        !repository ||
        !repository.projectId ||
        repository.integration?.organizationId !== unlinkProject.organizationId
      ) {
        throw new RpcException({
          message: `Repository not found or not linked to this project`,
          code: status.NOT_FOUND,
        });
      }

      repository.projectId = null;
      repository.scanBranch = null; // Reset scan branch when unlinking

      try {
        await this.githubRepositoryIntegration.save(repository);
      } catch (error) {
        this.logger.error(
          `Failed to update repository with ID ${unlinkProject.repositoryId} in database: ${error}`,
        );
        throw new RpcException({
          message: `Failed to update repository in database`,
          code: status.INTERNAL,
        });
      }

      return {
        name: repository.name,
        fullName: repository.fullName,
        id: repository.id,
        githubId: repository.githubId,
        private: repository.private,
        projectId: repository.projectId,
        createdAt: repository.createdAt
          ? repository.createdAt.toISOString()
          : '',
        updatedAt: repository.updatedAt
          ? repository.updatedAt.toISOString()
          : '',
        defaultBranch: repository.defaultBranch || '',
        scanBranch: repository.scanBranch || '',
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      this.logger.error(
        `Unexpected error in unlinkProject while unlinking project ${unlinkProject.projectId} from repository ${unlinkProject.repositoryId} : ${error}`,
      );
      throw new RpcException({
        message:
          'An unexpected error occurred while unlinking project from repository',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get the repositories for an organization
   * @param getRepos - The data containing the organization ID
   * @returns The repositories for the organization or an error
   */
  @Span()
  async getRepositories(
    getRepos: GetRepositoriesRequest,
  ): Promise<GetRepositoriesResponse> {
    // Without a GitHub App there is nothing to reconcile against.
    this.assertGithubAppConfigured();
    const organizationId = getRepos.organizationId;

    const installations = await this.githubIntegrationRepository.find({
      where: { organizationId },
      relations: ['repositories'],
    });

    if (!installations) {
      throw new RpcException({
        message: `No GitHub installations found for organization`,
        code: status.NOT_FOUND,
      });
    }

    // Renames, visibility changes and lost webhook deliveries only reach the
    // stored list through a reconciliation with GitHub. It runs in the
    // background: this read serves the stored list, the next one sees the
    // changes.
    this.reconcileRepositoriesInBackground(installations);

    const repositories = installations.map((installation) => {
      const repository = installation.repositories.map((repository) => {
        return {
          id: repository.id,
          githubId: repository.githubId,
          nodeId: repository.nodeId,
          name: repository.name,
          fullName: repository.fullName,
          private: repository.private,
          projectId: repository.projectId || '',
          defaultBranch: repository.defaultBranch || '',
          scanBranch: repository.scanBranch || '',
        };
      });

      return {
        installationId: installation.installationId,
        repository,
      };
    });

    return {
      repositories: repositories,
      organizationId: organizationId,
    };
  }

  /**
   * Start a reconciliation with GitHub for every installation whose last sync
   * is older than the TTL and that has none running, without waiting for it:
   * the caller serves the stored list and the next read sees the changes. A
   * failed sync is only logged, and the next read retries.
   */
  private reconcileRepositoriesInBackground(
    installations: GithubIntegration[],
  ): void {
    const now = Date.now();
    for (const installation of installations) {
      const { installationId } = installation;
      if (
        this.repositoriesSyncInFlight.has(installationId) ||
        now - (this.repositoriesSyncedAt.get(installationId) ?? 0) <
          this.repositoriesSyncTtlMs
      ) {
        continue;
      }
      this.repositoriesSyncInFlight.add(installationId);
      void this.syncInstallationRepositories(installation)
        .catch((error: unknown) => {
          this.logger.warn(
            `REPOSITORIES_SYNC installation=${installationId} provider=github failed, the stored list was served: ${error}`,
          );
        })
        .finally(() => this.repositoriesSyncInFlight.delete(installationId));
    }
  }

  /**
   * Align the stored repositories of one installation with GitHub: overwrite
   * the name, full name and visibility that drifted (renames, transfers,
   * visibility changes) and record the repositories we never stored (lost
   * `installation_repositories.added` deliveries). Insert/update only — a
   * repository missing from GitHub's list is never deleted nor unlinked from
   * its project by a read; removals stay driven by the webhook.
   *
   * @returns whether a stored row changed
   */
  @Span()
  private async syncInstallationRepositories(
    installation: GithubIntegration,
  ): Promise<boolean> {
    const startedAt = Date.now();
    const githubRepositories = await this.fetchInstallationRepositories(
      installation.installationId,
    );
    const storedByGithubId = new Map(
      (installation.repositories ?? []).map((repository) => [
        Number(repository.githubId),
        repository,
      ]),
    );

    let updated = 0;
    let inserted = 0;
    for (const repository of githubRepositories) {
      const stored = storedByGithubId.get(repository.id);
      if (!stored) {
        await this.storeRepository(installation, repository);
        inserted++;
        continue;
      }
      // Truthiness, so a TINYINT read back as 0/1 never counts as drift.
      if (
        stored.name !== repository.name ||
        stored.fullName !== repository.full_name ||
        Boolean(stored.private) !== repository.private
      ) {
        await this.githubRepositoryIntegration.update(
          { id: stored.id },
          {
            name: repository.name,
            fullName: repository.full_name,
            private: repository.private,
          },
        );
        updated++;
      }
    }

    this.repositoriesSyncedAt.set(installation.installationId, Date.now());
    this.logger.log(
      `REPOSITORIES_SYNC installation=${installation.installationId} provider=github count=${githubRepositories.length} updated=${updated} inserted=${inserted} durationMs=${Date.now() - startedAt}`,
    );
    return updated + inserted > 0;
  }

  /**
   * Store a repository the installation can access. When the unique index
   * `IDX_github_repositories_unique_repo_per_install` shows it is already
   * stored — GitHub retrying a delivery, re-sending every repository after an
   * access change, or a concurrent sync — refresh its GitHub-owned fields
   * instead: skipping the duplicate kept a renamed repository's old name.
   */
  private async storeRepository(
    integration: GithubIntegration,
    repository: GithubRepositoryPayload,
  ): Promise<void> {
    const repo = new GithubRepository();
    repo.githubId = repository.id;
    repo.nodeId = repository.node_id;
    repo.name = repository.name;
    repo.fullName = repository.full_name;
    repo.private = repository.private;
    repo.integration = integration;

    try {
      await this.githubRepositoryIntegration.save(repo);
    } catch (error: unknown) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }
      await this.githubRepositoryIntegration.update(
        { githubId: repository.id, integrationId: integration.id },
        {
          name: repository.name,
          fullName: repository.full_name,
          private: repository.private,
        },
      );
    }
  }

  /**
   * Exchange the OAuth `code` returned by GitHub after an App installation for
   * a user-to-server access token. This proves the caller actually completed
   * GitHub's authorization flow as a real GitHub user — the proof of ownership
   * the install callback requires.
   *
   * GitHub answers HTTP 200 with an `error` body (not a non-2xx status) for a
   * bad/expired code, so the body must be inspected, not just the status.
   */
  private async exchangeOAuthCodeForUserToken(code: string): Promise<string> {
    const clientId = this.getSecretOrEnv('GITHUB_CLIENT_ID');
    const clientSecret = this.getSecretOrEnv('GITHUB_CLIENT_SECRET');

    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    ).catch((error: any) => {
      this.logger.error(
        `GitHub OAuth code exchange request failed: ${error?.message}`,
      );
      throw new RpcException({
        message: 'Failed to validate GitHub authorization code',
        code: status.INTERNAL,
      });
    });

    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
    };

    if (!response.ok || data.error || !data.access_token) {
      this.logger.warn(
        `GitHub OAuth code exchange rejected (status=${response.status}, error=${data.error ?? 'none'})`,
      );
      throw new RpcException({
        message: 'Invalid or expired GitHub authorization code',
        code: status.PERMISSION_DENIED,
      });
    }

    return data.access_token;
  }

  /**
   * Verify the GitHub user behind `userAccessToken` actually has access to the
   * installation they are trying to bind to their organization.
   * `GET /user/installations` only lists installations the authenticated user
   * has explicit permission to access/manage, so an installationId the caller
   * merely knows is not found here: an installation is never bound to another
   * tenant's organization. Throws PERMISSION_DENIED when the installation is not
   * among the user's installations.
   */
  private async assertUserCanManageInstallation(
    userAccessToken: string,
    installationId: number,
  ): Promise<void> {
    const userOctokit = this.createUserOctokit(userAccessToken);
    const perPage = 100;
    const MAX_PAGES = 20; // up to 2000 installations — far beyond any real user

    for (let page = 1; page <= MAX_PAGES; page++) {
      let installations: Array<{ id: number }>;
      try {
        const { data } = await userOctokit.request('GET /user/installations', {
          per_page: perPage,
          page,
        });
        installations = data?.installations ?? [];
      } catch (error: any) {
        this.logger.error(
          `Failed to list installations for the authorizing GitHub user: ${error?.message}`,
        );
        throw new RpcException({
          message: 'Failed to verify GitHub installation ownership',
          code: status.INTERNAL,
        });
      }

      if (
        installations.some(
          (installation) => Number(installation.id) === Number(installationId),
        )
      ) {
        return; // The user can manage this installation — authorized.
      }

      if (installations.length < perPage) {
        break; // Last page reached without a match.
      }
    }

    throw new RpcException({
      message: 'You do not have permission to manage this GitHub installation',
      code: status.PERMISSION_DENIED,
    });
  }

  /**
   * Prove that the GitHub user behind `userAccessToken` administers the
   * account of an installation before it is bound to an organization.
   *
   * `GET /user/installations` lists every installation in which the user can
   * see one repository, a read-only collaborator included, so it does not
   * prove the right to connect an installation. The age of the installation
   * proves nothing either: whoever calls first could bind an installation
   * someone else has just made. Every installation therefore needs one of:
   * - personal account: the user is the account itself;
   * - organization: the user is an active owner of it, or else an
   *   administrator of every repository the installation covers.
   * Any GitHub error refuses (fail closed). The refusal never says which
   * check failed.
   */
  private async assertUserAdministersInstallation(
    userAccessToken: string,
    installationId: number,
    installationDetails: InstallationProofDetails,
  ): Promise<void> {
    let proven = false;
    try {
      proven = await this.userAdministersInstallationAccount(
        this.createUserOctokit(userAccessToken),
        installationId,
        installationDetails?.account,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Could not prove administration of GitHub installation ${installationId}: status=${(error as { status?: number })?.status ?? 'none'}`,
      );
      proven = false;
    }

    if (!proven) {
      this.logger.warn(
        `GitHub installation ${installationId} refused: the authorizing user does not administer its account`,
      );
      throw new RpcException({
        message:
          'An administrator of the GitHub account must connect this installation.',
        code: status.PERMISSION_DENIED,
      });
    }
  }

  private async userAdministersInstallationAccount(
    userOctokit: Octokit,
    installationId: number,
    account: InstallationProofDetails['account'],
  ): Promise<boolean> {
    if (!account || account.id === undefined || account.id === null) {
      return false;
    }

    if (account.type === 'User') {
      const { data } = await userOctokit.request('GET /user');
      return Number(data?.id) === Number(account.id);
    }

    if (account.type !== 'Organization' || !account.login) {
      return false;
    }

    try {
      const { data } = await userOctokit.request(
        'GET /user/memberships/orgs/{org}',
        { org: account.login },
      );
      if (data?.state === 'active' && data?.role === 'admin') {
        return true;
      }
    } catch {
      // Not a member, or the endpoint is refused for this token: fall back
      // to the per-repository proof below.
    }

    const covered = await this.fetchInstallationRepositories(installationId);
    if (covered.length === 0) {
      return false;
    }
    const adminRepositoryIds = await this.listUserAdminRepositoryIds(
      userOctokit,
      installationId,
    );
    return covered.every((repository) =>
      adminRepositoryIds.has(Number(repository.id)),
    );
  }

  /** Ids of the installation's repositories on which the user is admin. */
  private async listUserAdminRepositoryIds(
    userOctokit: Octokit,
    installationId: number,
  ): Promise<Set<number>> {
    const PER_PAGE = 100;
    const MAX_PAGES = 100;
    const adminIds = new Set<number>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await userOctokit.request(
        'GET /user/installations/{installation_id}/repositories',
        { installation_id: installationId, per_page: PER_PAGE, page },
      );
      const repositories = data?.repositories ?? [];
      for (const repository of repositories) {
        if (repository.permissions?.admin === true) {
          adminIds.add(Number(repository.id));
        }
      }
      if (repositories.length < PER_PAGE) {
        break;
      }
    }
    return adminIds;
  }

  /**
   * Create an Octokit instance authenticated as a GitHub user (user-to-server
   * token). Used only to verify installation ownership during the install
   * callback — app-authenticated calls use createInstallationOctokit instead.
   */
  private createUserOctokit(userAccessToken: string): Octokit {
    return new OctokitWithPlugins({
      auth: userAccessToken,
      request: {
        timeout: 30000,
      },
      retry: {
        enabled: true,
        retries: 3,
        doNotRetry: [400, 401, 403, 404, 422],
      },
      throttle: {
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          this.logger.warn(
            `Rate limit hit for ${(options as { method: string; url: string }).method} ${(options as { method: string; url: string }).url}, retrying after ${retryAfter}s (attempt ${retryCount + 1})`,
          );
          return retryCount < 3;
        },
        onSecondaryRateLimit: (retryAfter, options) => {
          this.logger.warn(
            `Secondary rate limit hit for ${(options as { method: string; url: string }).method} ${(options as { method: string; url: string }).url}, retrying after ${retryAfter}s`,
          );
          return false;
        },
      },
    });
  }

  /**
   * Callback for the installation of the Github App
   * @param callbackDto - The data containing the installation ID, organization ID, and OAuth code
   * @returns The result of the callback or an error
   */
  @Span()
  async callbackInstall(
    callbackDto: CallbackInstallRequest,
  ): Promise<CallbackInstallResponse> {
    const installationId = callbackDto.installationId;
    const organizationId = callbackDto.organizationId;
    const userInternalId = callbackDto.userId;
    const code = callbackDto.code;

    // Prove the caller actually authorized the GitHub App AND has access to
    // THIS installation BEFORE any DB read/write: installation ids are
    // sequential, so knowing one must never be enough to bind it (and its
    // private repos) to another organization. The `code` is the user's proof-of-authorization: exchange it for a
    // user-to-server token, then confirm the installation is one that user can
    // actually manage. Both steps must run before we touch the database.
    if (!code || typeof code !== 'string' || code.trim() === '') {
      throw new RpcException({
        message: 'Missing GitHub authorization code',
        code: status.INVALID_ARGUMENT,
      });
    }
    const userAccessToken = await this.exchangeOAuthCodeForUserToken(code);
    await this.assertUserCanManageInstallation(userAccessToken, installationId);

    // Check if there's already an installation for this organization (excluding the current one)
    const existingInstallation = await this.githubIntegrationRepository.findOne(
      {
        where: {
          organizationId,
          installationId: Not(installationId), // Exclude the current installation
        },
      },
    );
    if (
      existingInstallation &&
      !(await this.removeIfGoneAtGithub(existingInstallation))
    ) {
      throw new RpcException({
        message: `An installation already exists for organization`,
        code: status.ALREADY_EXISTS,
      });
    }

    const installationDetails =
      await this.getInstallationDetails(installationId);
    if (!installationDetails) {
      throw new RpcException({
        message: `Installation not found`,
        code: status.NOT_FOUND,
      });
    }

    let githubIntegration = await this.githubIntegrationRepository.findOne({
      where: { installationId },
    });

    // An installation belongs to one organization. Binding it again from
    // another one must fail loudly and leave it where it is: a silent success
    // would let the rightful owner believe the connection worked.
    this.assertNotBoundElsewhere(githubIntegration, organizationId);

    // Every path below binds an installation that is not yet bound to an
    // organization: require proof that the caller administers it first.
    if (!githubIntegration?.organizationId) {
      await this.assertUserAdministersInstallation(
        userAccessToken,
        installationId,
        installationDetails,
      );
    }

    // If installation not found, create it (webhook might not have been processed yet)
    if (!githubIntegration) {
      this.logger.log(
        `GitHub integration with installation ID ${installationId} not found in database. Creating it now (webhook may not have been processed yet).`,
      );

      // Get repository details from GitHub API
      const installationRepos =
        await this.getInstallationRepositoriesFromAPI(installationId);

      // Create the installation entity
      const newIntegration = new GithubIntegration();
      newIntegration.installationId = installationId;
      newIntegration.userId = userInternalId;
      newIntegration.organizationId = organizationId;
      newIntegration.githubOwner =
        installationAccountLogin(installationDetails);

      try {
        githubIntegration =
          await this.githubIntegrationRepository.save(newIntegration);
      } catch (error: any) {
        if (this.isUniqueConstraintViolation(error)) {
          // Created in parallel (webhook or another callback): fetch the
          // existing row, and refuse if another organization won the race.
          githubIntegration = await this.githubIntegrationRepository.findOne({
            where: { installationId },
          });
          this.assertNotBoundElsewhere(githubIntegration, organizationId);
        } else {
          throw error;
        }
      }

      if (!githubIntegration) {
        // As a last resort, fetch again (shouldn't happen)
        githubIntegration = await this.githubIntegrationRepository.findOne({
          where: { installationId },
        });
      }

      // If we finally have the integration, bind it (a row the webhook
      // created in parallel has no organization yet) and fill its fields.
      if (githubIntegration) {
        githubIntegration = await this.bindInstallation(
          githubIntegration,
          organizationId,
          userInternalId,
          installationAccountLogin(installationDetails),
        );
      }

      // Create repository entities (idempotent: ignore duplicates if any)
      for (const repository of installationRepos) {
        const repo = new GithubRepository();
        repo.githubId = repository.id;
        repo.nodeId = repository.node_id;
        repo.name = repository.name;
        repo.fullName = repository.full_name;
        repo.private = repository.private;
        repo.integration = githubIntegration!;

        try {
          await this.githubRepositoryIntegration.save(repo);
        } catch (error: any) {
          if (this.isUniqueConstraintViolation(error)) {
            // Repo already exists for this installation; ignore
            continue;
          }
          throw error;
        }
      }

      this.logger.log(
        `Created/ensured GitHub integration for installation ID ${installationId} with repositories synchronized.`,
      );
    } else {
      await this.bindInstallation(
        githubIntegration,
        organizationId,
        userInternalId,
        installationAccountLogin(installationDetails),
      );
    }

    return {
      returnUri: this.productLinks.githubInstallReturnUri(),
    };
  }

  /**
   * Bind an installation row to the organization, or fill the missing fields
   * of a row already bound to it.
   *
   * A row with no organization (recorded by the installation webhook) is
   * bound with one conditional update: it only applies while the row still
   * has no organization. When two organizations finish the flow at the same
   * time, only one update applies; the other reads the row again and is
   * refused (ALREADY_EXISTS), or succeeds when the winner is its own
   * organization. Never a silent overwrite.
   */
  private async bindInstallation(
    integration: GithubIntegration,
    organizationId: string,
    userId: string,
    githubOwner: string | null | undefined,
  ): Promise<GithubIntegration> {
    if (!integration.organizationId) {
      const changes: Partial<GithubIntegration> = {
        organizationId,
        userId: integration.userId || userId,
      };
      if (!integration.githubOwner && githubOwner) {
        changes.githubOwner = githubOwner;
      }
      const result = await this.githubIntegrationRepository.update(
        { id: integration.id, organizationId: IsNull() },
        changes,
      );
      if (result?.affected) {
        return { ...integration, ...changes } as GithubIntegration;
      }
      const current = await this.githubIntegrationRepository.findOne({
        where: { installationId: integration.installationId },
      });
      this.assertNotBoundElsewhere(current, organizationId);
      if (current?.organizationId !== organizationId) {
        // Removed, or still unbound although the update did not apply:
        // never report a connection that did not happen.
        throw new RpcException({
          message: 'The GitHub installation could not be connected.',
          code: status.ABORTED,
        });
      }
      return current;
    }

    this.assertNotBoundElsewhere(integration, organizationId);
    let needSave = false;
    if (!integration.userId) {
      integration.userId = userId;
      needSave = true;
    }
    if (!integration.githubOwner && githubOwner) {
      integration.githubOwner = githubOwner;
      needSave = true;
    }
    if (needSave) {
      await this.githubIntegrationRepository.save(integration);
    }
    return integration;
  }

  /** ALREADY_EXISTS when the installation is bound to another organization. */
  private assertNotBoundElsewhere(
    integration: GithubIntegration | null | undefined,
    organizationId: string,
  ): void {
    if (
      integration?.organizationId &&
      integration.organizationId !== organizationId
    ) {
      this.logger.warn(
        `GitHub installation ${integration.installationId} refused for organization ${organizationId}: it is bound to another organization`,
      );
      throw new RpcException({
        message:
          'This GitHub installation is already connected to another organization.',
        code: status.ALREADY_EXISTS,
      });
    }
  }

  /**
   * The organization already has another installation recorded. If GitHub no
   * longer knows it (404: removed at GitHub, its installation.deleted webhook
   * lost), it is cleaned up as that webhook would have, and the
   * reinstallation can proceed. Read with the App JWT
   * (`GET /app/installations/{id}` mints no installation token); this only
   * runs when an organization installs the App again. Any other answer keeps
   * the installation, and the refusal.
   */
  private async removeIfGoneAtGithub(
    installation: GithubIntegration,
  ): Promise<boolean> {
    try {
      await this.createInstallationOctokit(installation.installationId).request(
        'GET /app/installations/{installation_id}',
        { installation_id: installation.installationId },
      );
      return false;
    } catch (error: unknown) {
      if ((error as { status?: number })?.status !== 404) {
        this.logger.warn(
          `Could not check installation ${installation.installationId} of organization ${installation.organizationId}: ${error}`,
        );
        return false;
      }
    }
    this.logger.warn(
      `Installation ${installation.installationId} of organization ${installation.organizationId} is gone at GitHub (404): removing its stale row before the reinstallation`,
    );
    await this.handleUninstallEvent(installation.installationId);
    return true;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    // 1062 / ER_DUP_ENTRY on MySQL, 23505 on PostgreSQL.
    return isUniqueViolation(error);
  }

  /**
   * Get installation details from GitHub
   * @param installationId - The installation ID
   * @returns The installation details or an error
   */
  private async getInstallationDetails(
    installationId: number,
  ): Promise<any | null> {
    try {
      const installationOctokit =
        this.createInstallationOctokit(installationId);

      const { data } = await installationOctokit.request(
        'GET /app/installations/{installation_id}',
        {
          installation_id: installationId,
        },
      );

      return data;
    } catch (error: unknown) {
      // The API's error is logged through the serializer; the caller gets a
      // stable message.
      this.logger.error({
        err: error,
        msg: 'Failed to retrieve installation details',
      });
      throw new RpcException({
        message: 'Failed to retrieve installation details',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Get installation repositories from GitHub API
   * @param installationId - The installation ID
   * @returns The repositories for the installation
   */
  private async getInstallationRepositoriesFromAPI(
    installationId: number,
  ): Promise<GithubRepositoryPayload[]> {
    try {
      return await this.fetchInstallationRepositories(installationId);
    } catch (error: unknown) {
      // The API's error is logged through the serializer; the caller gets a
      // stable message.
      this.logger.error({
        err: error,
        msg: 'Failed to retrieve installation repositories',
      });
      throw new RpcException({
        message: 'Failed to retrieve installation repositories',
        code: status.INTERNAL,
      });
    }
  }

  /**
   * Every repository the installation can access. GitHub caps `per_page` at
   * 100 and paginates the rest: an unpaged call silently stopped at GitHub's
   * default page size of 30. A MAX_PAGES guard bounds a pathological or
   * looping response.
   */
  private async fetchInstallationRepositories(
    installationId: number,
  ): Promise<GithubRepositoryPayload[]> {
    const installationOctokit = this.createInstallationOctokit(installationId);
    const PER_PAGE = 100;
    const MAX_PAGES = 100;
    const repositories: GithubRepositoryPayload[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await installationOctokit.request(
        'GET /installation/repositories',
        { per_page: PER_PAGE, page },
      );
      repositories.push(
        ...data.repositories.map((repo) => ({
          // @octokit/openapi-types >= 28 widened `id` to `number | bigint`;
          // GitHub repository ids stay within Number.MAX_SAFE_INTEGER and the
          // rest of the codebase (protos, DB columns) models them as numbers.
          id: Number(repo.id),
          node_id: repo.node_id,
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private,
        })),
      );
      if (data.repositories.length < PER_PAGE) {
        return repositories;
      }
    }

    this.logger.warn(
      `REPOSITORIES_SYNC installation=${installationId} provider=github hit page cap ${MAX_PAGES}; repository list is truncated`,
    );
    return repositories;
  }

  /**
   * Installation event handler for the Github App
   * @param body - The data containing the installation details
   * @returns The result of the handling or an error
   */
  @Span()
  async handleInstallationsEvent(body: any): Promise<boolean> {
    if (!body.installation || !body.installation.id) {
      throw new RpcException({
        message: 'Invalid installation data: missing installation ID',
        code: status.INVALID_ARGUMENT,
      });
    }

    if (!Array.isArray(body.repositories)) {
      throw new RpcException({
        message: 'Invalid installation data: repositories must be an array',
        code: status.INVALID_ARGUMENT,
      });
    }

    const installationId = body.installation.id;
    const repositories = body.repositories;
    const existingInstallation = await this.githubIntegrationRepository.findOne(
      { where: { installationId } },
    );
    if (existingInstallation) {
      this.logger.log(
        `Installation with ID ${installationId} already exists (likely created by callback). Skipping webhook creation.`,
      );
      return true;
    }

    const installation = new GithubIntegration();
    installation.installationId = installationId;
    installation.githubOwner = installationAccountLogin(body.installation);

    try {
      await this.githubIntegrationRepository.save(installation);
    } catch (error: any) {
      if (this.isUniqueConstraintViolation(error)) {
        // Integration already created (likely by callback); continue idempotently
      } else {
        throw error;
      }
    }

    const persistedInstallation =
      await this.githubIntegrationRepository.findOne({
        where: { installationId },
      });
    if (!persistedInstallation) {
      // In rare cases, another transaction might have rolled back; bail out safely
      this.logger.warn(
        `Installation ${installationId} not found after attempted insert; skipping repository creation in webhook handler`,
      );
      return true;
    }

    for (const repository of repositories) {
      const repo = new GithubRepository();
      repo.githubId = repository.id;
      repo.nodeId = repository.node_id;
      repo.name = repository.name;
      repo.fullName = repository.full_name;
      repo.private = repository.private;
      repo.integration = persistedInstallation!;

      try {
        await this.githubRepositoryIntegration.save(repo);
      } catch (error: any) {
        if (this.isUniqueConstraintViolation(error)) {
          // Repository already exists for this installation; ignore
          continue;
        }
        throw error;
      }
    }

    return true;
  }

  /**
   * `installation_target.renamed`: the GitHub user or organization the App is
   * installed on changed its login. Keeps the stored account in step; an unknown installation updates nothing.
   */
  @Span()
  private async handleInstallationTargetRenamed(body: {
    installation?: { id?: number };
    account?: { login?: string };
  }): Promise<void> {
    const installationId = body?.installation?.id;
    const githubOwner = body?.account?.login;
    if (typeof installationId !== 'number' || !githubOwner) {
      this.logger.warn(
        'installation_target.renamed ignored: installation id or account login missing',
      );
      return;
    }
    await this.githubIntegrationRepository.update(
      { installationId },
      { githubOwner },
    );
    this.logger.log(
      `GitHub account of installation ${installationId} renamed to ${githubOwner}`,
    );
  }

  /**
   * Uninstall event handler for the Github App
   * @param installationId - The installation ID
   * @returns The result of the handling or an error
   */
  @Span()
  async handleUninstallEvent(installationId: number): Promise<void> {
    const installation = await this.githubIntegrationRepository.findOne({
      where: { installationId },
    });

    if (!installation) {
      // Idempotent: GitHub retries installation.deleted on any non-2xx and
      // also occasionally double-delivers. Throwing here used to bubble up
      // as 5xx, leaving GitHub stuck in its retry budget and (worse) leaving
      // the stale row in place when a previous attempt had succeeded.
      this.logger.log(
        `installation.deleted webhook for unknown installation ${installationId} — already cleaned up`,
      );
      return;
    }

    await this.githubIntegrationRepository.delete(installation.id);
  }

  /**
   * Repository creation event handler for the Github App
   * @param installationId - The installation ID
   * @param repositoriesAdded - The repositories to add
   * @returns The result of the handling or an error
   */
  @Span()
  async handleRepositoryCreationEvent(
    installationId: number,
    repositoriesAdded: Array<{
      id: number;
      node_id: string;
      name: string;
      full_name: string;
      private: boolean;
    }>,
  ): Promise<void> {
    const installationDetails = await this.githubIntegrationRepository.findOne({
      where: { installationId },
    });

    if (!installationDetails) {
      throw new RpcException({
        message: `Installation not found`,
        code: status.NOT_FOUND,
      });
    }

    // Idempotent: GitHub may retry installation_repositories.added (delivery
    // timeout, transient 5xx) or batch repositories we already store — the
    // whole list is re-sent when the installation's access changes. Those
    // duplicates get their name/visibility refreshed and the rest of the
    // batch keeps going, so siblings are not silently lost.
    for (const repository of repositoriesAdded) {
      await this.storeRepository(installationDetails, repository);
    }
  }

  /**
   * Repository deletion event handler for the Github App
   * @param installationId - The installation ID
   * @param repositoriesToRemove - The repositories to remove
   * @returns The result of the handling or an error
   */
  @Span()
  async handleRepositoryDeletionEvent(
    installationId: number,
    repositoriesToRemove: Array<{
      id: number;
      node_id: string;
      name: string;
      full_name: string;
      private: boolean;
    }>,
  ): Promise<void> {
    for (const repository of repositoriesToRemove) {
      const repositoryReq = await this.githubRepositoryIntegration
        .createQueryBuilder('repository')
        .innerJoin('repository.integration', 'integration')
        .where('repository.githubId = :repositoryId', {
          repositoryId: repository.id,
        })
        .andWhere('integration.installationId = :installationId', {
          installationId,
        })
        .getOne();

      if (!repositoryReq) {
        // GitHub may deliver installation_repositories.removed for a repo
        // we never recorded (earlier add was lost). Dereferencing .id here
        // used to throw and break the rest of the batch, leaving the
        // gateway to 5xx and GitHub to retry forever.
        this.logger.warn(
          `Skipping deletion of unknown repository githubId=${repository.id} for installation ${installationId}`,
        );
        continue;
      }

      await this.githubRepositoryIntegration.delete(repositoryReq.id);
    }
  }

  /**
   * Repository update event handler for the Github App
   * @param installationId - The installation ID
   * @param repositoriesToUpdate - The repositories to update
   * @returns The result of the handling or an error
   */
  @Span()
  async handleRepositoryUpdateEvent(
    installationId: number,
    repositoriesToUpdate: Array<{
      id: number;
      node_id: string;
      name: string;
      full_name: string;
      private: boolean;
    }>,
  ): Promise<void> {
    for (const repository of repositoriesToUpdate) {
      const repositoryReq = await this.githubRepositoryIntegration
        .createQueryBuilder('repository')
        .innerJoin('repository.integration', 'integration')
        .where('repository.githubId = :repositoryId', {
          repositoryId: repository.id,
        })
        .andWhere('integration.installationId = :installationId', {
          installationId,
        })
        .getOne();

      if (!repositoryReq) {
        // A repository outside the installation's selection, or whose add
        // event was lost. Throwing would make GitHub retry the delivery
        // forever; the GetRepositories reconciliation records it instead.
        this.logger.warn(
          `Skipping metadata update of unknown repository githubId=${repository.id} for installation ${installationId}`,
        );
        continue;
      }

      repositoryReq.name = repository.name;
      repositoryReq.fullName = repository.full_name;
      repositoryReq.private = repository.private;

      await this.githubRepositoryIntegration.save(repositoryReq);
    }
  }

  /**
   * `repository` webhook: a repository the installation can access changed on
   * GitHub. Renames, transfers and visibility changes rewrite fields we store,
   * so they are applied. The other actions are left alone as before — a
   * created repository already arrives as `installation_repositories.added`.
   */
  @Span()
  private async handleRepositoryEvent(
    installationId: number,
    action: string,
    repository: GithubRepositoryPayload,
  ): Promise<void> {
    if (!REPOSITORY_METADATA_ACTIONS.has(action)) {
      this.logger.log(
        `Repository ${action} event ignored for installation ID ${installationId}`,
      );
      return;
    }

    this.logger.log(
      `Handling repository ${action} event for installation ID ${installationId}`,
    );
    await this.handleRepositoryUpdateEvent(installationId, [repository]);
  }

  /**
   * Webhook event handler for the Github App
   * @param webHookDto - The data containing the webhook event details
   * @returns The result of the handling or an error
   */
  @Span()
  async handleWebhookEvent(
    webHookDto: WebhookEventRequest,
  ): Promise<WebhookResponse> {
    // HMAC over the RAW body string (the bytes the gateway received).
    // Parsing then re-serializing would silently re-order keys / drop
    // whitespace and create a signature-bypass surface.
    const isValid = this.verifyWebhookSignature(
      webHookDto.bodyJson,
      webHookDto.signature,
      this.secretsService.getSecret('GITHUB_WEBHOOK_SECRET'),
    );

    const body = JSON.parse(webHookDto.bodyJson);

    if (!isValid) {
      this.logger.warn('GitHub webhook signature verification failed');
      throw new RpcException({
        message: 'Invalid webhook signature',
        code: status.UNAUTHENTICATED,
      });
    }

    const event = webHookDto.event;
    const action = webHookDto.action;

    const organizationId = (
      await this.githubIntegrationRepository.findOneBy({
        installationId: body.installation.id,
      })
    )?.organizationId;

    try {
      switch (event) {
        case 'installation':
          switch (action) {
            case 'created':
              this.logger.log(
                `Handling installation created event for installation ID ${body.installation.id}`,
              );
              await this.handleInstallationsEvent(body);
              break;
            case 'deleted':
              this.logger.log(
                `Handling installation deleted event for installation ID ${body.installation.id}`,
              );
              await this.handleUninstallEvent(body.installation.id);
              break;
          }
          break;
        case 'installation_target':
          // The account the App is installed on was renamed (its login is stored with the installation, see githubOwner).
          if (action === 'renamed') {
            await this.handleInstallationTargetRenamed(body);
          }
          break;
        case 'installation_repositories':
          switch (action) {
            case 'added':
              this.logger.log(
                `Handling installation repositories added event for installation ID ${body.installation.id}`,
              );
              await this.handleRepositoryCreationEvent(
                body.installation.id,
                body.repositories_added,
              );
              break;
            case 'removed':
              this.logger.log(
                `Handling installation repositories removed event for installation ID ${body.installation.id}`,
              );
              await this.handleRepositoryDeletionEvent(
                body.installation.id,
                body.repositories_removed,
              );
              break;
          }
          break;
        case 'repository':
          await this.handleRepositoryEvent(
            body.installation.id,
            action,
            body.repository,
          );
          break;
        case 'create':
          this.logger.log(
            `Handling create event for installation ID ${body.installation?.id ?? 'unknown'}`,
          );
          await this.handleBranchCreateEvent(body);
          break;
        case 'delete':
          this.logger.log(
            `Handling delete event for installation ID ${body.installation?.id ?? 'unknown'}`,
          );
          await this.handleBranchDeleteEvent(body);
          break;
        case 'push':
          // Extract branch from ref (refs/heads/branch-name)
          const pushBranch = body.ref.replace('refs/heads/', '');

          // Find linked repository to check configured scan branch
          const pushRepo = await this.githubRepositoryIntegration.findOne({
            where: { githubId: body.repository.id, projectId: Not(IsNull()) },
            relations: ['integration'],
          });

          if (!pushRepo) {
            this.logger.log(
              `Push event ignored: Repository ${body.repository.id} not linked to any project`,
            );
            break;
          }

          // Determine target branch: scanBranch > default_branch
          const targetBranch =
            pushRepo.scanBranch || body.repository.default_branch;

          if (pushBranch !== targetBranch) {
            this.logger.log(
              `Push to ${pushBranch} ignored, scanning only ${targetBranch}`,
            );
            break;
          }

          // Per-project opt-out: the owner disabled scan-on-commit for this
          // project. Checked here rather than inside
          // startScanForCommitAndProject so that manual scans and the initial
          // scan fired when a repository is linked keep working.
          const pushSettings = await this.readPushProjectSettings(
            pushRepo.projectId,
          );
          if (!pushSettings.scanOnCommitEnabled) {
            this.logger.log(
              `WEBHOOK_IGNORED_SCAN_ON_COMMIT_DISABLED project=${pushRepo.projectId} commit=${body.after} repo=${body.repository.id}`,
            );
            break;
          }

          // The push scans what the PROJECT is: an AppSec project whose
          // AppSec is writable gets an AppSec scan; otherwise a graph-only
          // scan when the graph-only product is active; otherwise nothing. An
          // unreadable mark or product state keeps the AppSec path behind its
          // gate.
          const pushScan = await this.entitlements.decidePushScan(
            organizationId,
            pushSettings.appsecProject,
          );
          if (pushScan.scan === 'none') {
            this.logger.log(
              `WEBHOOK_IGNORED_${webhookIgnoredLabel(pushScan.reason)} org=${organizationId} project=${pushRepo.projectId} commit=${body.after} repo=${body.repository.id}`,
            );
            break;
          }

          if (pushScan.scan === 'graph_only') {
            await this.startGraphOnlyPushScan(
              body.repository.id,
              body.after,
              targetBranch,
              body.ref,
              organizationId,
              pushRepo.projectId,
              pushSettings.typeScan,
            );
            break;
          }

          this.logger.log(
            `Push event to target branch ${pushBranch}, triggering scan for repository ${body.repository.id}`,
          );
          try {
            await this.startScanForCommitAndProject(
              body.repository.id,
              body.after,
              targetBranch,
              body.ref,
              organizationId,
              {},
              pushSettings.typeScan,
            );
          } catch (error: unknown) {
            // A scan of the branch is running. GitHub never
            // redelivers a refused webhook, so the commit is scanned later.
            const deferred = await this.deferRefusedPush(error, {
              provider: 'github',
              projectId: pushRepo.projectId,
              branch: targetBranch,
              commitSha: body.after,
              githubRepositoryId: body.repository.id,
            });
            if (!deferred) {
              throw error;
            }
          }
          break;
        default:
          this.logger.warn(
            `Unhandled event - metadata: { event: ${event}, action: ${action} }`,
          );
      }
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof RpcException) {
        throw error;
      }

      this.logger.error(
        `Unexpected error in handleWebhookEvent - metadata: { error: ${error} }`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error handling webhook event',
      });
    }
  }

  /**
   * Handle a GitHub `create` webhook event for a branch.
   *
   * GitHub fires `create` whenever a branch (or tag) is pushed for the first
   * time. We only care about branches — tag events are skipped. The handler is
   * intentionally tolerant: invalid payloads and unknown repositories are
   * logged and ignored rather than throwing (a thrown RpcException would make
   * GitHub retry the event forever).
   *
   * Idempotent by design: a repeated event hits the same
   * `(repositoryId, name)` unique index and the upsert is a no-op.
   */
  @Span()
  private async handleBranchCreateEvent(body: any): Promise<void> {
    const refType = body?.ref_type;
    const refName = body?.ref;
    const repoGithubId = body?.repository?.id;

    if (refType !== 'branch') {
      this.logger.log(
        `BRANCHES_WEBHOOK event=create provider=github outcome=skipped reason=ref_type=${refType}`,
      );
      return;
    }
    if (!refName || typeof repoGithubId !== 'number') {
      this.logger.log(
        `BRANCHES_WEBHOOK event=create provider=github outcome=skipped reason=invalid_payload`,
      );
      return;
    }

    const repository = await this.githubRepositoryIntegration.findOne({
      where: { githubId: repoGithubId },
    });
    if (!repository) {
      this.logger.warn(
        `BRANCHES_WEBHOOK event=create provider=github outcome=skipped reason=unknown_repo githubId=${repoGithubId}`,
      );
      return;
    }

    await this.githubBranchRepository.upsert(
      { repositoryId: repository.id, name: refName, isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    this.logger.log(
      `BRANCHES_WEBHOOK event=create provider=github outcome=upserted repo=${repository.id} branch=${refName}`,
    );
  }

  /**
   * Handle a GitHub `delete` webhook event for a branch.
   *
   * Mirrors {@link handleBranchCreateEvent}: tag events are skipped, invalid
   * payloads / unknown repositories are logged and ignored. Idempotent —
   * deleting a non-existent row simply returns `{ affected: 0 }`.
   */
  @Span()
  private async handleBranchDeleteEvent(body: any): Promise<void> {
    const refType = body?.ref_type;
    const refName = body?.ref;
    const repoGithubId = body?.repository?.id;

    if (refType !== 'branch') {
      this.logger.log(
        `BRANCHES_WEBHOOK event=delete provider=github outcome=skipped reason=ref_type=${refType}`,
      );
      return;
    }
    if (!refName || typeof repoGithubId !== 'number') {
      this.logger.log(
        `BRANCHES_WEBHOOK event=delete provider=github outcome=skipped reason=invalid_payload`,
      );
      return;
    }

    const repository = await this.githubRepositoryIntegration.findOne({
      where: { githubId: repoGithubId },
    });
    if (!repository) {
      this.logger.warn(
        `BRANCHES_WEBHOOK event=delete provider=github outcome=skipped reason=unknown_repo githubId=${repoGithubId}`,
      );
      return;
    }

    await this.githubBranchRepository.delete({
      repositoryId: repository.id,
      name: refName,
    });
    this.logger.log(
      `BRANCHES_WEBHOOK event=delete provider=github outcome=deleted repo=${repository.id} branch=${refName}`,
    );
  }

  /**
   * Verify the GitHub webhook signature.
   *
   *  - HMAC is computed over the **raw** request body string the gateway
   *    received over the wire, never over `JSON.stringify(JSON.parse(body))`:
   *    a re-serialization can re-order keys and strip whitespace, so the
   *    signature would no longer bind the exact bytes received.
   *  - Length-mismatch fast-fail before {@link crypto.timingSafeEqual} (which
   *    throws on unequal lengths) — the helper returns `false` cleanly.
   *  - Missing/empty secret returns `false` (no fail-open).
   *
   * @param rawBody The exact request body bytes (as received). MUST be a
   *                string, not a parsed object.
   * @param signature The `X-Hub-Signature-256` header value (e.g.
   *                  `sha256=<hex>`).
   * @param secret The configured `GITHUB_WEBHOOK_SECRET`.
   */
  @Span()
  verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!secret || typeof secret !== 'string') {
      return false;
    }
    return verifyHmacSignature(rawBody, signature, secret, 'sha256');
  }

  /**
   * Creates a failed scan record in the database
   * @param projectId - The project ID
   * @param errorMessage - Error message explaining the failure reason
   */
  @Span()
  private async createFailedScan(
    projectId: string,
    organizationId: string,
    errorMessage: string,
  ): Promise<void> {
    await safeGrpcCall(
      this.scanServiceClient.createFailedScan({
        projectId: projectId,
        organizationId: organizationId,
        errorMessage: errorMessage,
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
   * the scan would stay `running` with no reason at all. Security-
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
   * Request options of a repository-history call: bounded on the clock
   * (octokit 22 runs on fetch, which ignores `timeout`; only a signal bounds
   * it) and never retried, since the caller's deadline is 20 s.
   */
  private readonly historyOctokits = new Map<
    number,
    { octokit: Octokit; expiresAt: number }
  >();

  /** The history octokit of an installation, reused for HISTORY_OCTOKIT_TTL_MS. */
  private historyOctokit(installationId: number): Octokit {
    const now = Date.now();
    const cached = this.historyOctokits.get(installationId);
    if (cached && cached.expiresAt > now) return cached.octokit;
    for (const [id, entry] of this.historyOctokits) {
      if (entry.expiresAt <= now) this.historyOctokits.delete(id);
    }
    const octokit = this.createInstallationOctokit(installationId, {
      retryOnRateLimit: false,
    });
    this.historyOctokits.set(installationId, {
      octokit,
      expiresAt: now + HISTORY_OCTOKIT_TTL_MS,
    });
    return octokit;
  }

  private historyRequestOptions(): { signal: AbortSignal; retries: number } {
    return {
      signal: AbortSignal.timeout(HISTORY_PROVIDER_TIMEOUT_MS),
      retries: 0,
    };
  }

  /**
   * Commits of the linked repository (read by a closed rule miner), newest
   * first. Only sha, committer date and message are mapped: no author or
   * committer name or e-mail. Provider errors are thrown as octokit raised
   * them; RepositoryHistoryService maps them to gRPC codes.
   */
  @Span()
  async listCommitsForRepository(
    repoEntity: GithubRepository,
    options: HistoryListOptions,
  ): Promise<ProviderCommitSummary[]> {
    const { owner, repo } = this.parseRepoFullName(repoEntity.fullName);
    const octokit = this.historyOctokit(repoEntity.integration.installationId);
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/commits',
      {
        owner,
        repo,
        ...(options.branch ? { sha: options.branch } : {}),
        ...(options.path ? { path: options.path } : {}),
        page: options.page,
        per_page: options.perPage,
        request: this.historyRequestOptions(),
      },
    );
    return (Array.isArray(data) ? data : []).map((c) => ({
      sha: c.sha,
      date: c.commit?.committer?.date ?? '',
      message: c.commit?.message ?? '',
    }));
  }

  /**
   * One commit of the linked repository with its changed files and patches,
   * as GitHub returns them without pagination (at most 300 files).
   */
  @Span()
  async getCommitForRepository(
    repoEntity: GithubRepository,
    sha: string,
  ): Promise<ProviderCommit> {
    const { owner, repo } = this.parseRepoFullName(repoEntity.fullName);
    const octokit = this.historyOctokit(repoEntity.integration.installationId);
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}',
      { owner, repo, ref: sha, request: this.historyRequestOptions() },
    );
    const files = Array.isArray(data.files) ? data.files : [];
    return {
      sha: data.sha,
      date: data.commit?.committer?.date ?? '',
      message: data.commit?.message ?? '',
      files: files.map((f) => ({
        path: f.filename,
        oldPath: f.previous_filename ?? '',
        status: f.status ?? '',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        patch: f.patch ?? '',
      })),
      moreFiles: files.length >= GITHUB_COMMIT_FILES_PAGE,
    };
  }

  /**
   * Check if a project has a linked GitHub repository.
   * @param request - The data containing the projectId.
   * @returns The link status with repository info if linked.
   */
  @Span()
  async getProjectLinkStatus(request: { projectId: string }): Promise<{
    isLinked: boolean;
    repositoryId: string;
    repositoryName: string;
    repositoryFullName: string;
  }> {
    try {
      const repository = await this.githubRepositoryIntegration.findOne({
        where: { projectId: request.projectId },
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
        repositoryFullName: repository.fullName,
      };
    } catch (error) {
      this.logger.error(
        `Failed to check GitHub link status for project ${request.projectId}: ${error}`,
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
   * Batch check if multiple projects have linked GitHub repositories.
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
      const repositories = await this.githubRepositoryIntegration.find({
        where: { projectId: In(projectIds) },
      });

      // Create a map for quick lookup
      const repoMap = new Map<
        string,
        { id: string; name: string; fullName: string }
      >();
      for (const repo of repositories) {
        repoMap.set(repo.projectId, {
          id: repo.id,
          name: repo.name,
          fullName: repo.fullName,
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
            repositoryFullName: repo.fullName,
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
      this.logger.error(`Failed to batch check GitHub link status: ${error}`);
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

  /**
   * Get a valid GitHub installation access token for a project.
   * Used for internal service operations like git clone.
   * @param projectId - The CybeDefend project ID linked to a GitHub repository
   * @returns Access token and repository metadata for git operations
   */
  @Span()
  async getAccessTokenForProject(projectId: string): Promise<{
    accessToken: string;
    cloneUrl: string;
    repositoryFullName: string;
    defaultBranch: string;
  }> {
    // Find the GitHub repository linked to this project
    const repository = await this.githubRepositoryIntegration.findOne({
      where: { projectId },
      relations: ['integration'],
    });

    if (!repository || !repository.integration) {
      throw new RpcException({
        message: 'No GitHub repository linked to this project',
        code: status.NOT_FOUND,
      });
    }

    const integration = repository.integration;

    // Outside the try, so the refusal keeps its own code instead of
    // being wrapped as INTERNAL.
    this.assertGithubAppConfigured();

    try {
      // Create installation-scoped Octokit to get an access token
      const auth = createAppAuth({
        appId: this.appId,
        privateKey: this.privateKey,
        installationId: integration.installationId,
      });

      // Get the installation access token
      const { token } = await auth({ type: 'installation' });

      // Build the clone URL with token authentication
      // Format: https://x-access-token:{token}@github.com/{owner}/{repo}.git
      const cloneUrl = `https://github.com/${repository.fullName}.git`;

      this.logger.log(
        `Generated GitHub access token for project ${projectId} (repo: ${repository.fullName})`,
      );

      return {
        accessToken: token,
        cloneUrl,
        repositoryFullName: repository.fullName,
        defaultBranch: repository.defaultBranch || 'main',
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate GitHub access token for project ${projectId}: ${error}`,
      );
      throw new RpcException({
        message: 'Failed to generate GitHub access token',
        code: status.INTERNAL,
      });
    }
  }
}
