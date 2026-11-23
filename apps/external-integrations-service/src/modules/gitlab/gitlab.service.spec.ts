// adm-zip exports a CJS constructor function. ts-jest wraps it via __importStar,
// which turns the function into an object { default: fn, ...fn }. When the service
// calls `new AdmZip()`, AdmZip is now a plain object (not callable), which throws.
// Fix: mark the module as __esModule=true so __importStar returns it as-is,
// preserving the callable nature. We still point to the real implementation.
jest.mock('adm-zip', () => {
  const actual = jest.requireActual<any>('adm-zip');
  actual.__esModule = true;
  actual.default = actual;
  return actual;
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import axios, { AxiosError } from 'axios';
import { DataSource, In } from 'typeorm';
import { status as GrpcStatus } from '@grpc/grpc-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';
import { GitlabService } from './gitlab.service';
import { generateWebhookToken, hashWebhookToken } from './gitlab-webhook-token';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import SecretsService from '../../core/secrets/secrets.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import {
  historyUnavailable,
  PreparedHistory,
  RepoHistoryService,
} from '../repo-scan-queue/git-history/repo-history.service';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';
import { PendingRescanStore } from '../pending-rescan/pending-rescan.store';
import { ArchiveDownloadError } from '../../core/utils/retry-download';
import {
  SCAN_FAILURE_SOURCE_FETCH_FAILED,
  SCAN_FAILURE_SOURCE_RATE_LIMITED,
} from '../../core/constants/scan-failure-codes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

class FakeSecrets extends (SecretsService as any) {
  private cache = new Map<string, string>();
  async getSecret(key: string) {
    return this.cache.get(key);
  }
  setSecret(key: string, val: string) {
    this.cache.set(key, val);
  }
}

/** The security-scanning gRPC client as the service sees it in tests. */
type ScanServiceClientMock = {
  createFailedScan: jest.Mock;
  checkExistingScan: jest.Mock;
  createScan: jest.Mock;
  startScan: jest.Mock;
  updateScan: jest.Mock;
  updateScanData: jest.Mock;
};

/** The git history service as the service sees it in tests. */
type RepoHistoryMock = {
  prepare: jest.Mock<Promise<PreparedHistory>, unknown[]>;
  publish: jest.Mock<Promise<void>, unknown[]>;
  cleanup: jest.Mock;
};

/** The lean ProjectService/Get a push webhook asks for. */
const leanProjectRead = (projectId: string) => ({
  projectId,
  skipVulnerabilityStats: true,
  skipIntegrationStatus: true,
  skipSecurityContext: true,
});

/** One multi-row INSERT … ON DUPLICATE KEY UPDATE issued on gitlab_branches. */
type BranchInsert = {
  target: unknown;
  rows: { repositoryId: string; name: string; isProtected: boolean }[];
  overwrite: string[];
  conflict: string[];
  updateEntity: boolean;
};

/**
 * The transaction manager's query builder, recording each branch upsert it
 * executes (the lazy-fill writes its branches in batches).
 */
function recordingInsertQueryBuilder(inserts: BranchInsert[]) {
  return jest.fn(() => {
    const insert: BranchInsert = {
      target: undefined,
      rows: [],
      overwrite: [],
      conflict: [],
      updateEntity: true,
    };
    const qb: any = {
      insert: jest.fn(() => qb),
      into: jest.fn((target: unknown) => {
        insert.target = target;
        return qb;
      }),
      values: jest.fn((rows: BranchInsert['rows']) => {
        insert.rows = rows;
        return qb;
      }),
      orUpdate: jest.fn((overwrite: string[], conflict: string[]) => {
        insert.overwrite = overwrite;
        insert.conflict = conflict;
        return qb;
      }),
      updateEntity: jest.fn((enabled: boolean) => {
        insert.updateEntity = enabled;
        return qb;
      }),
      execute: jest.fn(async () => {
        inserts.push(insert);
        return { identifiers: [], generatedMaps: [], raw: {} };
      }),
    };
    return qb;
  });
}

/** Build a NestJS test module and return a compiled GitlabService instance. */
async function buildService(
  configOverrides: Record<string, string> = {},
): Promise<{
  service: GitlabService;
  gitlabIntegrationRepo: jest.Mocked<any>;
  gitlabRepositoryRepo: jest.Mocked<any>;
  gitlabBranchRepo: jest.Mocked<any>;
  dataSource: { transaction: jest.Mock };
  branchInserts: BranchInsert[];
  loggerMock: ReturnType<typeof createLoggerMock>;
  repoScanQueue: { enqueueRepoScan: jest.Mock; getQueueBacklog: jest.Mock };
  projectGet: jest.Mock;
  scanServiceClient: ScanServiceClientMock;
  fileServiceClient: { uploadFile: jest.Mock };
  repoHistory: RepoHistoryMock;
  entitlements: jest.Mocked<EntitlementsPort>;
  pendingRescans: {
    record: jest.Mock;
    supersede: jest.Mock;
    startedCommit: jest.Mock;
  };
}> {
  const config = new Map<string, string>();
  config.set('FRONTEND_URL', 'https://app.example.com');
  config.set('GATEWAY_URL', 'https://app.example.com');
  for (const [key, value] of Object.entries(configOverrides)) {
    config.set(key, value);
  }

  const secrets = new FakeSecrets();
  secrets.setSecret('GITLAB_APPLICATION_ID', 'app');
  secrets.setSecret('GITLAB_APPLICATION_SECRET', 'secret');
  secrets.setSecret(
    'GITLAB_ENCRYPTION_KEY',
    '0123456789abcdef0123456789abcdef',
  );

  const gitlabIntegrationRepo = createMockRepository();
  const gitlabRepositoryRepo = createMockRepository();
  const gitlabBranchRepo = createMockRepository();
  const loggerMock = createLoggerMock();

  // Project settings served by global-management. scanOnCommitEnabled is left
  // absent by default so the fail-open path is what every unrelated test sees.
  const projectGet = jest.fn(() =>
    of({ sastEnabled: true, iacEnabled: false, scaEnabled: true }),
  );

  // Default fluent createQueryBuilder for branch repo (used for orphan delete).
  (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => ({
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  }));

  // upsert is not in createMockRepository by default — add it for branch repo.
  (gitlabBranchRepo as any).upsert = jest.fn().mockResolvedValue(undefined);

  // DataSource stub — transaction(cb) executes cb with a manager whose
  // getRepository(entity) returns the appropriate mock repo, and whose query
  // builder records the branch upserts.
  const branchInserts: BranchInsert[] = [];
  const dataSource = {
    transaction: jest.fn(async (cb: any) =>
      cb({
        getRepository: (entity: any) => {
          if (entity === GitlabBranch) return gitlabBranchRepo;
          if (entity === GitlabRepository) return gitlabRepositoryRepo;
          return null;
        },
        createQueryBuilder: recordingInsertQueryBuilder(branchInserts),
      }),
    ),
  };

  const repoScanQueue = {
    enqueueRepoScan: jest.fn().mockResolvedValue(undefined),
    getQueueBacklog: jest.fn(),
  };

  // The port double: the AppSec path by default, so the blocks that stay
  // keep today's behaviour (the product blocks live in the closed edition).
  const entitlements = entitlementsMock();

  // The deferred rescans of refused pushes (Redis).
  const pendingRescans = {
    record: jest.fn().mockResolvedValue(true),
    supersede: jest.fn().mockResolvedValue(false),
    startedCommit: jest.fn().mockResolvedValue(null),
  };

  // One stable instance per buildService() call so a test can assert which
  // scan RPC the service actually issued (scan-level UpdateScanData,
  // never the container-level UpdateScan).
  const scanServiceClient: ScanServiceClientMock = {
    createFailedScan: jest.fn(() => of({ success: true })),
    checkExistingScan: jest.fn(() => of({ exists: false })),
    createScan: jest.fn(() => of({ success: true })),
    startScan: jest.fn(() => of({ detectedLanguages: [] })),
    updateScan: jest.fn(() => of({ success: true })),
    updateScanData: jest.fn(() => of({ success: true })),
  };

  const fileServiceClient = {
    uploadFile: jest.fn(() =>
      of({ url: 'https://storage.example.com/signed-url' }),
    ),
  };

  // The git history of a scan: none by default.
  const repoHistory: RepoHistoryMock = {
    prepare: jest.fn(
      async (): Promise<PreparedHistory> => ({
        mode: 'in_archive',
        gitDir: null,
      }),
    ),
    publish: jest.fn(async (): Promise<void> => undefined),
    cleanup: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GitlabService,
      {
        provide: getRepositoryToken(GitlabIntegration),
        useValue: gitlabIntegrationRepo,
      },
      {
        provide: getRepositoryToken(GitlabRepository),
        useValue: gitlabRepositoryRepo,
      },
      {
        provide: getRepositoryToken(GitlabBranch),
        useValue: gitlabBranchRepo,
      },
      { provide: DataSource, useValue: dataSource },
      { provide: SecretsService, useValue: secrets },
      {
        provide: Logger,
        useValue: loggerMock,
      },
      {
        provide: ConfigService,
        useValue: { get: (k: string) => config.get(k) },
      },
      {
        provide: 'REDIS_CLIENT',
        useValue: {
          incr: jest.fn(),
          expire: jest.fn(),
          ttl: jest.fn(),
          set: jest.fn(),
          get: jest.fn(),
          del: jest.fn(),
        },
      },
      {
        provide: 'GLOBAL_MANAGEMENT_SERVICE',
        useValue: {
          getService: jest.fn((serviceName: string) => {
            if (serviceName === 'ApiKeyService') {
              return {
                createSystemApiKeyForProject: jest.fn(() =>
                  of({ apiKey: 'k' }),
                ),
              };
            }
            return { get: projectGet };
          }),
        },
      },
      {
        provide: 'SECURITY_SCANNING_SERVICE',
        useValue: { getService: jest.fn(() => scanServiceClient) },
      },
      {
        provide: 'FILE_MANAGEMENT_SERVICE',
        useValue: { getService: jest.fn(() => fileServiceClient) },
      },
      {
        provide: RepoScanQueueService,
        useValue: repoScanQueue,
      },
      { provide: ENTITLEMENTS_PORT, useValue: entitlements },
      { provide: PendingRescanStore, useValue: pendingRescans },
      { provide: RepoHistoryService, useValue: repoHistory },
    ],
  }).compile();

  const service = module.get(GitlabService);
  await (service as any).onModuleInit?.();

  return {
    service,
    pendingRescans,
    repoScanQueue,
    gitlabIntegrationRepo,
    gitlabRepositoryRepo,
    gitlabBranchRepo,
    dataSource,
    branchInserts,
    loggerMock,
    projectGet,
    scanServiceClient,
    fileServiceClient,
    repoHistory,
    entitlements,
  };
}

// ---------------------------------------------------------------------------
// Filesystem fixtures
// ---------------------------------------------------------------------------

/** Create a fake GitLab-style zipball (entries under a top-level dir). */
function createFakeGitlabZip(tmpDir: string): string {
  const zipPath = path.join(tmpDir, 'input.zip');
  const zip = new AdmZip();
  zip.addFile('top-abc123/src/main.py', Buffer.from('print("hello")'));
  zip.addFile('top-abc123/README.md', Buffer.from('# readme'));
  zip.writeZip(zipPath);
  return zipPath;
}

/** Create a fake bare .git mirror directory with a few files. */
function createFakeGitDir(tmpDir: string): string {
  const gitDir = path.join(tmpDir, 'git-mirror');
  fs.mkdirSync(path.join(gitDir, 'objects', 'pack'), { recursive: true });
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(gitDir, 'config'), '[core]\n\tbare = false\n');
  fs.writeFileSync(
    path.join(gitDir, 'objects', 'pack', 'pack-abc.pack'),
    Buffer.from([0x50, 0x41, 0x43, 0x4b]), // PACK magic bytes
  );
  return gitDir;
}

// ---------------------------------------------------------------------------
// Existing tests (preserved)
// ---------------------------------------------------------------------------

