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
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { GitlabService } from './gitlab.service';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import SecretsService from '../../core/secrets/secrets.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import { RepoHistoryService } from '../repo-scan-queue/git-history/repo-history.service';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { CommunityEntitlements } from '../../edition/community/entitlements.community';
import { PendingRescanStore } from '../pending-rescan/pending-rescan.store';

jest.mock('axios');

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
async function buildService(): Promise<{
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
  pendingRescans: {
    record: jest.Mock;
    supersede: jest.Mock;
    startedCommit: jest.Mock;
  };
}> {
  const config = new Map<string, string>();
  config.set('FRONTEND_URL', 'https://app.example.com');
  config.set('GATEWAY_URL', 'https://app.example.com');

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
        useValue: {
          getService: jest.fn(() => ({
            uploadFile: jest.fn(() =>
              of({ url: 'https://storage.example.com/signed-url' }),
            ),
          })),
        },
      },
      {
        provide: RepoScanQueueService,
        useValue: repoScanQueue,
      },
      { provide: ENTITLEMENTS_PORT, useValue: new CommunityEntitlements() },
      { provide: PendingRescanStore, useValue: pendingRescans },
      {
        provide: RepoHistoryService,
        useValue: {
          prepare: jest.fn(),
          publish: jest.fn(),
          cleanup: jest.fn(),
        },
      },
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
  };
}

// ---------------------------------------------------------------------------
// Community Edition: a push or a link starts no scan, but branches
// and webhooks still sync.
// ---------------------------------------------------------------------------

describe('GitlabService in the Community Edition', () => {
  let built: Awaited<ReturnType<typeof buildService>>;
  let service: GitlabService;

  const checkoutSha = 'e'.repeat(40);
  const pushRequest = () => ({
    bodyJson: JSON.stringify({
      object_kind: 'push',
      ref: 'refs/heads/main',
      before: 'a'.repeat(40),
      after: checkoutSha,
      checkout_sha: checkoutSha,
      project: { id: 4242 },
    }),
    gitlabToken: 'secret',
    event: 'Push Hook',
  });
  const linkedRepository = {
    id: 'repo-1',
    gitlabId: 4242,
    projectId: 'p1',
    name: 'widgets',
    scanBranch: 'main',
    defaultBranch: 'main',
    integration: { id: 'int-1', organizationId: 'org-1' },
  };

  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setImmediate(r));
    }
  };

  beforeEach(async () => {
    built = await buildService();
    service = built.service;
    jest
      .spyOn(service as any, 'verifyWebhookSignature')
      .mockResolvedValue(true);
    (built.gitlabRepositoryRepo.findOne as any).mockResolvedValue(
      linkedRepository,
    );
    built.projectGet.mockReturnValue(
      of({ scanOnCommitEnabled: true, sastEnabled: true, scaEnabled: true }),
    );
  });

  it('a push logs WEBHOOK_IGNORED_COMMUNITY_EDITION and starts no scan', async () => {
    const res = await service.handleWebhook(pushRequest() as any);

    expect(res).toEqual({ success: true });
    expect(built.loggerMock.log).toHaveBeenCalledWith(
      expect.stringMatching(/^WEBHOOK_IGNORED_COMMUNITY_EDITION org=org-1 /),
      GitlabService.name,
    );
    expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
  });

  it('a push still updates the branch', async () => {
    await service.handleWebhook(pushRequest() as any);

    expect(built.gitlabBranchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'main', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
  });

  it('a link saves the repository, still creates the webhook, and logs LINK_SCAN_SKIPPED', async () => {
    (built.gitlabRepositoryRepo.findOne as any).mockResolvedValue({
      ...linkedRepository,
      projectId: null,
      scanBranch: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      integration: { id: 'int-1', organizationId: 'o1', accessToken: 'enc' },
    });
    (built.gitlabRepositoryRepo.save as any).mockImplementation(
      async (r: unknown) => r,
    );
    const webhook = jest
      .spyOn(service as any, 'createProjectWebhook')
      .mockResolvedValue(undefined);
    const initialScan = jest
      .spyOn(service, 'startScanForLastCommit')
      .mockResolvedValue({
        success: true,
        message: '',
        scanId: 's1',
        detectedLanguages: [],
      });

    await service.linkProjectToRepository({
      repositoryId: 'repo-1',
      projectId: 'p1',
      organizationId: 'o1',
      scanBranch: '',
    } as any);
    await flush();

    expect(built.gitlabRepositoryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
    );
    expect(webhook).toHaveBeenCalled();
    expect(built.loggerMock.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^LINK_SCAN_SKIPPED reason=community_edition repo=repo-1 project=p1/,
      ),
      GitlabService.name,
    );
    expect(initialScan).not.toHaveBeenCalled();
  });

  it('a deferred rescan is dropped', async () => {
    const entry = {
      provider: 'gitlab' as const,
      projectId: 'p1',
      branch: 'main',
      commitSha: checkoutSha,
      gitlabRepositoryId: 'repo-1',
      recordedAt: 1,
    };

    await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

    expect(built.loggerMock.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^PENDING_RESCAN_DROPPED reason=community_edition org=org-1/,
      ),
      GitlabService.name,
    );
    expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
  });

  it('a manual scan is refused', async () => {
    const decrypt = jest.spyOn(service as any, 'decryptToken');

    await expect(
      service.startScanForLastCommit({
        projectId: 'p1',
        repositoryId: 'repo-1',
        branch: '',
      } as any),
    ).rejects.toMatchObject({
      error: {
        code: GrpcStatus.FAILED_PRECONDITION,
        message: 'SCANNERS_NOT_AVAILABLE',
      },
    });
    // Refused before any download: the repository is not even read.
    expect(built.gitlabRepositoryRepo.findOne).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });
});