describe('GitlabService', () => {
  let service: GitlabService;
  let gitlabIntegrationRepo: jest.Mocked<any>;
  let loggerMock: ReturnType<typeof createLoggerMock>;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    gitlabIntegrationRepo = built.gitlabIntegrationRepo;
    loggerMock = built.loggerMock;

    // Reset axios mocks
    jest.clearAllMocks();
  });

  it('handleWebhook answers an invalid token UNAUTHENTICATED without an error log', async () => {
    jest
      .spyOn<any, any>(service as any, 'verifyWebhookSignature')
      .mockResolvedValue([]);
    await expect(
      service.handleWebhook({
        event: 'Push Hook',
        payload: '{}',
        signature: 'sig',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAUTHENTICATED }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('unlinkProjectFromRepository preserves NOT_FOUND without an error log', async () => {
    (service as any).gitlabRepositoryRepository.findOne.mockResolvedValue(null);

    await expect(
      service.unlinkProjectFromRepository({
        repositoryId: 'repository-1',
        projectId: 'project-1',
        organizationId: 'org-1',
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.NOT_FOUND }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('handleWebhook maps an unexpected failure to INTERNAL and logs it', async () => {
    jest
      .spyOn<any, any>(service as any, 'verifyWebhookSignature')
      .mockResolvedValue(true);
    jest
      .spyOn<any, any>(service as any, 'handlePushEvent')
      .mockRejectedValue(new Error('database down'));

    await expect(
      service.handleWebhook({
        bodyJson: '{"object_kind":"push","project":{"id":1}}',
        gitlabToken: 'token',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({
        code: GrpcStatus.INTERNAL,
        message: 'Failed to handle GitLab webhook',
      }),
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to handle GitLab webhook'),
      expect.any(String),
      GitlabService.name,
    );
  });

  it('startScanForLastCommit preserves an expected authentication error without an error log', async () => {
    const integration = {
      id: 'integration-1',
      organizationId: 'org-1',
      accessToken: 'encrypted-access-token',
    } as GitlabIntegration;
    gitlabIntegrationRepo.findOne.mockResolvedValue(integration);
    const repository = {
      id: 'repository-1',
      name: 'monorepo',
      projectId: 'project-1',
      gitlabId: 42,
      defaultBranch: 'main',
      integration,
    } as GitlabRepository;
    (service as any).gitlabRepositoryRepository.findOne.mockResolvedValue(
      repository,
    );
    jest
      .spyOn(service as any, 'decryptToken')
      .mockResolvedValue('access-token');
    const authenticationError = new RpcException({
      code: GrpcStatus.UNAUTHENTICATED,
      message:
        'Failed to refresh GitLab access token. Please reinstall the integration.',
    });
    jest
      .spyOn(service as any, 'getLatestCommit')
      .mockRejectedValue(authenticationError);

    await expect(
      service.startScanForLastCommit({
        repositoryId: repository.id,
        projectId: repository.projectId,
        branch: 'main',
      }),
    ).rejects.toBe(authenticationError);

    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('maps a rejected GitLab refresh token to UNAUTHENTICATED and a warning', async () => {
    const integration = {
      id: 'integration-1',
      organizationId: 'org-1',
      refreshToken: 'encrypted-refresh-token',
    } as GitlabIntegration;
    gitlabIntegrationRepo.findOne.mockResolvedValue(integration);
    jest
      .spyOn(service as any, 'decryptToken')
      .mockResolvedValue('refresh-token');
    (service as any).redisClient.set.mockResolvedValue('OK');
    (service as any).redisClient.del.mockResolvedValue(1);

    const axiosError = new Error(
      'Request failed with status code 400',
    ) as AxiosError;
    (axiosError as any).response = { status: 400 };
    mockedAxios.post.mockRejectedValueOnce(axiosError);
    mockedAxios.isAxiosError.mockImplementation(
      (error) => error === axiosError,
    );

    await expect(
      (service as any).refreshAccessToken(integration),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAUTHENTICATED }),
    });

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('rejected the token refresh'),
    );
  });

  it('maps a GitLab refresh outage to UNAVAILABLE and an error log', async () => {
    const integration = {
      id: 'integration-1',
      organizationId: 'org-1',
      refreshToken: 'encrypted-refresh-token',
    } as GitlabIntegration;
    gitlabIntegrationRepo.findOne.mockResolvedValue(integration);
    jest
      .spyOn(service as any, 'decryptToken')
      .mockResolvedValue('refresh-token');
    (service as any).redisClient.set.mockResolvedValue('OK');
    (service as any).redisClient.del.mockResolvedValue(1);

    const axiosError = new Error(
      'Request failed with status code 503',
    ) as AxiosError;
    (axiosError as any).response = { status: 503 };
    mockedAxios.post.mockRejectedValueOnce(axiosError);
    mockedAxios.isAxiosError.mockImplementation(
      (error) => error === axiosError,
    );

    await expect(
      (service as any).refreshAccessToken(integration),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAVAILABLE }),
    });

    expect(loggerMock.error).toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('maps a GitLab refresh rate limit to RESOURCE_EXHAUSTED and a warning', async () => {
    const integration = {
      id: 'integration-1',
      organizationId: 'org-1',
      refreshToken: 'encrypted-refresh-token',
    } as GitlabIntegration;
    gitlabIntegrationRepo.findOne.mockResolvedValue(integration);
    jest
      .spyOn(service as any, 'decryptToken')
      .mockResolvedValue('refresh-token');
    (service as any).redisClient.set.mockResolvedValue('OK');
    (service as any).redisClient.del.mockResolvedValue(1);

    const axiosError = new Error(
      'Request failed with status code 429',
    ) as AxiosError;
    (axiosError as any).response = { status: 429 };
    mockedAxios.post.mockRejectedValueOnce(axiosError);
    mockedAxios.isAxiosError.mockImplementation(
      (error) => error === axiosError,
    );

    await expect(
      (service as any).refreshAccessToken(integration),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.RESOURCE_EXHAUSTED }),
    });

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('rejected the token refresh'),
    );
  });

  // ---------------------------------------------------------------
  // Webhook token verification: a per-hook random token, checked against
  // the hash stored for the project the payload names. The OAuth
  // application secret is never a valid token, except for a project not yet
  // migrated while GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED is on.
  // ---------------------------------------------------------------
  describe('webhook token verification', () => {
    const token = generateWebhookToken();
    const tokenHash = hashWebhookToken(token);
    const push = (projectId = 42) =>
      JSON.stringify({ object_kind: 'push', project: { id: projectId } });

    let repositoryRepo: jest.Mocked<any>;
    let pushHandler: jest.SpyInstance;

    const build = async (config: Record<string, string> = {}) => {
      const built = await buildService(config);
      service = built.service;
      loggerMock = built.loggerMock;
      repositoryRepo = built.gitlabRepositoryRepo;
      pushHandler = jest
        .spyOn(service as any, 'handlePushEvent')
        .mockResolvedValue(undefined);
    };

    const deliver = (bodyJson: string, gitlabToken: string | undefined) =>
      service.handleWebhook({ bodyJson, gitlabToken } as any);

    // A wrong or missing token is a 401, as on the GitHub webhook.
    const refused = expect.objectContaining({
      error: expect.objectContaining({ code: GrpcStatus.UNAUTHENTICATED }),
    });

    beforeEach(async () => {
      await build();
    });

    it('accepts the token whose hash is stored for the project the payload names', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: tokenHash },
      ]);

      await expect(deliver(push(42), token)).resolves.toEqual({
        success: true,
      });

      expect(repositoryRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { gitlabId: 42 } }),
      );
      expect(pushHandler).toHaveBeenCalled();
    });

    it('accepts the token when another row of the same project holds the hash', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: null },
        { id: 'r2', webhookTokenHash: tokenHash },
      ]);

      await expect(deliver(push(), token)).resolves.toEqual({ success: true });
    });

    it('refuses a token that is not the one of that project', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: hashWebhookToken('another-token') },
      ]);

      await expect(deliver(push(), token)).rejects.toEqual(refused);
      expect(pushHandler).not.toHaveBeenCalled();
    });

    it('refuses the OAuth application secret on a migrated project, even with the legacy setting on', async () => {
      await build({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: 'true' });
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: tokenHash },
      ]);

      await expect(deliver(push(), 'secret')).rejects.toEqual(refused);
      expect(pushHandler).not.toHaveBeenCalled();
    });

    it('refuses the OAuth application secret on a project not migrated when the legacy setting is off (default)', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: null },
      ]);

      await expect(deliver(push(), 'secret')).rejects.toEqual(refused);
      expect(pushHandler).not.toHaveBeenCalled();
    });

    it('accepts the OAuth application secret only for a project not migrated, with the legacy setting on, and logs it without the token', async () => {
      await build({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: 'true' });
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: null },
      ]);

      await expect(deliver(push(42), 'secret')).resolves.toEqual({
        success: true,
      });

      const warned = (loggerMock.warn as jest.Mock).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const line = warned.find((l: string) =>
        l.includes('GITLAB_WEBHOOK_LEGACY_TOKEN'),
      );
      expect(line).toContain('gitlabProject=42');
      expect(warned.join(' ')).not.toContain('secret');
    });

    it('refuses a wrong token on a project not migrated, with the legacy setting on', async () => {
      await build({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: 'true' });
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: null },
      ]);

      await expect(deliver(push(), 'wrong')).rejects.toEqual(refused);
    });

    it('refuses the legacy path when the application secret is unset', async () => {
      await build({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: 'true' });
      (service as any).secretsService = { getSecret: jest.fn(async () => '') };
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: null },
      ]);

      await expect(deliver(push(), '')).rejects.toEqual(refused);
    });

    it('refuses an event about a project we do not track', async () => {
      await build({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: 'true' });
      repositoryRepo.find.mockResolvedValue([]);

      await expect(deliver(push(), 'secret')).rejects.toEqual(refused);
      await expect(deliver(push(), token)).rejects.toEqual(refused);
    });

    it('refuses a payload whose project ids disagree, before any lookup', async () => {
      const body = JSON.stringify({
        object_kind: 'project_destroy',
        project_id: 7,
        project: { id: 42 },
      });

      await expect(deliver(body, token)).rejects.toEqual(refused);
      expect(repositoryRepo.find).not.toHaveBeenCalled();
    });

    describe('two organisations tracking the same GitLab project', () => {
      // Each organisation's row has its own hook, hence its own token. The
      // delivery acts on the row whose token matched, never on the other
      // organisation's.
      const rows = () => [
        {
          id: 'r-other',
          gitlabId: 42,
          webhookTokenHash: hashWebhookToken('another-token'),
        },
        { id: 'r-mine', gitlabId: 42, webhookTokenHash: tokenHash },
      ];

      beforeEach(() => {
        repositoryRepo.find.mockImplementation(async (options: any) =>
          options?.select ? rows() : rows().filter((r) => r.id === 'r-mine'),
        );
      });

      it('project_destroy deletes the matched row only', async () => {
        repositoryRepo.delete.mockResolvedValue({ affected: 1 });
        const body = JSON.stringify({
          object_kind: 'project_destroy',
          project_id: 42,
        });

        await expect(deliver(body, token)).resolves.toEqual({
          success: true,
        });

        expect(repositoryRepo.delete).toHaveBeenCalledTimes(1);
        expect(repositoryRepo.delete).toHaveBeenCalledWith({
          id: In(['r-mine']),
        });
      });

      it('project_rename updates the matched row only', async () => {
        repositoryRepo.save.mockImplementation(async (row: unknown) => row);
        const body = JSON.stringify({
          object_kind: 'project_rename',
          project_id: 42,
          name: 'renamed',
          path: 'renamed',
          path_with_namespace: 'group/renamed',
        });

        await expect(deliver(body, token)).resolves.toEqual({
          success: true,
        });

        const saved = repositoryRepo.save.mock.calls.map(
          (c: unknown[]) => (c[0] as { id: string }).id,
        );
        expect(saved).toEqual(['r-mine']);
        expect(repositoryRepo.findOne).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: { gitlabId: 42 } }),
        );
      });

      it('push is handled for the matched row only', async () => {
        await expect(deliver(push(42), token)).resolves.toEqual({
          success: true,
        });

        expect(pushHandler).toHaveBeenCalledWith(expect.anything(), ['r-mine']);
      });
    });

    it('refuses a missing token and an unparseable body', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', webhookTokenHash: tokenHash },
      ]);

      await expect(deliver(push(), undefined)).rejects.toEqual(refused);
      await expect(deliver('{not-json', token)).rejects.toEqual(refused);
    });
  });

  describe('callGitlabApi', () => {
    const mockIntegration = {
      id: 'integration-id',
      organizationId: 'org-123',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    } as GitlabIntegration;

    it('should make API call with valid token', async () => {
      jest
        .spyOn<any, any>(service as any, 'decryptToken')
        .mockResolvedValue('valid-token');

      mockedAxios.get.mockResolvedValueOnce({ data: { success: true } });

      const result = await (service as any).callGitlabApi(
        mockIntegration,
        (token: string) =>
          axios.get('https://gitlab.com/api/v4/test', {
            headers: { Authorization: `Bearer ${token}` },
          }),
      );

      expect(result.data.success).toBe(true);
    });

    it('should refresh token when expired proactively', async () => {
      const expiredIntegration = {
        ...mockIntegration,
        tokenExpiresAt: new Date(Date.now() - 1000),
      };

      const refreshSpy = jest
        .spyOn<any, any>(service as any, 'refreshAccessToken')
        .mockResolvedValue('new-token');

      mockedAxios.get.mockResolvedValueOnce({ data: { success: true } });

      await (service as any).callGitlabApi(
        expiredIntegration,
        (token: string) =>
          axios.get('https://gitlab.com/api/v4/test', {
            headers: { Authorization: `Bearer ${token}` },
          }),
      );

      expect(refreshSpy).toHaveBeenCalledWith(expiredIntegration);
    });

    it('should reload integration from DB on 401 to avoid race conditions', async () => {
      jest
        .spyOn<any, any>(service as any, 'decryptToken')
        .mockResolvedValue('old-token');

      const freshIntegration = {
        ...mockIntegration,
        accessToken: 'fresh-encrypted-token',
        refreshToken: 'fresh-encrypted-refresh',
      };
      gitlabIntegrationRepo.findOne.mockResolvedValue(freshIntegration);

      // Create a proper AxiosError for 401
      const axiosError = new Error(
        'Request failed with status code 401',
      ) as AxiosError;
      (axiosError as any).response = { status: 401 };
      (axiosError as any).isAxiosError = true;

      mockedAxios.get
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce({ data: { success: true } });
      mockedAxios.isAxiosError.mockReturnValue(true);

      const refreshSpy = jest
        .spyOn<any, any>(service as any, 'refreshAccessToken')
        .mockResolvedValue('newest-token');

      await (service as any).callGitlabApi(mockIntegration, (token: string) =>
        axios.get('https://gitlab.com/api/v4/test', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      // Should have reloaded integration from DB
      expect(gitlabIntegrationRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockIntegration.id },
      });
      // Should have called refresh with the fresh integration
      expect(refreshSpy).toHaveBeenCalledWith(freshIntegration);
    });

    it('should throw RpcException on network error', async () => {
      jest
        .spyOn<any, any>(service as any, 'decryptToken')
        .mockResolvedValue('valid-token');

      const networkError = new Error('Network failed');
      networkError.name = 'AggregateError';
      mockedAxios.get.mockRejectedValueOnce(networkError);

      await expect(
        (service as any).callGitlabApi(mockIntegration, (token: string) =>
          axios.get('https://gitlab.com/api/v4/test', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });
});

// ---------------------------------------------------------------------------
// getBranches (DB-backed lazy-fill)
//
// New behaviour: read branches from MySQL by default; only call the GitLab
// API when branchesSyncedAt is NULL (first sync). Existing guards
// (PERMISSION_DENIED, NOT_FOUND, INTERNAL) preserved. The `code:` key (not
// `status:`) is preserved verbatim from the legacy implementation.
// ---------------------------------------------------------------------------

describe('GitlabService.getBranches (DB-backed)', () => {
  let service: GitlabService;
  let gitlabRepositoryRepo: jest.Mocked<any>;
  let gitlabBranchRepo: jest.Mocked<any>;
  let dataSource: { transaction: jest.Mock };
  let branchInserts: BranchInsert[];

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    gitlabRepositoryRepo = built.gitlabRepositoryRepo;
    gitlabBranchRepo = built.gitlabBranchRepo;
    dataSource = built.dataSource;
    branchInserts = built.branchInserts;
  });

  /** Build a base repository entity with sane defaults. */
  const makeRepoEntity = (overrides: any = {}) => ({
    id: 'repo-1',
    gitlabId: 12345,
    name: 'cool-repo',
    nameWithNamespace: 'group / cool-repo',
    path: 'cool-repo',
    pathWithNamespace: 'group/cool-repo',
    private: false,
    defaultBranch: 'main',
    scanBranch: null,
    integrationId: 'int-1',
    branchesSyncedAt: null,
    integration: {
      id: 'int-1',
      organizationId: 'org-1',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    } as GitlabIntegration,
    ...overrides,
  });

  it('1. DB hit — does NOT call axios, returns rows from DB with correct isDefault', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
      defaultBranch: 'main',
      scanBranch: 'develop',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    (gitlabBranchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'develop', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b2', name: 'feature', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b3', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    const res = await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.find).toHaveBeenCalledWith({
      where: { repositoryId: 'repo-1' },
      order: { name: 'ASC' },
    });
    expect(res.branches).toEqual([
      { name: 'develop', isDefault: false, isProtected: false },
      { name: 'feature', isDefault: false, isProtected: false },
      { name: 'main', isDefault: true, isProtected: true },
    ]);
    expect(res.repositoryId).toBe('repo-1');
    expect(res.defaultBranch).toBe('main');
    expect(res.scanBranch).toBe('develop');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('2. Lazy-fill happy path — upserts branches, deletes orphans, sets branchesSyncedAt', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
      scanBranch: 'develop',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);

    // The lazy-fill goes through callGitlabApi → axios.get.
    // The integration has a non-expired token, so decryptToken is invoked.
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { name: 'main', default: true, protected: true },
        { name: 'develop', default: false, protected: false },
        { name: 'feature/x', default: false, protected: false },
      ],
    });

    // Final find() returns the upserted rows (after lazy-fill).
    (gitlabBranchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'develop', isProtected: false, repositoryId: 'repo-1' },
      {
        id: 'b2',
        name: 'feature/x',
        isProtected: false,
        repositoryId: 'repo-1',
      },
      { id: 'b3', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    const orphanDeleteExec = jest.fn().mockResolvedValue({ affected: 0 });
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: orphanDeleteExec,
    }));

    const res = await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // GitLab API was called once (axios.get from inside callGitlabApi).
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/projects/12345/repository/branches'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer valid-access-token' },
        params: { per_page: 100, page: 1 },
      }),
    );

    // Every branch upserted, in one multi-row statement.
    expect(branchInserts).toHaveLength(1);
    expect(branchInserts[0].rows).toEqual([
      { repositoryId: 'repo-1', name: 'main', isProtected: true },
      { repositoryId: 'repo-1', name: 'develop', isProtected: false },
      { repositoryId: 'repo-1', name: 'feature/x', isProtected: false },
    ]);

    // Orphan delete query was executed.
    expect(orphanDeleteExec).toHaveBeenCalled();

    // branchesSyncedAt set on the entity + saved inside the tx.
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
    expect(gitlabRepositoryRepo.save).toHaveBeenCalledWith(repo);

    // Final response shape.
    expect(res.branches).toEqual([
      { name: 'develop', isDefault: false, isProtected: false },
      { name: 'feature/x', isDefault: false, isProtected: false },
      { name: 'main', isDefault: true, isProtected: true },
    ]);
    expect(res.repositoryId).toBe('repo-1');
    expect(res.defaultBranch).toBe('main');
    expect(res.scanBranch).toBe('develop');
  });

  it('3. Lazy-fill API failure — no transaction, branchesSyncedAt stays null, RpcException INTERNAL', async () => {
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);

    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    mockedAxios.get.mockRejectedValueOnce(new Error('GitLab 500'));

    try {
      await service.getBranches({
        repositoryId: 'repo-1',
        organizationId: 'org-1',
      } as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errObj = err.getError() as any;
      expect(errObj.code).toBe(GrpcStatus.INTERNAL);
    }

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(repo.branchesSyncedAt).toBeNull();
  });

  it('4. DB-only resilience — booby-trapped axios is never called when branchesSyncedAt is set', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    (gitlabBranchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    // If anyone calls axios, blow up loudly.
    mockedAxios.get.mockImplementation(() => {
      throw new Error('axios must not be called when DB is populated');
    });

    const res = await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(res.branches).toEqual([
      { name: 'main', isDefault: true, isProtected: true },
    ]);
  });

  it('5. Permission denied preserved — org mismatch throws RpcException with code: PERMISSION_DENIED', async () => {
    const repo = makeRepoEntity({
      integration: {
        id: 'int-1',
        organizationId: 'other-org',
        accessToken: 'encrypted-token',
        refreshToken: 'encrypted-refresh',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      } as GitlabIntegration,
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);

    try {
      await service.getBranches({
        repositoryId: 'repo-1',
        organizationId: 'org-1',
      } as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errObj = err.getError() as any;
      // Preserve verbatim: legacy uses `code:` (not `status:`).
      expect(errObj.code).toBe(GrpcStatus.PERMISSION_DENIED);
      expect(errObj.status).toBeUndefined();
      expect(errObj.message).toBe('Unauthorized access to repository');
    }

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('6. Not found preserved — missing repository throws RpcException with code: NOT_FOUND', async () => {
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(null);

    try {
      await service.getBranches({
        repositoryId: 'missing-id',
        organizationId: 'org-1',
      } as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errObj = err.getError() as any;
      // Preserve verbatim: legacy uses `code:` (not `status:`).
      expect(errObj.code).toBe(GrpcStatus.NOT_FOUND);
      expect(errObj.status).toBeUndefined();
      expect(errObj.message).toBe('GitLab repository not found');
    }

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('7. Default branch drift — GitLab reports a different default, entity updated in tx', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'master',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);

    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { name: 'main', default: true, protected: true },
        { name: 'develop', default: false, protected: false },
      ],
    });

    // Final find returns the upserted rows.
    (gitlabBranchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'develop', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b2', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    const res = await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    // The entity's defaultBranch must have been mutated to 'main' before save.
    expect(repo.defaultBranch).toBe('main');
    expect(gitlabRepositoryRepo.save).toHaveBeenCalledWith(repo);
    // isDefault now matches 'main', not the stale 'master'.
    expect(res.branches.find((b) => b.name === 'main')?.isDefault).toBe(true);
    expect(res.branches.find((b) => b.name === 'develop')?.isDefault).toBe(
      false,
    );
    expect(res.defaultBranch).toBe('main');
  });

  it('8. Orphan reconciliation — NOT IN clause uses fresh branch names, removes stale rows', async () => {
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);

    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { name: 'main', default: true, protected: true },
        { name: 'feature', default: false, protected: false },
      ],
    });

    const orphanWhere = jest.fn().mockReturnThis();
    const orphanExec = jest.fn().mockResolvedValue({ affected: 1 });
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: orphanWhere,
      andWhere: jest.fn().mockReturnThis(),
      execute: orphanExec,
    }));

    (gitlabBranchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'feature', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b2', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    // The where(...) call must have been made with a NOT IN clause carrying
    // the two fresh names.
    expect(orphanWhere).toHaveBeenCalled();
    const [whereSql, whereParams] = (orphanWhere.mock.calls[0] || []) as any[];
    expect(whereSql).toContain('NOT IN');
    expect(whereParams).toBeDefined();
    expect(whereParams.id).toBe('repo-1');
    expect(whereParams.names).toEqual(['main', 'feature']);
    expect(orphanExec).toHaveBeenCalled();
  });

  it('9. Empty branch list from API — full delete (no NOT IN), branchesSyncedAt still set, empty response', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
      scanBranch: 'main',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);

    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    mockedAxios.get.mockResolvedValueOnce({ data: [] });

    const fullDeleteWhere = jest.fn().mockReturnThis();
    const fullDeleteExec = jest.fn().mockResolvedValue({ affected: 0 });
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: fullDeleteWhere,
      andWhere: jest.fn().mockReturnThis(),
      execute: fullDeleteExec,
    }));

    (gitlabBranchRepo.find as any).mockResolvedValue([]);

    const res = await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    // No INSERT either: TypeORM refuses an insert without values.
    expect(branchInserts).toEqual([]);
    expect(fullDeleteWhere).toHaveBeenCalled();
    // No NOT IN constraint — just plain where on repositoryId.
    const [whereSql, whereParams] = (fullDeleteWhere.mock.calls[0] ||
      []) as any[];
    expect(whereSql).not.toContain('NOT IN');
    expect(whereParams).toEqual({ id: 'repo-1' });
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
    expect(gitlabRepositoryRepo.save).toHaveBeenCalledWith(repo);
    expect(res.branches).toEqual([]);
    expect(res.repositoryId).toBe('repo-1');
    expect(res.defaultBranch).toBe('main');
    expect(res.scanBranch).toBe('main');
  });

  it('10. Lazy-fill pagination — follows X-Next-Page across all pages for >100 branches', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    // 250 branches spread across three GitLab pages (100 + 100 + 50). GitLab
    // signals "more pages" via the X-Next-Page response header (empty on last).
    const mkPage = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `b${start + i}`,
        default: false,
        protected: false,
      }));
    mockedAxios.get
      .mockResolvedValueOnce({
        data: mkPage(0, 100),
        headers: { 'x-next-page': '2' },
      })
      .mockResolvedValueOnce({
        data: mkPage(100, 100),
        headers: { 'x-next-page': '3' },
      })
      .mockResolvedValueOnce({
        data: mkPage(200, 50),
        headers: { 'x-next-page': '' },
      });

    let capturedNames: string[] | undefined;
    const qb: any = {
      delete: jest.fn(() => qb),
      from: jest.fn(() => qb),
      where: jest.fn((_sql: string, params: any) => {
        if (params?.names) capturedNames = params.names;
        return qb;
      }),
      andWhere: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => qb);
    (gitlabBranchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    // Three pages fetched, each with an explicit page param.
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/projects/12345/repository/branches'),
      expect.objectContaining({
        params: expect.objectContaining({ per_page: 100, page: 1 }),
      }),
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/projects/12345/repository/branches'),
      expect.objectContaining({
        params: expect.objectContaining({ per_page: 100, page: 3 }),
      }),
    );
    // Every one of the 250 branches is upserted — including page-3 branches.
    const written = branchInserts.flatMap((insert) => insert.rows);
    expect(written).toHaveLength(250);
    expect(written).toContainEqual({
      repositoryId: 'repo-1',
      name: 'b249',
      isProtected: false,
    });
    // The orphan reconciliation sees the FULL 250-name set.
    expect(capturedNames).toHaveLength(250);
    expect(capturedNames).toContain('b249');
  });

  it('11. Lazy-fill pagination — a full final page with empty X-Next-Page does NOT trigger an extra fetch', async () => {
    // GitLab uses offset pagination: a 100-branch repo returns an empty
    // X-Next-Page, so — unlike a naive length-based loop — we must NOT request
    // a (non-existent) page 2.
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      name: `b${i}`,
      default: false,
      protected: false,
    }));
    mockedAxios.get.mockResolvedValueOnce({
      data: fullPage,
      headers: { 'x-next-page': '' },
    });

    const qb: any = {
      delete: jest.fn(() => qb),
      from: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => qb);
    (gitlabBranchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/projects/12345/repository/branches'),
      expect.objectContaining({
        params: expect.objectContaining({ per_page: 100, page: 1 }),
      }),
    );
    expect(branchInserts.flatMap((insert) => insert.rows)).toHaveLength(100);
  });

  it('12. Lazy-fill pagination — MAX_PAGES cap holds even when X-Next-Page repeats, and the truncated sync is not cached or reconciled', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    // A misbehaving endpoint that ALWAYS reports the same next page ('2'). The
    // cap must bound iterations via a LOCAL counter, not the server-controlled
    // page value — otherwise the loop never terminates. The mock falls back to
    // an empty header well past the cap (call 106) so that a regressed,
    // server-driven cap would still TERMINATE this test (at 106) rather than
    // hang it — letting the assertion below catch the regression cleanly.
    let calls = 0;
    mockedAxios.get.mockImplementation(async () => {
      calls++;
      return {
        data: Array.from({ length: 100 }, (_, i) => ({
          name: `b${i}`,
          default: false,
          protected: false,
        })),
        headers: { 'x-next-page': calls >= 106 ? '' : '2' },
      };
    });

    // Stays functional so the pre-fix path fails on the ASSERTION below (delete
    // ran) rather than crashing on an undefined query builder.
    const cqb = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }));
    (gitlabBranchRepo.createQueryBuilder as any) = cqb;
    (gitlabBranchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    // Bounded to exactly MAX_PAGES by the local counter — NOT 106.
    expect(mockedAxios.get).toHaveBeenCalledTimes(100);
    // Truncated sync: no destructive reconciliation, not cached.
    expect(cqb).not.toHaveBeenCalled();
    expect(repo.branchesSyncedAt).toBeNull();
  });

  // One upsert per branch was 2 statements per branch (the
  // INSERT, then TypeORM's SELECT reloading the generated columns). The
  // branches now go in batches of 500 rows, without the reload.
  it('13. Lazy-fill writes 1 200 branches in 3 multi-row upserts, without reloading them', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    const branches = Array.from({ length: 1200 }, (_, i) => ({
      name: `b${i}`,
      default: i === 0,
      protected: i % 2 === 0,
    }));
    mockedAxios.get.mockImplementation(
      async (_url: string, config?: { params?: { page?: number } }) => {
        const page = config?.params?.page ?? 1;
        return {
          data: branches.slice((page - 1) * 100, page * 100),
          headers: { 'x-next-page': page < 12 ? String(page + 1) : '' },
        };
      },
    );
    (gitlabBranchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      repositoryId: 'repo-1',
      organizationId: 'org-1',
    } as any);

    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(branchInserts.map((i) => i.rows.length)).toEqual([500, 500, 200]);
    for (const insert of branchInserts) {
      expect(insert.target).toBe(GitlabBranch);
      expect(insert.overwrite).toEqual(['repositoryId', 'name', 'isProtected']);
      expect(insert.conflict).toEqual(['repositoryId', 'name']);
      expect(insert.updateEntity).toBe(false);
    }
    const written = branchInserts.flatMap((i) => i.rows);
    expect(written).toHaveLength(1200);
    expect(written[0]).toEqual({
      repositoryId: 'repo-1',
      name: 'b0',
      isProtected: true,
    });
    expect(written[1199]).toEqual({
      repositoryId: 'repo-1',
      name: 'b1199',
      isProtected: false,
    });
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// fetchUserProjects (repository import) — pagination
//
// The GitLab /projects listing is also paginated: a user with >100 projects
// must have every page imported, not just the first 100. syncRepositories only
// UPSERTS each project (no orphan delete), so unlike the branch sync there is no
// destructive-reconciliation risk — but the same infinite-loop guard applies:
// the cap must count iterations locally, never trust the server's X-Next-Page.
// ---------------------------------------------------------------------------

describe('GitlabService.fetchUserProjects (pagination)', () => {
  let service: GitlabService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
  });

  const makeIntegration = () =>
    ({
      id: 'int-1',
      organizationId: 'org-1',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    }) as GitlabIntegration;

  it('1. follows X-Next-Page across all pages for a user with >100 projects', async () => {
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    const mkPage = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: start + i,
        name: `p${start + i}`,
      }));
    mockedAxios.get
      .mockResolvedValueOnce({
        data: mkPage(0, 100),
        headers: { 'x-next-page': '2' },
      })
      .mockResolvedValueOnce({
        data: mkPage(100, 100),
        headers: { 'x-next-page': '3' },
      })
      .mockResolvedValueOnce({
        data: mkPage(200, 50),
        headers: { 'x-next-page': '' },
      });

    const projects = await (service as any).fetchUserProjects(
      makeIntegration(),
    );

    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('membership=true&per_page=100&page=1'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer valid-access-token' },
      }),
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('page=3'),
      expect.anything(),
    );
    // Every page imported — not just the first 100.
    expect(projects).toHaveLength(250);
    expect(projects[249]).toEqual({ id: 249, name: 'p249' });
  });

  it('2. caps iterations via a local counter when X-Next-Page repeats (no infinite loop)', async () => {
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');

    // Endpoint always reports the same next page ('2'); falls back to an empty
    // header at call 106 so a regressed (server-driven) cap still TERMINATES the
    // test at 106 rather than hanging it.
    let calls = 0;
    mockedAxios.get.mockImplementation(async () => {
      calls++;
      return {
        data: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `p${i}` })),
        headers: { 'x-next-page': calls >= 106 ? '' : '2' },
      };
    });

    const projects = await (service as any).fetchUserProjects(
      makeIntegration(),
    );

    // Bounded to MAX_PAGES (100) by the local counter — NOT 106.
    expect(mockedAxios.get).toHaveBeenCalledTimes(100);
    expect(projects).toHaveLength(100 * 100);
  });
});

// ---------------------------------------------------------------------------
// addGitDirToArchive
// ---------------------------------------------------------------------------

describe('GitlabService.addGitDirToArchive', () => {
  let service: GitlabService;
  let tmpDir: string;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-svc-git-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds all regular files under .git/ prefix', () => {
    const gitDir = createFakeGitDir(tmpDir);
    const zip = new AdmZip();

    service['addGitDirToArchive'](zip, gitDir);

    const names = zip
      .getEntries()
      .map((e: any) => e.entryName)
      .sort();
    expect(names).toContain('.git/HEAD');
    expect(names).toContain('.git/config');
    expect(names).toContain('.git/objects/pack/pack-abc.pack');
  });

  it('preserves file content', () => {
    const gitDir = createFakeGitDir(tmpDir);
    const zip = new AdmZip();

    service['addGitDirToArchive'](zip, gitDir);

    const headEntry = zip
      .getEntries()
      .find((e: any) => e.entryName === '.git/HEAD');
    expect(headEntry).toBeDefined();
    expect(headEntry.getData().toString()).toBe('ref: refs/heads/main\n');
  });

  it('skips symlinks', () => {
    const gitDir = createFakeGitDir(tmpDir);
    const symlinkPath = path.join(gitDir, 'symlink-file');
    try {
      fs.symlinkSync(path.join(gitDir, 'HEAD'), symlinkPath);
    } catch {
      // Windows without elevated privileges — skip
      return;
    }

    const zip = new AdmZip();
    service['addGitDirToArchive'](zip, gitDir);

    const names = zip.getEntries().map((e: any) => e.entryName);
    expect(names).not.toContain('.git/symlink-file');
    // regular files still present
    expect(names).toContain('.git/HEAD');
  });

  it('does not produce paths escaping the gitDir', () => {
    const gitDir = createFakeGitDir(tmpDir);
    const zip = new AdmZip();
    const addFileSpy = jest.spyOn(zip, 'addFile');

    service['addGitDirToArchive'](zip, gitDir);

    for (const call of addFileSpy.mock.calls) {
      const zipPath: string = call[0] as string;
      expect(zipPath.startsWith('.git/../')).toBe(false);
      expect(zipPath.includes('../')).toBe(false);
      expect(path.isAbsolute(zipPath)).toBe(false);
    }
  });

  it('uses POSIX path separators in zip entry names', () => {
    const gitDir = createFakeGitDir(tmpDir);
    const zip = new AdmZip();

    service['addGitDirToArchive'](zip, gitDir);

    const names = zip.getEntries().map((e: any) => e.entryName);
    for (const name of names) {
      expect(name).not.toContain('\\');
    }
  });
});

// ---------------------------------------------------------------------------
// processZipFile — verifies source files are stripped and .git is injected
// ---------------------------------------------------------------------------

describe('GitlabService.processZipFile', () => {
  let service: GitlabService;
  let tmpDir: string;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-svc-zip-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips top-level directory from gitlab zipball entries', async () => {
    const inputZip = createFakeGitlabZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip);

    const result = new AdmZip(outputZip);
    const names = result
      .getEntries()
      .map((e: any) => e.entryName)
      .sort();
    expect(names).toContain('src/main.py');
    expect(names).toContain('README.md');
    // top-level dir prefix must be gone
    expect(names.every((n: string) => !n.startsWith('top-'))).toBe(true);
  });

  it('does NOT add any .git entries when gitDir is not provided', async () => {
    const inputZip = createFakeGitlabZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip);

    const result = new AdmZip(outputZip);
    const gitEntries = result
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });

  it('does NOT add any .git entries when gitDir is undefined', async () => {
    const inputZip = createFakeGitlabZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip, undefined);

    const result = new AdmZip(outputZip);
    const gitEntries = result
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });

  it('injects .git/* files when gitDir is provided and exists', async () => {
    const inputZip = createFakeGitlabZip(tmpDir);
    const gitDir = createFakeGitDir(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip, gitDir);

    const result = new AdmZip(outputZip);
    const names = result
      .getEntries()
      .map((e: any) => e.entryName)
      .sort();

    // Source files still present
    expect(names).toContain('src/main.py');
    expect(names).toContain('README.md');

    // .git files injected
    expect(names).toContain('.git/HEAD');
    expect(names).toContain('.git/config');
    expect(names).toContain('.git/objects/pack/pack-abc.pack');
  });

  it('injected .git/HEAD has correct content', async () => {
    const inputZip = createFakeGitlabZip(tmpDir);
    const gitDir = createFakeGitDir(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip, gitDir);

    const result = new AdmZip(outputZip);
    const headEntry = result
      .getEntries()
      .find((e: any) => e.entryName === '.git/HEAD');
    expect(headEntry).toBeDefined();
    expect(headEntry.getData().toString()).toBe('ref: refs/heads/main\n');
  });

  it('does NOT inject .git entries when gitDir does not exist on disk', async () => {
    const inputZip = createFakeGitlabZip(tmpDir);
    const nonExistentDir = path.join(tmpDir, 'does-not-exist');
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip, nonExistentDir);

    const result = new AdmZip(outputZip);
    const gitEntries = result
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRefreshedAccessToken
// ---------------------------------------------------------------------------

describe('GitlabService.getRefreshedAccessToken', () => {
  let service: GitlabService;
  let loggerMock: ReturnType<typeof createLoggerMock>;

  const futureExpiry = new Date(Date.now() + 3600 * 1000); // +1 h
  const pastExpiry = new Date(Date.now() - 1000); // already expired

  const integrationBase = {
    id: 'integ-id',
    organizationId: 'org-grat',
    accessToken: 'enc-access-token',
    refreshToken: 'enc-refresh-token',
  } as GitlabIntegration;

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    loggerMock = built.loggerMock;
  });

  it('returns the current token when not expired (no refresh called)', async () => {
    const integration = { ...integrationBase, tokenExpiresAt: futureExpiry };

    jest.spyOn(service as any, 'decryptToken').mockResolvedValue('valid-token');
    const refreshSpy = jest
      .spyOn(service as any, 'refreshAccessToken')
      .mockResolvedValue('should-not-be-called');

    const result = await (service as any).getRefreshedAccessToken(integration);

    expect(result).toBe('valid-token');
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('refreshes when the token is expired and returns the new token', async () => {
    const integration = { ...integrationBase, tokenExpiresAt: pastExpiry };

    const refreshSpy = jest
      .spyOn(service as any, 'refreshAccessToken')
      .mockResolvedValue('new-shiny-token');

    const result = await (service as any).getRefreshedAccessToken(integration);

    expect(refreshSpy).toHaveBeenCalledWith(integration);
    expect(result).toBe('new-shiny-token');
  });

  it('returns null when refresh fails and logs a warn without leaking the token', async () => {
    const integration = { ...integrationBase, tokenExpiresAt: pastExpiry };

    jest
      .spyOn(service as any, 'refreshAccessToken')
      .mockRejectedValue(new Error('refresh-failed'));

    const result = await (service as any).getRefreshedAccessToken(integration);

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalled();
    // The plain token value must not appear in the warning
    const warnMsg = (loggerMock.warn as jest.Mock).mock.calls[0][0] as string;
    expect(warnMsg).not.toContain('new-shiny-token');
    expect(warnMsg).not.toContain('enc-access-token');
  });
});

// ---------------------------------------------------------------------------
// downloadAndUploadInBackground — the git history of the scanned branch
// ---------------------------------------------------------------------------

describe('GitlabService.downloadAndUploadInBackground — git history', () => {
  let built: Awaited<ReturnType<typeof buildService>>;
  let service: GitlabService;
  let tmpDir: string;
  let tmpPath: string;
  let cleanedPath: string;
  let getToken: jest.SpyInstance;
  let processZip: jest.SpyInstance;
  let uploadArchive: jest.SpyInstance;
  let downloadArchive: jest.SpyInstance;

  const mockIntegration = {
    id: 'integration-id',
    organizationId: 'org-123',
    accessToken: 'encrypted-token',
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  } as GitlabIntegration;

  const mockRepo = {
    id: 'repo-id',
    gitlabId: 42,
    name: 'my-project',
    pathWithNamespace: 'mygroup/my-project',
    projectId: 'project-1',
    integration: mockIntegration,
  } as GitlabRepository;

  const incremental: PreparedHistory = {
    mode: 'incremental_artifact',
    tarPath: '/tmp/git-history-abc.tar',
    pass: {
      mode: 'incremental',
      tipSha: 'b'.repeat(40),
      baseTipSha: 'a'.repeat(40),
      excludeShas: ['a'.repeat(40)],
      bytes: '2048',
      firstPass: false,
      repositoryKey: 'gitlab:repo-id',
    },
  };

  /** The background flow around `svc`, with the history left to the test. */
  function wire(svc: GitlabService) {
    jest
      .spyOn(svc as any, 'generateTempPaths')
      .mockReturnValue({ tmpPath, cleanedPath });
    getToken = jest
      .spyOn(svc as any, 'getRefreshedAccessToken')
      .mockResolvedValue('my-secret-token');
    downloadArchive = jest
      .spyOn(svc as any, 'downloadRepositoryArchive')
      .mockImplementation(async () => {
        createFakeGitlabZip(tmpDir);
      });
    processZip = jest
      .spyOn(svc as any, 'processZipInWorker')
      .mockImplementation(async (...args: unknown[]) => {
        fs.writeFileSync(args[1] as string, 'cleaned');
      });
    uploadArchive = jest
      .spyOn(svc as any, 'uploadToSignedUrl')
      .mockResolvedValue(undefined);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    built = await buildService();
    service = built.service;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-history-'));
    tmpPath = path.join(tmpDir, 'input.zip');
    cleanedPath = path.join(tmpDir, 'cleaned.zip');
    wire(service);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const run = (branch = 'main') =>
    service['downloadAndUploadInBackground'](
      mockRepo,
      'sha-1',
      'scan-1',
      'project-1',
      'org-1',
      branch,
      'sast',
    );

  it('fetches the history of the scanned branch with the OAuth token', async () => {
    await run('release/1.2');

    expect(getToken).toHaveBeenCalledWith(mockIntegration);
    expect(built.repoHistory.prepare).toHaveBeenCalledWith({
      scanId: 'scan-1',
      projectId: 'project-1',
      branch: 'release/1.2',
      repositoryKey: 'gitlab:repo-id',
      cloneUrl:
        'https://oauth2:my-secret-token@gitlab.com/mygroup/my-project.git',
    });
  });

  it('keeps the path of a self-managed GitLab served under a sub-path', async () => {
    built = await buildService({
      GITLAB_API_URL: 'https://git.example.com/gitlab/api/v4',
    });
    service = built.service;
    wire(service);
    getToken.mockResolvedValue('tok-123456789');

    await run();

    expect(built.repoHistory.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        cloneUrl:
          'https://oauth2:tok-123456789@git.example.com/gitlab/mygroup/my-project.git',
      }),
    );
  });

  it('a GitLab base URL that cannot be parsed still uploads the archive and records none', async () => {
    built = await buildService({ GITLAB_API_URL: 'not a url' });
    service = built.service;
    wire(service);
    // The real history service, so the recorded pass is what is asserted.
    const scanClient = {
      getGitHistoryCursor: jest.fn(() => of({ mode: 'incremental_artifact' })),
      recordGitHistoryPass: jest.fn(() => of({ success: true })),
    };
    const repoHistory = new RepoHistoryService(
      { getService: jest.fn(() => scanClient) } as never,
      { getService: jest.fn(() => built.fileServiceClient) } as never,
      createLoggerMock() as never,
    );
    repoHistory.onModuleInit();
    (service as any).repoHistory = repoHistory;

    await expect(run()).resolves.toBeUndefined();

    expect(scanClient.recordGitHistoryPass).toHaveBeenCalledWith({
      scanId: 'scan-1',
      pass: expect.objectContaining({
        mode: 'none',
        repositoryKey: 'gitlab:repo-id',
      }),
    });
    expect(
      scanClient.recordGitHistoryPass.mock.invocationCallOrder[0],
    ).toBeLessThan(uploadArchive.mock.invocationCallOrder[0]);
    expect(uploadArchive).toHaveBeenCalledWith(
      'https://storage.example.com/signed-url',
      cleanedPath,
    );
  });

  it('fetches no history when no OAuth token can be had, and still scans', async () => {
    getToken.mockResolvedValue(null);

    await run();

    expect(built.repoHistory.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ cloneUrl: null }),
    );
    expect(uploadArchive).toHaveBeenCalledTimes(1);
  });

  it('publishes the history before uploading the archive', async () => {
    built.repoHistory.prepare.mockResolvedValue(incremental);

    await run();

    expect(built.repoHistory.publish).toHaveBeenCalledWith(incremental, {
      scanId: 'scan-1',
      projectId: 'project-1',
      typeScan: 'sast',
    });
    const published = built.repoHistory.publish.mock.invocationCallOrder[0];
    // The archive upload starts the scan: the history must be there first.
    expect(published).toBeLessThan(
      built.fileServiceClient.uploadFile.mock.invocationCallOrder[0],
    );
    expect(published).toBeLessThan(uploadArchive.mock.invocationCallOrder[0]);
    expect(built.fileServiceClient.uploadFile).toHaveBeenCalledWith({
      scanId: 'scan-1',
      projectId: 'project-1',
      typeScan: 'sast',
    });
    expect(uploadArchive).toHaveBeenCalledWith(
      'https://storage.example.com/signed-url',
      cleanedPath,
    );
    expect(built.repoHistory.cleanup).toHaveBeenCalledWith(incremental);
  });

  it('no .git is injected into the zip in incremental mode', async () => {
    built.repoHistory.prepare.mockResolvedValue(incremental);

    await run();

    expect(processZip).toHaveBeenCalledWith(tmpPath, cleanedPath, undefined);
  });

  it('the bounded history goes into the zip in in_archive mode', async () => {
    built.repoHistory.prepare.mockResolvedValue({
      mode: 'in_archive',
      gitDir: '/tmp/git-history-xyz',
    });

    await run();

    expect(processZip).toHaveBeenCalledWith(
      tmpPath,
      cleanedPath,
      '/tmp/git-history-xyz',
    );
  });

  it('the archive is still uploaded when the history step fails', async () => {
    built.repoHistory.prepare.mockRejectedValue(new Error('history exploded'));

    await run();

    expect(processZip).toHaveBeenCalledWith(tmpPath, cleanedPath, undefined);
    // Still a recorded pass, of mode none, before the archive.
    const unavailable = historyUnavailable('gitlab:repo-id');
    expect(built.repoHistory.publish).toHaveBeenCalledWith(unavailable, {
      scanId: 'scan-1',
      projectId: 'project-1',
      typeScan: 'sast',
    });
    expect(built.repoHistory.publish.mock.invocationCallOrder[0]).toBeLessThan(
      uploadArchive.mock.invocationCallOrder[0],
    );
    expect(uploadArchive).toHaveBeenCalledWith(
      'https://storage.example.com/signed-url',
      cleanedPath,
    );
    expect(built.scanServiceClient.updateScanData).not.toHaveBeenCalled();
  });

  it('cleans up the history when the archive is not a zip (early return)', async () => {
    built.repoHistory.prepare.mockResolvedValue(incremental);
    downloadArchive.mockImplementation(async () => {
      fs.writeFileSync(tmpPath, Buffer.from([0x00, 0x00, 0x00, 0x00]));
    });
    jest.spyOn(service as any, 'markScanAsFailed').mockResolvedValue(undefined);

    await run();

    expect(built.repoHistory.publish).not.toHaveBeenCalled();
    expect(built.repoHistory.cleanup).toHaveBeenCalledWith(incremental);
  });

  it('cleans up the history when the archive download fails', async () => {
    const inArchive: PreparedHistory = {
      mode: 'in_archive',
      gitDir: '/tmp/git-history-leak',
    };
    built.repoHistory.prepare.mockResolvedValue(inArchive);
    downloadArchive.mockRejectedValue(new Error('simulated download failure'));
    jest.spyOn(service as any, 'markScanAsFailed').mockResolvedValue(undefined);

    await expect(run()).resolves.toBeUndefined();

    expect(built.repoHistory.cleanup).toHaveBeenCalledWith(inArchive);
    expect(uploadArchive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handlePushEvent — branch lifecycle (Task D)
// ---------------------------------------------------------------------------

describe('GitlabService.handlePushEvent — branch lifecycle', () => {
  let service: GitlabService;
  let gitlabRepositoryRepo: jest.Mocked<any>;
  let gitlabBranchRepo: jest.Mocked<any>;
  let loggerMock: ReturnType<typeof createLoggerMock>;
  const SHA_ZERO = '0'.repeat(40);

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    gitlabRepositoryRepo = built.gitlabRepositoryRepo;
    gitlabBranchRepo = built.gitlabBranchRepo;
    loggerMock = built.loggerMock;
  });

  const makeRepo = (overrides: any = {}) => ({
    id: 'repo-1',
    gitlabId: 12345,
    name: 'cool-repo',
    projectId: 'project-1',
    scanBranch: null,
    defaultBranch: 'main',
    branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    integration: {
      id: 'int-1',
      organizationId: 'org-1',
    },
    ...overrides,
  });

  it('1. branch creation push — upserts branch row with isProtected=false, no scan trigger', async () => {
    const repo = makeRepo();
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 12345 },
      ref: 'refs/heads/new-feature',
      before: SHA_ZERO,
      after: 'abc123def456',
    };

    await (service as any).handlePushEvent(payload);

    expect(gitlabBranchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'new-feature', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    expect(startScanSpy).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.delete).not.toHaveBeenCalled();
    // Webhook must NOT touch branchesSyncedAt
    expect(repo.branchesSyncedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('2. branch deletion push — deletes branch row by (repositoryId, name), no scan trigger', async () => {
    const repo = makeRepo();
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    (gitlabBranchRepo.delete as any).mockResolvedValue({ affected: 1 });
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 12345 },
      ref: 'refs/heads/feature-gone',
      before: 'abc123def456',
      after: SHA_ZERO,
    };

    await (service as any).handlePushEvent(payload);

    expect(gitlabBranchRepo.delete).toHaveBeenCalledWith({
      repositoryId: 'repo-1',
      name: 'feature-gone',
    });
    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('3. normal push to target branch on linked repo — upserts (refresh) AND triggers scan', async () => {
    const repo = makeRepo({ scanBranch: 'main', defaultBranch: 'main' });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 12345 },
      ref: 'refs/heads/main',
      before: 'abc',
      after: 'd'.repeat(40),
      checkout_sha: 'd'.repeat(40),
    };

    await (service as any).handlePushEvent(payload);

    // Upsert called to refresh lastSeenAt.
    expect(gitlabBranchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'main', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    // The scan types read with the scan-on-commit opt-out are
    // handed to the scan start (the default project enables SAST and SCA).
    // So is the commit the push checked out.
    expect(startScanSpy).toHaveBeenCalledWith(
      {
        repositoryId: 'repo-1',
        projectId: 'project-1',
        branch: 'main',
      },
      // A push is an AppSec scan: no graph-only option.
      {},
      'sast,sca',
      'd'.repeat(40),
    );
  });

  it('logs a server-side scan RpcException as an error', async () => {
    const repo = makeRepo({ scanBranch: 'main', defaultBranch: 'main' });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    jest.spyOn(service as any, 'startScanForLastCommit').mockRejectedValue(
      new RpcException({
        code: GrpcStatus.UNAVAILABLE,
        message: 'Scan service unavailable',
      }),
    );

    await (service as any).handlePushEvent({
      project: { id: 12345 },
      ref: 'refs/heads/main',
      before: 'abc',
      after: 'def',
    });

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start scan'),
      expect.any(String),
      GitlabService.name,
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('4. push to UNLINKED repo (projectId=null) — branch still tracked, no scan trigger', async () => {
    const repo = makeRepo({ projectId: null, scanBranch: null });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 12345 },
      ref: 'refs/heads/main',
      before: 'abc',
      after: 'def',
    };

    await (service as any).handlePushEvent(payload);

    expect(gitlabBranchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'main', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('5. push with tag ref (refs/tags/v1) — no branch DB write, no scan', async () => {
    const repo = makeRepo({ scanBranch: 'main' });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 12345 },
      ref: 'refs/tags/v1',
      before: 'abc',
      after: 'def',
    };

    await (service as any).handlePushEvent(payload);

    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.delete).not.toHaveBeenCalled();
    // Tag pushes never match scanBranch/defaultBranch so existing logic
    // continues to skip the scan trigger.
    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('6. push to UNKNOWN repo (not in DB) — early return, no DB writes, no scan', async () => {
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(null);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 99999 },
      ref: 'refs/heads/main',
      before: 'abc',
      after: 'def',
    };

    await (service as any).handlePushEvent(payload);

    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.delete).not.toHaveBeenCalled();
    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('7. normal push to NON-target branch on linked repo — upsert only, no scan', async () => {
    const repo = makeRepo({ scanBranch: 'main', defaultBranch: 'main' });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const payload = {
      project: { id: 12345 },
      ref: 'refs/heads/develop',
      before: 'abc',
      after: 'def',
    };

    await (service as any).handlePushEvent(payload);

    // The branch still gets tracked (refresh lastSeenAt).
    expect(gitlabBranchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'develop', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    // But scan is skipped because branch != scanBranch.
    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('8. early-return when ref missing', async () => {
    const repo = makeRepo();
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    await (service as any).handlePushEvent({ project: { id: 12345 } });

    expect(gitlabRepositoryRepo.findOne).not.toHaveBeenCalled();
    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('9. early-return when projectId missing on payload', async () => {
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    await (service as any).handlePushEvent({ ref: 'refs/heads/main' });

    expect(gitlabRepositoryRepo.findOne).not.toHaveBeenCalled();
    expect(startScanSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getGitlabRepositoryBranchesPaginated — Task 2.3
// ---------------------------------------------------------------------------

describe('GitlabService.getGitlabRepositoryBranchesPaginated', () => {
  let service: GitlabService;
  let gitlabRepositoryRepo: any;
  let gitlabBranchRepo: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    gitlabRepositoryRepo = built.gitlabRepositoryRepo;
    gitlabBranchRepo = built.gitlabBranchRepo;
  });

  const makeRepo = (o: any = {}) => ({
    id: 'repo-1',
    defaultBranch: 'main',
    scanBranch: 'develop',
    branchesSyncedAt: new Date('2026-01-01'),
    integration: { id: 'int-1', organizationId: 'org-1' },
    ...o,
  });
  const makeQb = (rows: any[], total: number) => {
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      setParameter: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn().mockResolvedValue([rows, total]),
    };
    return qb;
  };

  it('searches + paginates + excludes archived + default-first, returns total', async () => {
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(makeRepo());
    const qb = makeQb(
      [
        { name: 'main', isProtected: true },
        { name: 'feature/x', isProtected: false },
      ],
      42,
    );
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => qb);

    const res = await service.getGitlabRepositoryBranchesPaginated({
      organizationId: 'org-1',
      projectId: 'proj-1',
      search: 'fea',
      page: 1,
      pageSize: 30,
      includeArchived: false,
      archivedNames: ['old'],
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'branch.name NOT IN (:...archivedNames)',
      { archivedNames: ['old'] },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('branch.name LIKE :search', {
      search: '%fea%',
    });
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(30);
    expect(res.total).toBe(42);
    expect(res.defaultBranch).toBe('main');
    expect(res.scanBranch).toBe('develop');
    expect(res.branches).toEqual([
      { name: 'main', isDefault: true, isProtected: true, archived: false },
      {
        name: 'feature/x',
        isDefault: false,
        isProtected: false,
        archived: false,
      },
    ]);
  });

  it('repo not found for project → RpcException (NOT_FOUND code)', async () => {
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(null);
    await expect(
      service.getGitlabRepositoryBranchesPaginated({
        organizationId: 'org-1',
        projectId: 'missing',
        search: '',
        page: 1,
        pageSize: 30,
        includeArchived: false,
        archivedNames: [],
      } as any),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('includeArchived=true keeps archived rows and annotates them, no NOT IN clause', async () => {
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(makeRepo());
    const qb = makeQb([{ name: 'old-release', isProtected: false }], 1);
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => qb);

    const res = await service.getGitlabRepositoryBranchesPaginated({
      organizationId: 'org-1',
      projectId: 'proj-1',
      search: '',
      page: 1,
      pageSize: 30,
      includeArchived: true,
      archivedNames: ['old-release'],
    } as any);

    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'branch.name NOT IN (:...archivedNames)',
      expect.anything(),
    );
    expect(res.branches).toEqual([
      {
        name: 'old-release',
        isDefault: false,
        isProtected: false,
        archived: true,
      },
    ]);
  });

  it('lazy-fills when branchesSyncedAt is null before querying', async () => {
    const repo = makeRepo({ branchesSyncedAt: null });
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repo);
    const lazySpy = jest
      .spyOn<any, any>(service as any, 'lazyFillGitlabBranches')
      .mockResolvedValue(undefined);
    const qb = makeQb([], 0);
    (gitlabBranchRepo.createQueryBuilder as any) = jest.fn(() => qb);

    await service.getGitlabRepositoryBranchesPaginated({
      organizationId: 'org-1',
      projectId: 'proj-1',
      search: '',
      page: 1,
      pageSize: 30,
      includeArchived: false,
      archivedNames: [],
    } as any);

    expect(lazySpy).toHaveBeenCalledWith(repo);
  });
});

// ---------------------------------------------------------------------------
// ensurePushEventsEnabled — Task D Part 2
// ---------------------------------------------------------------------------

describe('GitlabService.ensurePushEventsEnabled', () => {
  let service: GitlabService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
  });

  const mockIntegration = {
    id: 'integration-id',
    organizationId: 'org-1',
    accessToken: 'encrypted-token',
    refreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  } as GitlabIntegration;

  it('1. no webhook exists for our URL — POSTs a new hook with push_events=true', async () => {
    // Mock callGitlabApi to behave like the real method: invoke the callback
    // with a token and return its result.
    const callGitlabApiSpy = jest
      .spyOn(service as any, 'callGitlabApi')
      .mockImplementationOnce(async () => ({
        data: [{ id: 99, url: 'https://other.example.com/hook' }],
      }))
      .mockImplementationOnce(async () => ({ data: { id: 100 } }));

    mockedAxios.post.mockResolvedValue({ data: { id: 100 } });

    await (service as any).ensurePushEventsEnabled(mockIntegration, 12345);

    // First call: GET existing hooks. Second call: POST new hook.
    expect(callGitlabApiSpy).toHaveBeenCalledTimes(2);
  });

  it('2. webhook exists with push_events=false — PUTs to update it', async () => {
    const callGitlabApiSpy = jest
      .spyOn(service as any, 'callGitlabApi')
      .mockImplementationOnce(async () => ({
        data: [
          {
            id: 77,
            url: 'https://app.example.com/webhooks/gitlab',
            push_events: false,
          },
        ],
      }))
      .mockImplementationOnce(async () => ({
        data: { id: 77, push_events: true },
      }));

    await (service as any).ensurePushEventsEnabled(mockIntegration, 12345);

    // 1 GET + 1 PUT.
    expect(callGitlabApiSpy).toHaveBeenCalledTimes(2);
  });

  it('3. webhook already has push_events=true — no API mutation (idempotent fast path)', async () => {
    const callGitlabApiSpy = jest
      .spyOn(service as any, 'callGitlabApi')
      .mockImplementationOnce(async () => ({
        data: [
          {
            id: 55,
            url: 'https://app.example.com/webhooks/gitlab',
            push_events: true,
          },
        ],
      }));

    await (service as any).ensurePushEventsEnabled(mockIntegration, 12345);

    // Only the GET call — no POST/PUT.
    expect(callGitlabApiSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Webhook registration: every hook we create or update gets a fresh random
// token; only its hash is stored, on every row of that GitLab project.
// ---------------------------------------------------------------------------

describe('GitlabService webhook registration tokens', () => {
  let service: GitlabService;
  let repositoryRepo: jest.Mocked<any>;
  let loggerMock: ReturnType<typeof createLoggerMock>;
  const hookUrl = 'https://app.example.com/webhooks/gitlab';
  const integration = {
    id: 'integration-id',
    organizationId: 'org-1',
    accessToken: 'encrypted-token',
  } as GitlabIntegration;

  /** callGitlabApi runs the request with a dummy access token. */
  const passThrough = () =>
    jest
      .spyOn(service as any, 'callGitlabApi')
      .mockImplementation(async (_i: unknown, request: any) =>
        request('access'),
      );

  const sentTokens = (method: 'post' | 'put') =>
    mockedAxios[method].mock.calls.map((c: any[]) => c[1]?.token);

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    repositoryRepo = built.gitlabRepositoryRepo;
    loggerMock = built.loggerMock;
    repositoryRepo.update.mockResolvedValue({ affected: 1 });
    repositoryRepo.save.mockImplementation(async (r: unknown) => r);
  });

  const expectFreshToken = (token: unknown) => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe('secret');
    expect(repositoryRepo.update).toHaveBeenCalledWith(
      { gitlabId: 12345 },
      { webhookTokenHash: hashWebhookToken(token as string) },
    );
  };

  it('createProjectWebhook registers a new hook with a fresh token, not the OAuth secret', async () => {
    passThrough();
    mockedAxios.get.mockResolvedValue({ data: [] });
    mockedAxios.post.mockResolvedValue({ data: { id: 100 } });

    await (service as any).createProjectWebhook({
      integration,
      gitlabId: 12345,
    });

    const [token] = sentTokens('post');
    expectFreshToken(token);
  });

  it('createProjectWebhook gives an existing hook of ours a fresh token', async () => {
    passThrough();
    mockedAxios.get.mockResolvedValue({
      data: [{ id: 77, url: hookUrl, push_events: true }],
    });
    mockedAxios.put.mockResolvedValue({ data: { id: 77 } });

    const repository: any = { integration, gitlabId: 12345 };
    await (service as any).createProjectWebhook(repository);

    expect(mockedAxios.put.mock.calls[0][0]).toContain(
      '/projects/12345/hooks/77',
    );
    const [token] = sentTokens('put');
    expectFreshToken(token);
    expect(repository.webhookId).toBe(77);
  });

  it('ensurePushEventsEnabled creates a missing hook with a fresh token', async () => {
    passThrough();
    mockedAxios.get.mockResolvedValue({ data: [] });
    mockedAxios.post.mockResolvedValue({ data: { id: 100 } });

    await (service as any).ensurePushEventsEnabled(integration, 12345);

    expectFreshToken(sentTokens('post')[0]);
  });

  it('ensurePushEventsEnabled re-enables push events with a fresh token', async () => {
    passThrough();
    mockedAxios.get.mockResolvedValue({
      data: [{ id: 77, url: hookUrl, push_events: false }],
    });
    mockedAxios.put.mockResolvedValue({ data: { id: 77 } });

    await (service as any).ensurePushEventsEnabled(integration, 12345);

    expectFreshToken(sentTokens('put')[0]);
  });

  it('stores no hash when GitLab refuses the hook', async () => {
    passThrough();
    mockedAxios.get.mockResolvedValue({ data: [] });
    mockedAxios.post.mockRejectedValue(new Error('403 Forbidden'));

    await (service as any).createProjectWebhook({
      integration,
      gitlabId: 12345,
    });

    expect(repositoryRepo.update).not.toHaveBeenCalled();
  });

  describe('rotateWebhookToken (token migration of one GitLab project)', () => {
    const second = { ...integration, id: 'integration-2' } as GitlabIntegration;

    it('gives the existing hook a fresh token, keeping its event settings', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', gitlabId: 12345, integration },
      ]);
      passThrough();
      mockedAxios.get.mockResolvedValue({
        data: [
          {
            id: 77,
            url: hookUrl,
            push_events: true,
            merge_requests_events: false,
            enable_ssl_verification: true,
          },
        ],
      });
      mockedAxios.put.mockResolvedValue({ data: { id: 77 } });

      await expect(service.rotateWebhookToken(12345)).resolves.toBe('rotated');

      const [url, body] = mockedAxios.put.mock.calls[0] as any[];
      expect(url).toContain('/projects/12345/hooks/77');
      expect(body).toMatchObject({
        url: hookUrl,
        push_events: true,
        merge_requests_events: false,
        enable_ssl_verification: true,
      });
      expectFreshToken(body.token);
    });

    it('marks a project without a hook of ours as migrated, with a hash no one holds', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', gitlabId: 12345, integration },
      ]);
      passThrough();
      mockedAxios.get.mockResolvedValue({
        data: [{ id: 5, url: 'https://elsewhere.example.com/hook' }],
      });

      await expect(service.rotateWebhookToken(12345)).resolves.toBe('no_hook');

      expect(mockedAxios.put).not.toHaveBeenCalled();
      expect(repositoryRepo.update).toHaveBeenCalledWith(
        { gitlabId: 12345 },
        { webhookTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      );
    });

    it('falls back to the next connection when the first one cannot read the hooks', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', gitlabId: 12345, integration },
        { id: 'r2', gitlabId: 12345, integration: second },
      ]);
      const call = jest
        .spyOn(service as any, 'callGitlabApi')
        .mockImplementation(async (i: any, request: any) => {
          if (i.id === 'integration-id') throw new Error('403 Forbidden');
          return request('access');
        });
      mockedAxios.get.mockResolvedValue({
        data: [{ id: 77, url: hookUrl, push_events: true }],
      });
      mockedAxios.put.mockResolvedValue({ data: { id: 77 } });

      await expect(service.rotateWebhookToken(12345)).resolves.toBe('rotated');
      expect(call.mock.calls.map((c: any[]) => c[0].id)).toContain(
        'integration-2',
      );
    });

    it('reports failed and stores nothing when no connection can update the hook', async () => {
      repositoryRepo.find.mockResolvedValue([
        { id: 'r1', gitlabId: 12345, integration },
      ]);
      passThrough();
      mockedAxios.get.mockResolvedValue({
        data: [{ id: 77, url: hookUrl, push_events: true }],
      });
      mockedAxios.put.mockRejectedValue(new Error('403 Forbidden'));

      await expect(service.rotateWebhookToken(12345)).resolves.toBe('failed');
      expect(repositoryRepo.update).not.toHaveBeenCalled();
      const logged = [
        ...(loggerMock.warn as jest.Mock).mock.calls,
        ...(loggerMock.error as jest.Mock).mock.calls,
      ]
        .flat()
        .join(' ');
      expect(logged).not.toMatch(/[0-9a-f]{64}/);
    });

    it('reports failed when the project has no row', async () => {
      repositoryRepo.find.mockResolvedValue([]);
      await expect(service.rotateWebhookToken(12345)).resolves.toBe('failed');
    });
  });
});

describe('GitlabService.runRepoDownloadJob', () => {
  it('re-fetches the repository (with integration) and runs the download flow', async () => {
    const { service, gitlabRepositoryRepo } = await buildService();
    const repo = {
      id: 'repo-uuid',
      name: 'r',
      integration: { organizationId: 'org' },
    };
    gitlabRepositoryRepo.findOne.mockResolvedValue(repo);
    const bg = jest
      .spyOn(service as any, 'downloadAndUploadInBackground')
      .mockResolvedValue(undefined);

    await service.runRepoDownloadJob({
      provider: 'gitlab',
      scanId: 's',
      projectId: 'p',
      organizationId: 'org',
      branch: 'main',
      typeScan: 'sast',
      repositoryId: 'repo-uuid',
      commitSha: 'c',
    });

    expect(gitlabRepositoryRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'repo-uuid' },
      relations: ['integration'],
    });
    expect(bg).toHaveBeenCalledWith(repo, 'c', 's', 'p', 'org', 'main', 'sast');
  });

  it('throws when the repository no longer exists', async () => {
    const { service, gitlabRepositoryRepo } = await buildService();
    gitlabRepositoryRepo.findOne.mockResolvedValue(null);

    await expect(
      service.runRepoDownloadJob({
        provider: 'gitlab',
        scanId: 's',
        projectId: 'p',
        organizationId: 'org',
        branch: 'main',
        typeScan: 'sast',
        repositoryId: 'missing',
        commitSha: 'c',
      }),
    ).rejects.toThrow('GitlabRepository missing not found');
  });
});

// ---------------------------------------------------------------------------
// Repository import — resilience of the OAuth install (no 500 on a partial import)
//
// callbackInstall was returning INTERNAL (HTTP 500) to the user even though the
// integration had been created and most repositories were already committed:
// `gitlab_repositories` stores every GitLab-supplied string in varchar(255),
// while GitLab allows a 2000-character project description (and nests groups
// deep enough for `name_with_namespace` / URLs to pass 255). The first project
// that does not fit makes MySQL reject the INSERT; `save()`'s implicit
// transaction ROLLBACKs, the rejection escapes the `for` loop in
// syncRepositories, and the whole callback dies.
//
// Two independent guarantees are locked in here:
//   1. values that are display-only are clamped to what the column can store,
//      so a long description never reaches MySQL as an oversized value;
//   2. whatever the reason a single repository cannot be persisted, the import
//      keeps going and the OAuth callback still succeeds.
// ---------------------------------------------------------------------------

describe('GitlabService.createOrUpdateRepository (column-width safety)', () => {
  const integration = { id: 'int-1', organizationId: 'org-1' } as any;

  const makeProject = (over: Record<string, unknown> = {}) => ({
    id: 42,
    name: 'app',
    name_with_namespace: 'Group / app',
    path: 'app',
    path_with_namespace: 'group/app',
    visibility: 'private',
    default_branch: 'main',
    description: 'a short description',
    web_url: 'https://gitlab.com/group/app',
    ssh_url_to_repo: 'git@gitlab.com:group/app.git',
    http_url_to_repo: 'https://gitlab.com/group/app.git',
    ...over,
  });

  const saveNewRepository = async (project: Record<string, unknown>) => {
    const { service, gitlabRepositoryRepo } = await buildService();
    gitlabRepositoryRepo.findOne.mockResolvedValue(null);
    gitlabRepositoryRepo.save.mockImplementation(async (r: any) => r);

    await (service as any).createOrUpdateRepository(integration, project);

    return gitlabRepositoryRepo.save.mock.calls[0][0] as any;
  };

  it('1. clamps a description longer than GitLab’s own 2000-char limit (the database would reject the INSERT)', async () => {
    const saved = await saveNewRepository(
      makeProject({ description: 'x'.repeat(3000) }),
    );

    expect(saved.description).toHaveLength(2000);
    expect(saved.description).toBe('x'.repeat(2000));
  });

  it('2. clamps an over-long display name and name_with_namespace', async () => {
    const saved = await saveNewRepository(
      makeProject({
        name: 'n'.repeat(400),
        name_with_namespace: 'g'.repeat(900),
      }),
    );

    expect(saved.name).toHaveLength(255);
    expect(saved.nameWithNamespace).toHaveLength(512);
  });

  it('3. leaves values that already fit byte-for-byte untouched', async () => {
    const project = makeProject();
    const saved = await saveNewRepository(project);

    expect(saved.name).toBe('app');
    expect(saved.nameWithNamespace).toBe('Group / app');
    expect(saved.description).toBe('a short description');
    expect(saved.pathWithNamespace).toBe('group/app');
    expect(saved.httpUrlToRepo).toBe('https://gitlab.com/group/app.git');
  });

  it('4. keeps an absent description null rather than coercing it to a string', async () => {
    const saved = await saveNewRepository(
      makeProject({ description: null, default_branch: null }),
    );

    expect(saved.description).toBeNull();
    expect(saved.defaultBranch).toBeNull();
  });

  it('5. never truncates the functional identifiers (a clipped clone URL would silently break scans)', async () => {
    const longPath = `group/${'s'.repeat(400)}`;
    const saved = await saveNewRepository(
      makeProject({
        path_with_namespace: longPath,
        http_url_to_repo: `https://gitlab.com/${longPath}.git`,
      }),
    );

    expect(saved.pathWithNamespace).toBe(longPath);
    expect(saved.httpUrlToRepo).toBe(`https://gitlab.com/${longPath}.git`);
  });
});

describe('GitlabService.syncRepositories (per-repository fault isolation)', () => {
  const integration = { id: 'int-1', organizationId: 'org-1' } as any;

  it('1. keeps importing the remaining projects when one repository row is rejected', async () => {
    const { service } = await buildService();
    jest.spyOn(service as any, 'fetchUserProjects').mockResolvedValue([
      { id: 1, path_with_namespace: 'g/a' },
      { id: 2, path_with_namespace: 'g/poison' },
      { id: 3, path_with_namespace: 'g/c' },
    ]);
    const upsert = jest
      .spyOn(service as any, 'createOrUpdateRepository')
      .mockImplementation(async (_i: any, project: any) => {
        if (project.id === 2) {
          throw new Error(
            "ER_DATA_TOO_LONG: Data too long for column 'description' at row 1",
          );
        }
      });

    await expect(
      (service as any).syncRepositories(integration),
    ).resolves.toBeUndefined();

    // The project AFTER the poison one still gets imported.
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenNthCalledWith(
      3,
      integration,
      expect.objectContaining({ id: 3 }),
    );
  });

  it('2. logs the offending project so the failure is diagnosable without a DB dump', async () => {
    const { service, loggerMock } = await buildService();
    jest
      .spyOn(service as any, 'fetchUserProjects')
      .mockResolvedValue([{ id: 2, path_with_namespace: 'g/poison' }]);
    jest
      .spyOn(service as any, 'createOrUpdateRepository')
      .mockRejectedValue(new Error('Data too long for column'));

    await (service as any).syncRepositories(integration);

    const logged = (loggerMock.error as jest.Mock).mock.calls
      .map((c) => String(c[0]))
      .join('\n');
    expect(logged).toContain('g/poison');
    expect(logged).toContain('Data too long for column');
  });

  it('3. still throws when the project listing itself fails (a real integration error)', async () => {
    const { service } = await buildService();
    jest
      .spyOn(service as any, 'fetchUserProjects')
      .mockRejectedValue(new Error('401 Unauthorized'));

    await expect(
      (service as any).syncRepositories(integration),
    ).rejects.toThrow('401 Unauthorized');
  });
});

describe('GitlabService.callbackInstall (does not 500 on a single bad repository)', () => {
  const buildCallbackService = async () => {
    const built = await buildService();
    const { service } = built;

    // Redis holds the CSRF state for the org; buildService only stubs the
    // methods other suites need, so add the two this path uses.
    (service as any).redisClient.get = jest.fn().mockResolvedValue('state-123');
    (service as any).redisClient.del = jest.fn().mockResolvedValue(1);

    jest.spyOn(service as any, 'exchangeCodeForToken').mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 7200,
      scope: 'api read_user read_repository write_repository',
    });
    jest
      .spyOn(service as any, 'getGitlabUser')
      .mockResolvedValue({ id: 7, username: 'u' });
    jest
      .spyOn(service as any, 'createOrUpdateIntegration')
      .mockResolvedValue({ id: 'int-1', organizationId: 'org-1' });

    return built;
  };

  const request = {
    organizationId: 'org-1',
    userId: 'user-1',
    code: 'code-abc',
    state: 'state-123',
  } as any;

  it('does not log the expected OAuth state when the received one differs', async () => {
    const built = await buildCallbackService();

    await expect(
      built.service.callbackInstall({ ...request, state: 'forged' }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.INVALID_ARGUMENT }),
    });

    const logged = [
      ...(built.loggerMock.error as jest.Mock).mock.calls,
      ...(built.loggerMock.warn as jest.Mock).mock.calls,
      ...(built.loggerMock.log as jest.Mock).mock.calls,
    ]
      .flat()
      .map(String)
      .join(' ');
    expect(logged).not.toContain('state-123');
  });

  it('1. returns the redirect URI when one repository cannot be persisted', async () => {
    const { service } = await buildCallbackService();
    jest.spyOn(service as any, 'fetchUserProjects').mockResolvedValue([
      { id: 1, path_with_namespace: 'g/ok' },
      { id: 2, path_with_namespace: 'g/poison' },
    ]);
    jest
      .spyOn(service as any, 'createOrUpdateRepository')
      .mockImplementation(async (_i: any, project: any) => {
        if (project.id === 2) {
          throw new Error(
            "ER_DATA_TOO_LONG: Data too long for column 'description' at row 1",
          );
        }
      });

    await expect(service.callbackInstall(request)).resolves.toEqual({
      returnUri: '/organizations/org-1/integrations',
    });
  });

  it('2. still fails loudly when the integration itself cannot be created', async () => {
    const { service } = await buildCallbackService();
    jest
      .spyOn(service as any, 'createOrUpdateIntegration')
      .mockRejectedValue(new Error('DB down'));

    const err = await service.callbackInstall(request).catch((e) => e);
    expect(err).toBeInstanceOf(RpcException);
    expect((err.getError() as any).message).toBe(
      'Failed to complete GitLab integration',
    );
  });
});

describe('GitlabService scan error propagation', () => {
  it('returns UNAUTHENTICATED for an invalid decrypted access token', async () => {
    const { service, loggerMock } = await buildService();
    jest.spyOn(service as any, 'decryptToken').mockResolvedValue('');
    jest.spyOn(service as any, 'createFailedScan').mockResolvedValue(undefined);

    await expect(
      (service as any).getValidAccessToken(
        { id: 'integration-1', accessToken: 'encrypted' },
        'project-1',
        'organization-1',
      ),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAUTHENTICATED }),
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to decrypt access token'),
    );
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('preserves downstream gRPC errors when loading project scan types', async () => {
    const { service, loggerMock } = await buildService();
    (service as any).projectServiceClient.get = jest.fn(() =>
      throwError(() => ({
        code: GrpcStatus.PERMISSION_DENIED,
        details: 'Project access denied',
      })),
    );

    await expect(
      (service as any).getProjectScanTypes('project-1'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.PERMISSION_DENIED }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handlePushEvent — per-project scan-on-commit opt-out
// ---------------------------------------------------------------------------

describe('GitlabService.handleWebhook (scanOnCommitEnabled gate)', () => {
  let service: GitlabService;
  let gitlabRepositoryRepo: jest.Mocked<any>;
  let loggerMock: ReturnType<typeof createLoggerMock>;
  let projectGet: jest.Mock;

  const pushPayload = {
    object_kind: 'push',
    ref: 'refs/heads/main',
    project: { id: 4242 },
  };

  const buildPushRequest = () => ({
    bodyJson: JSON.stringify(pushPayload),
    gitlabToken: 'secret',
    event: 'Push Hook',
  });

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    gitlabRepositoryRepo = built.gitlabRepositoryRepo;
    loggerMock = built.loggerMock;
    projectGet = built.projectGet;

    jest
      .spyOn(service as any, 'verifyWebhookSignature')
      .mockResolvedValue(true);
    (gitlabRepositoryRepo.findOne as any).mockResolvedValue({
      id: 'repo-1',
      gitlabId: 4242,
      projectId: 'p1',
      name: 'widgets',
      scanBranch: 'main',
      defaultBranch: 'main',
      integration: { id: 'int-1' },
    });
  });

  it('skips the scan when the project has scanOnCommitEnabled=false', async () => {
    projectGet.mockReturnValue(of({ scanOnCommitEnabled: false }));
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    const res = await service.handleWebhook(buildPushRequest() as any);

    expect(projectGet).toHaveBeenCalledWith(leanProjectRead('p1'));
    expect(startScanSpy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('scans when the project has scanOnCommitEnabled=true', async () => {
    projectGet.mockReturnValue(of({ scanOnCommitEnabled: true }));
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    await service.handleWebhook(buildPushRequest() as any);

    expect(startScanSpy).toHaveBeenCalled();
  });

  // A global-management running behind this service omits the field entirely;
  // reading that as "disabled" would silently stop scanning every project.
  it('scans when the field is absent from the project response', async () => {
    projectGet.mockReturnValue(of({ sastEnabled: true }));
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    await service.handleWebhook(buildPushRequest() as any);

    expect(startScanSpy).toHaveBeenCalled();
  });

  // Fail open: a missed scan is a security gap, so a transient gRPC failure
  // must not silently suppress scanning.
  it('scans and warns when the project lookup fails', async () => {
    projectGet.mockImplementation(() => {
      throw new Error('global-management unavailable');
    });
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForLastCommit')
      .mockResolvedValue(undefined);

    await service.handleWebhook(buildPushRequest() as any);

    expect(startScanSpy).toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('scanOnCommitEnabled'),
      expect.anything(),
    );
  });

  // A push read the project twice (the scan-on-commit opt-out,
  // then the scan types), each a full ProjectService/Get with its
  // vulnerability count. One lean read now serves both.
  describe('one project read per push', () => {
    let repoScanQueue: { enqueueRepoScan: jest.Mock };

    beforeEach(async () => {
      const built = await buildService();
      service = built.service;
      gitlabRepositoryRepo = built.gitlabRepositoryRepo;
      projectGet = built.projectGet;
      repoScanQueue = built.repoScanQueue;

      jest
        .spyOn(service as any, 'verifyWebhookSignature')
        .mockResolvedValue(true);
      const repository = {
        id: 'repo-1',
        gitlabId: 4242,
        projectId: 'p1',
        name: 'widgets',
        scanBranch: 'main',
        defaultBranch: 'main',
        integration: { id: 'int-1', organizationId: 'org-1' },
      };
      (gitlabRepositoryRepo.findOne as any).mockResolvedValue(repository);
      jest.spyOn(service as any, 'decryptToken').mockResolvedValue('token');
      jest
        .spyOn(service as any, 'getLatestCommit')
        .mockResolvedValue({ id: 'sha-1' });
      jest
        .spyOn(service as any, 'getValidAccessToken')
        .mockResolvedValue('token');
    });

    it('reads the project once, with the lean read, and scans with its types', async () => {
      projectGet.mockReturnValue(
        of({
          scanOnCommitEnabled: true,
          sastEnabled: true,
          iacEnabled: true,
          scaEnabled: false,
        }),
      );

      await service.handleWebhook(buildPushRequest() as any);

      expect(projectGet).toHaveBeenCalledTimes(1);
      expect(projectGet).toHaveBeenCalledWith(leanProjectRead('p1'));
      expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          commitSha: 'sha-1',
          typeScan: 'sast,iac',
        }),
      );
    });

    it('a failed read keeps the former behaviour: scan anyway, types read again', async () => {
      projectGet
        .mockImplementationOnce(() =>
          throwError(() => ({ code: GrpcStatus.UNAVAILABLE, details: 'down' })),
        )
        .mockReturnValueOnce(
          of({ sastEnabled: false, iacEnabled: false, scaEnabled: true }),
        );

      await service.handleWebhook(buildPushRequest() as any);

      expect(projectGet).toHaveBeenCalledTimes(2);
      expect(projectGet).toHaveBeenNthCalledWith(2, leanProjectRead('p1'));
      expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({ typeScan: 'sca' }),
      );
    });
  });

  // The push payload already names the commit GitLab checked out
  // (`checkout_sha`). Asking the GitLab API for the branch's latest commit cost
  // an HTTPS round trip per push (0.3 to 4 s), and could name a commit pushed
  // after this one.
  describe('the scanned commit comes from the push payload', () => {
    let repoScanQueue: { enqueueRepoScan: jest.Mock };
    let getLatestCommit: jest.SpyInstance;
    const checkoutSha = 'a'.repeat(40);

    const pushWith = (extra: Record<string, unknown>) => ({
      bodyJson: JSON.stringify({ ...pushPayload, ...extra }),
      gitlabToken: 'secret',
      event: 'Push Hook',
    });

    beforeEach(async () => {
      const built = await buildService();
      service = built.service;
      gitlabRepositoryRepo = built.gitlabRepositoryRepo;
      repoScanQueue = built.repoScanQueue;

      jest
        .spyOn(service as any, 'verifyWebhookSignature')
        .mockResolvedValue(true);
      (gitlabRepositoryRepo.findOne as any).mockResolvedValue({
        id: 'repo-1',
        gitlabId: 4242,
        projectId: 'p1',
        name: 'widgets',
        scanBranch: 'main',
        defaultBranch: 'main',
        integration: { id: 'int-1', organizationId: 'org-1' },
      });
      jest.spyOn(service as any, 'decryptToken').mockResolvedValue('token');
      jest
        .spyOn(service as any, 'getValidAccessToken')
        .mockResolvedValue('token');
      getLatestCommit = jest
        .spyOn(service as any, 'getLatestCommit')
        .mockResolvedValue({ id: 'b'.repeat(40) });
    });

    it('scans checkout_sha without asking GitLab for the latest commit', async () => {
      await service.handleWebhook(
        pushWith({ checkout_sha: checkoutSha, after: checkoutSha }) as any,
      );

      expect(getLatestCommit).not.toHaveBeenCalled();
      expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          branch: 'main',
          commitSha: checkoutSha,
        }),
      );
    });

    it('accepts the 64-character id of a SHA-256 repository', async () => {
      const sha256 = 'c'.repeat(64);
      await service.handleWebhook(pushWith({ checkout_sha: sha256 }) as any);

      expect(getLatestCommit).not.toHaveBeenCalled();
      expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({ commitSha: sha256 }),
      );
    });

    it.each([
      ['absent', {}],
      ['null', { checkout_sha: null }],
      ['not a commit id', { checkout_sha: 'main; rm -rf /' }],
    ])(
      'falls back to the latest commit when checkout_sha is %s',
      async (_label, extra) => {
        await service.handleWebhook(pushWith(extra) as any);

        expect(getLatestCommit).toHaveBeenCalledTimes(1);
        expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
          expect.objectContaining({ commitSha: 'b'.repeat(40) }),
        );
      },
    );
  });
});

// ---------------------------------------------------------------------------
// A push refused by a running scan is rescanned later
// ---------------------------------------------------------------------------

describe('GitlabService — push refused by a running scan, rescanned later', () => {
  let built: Awaited<ReturnType<typeof buildService>>;
  let service: GitlabService;
  let getLatestCommit: jest.SpyInstance;

  const checkoutSha = 'c'.repeat(40);
  const pushPayload = {
    object_kind: 'push',
    ref: 'refs/heads/main',
    before: 'a'.repeat(40),
    after: checkoutSha,
    checkout_sha: checkoutSha,
    project: { id: 4242 },
  };
  const pushRequest = (payload: Record<string, unknown> = pushPayload) => ({
    bodyJson: JSON.stringify(payload),
    gitlabToken: 'secret',
    event: 'Push Hook',
  });
  const linkedRepository = (overrides: Record<string, unknown> = {}) => ({
    id: 'repo-1',
    gitlabId: 4242,
    projectId: 'p1',
    name: 'widgets',
    scanBranch: 'main',
    defaultBranch: 'main',
    integration: { id: 'int-1', organizationId: 'org-1' },
    ...overrides,
  });
  const alreadyExists = () =>
    throwError(() => ({
      code: GrpcStatus.ALREADY_EXISTS,
      details: 'A scan is already in progress',
    }));

  beforeEach(async () => {
    built = await buildService();
    service = built.service;
    jest
      .spyOn(service as any, 'verifyWebhookSignature')
      .mockResolvedValue(true);
    (built.gitlabRepositoryRepo.findOne as any).mockResolvedValue(
      linkedRepository(),
    );
    built.projectGet.mockReturnValue(
      of({ scanOnCommitEnabled: true, sastEnabled: true, scaEnabled: true }),
    );
    jest.spyOn(service as any, 'decryptToken').mockResolvedValue('token');
    jest
      .spyOn(service as any, 'getValidAccessToken')
      .mockResolvedValue('token');
    getLatestCommit = jest
      .spyOn(service as any, 'getLatestCommit')
      .mockResolvedValue({ id: 'd'.repeat(40) });
  });

  describe('the push', () => {
    it('records the checked-out commit, and no failed scan, when a scan of the branch is running', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );

      const res = await service.handleWebhook(pushRequest() as any);

      expect(res).toEqual({ success: true });
      expect(built.pendingRescans.record).toHaveBeenCalledTimes(1);
      expect(built.pendingRescans.record).toHaveBeenCalledWith({
        provider: 'gitlab',
        projectId: 'p1',
        branch: 'main',
        commitSha: checkoutSha,
        gitlabRepositoryId: 'repo-1',
      });
      // It used to leave a failed scan "A scan is already in progress".
      expect(built.scanServiceClient.createFailedScan).not.toHaveBeenCalled();
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    });

    it('a refused push of the commit already being scanned writes nothing: no failed scan, no rescan', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );
      built.pendingRescans.record.mockResolvedValue(false);

      const res = await service.handleWebhook(pushRequest() as any);

      expect(res).toEqual({ success: true });
      expect(built.scanServiceClient.createFailedScan).not.toHaveBeenCalled();
      expect(built.loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('WEBHOOK_PUSH_RESCAN_SKIPPED'),
        GitlabService.name,
      );
    });

    it('keeps the former failed scan when the push names no commit (no checkout_sha)', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );
      const withoutCheckoutSha: Record<string, unknown> = { ...pushPayload };
      delete withoutCheckoutSha.checkout_sha;

      await service.handleWebhook(pushRequest(withoutCheckoutSha) as any);

      expect(built.pendingRescans.record).not.toHaveBeenCalled();
      expect(built.scanServiceClient.createFailedScan).toHaveBeenCalledTimes(1);
    });

    it('keeps the former failed scan when the deferral cannot be recorded', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );
      built.pendingRescans.record.mockRejectedValue(new Error('redis down'));

      await service.handleWebhook(pushRequest() as any);

      expect(built.scanServiceClient.createFailedScan).toHaveBeenCalledTimes(1);
    });

    it('defers nothing but a running scan: any other refusal is unchanged', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE, details: 'down' })),
      );

      await service.handleWebhook(pushRequest() as any);

      expect(built.pendingRescans.record).not.toHaveBeenCalled();
      expect(built.scanServiceClient.createFailedScan).toHaveBeenCalledTimes(1);
    });

    it('a push that starts its scan supersedes the pushes refused before it', async () => {
      const before = Date.now();

      await service.handleWebhook(pushRequest() as any);

      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);
      expect(built.pendingRescans.supersede).toHaveBeenCalledTimes(1);
      const [projectId, branch, startedAt, commitSha] =
        built.pendingRescans.supersede.mock.calls[0];
      expect([projectId, branch]).toEqual(['p1', 'main']);
      // The started commit, so a refused push of it is not recorded again.
      expect(commitSha).toBe(checkoutSha);
      expect(startedAt).toBeGreaterThanOrEqual(before);
      expect(
        built.scanServiceClient.checkExistingScan.mock.invocationCallOrder[0],
      ).toBeLessThan(
        built.pendingRescans.supersede.mock.invocationCallOrder[0],
      );
    });

    it('a scan start does not fail because the supersede could not run', async () => {
      built.pendingRescans.supersede.mockRejectedValue(new Error('redis down'));

      await expect(
        service.handleWebhook(pushRequest() as any),
      ).resolves.toEqual({ success: true });
      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);
      expect(built.scanServiceClient.createFailedScan).not.toHaveBeenCalled();
    });

    // A graph-only scan
    // runs no scanner, so it does not stand for the AppSec scan a refused
    // push is waiting for.
    it('a graph-only scan does not supersede the pushes refused before it', async () => {
      // The port decides the link's scan: graph-only for a closed product's link.
      built.entitlements.decideLinkScan.mockReturnValue({
        scan: 'graph_only',
      });

      await service.startScanForLastCommit({
        projectId: 'p1',
        repositoryId: 'repo-1',
        branch: '',
        product: 'vibedefend',
      });

      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);
      expect(built.pendingRescans.supersede).not.toHaveBeenCalled();
    });
  });

  describe('runPendingRescan (the consumer, once the running scan may be over)', () => {
    const entry = {
      provider: 'gitlab' as const,
      projectId: 'p1',
      branch: 'main',
      commitSha: checkoutSha,
      gitlabRepositoryId: 'repo-1',
      recordedAt: 1,
    };

    it('stays busy while a scan of the branch runs, asking nothing else', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe('busy');

      expect(built.projectGet).not.toHaveBeenCalled();
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    });

    it('starts the scan of the branch head', async () => {
      getLatestCommit.mockResolvedValue({ id: checkoutSha });

      await expect(service.runPendingRescan(entry)).resolves.toBe('started');

      expect(getLatestCommit).toHaveBeenCalledTimes(1);
      expect(
        built.scanServiceClient.createScan.mock.calls[0][0],
      ).not.toHaveProperty('isDiffScan');
      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gitlab',
          projectId: 'p1',
          organizationId: 'org-1',
          branch: 'main',
          repositoryId: 'repo-1',
          commitSha: checkoutSha,
          typeScan: 'sast,sca',
        }),
      );
    });

    it('is dropped when scan-on-commit was turned off meanwhile', async () => {
      built.projectGet.mockReturnValue(of({ scanOnCommitEnabled: false }));

      await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    });

    // As on GitHub and as the push itself, an organisation
    // whose AppSec stopped being writable while the push waited gets no
    // AppSec scan from it.
    it('is dropped when the organisation stopped being writable meanwhile', async () => {
      built.entitlements.decidePushScan.mockResolvedValue({
        scan: 'none',
        reason: 'writes_blocked',
      });

      await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

      expect(built.entitlements.decidePushScan).toHaveBeenCalledWith(
        'org-1',
        // The edition reads the project as an AppSec one (the community answer).
        true,
      );
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
      expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
      expect(built.loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'PENDING_RESCAN_DROPPED reason=writes_blocked org=org-1 project=p1',
        ),
        GitlabService.name,
      );
    });

    // An unexpected failure is retried (the TTL bounds it),
    // and a retry must not leave one failed scan row per attempt.
    it('an unexpected failure before the scan exists is checked again later, without a failed scan row', async () => {
      built.scanServiceClient.createScan.mockReturnValue(
        throwError(() => new Error('socket hang up')),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe('busy');
      expect(built.scanServiceClient.createFailedScan).not.toHaveBeenCalled();
    });

    // Once createScan succeeded, a retry would create one
    // more scan, left waiting_for_file, on every attempt.
    it('a queue failure after the scan was created is dropped, and says so', async () => {
      built.repoScanQueue.enqueueRepoScan.mockRejectedValue(
        new Error('Connection is closed.'),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

      expect(built.scanServiceClient.createScan).toHaveBeenCalledTimes(1);
      expect(built.scanServiceClient.createFailedScan).not.toHaveBeenCalled();
      expect(built.loggerMock.log).toHaveBeenCalledWith(
        expect.stringMatching(
          /PENDING_RESCAN_DROPPED reason=enqueue_failed_after_create project=p1 branch=main .*Connection is closed/,
        ),
        GitlabService.name,
      );
    });

    // The SHA claimed may be stale by the time the branch is
    // free. The head is read from GitLab when the rescan starts.
    describe('the commit it scans', () => {
      it('scans the head when a newer commit was pushed after the claim', async () => {
        const newer = 'f'.repeat(40);
        getLatestCommit.mockResolvedValue({ id: newer });

        await expect(service.runPendingRescan(entry)).resolves.toBe('started');

        expect(getLatestCommit).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 'org-1' }),
          4242,
          'main',
        );
        expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
          expect.objectContaining({ commitSha: newer }),
        );
      });

      it('out of order: an older push refused after the newer one started is not rescanned', async () => {
        const newer = 'f'.repeat(40);
        getLatestCommit.mockResolvedValue({ id: newer });
        built.pendingRescans.startedCommit.mockResolvedValue(newer);

        await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
        expect(built.loggerMock.log).toHaveBeenCalledWith(
          expect.stringContaining('reason=already_scanned'),
          GitlabService.name,
        );
      });

      it('a branch gone from GitLab (404) is dropped', async () => {
        getLatestCommit.mockRejectedValue(
          Object.assign(new Error('Not Found'), {
            response: { status: 404 },
          }),
        );

        await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
        expect(built.loggerMock.log).toHaveBeenCalledWith(
          expect.stringMatching(
            /PENDING_RESCAN_DROPPED reason=branch_head_unavailable project=p1 branch=main/,
          ),
          GitlabService.name,
        );
      });

      it('GitLab unreachable is checked again later', async () => {
        getLatestCommit.mockRejectedValue(
          new RpcException({
            code: GrpcStatus.UNAVAILABLE,
            message: 'Network error connecting to GitLab',
          }),
        );

        await expect(service.runPendingRescan(entry)).resolves.toBe('busy');
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
      });
    });

    it.each([
      ['unlinked', null],
      ['linked to another project', linkedRepository({ projectId: 'p2' })],
      ['scanning another branch', linkedRepository({ scanBranch: 'develop' })],
    ])(
      'is dropped when the repository was %s meanwhile',
      async (_label, repository) => {
        (built.gitlabRepositoryRepo.findOne as any).mockResolvedValue(
          repository,
        );

        await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
      },
    );

    it.each([
      [GrpcStatus.ALREADY_EXISTS, 'busy'],
      [GrpcStatus.UNAVAILABLE, 'busy'],
      [GrpcStatus.INTERNAL, 'busy'],
      [GrpcStatus.NOT_FOUND, 'dropped'],
    ])('a scan creation failing with gRPC %i is %s', async (code, outcome) => {
      built.scanServiceClient.createScan.mockReturnValue(
        throwError(() => ({ code, details: 'refused' })),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe(outcome);
      expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// A failed repository download must reach the scan WITH a reason
// ---------------------------------------------------------------------------

describe('GitlabService — repo download failure reporting', () => {
  let service: GitlabService;
  let scanServiceClient: ScanServiceClientMock;
  let tmpDir: string;

  const integration = {
    id: 'integration-id',
    organizationId: 'org-123',
    accessToken: 'encrypted-token',
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  } as GitlabIntegration;

  const repository = {
    id: 'repo-id',
    gitlabId: 42,
    name: 'my-project',
    pathWithNamespace: 'mygroup/my-project',
    projectId: 'project-1',
    integration,
  } as GitlabRepository;

  /** An axios rejection shaped exactly like a failed streaming request. */
  function axiosFailure(
    httpStatus: number,
    headers: Record<string, string> = {},
  ): Error {
    return Object.assign(
      new Error(`Request failed with status code ${httpStatus}`),
      {
        isAxiosError: true,
        response: { status: httpStatus, headers, data: Readable.from([]) },
      },
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    scanServiceClient = built.scanServiceClient;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-dl-failure-'));
    // Only the archive is under test: no token for the history fetch.
    jest
      .spyOn(service as any, 'getRefreshedAccessToken')
      .mockResolvedValue(null);
    // Only the retry sleeps are virtualized; the stream/fs plumbing stays real.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    mockedAxios.get.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retries the archive download on 429 and finally throws the rate-limited code 67', async () => {
    jest
      .spyOn(service as any, 'callGitlabApi')
      .mockImplementation((...args: unknown[]) =>
        (args[1] as (token: string) => Promise<unknown>)('gl-token'),
      );
    mockedAxios.get.mockRejectedValue(
      axiosFailure(429, { 'retry-after': '1' }),
    );

    const promise = service['downloadRepositoryArchive'](
      integration,
      42,
      'sha-429',
      path.join(tmpDir, 'archive.zip'),
    );
    const assertion = expect(promise).rejects.toMatchObject({
      code: SCAN_FAILURE_SOURCE_RATE_LIMITED,
      attempts: 3,
    });

    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining(
        '/projects/42/repository/archive.zip?sha=sha-429',
      ),
      expect.objectContaining({ responseType: 'stream', timeout: 30_000 }),
    );
  });

  it('reports a rate-limited archive download through updateScanData with code 67, never through the container updateScan RPC', async () => {
    jest.spyOn(service as any, 'generateTempPaths').mockReturnValue({
      tmpPath: path.join(tmpDir, 'input.zip'),
      cleanedPath: path.join(tmpDir, 'cleaned.zip'),
    });
    jest
      .spyOn(service as any, 'downloadRepositoryArchive')
      .mockRejectedValue(
        new ArchiveDownloadError(
          'GitLab archive download failed after 3 attempts: rate limit exceeded (HTTP 429)',
          SCAN_FAILURE_SOURCE_RATE_LIMITED,
          3,
          429,
        ),
      );

    await service['downloadAndUploadInBackground'](
      repository,
      'sha-429',
      'scan-gl-429',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-gl-429',
      state: 'failed',
      errorMessage: expect.stringContaining('rate limit'),
      errorCode: SCAN_FAILURE_SOURCE_RATE_LIMITED,
    });
  });

  it('reports any other download failure with code 66', async () => {
    jest.spyOn(service as any, 'generateTempPaths').mockReturnValue({
      tmpPath: path.join(tmpDir, 'input.zip'),
      cleanedPath: path.join(tmpDir, 'cleaned.zip'),
    });
    jest
      .spyOn(service as any, 'downloadRepositoryArchive')
      .mockRejectedValue(new Error('socket hang up'));

    await service['downloadAndUploadInBackground'](
      repository,
      'sha-boom',
      'scan-gl-boom',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-gl-boom',
      state: 'failed',
      errorMessage: 'socket hang up',
      errorCode: SCAN_FAILURE_SOURCE_FETCH_FAILED,
    });
  });

  it('reports a terminal queue failure through updateScanData with code 66', async () => {
    await service.markScanFailedFromJob(
      'scan-queue',
      'Repository download failed after 3 attempts',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-queue',
      state: 'failed',
      errorMessage: 'Repository download failed after 3 attempts',
      errorCode: SCAN_FAILURE_SOURCE_FETCH_FAILED,
    });
  });

  /** Wire the background flow so only the archive's size/shape can fail. */
  function stubFlowWithArchive(write?: (tmpPath: string) => void): string {
    const tmpPath = path.join(tmpDir, 'input.zip');
    jest.spyOn(service as any, 'generateTempPaths').mockReturnValue({
      tmpPath,
      cleanedPath: path.join(tmpDir, 'cleaned.zip'),
    });
    jest
      .spyOn(service as any, 'downloadRepositoryArchive')
      .mockImplementation(() => {
        write?.(tmpPath);
        return Promise.resolve();
      });
    return tmpPath;
  }

  // There is no post-download gate on the COMPRESSED size any more, so the
  // over-sized-archive test that lived here (a sparse 6 GB file expecting
  // 'File size exceeds the 5GB limit' with code 68) no longer describes any
  // behaviour. Size is now gated on the UNCOMPRESSED total inside
  // `runZipProcessing` — that rejection arrives at the zip-processing catch
  // below, which still reports code 68. See `core/utils/zip-size-gate.spec.ts`.

  it('reports an archive that is not a ZIP with code 68', async () => {
    stubFlowWithArchive((tmpPath) =>
      fs.writeFileSync(tmpPath, Buffer.from([0x00, 0x00, 0x00, 0x00])),
    );

    await service['downloadAndUploadInBackground'](
      repository,
      'sha-not-zip',
      'scan-gl-not-zip',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-gl-not-zip',
      state: 'failed',
      errorMessage:
        'Invalid archive format received from GitLab. Expected ZIP file.',
      errorCode: 68,
    });
  });

  it('reports a ZIP that cannot be processed with code 68', async () => {
    stubFlowWithArchive((tmpPath) =>
      fs.writeFileSync(tmpPath, Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    );
    jest
      .spyOn(service as any, 'processZipInWorker')
      .mockRejectedValue(new Error('No END header found'));

    await service['downloadAndUploadInBackground'](
      repository,
      'sha-bad-zip',
      'scan-gl-bad-zip',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-gl-bad-zip',
      state: 'failed',
      errorMessage: 'Failed to process archive: No END header found',
      errorCode: 68,
    });
  });

  it('still never throws when the scan-level report itself fails', async () => {
    scanServiceClient.updateScanData.mockReturnValue(
      throwError(() => ({
        code: GrpcStatus.NOT_FOUND,
        details: 'Scan not found',
      })),
    );

    await expect(
      service.markScanFailedFromJob('scan-gone', 'boom'),
    ).resolves.toBeUndefined();
  });
});

// Repository history (read by a closed rule miner): every GitLab call goes
// through callGitlabApi, which holds the Redis-locked token refresh.
describe('GitlabService - repository history', () => {
  let service: GitlabService;
  let callSpy: jest.SpyInstance;
  const integration = { id: 'int-1', organizationId: 'org-1' };
  const repoEntity = {
    id: 'repo-1',
    gitlabId: 77,
    projectId: 'p1',
    integration,
  } as unknown as GitlabRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
    ({ service } = await buildService());
    callSpy = jest
      .spyOn<any, any>(service as any, 'callGitlabApi')
      .mockImplementation(async (_integ: any, fn: any) => fn('tok'));
  });

  it('lists commits through callGitlabApi with ref_name, path and paging, without any author field', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'a'.repeat(40),
          short_id: 'aaaaaaa',
          message: 'feat: x\n\nbody',
          committed_date: '2026-10-01T10:00:00.000+02:00',
          author_name: 'Jane',
          author_email: 'jane@example.com',
          committer_email: 'jane@example.com',
        },
      ],
      headers: {},
    });

    const commits = await service.listCommitsForRepository(repoEntity, {
      branch: 'dev',
      path: 'src/app.ts',
      page: 3,
      perPage: 20,
    });

    expect(commits).toEqual([
      {
        sha: 'a'.repeat(40),
        date: '2026-10-01T10:00:00.000+02:00',
        message: 'feat: x\n\nbody',
      },
    ]);
    expect(callSpy).toHaveBeenCalledWith(integration, expect.any(Function));
    const [url, config] = mockedAxios.get.mock.calls[0];
    expect(url).toBe(
      'https://gitlab.com/api/v4/projects/77/repository/commits',
    );
    expect(config.params).toEqual({
      ref_name: 'dev',
      path: 'src/app.ts',
      page: 3,
      per_page: 20,
    });
    expect(config.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(config.timeout).toBe(15_000);
  });

  it('omits ref_name and path when empty', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [], headers: {} });
    await service.listCommitsForRepository(repoEntity, {
      branch: '',
      path: '',
      page: 1,
      perPage: 100,
    });
    expect(mockedAxios.get.mock.calls[0][1].params).toEqual({
      page: 1,
      per_page: 100,
    });
  });

  it('reads one commit and its diff, deriving the status and counting lines', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          id: 'b'.repeat(40),
          message: 'fix: y',
          committed_date: '2026-10-02T10:00:00Z',
          author_email: 'x@example.com',
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: [
          {
            new_path: 'src/new.ts',
            old_path: 'src/old.ts',
            new_file: false,
            deleted_file: false,
            renamed_file: true,
            diff: '@@ -1,2 +1,2 @@\n-a\n-b\n+c\n context\n',
          },
          {
            new_path: 'added.ts',
            old_path: 'added.ts',
            new_file: true,
            deleted_file: false,
            renamed_file: false,
            diff: '@@ -0,0 +1 @@\n+x\n',
          },
          {
            new_path: 'gone.ts',
            old_path: 'gone.ts',
            new_file: false,
            deleted_file: true,
            renamed_file: false,
            diff: '@@ -1 +0,0 @@\n-x\n',
          },
          {
            new_path: 'm.ts',
            old_path: 'm.ts',
            new_file: false,
            deleted_file: false,
            renamed_file: false,
            diff: '',
          },
        ],
        headers: { 'x-next-page': '' },
      });

    const commit = await service.getCommitForRepository(repoEntity, 'bbbbbbb');

    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      'https://gitlab.com/api/v4/projects/77/repository/commits/bbbbbbb',
    );
    expect(mockedAxios.get.mock.calls[1][0]).toBe(
      'https://gitlab.com/api/v4/projects/77/repository/commits/bbbbbbb/diff',
    );
    expect(callSpy).toHaveBeenCalledTimes(2);
    expect(commit).toEqual({
      sha: 'b'.repeat(40),
      date: '2026-10-02T10:00:00Z',
      message: 'fix: y',
      moreFiles: false,
      files: [
        {
          path: 'src/new.ts',
          oldPath: 'src/old.ts',
          status: 'renamed',
          additions: 1,
          deletions: 2,
          patch: '@@ -1,2 +1,2 @@\n-a\n-b\n+c\n context\n',
        },
        {
          path: 'added.ts',
          oldPath: '',
          status: 'added',
          additions: 1,
          deletions: 0,
          patch: '@@ -0,0 +1 @@\n+x\n',
        },
        {
          path: 'gone.ts',
          oldPath: '',
          status: 'removed',
          additions: 0,
          deletions: 1,
          patch: '@@ -1 +0,0 @@\n-x\n',
        },
        {
          path: 'm.ts',
          oldPath: '',
          status: 'modified',
          additions: 0,
          deletions: 0,
          patch: '',
        },
      ],
    });
  });

  it('follows the diff pages up to 3 and flags more files beyond', async () => {
    const page = (n: number) =>
      Array.from({ length: 100 }, (_, i) => ({
        new_path: `p${n}-${i}`,
        old_path: `p${n}-${i}`,
        diff: '',
      }));
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { id: 'c'.repeat(40), message: 'm', committed_date: 'd' },
        headers: {},
      })
      .mockResolvedValueOnce({ data: page(1), headers: { 'x-next-page': '2' } })
      .mockResolvedValueOnce({ data: page(2), headers: { 'x-next-page': '3' } })
      .mockResolvedValueOnce({
        data: page(3),
        headers: { 'x-next-page': '4' },
      });

    const commit = await service.getCommitForRepository(repoEntity, 'ccccccc');

    expect(mockedAxios.get).toHaveBeenCalledTimes(4);
    expect(mockedAxios.get.mock.calls[3][1].params).toEqual({
      page: 3,
      per_page: 100,
    });
    expect(commit.files).toHaveLength(300);
    expect(commit.moreFiles).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findBranch: a container scan's branch must exist in the repo
// ---------------------------------------------------------------------------

describe('GitlabService.findBranch', () => {
  let service: GitlabService;
  let gitlabBranchRepo: any;
  let loggerMock: any;
  let callGitlabApi: jest.SpyInstance;

  const repository = {
    id: 'repo-1',
    gitlabId: 4242,
    pathWithNamespace: 'acme/frontend',
    defaultBranch: 'main',
    branchesSyncedAt: new Date('2026-01-01'),
    integration: { id: 'int-1', organizationId: 'org-1' },
  } as unknown as GitlabRepository;

  /** An axios error as GitLab answers it. */
  const gitlabError = (httpStatus: number, message: string) => ({
    isAxiosError: true,
    response: { status: httpStatus, data: { message } },
    message: `Request failed with status code ${httpStatus}`,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    gitlabBranchRepo = built.gitlabBranchRepo;
    loggerMock = built.loggerMock;
    callGitlabApi = jest
      .spyOn<any, any>(service as any, 'callGitlabApi')
      .mockImplementation((_integration: unknown, apiCall: any) =>
        apiCall('valid-token'),
      );
    mockedAxios.isAxiosError.mockImplementation((e: any) => !!e?.isAxiosError);
  });

  it('answers from the synced branches, with their own spelling, without asking GitLab', async () => {
    gitlabBranchRepo.findOne.mockResolvedValue({ id: 'b1', name: 'develop' });

    await expect(service.findBranch(repository, 'Develop')).resolves.toBe(
      'develop',
    );

    expect(gitlabBranchRepo.findOne).toHaveBeenCalledWith({
      where: { repositoryId: 'repo-1', name: 'Develop' },
    });
    expect(callGitlabApi).not.toHaveBeenCalled();
  });

  it('asks GitLab for a branch the webhooks have not brought yet, and keeps it', async () => {
    gitlabBranchRepo.findOne.mockResolvedValue(null);
    mockedAxios.get.mockResolvedValueOnce({
      data: { name: 'feature/new', protected: true },
    });

    await expect(service.findBranch(repository, 'feature/new')).resolves.toBe(
      'feature/new',
    );

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/4242/repository/branches/feature%2Fnew',
      { headers: { Authorization: 'Bearer valid-token' } },
    );
    expect(gitlabBranchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'feature/new', isProtected: true },
      { conflictPaths: ['repositoryId', 'name'] },
    );
  });

  it('still answers the branch when keeping it fails: GitLab has confirmed it', async () => {
    gitlabBranchRepo.findOne.mockResolvedValue(null);
    gitlabBranchRepo.upsert.mockRejectedValueOnce(
      new Error('ER_LOCK_WAIT_TIMEOUT'),
    );
    mockedAxios.get.mockResolvedValueOnce({
      data: { name: 'feature/new', protected: false },
    });

    await expect(service.findBranch(repository, 'feature/new')).resolves.toBe(
      'feature/new',
    );
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('is null when GitLab answers "404 Branch Not Found": an image tag is not a branch', async () => {
    gitlabBranchRepo.findOne.mockResolvedValue(null);
    mockedAxios.get.mockRejectedValueOnce(
      gitlabError(404, '404 Branch Not Found'),
    );

    await expect(
      service.findBranch(repository, 'v2.102.0'),
    ).resolves.toBeNull();
    expect(gitlabBranchRepo.upsert).not.toHaveBeenCalled();
  });

  it('is FAILED_PRECONDITION, not a missing branch, when GitLab cannot see the project', async () => {
    gitlabBranchRepo.findOne.mockResolvedValue(null);
    mockedAxios.get.mockRejectedValueOnce(
      gitlabError(404, '404 Project Not Found'),
    );

    await expect(
      service.findBranch(repository, 'develop'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({
        code: GrpcStatus.FAILED_PRECONDITION,
        message: expect.stringContaining('acme/frontend'),
      }),
    });
  });

  it('is UNAVAILABLE, never null, when GitLab cannot be asked', async () => {
    gitlabBranchRepo.findOne.mockResolvedValue(null);
    mockedAxios.get.mockRejectedValueOnce(gitlabError(502, 'Bad gateway'));

    await expect(
      service.findBranch(repository, 'develop'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAVAILABLE }),
    });
  });
});

// With GITLAB_API_URL pointing at a self-managed instance, every
// GitLab URL (API, OAuth, clone) is derived from it instead of gitlab.com.
describe('GitlabService on a self-managed GitLab', () => {
  const SELF_MANAGED = 'https://git.acme.test/api/v4';

  const makeIntegration = () =>
    ({
      id: 'int-1',
      organizationId: 'org-1',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    }) as GitlabIntegration;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exchanges the code on the configured instance', async () => {
    const { service } = await buildService({ GITLAB_API_URL: SELF_MANAGED });
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 7200,
        scope: 'api',
      },
    });

    await (service as any).exchangeCodeForToken('code-abc');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://git.acme.test/oauth/token',
      expect.objectContaining({
        grant_type: 'authorization_code',
        code: 'code-abc',
      }),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('revokes on the configured instance', async () => {
    const { service } = await buildService({ GITLAB_API_URL: SELF_MANAGED });
    mockedAxios.post.mockResolvedValueOnce({ data: {} });

    const revoked = await (service as any).revokeAccessToken('token-123');

    expect(revoked).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://git.acme.test/oauth/revoke',
      expect.any(URLSearchParams),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('lists projects on the configured instance', async () => {
    const { service } = await buildService({ GITLAB_API_URL: SELF_MANAGED });
    jest
      .spyOn<any, any>(service as any, 'decryptToken')
      .mockResolvedValue('valid-access-token');
    mockedAxios.get.mockResolvedValueOnce({
      data: [],
      headers: { 'x-next-page': '' },
    });

    await (service as any).fetchUserProjects(makeIntegration());

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/git\.acme\.test\/api\/v4\/projects\?membership=true/,
      ),
      expect.objectContaining({
        headers: { Authorization: 'Bearer valid-access-token' },
      }),
    );
  });
});
