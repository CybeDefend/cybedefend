jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));

const mockOctokitInstance = { request: jest.fn() };
const MockOctokit = jest.fn().mockImplementation(() => mockOctokitInstance);
(MockOctokit as any).plugin = jest.fn().mockReturnValue(MockOctokit);

jest.mock('@octokit/rest', () => ({
  Octokit: MockOctokit,
}));
jest.mock('@octokit/plugin-retry', () => ({
  retry: jest.fn(),
}));
jest.mock('@octokit/plugin-throttling', () => ({
  throttling: jest.fn(),
}));

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
import { status as GrpcStatus } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { of } from 'rxjs';
import { GithubService } from './github.service';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubBranch } from '../../entities/github-branch.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { ConfigService } from '@nestjs/config';
import SecretsService from '../../core/secrets/secrets.service';
import { Logger } from 'nestjs-pino';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import { RepoHistoryService } from '../repo-scan-queue/git-history/repo-history.service';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { PRODUCT_LINKS_PORT } from '../../edition/ports/product-links.port';
import { CommunityEntitlements } from '../../edition/community/entitlements.community';
import { PendingRescanStore } from '../pending-rescan/pending-rescan.store';

class FakeSecrets extends (SecretsService as any) {
  private cache = new Map<string, string>();
  getSecret(key: string) {
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

/** One multi-row INSERT … ON DUPLICATE KEY UPDATE issued on github_branches. */
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

/** Build a NestJS test module and return a compiled GithubService instance. */
async function buildService(): Promise<{
  service: GithubService;
  repoIntegration: any;
  repoRepo: any;
  branchRepo: any;
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
  const gmConfig = new Map<string, string>();
  gmConfig.set('GATEWAY_URL', 'https://gw.example.com');

  const secrets = new FakeSecrets();
  secrets.setSecret('GITHUB_APP_ID', '1');
  secrets.setSecret('GITHUB_PRIVATE_KEY', 'fake');
  secrets.setSecret('GITHUB_CLIENT_ID', 'cid');
  secrets.setSecret('GITHUB_CLIENT_SECRET', 'csecret');

  const loggerMock = createLoggerMock();

  const repoIntegration = createMockRepository();
  const repoRepo = createMockRepository();
  const branchRepo = createMockRepository();

  // Default fluent createQueryBuilder for branch repo (used for orphan delete).
  (branchRepo.createQueryBuilder as any) = jest.fn(() => ({
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  }));

  // upsert is not in createMockRepository by default — add it for branch repo.
  (branchRepo as any).upsert = jest.fn().mockResolvedValue(undefined);

  // DataSource stub — transaction(cb) executes cb with a manager whose
  // getRepository(entity) returns the appropriate mock repo, and whose query
  // builder records the branch upserts.
  const branchInserts: BranchInsert[] = [];
  const dataSource = {
    transaction: jest.fn(async (cb: any) =>
      cb({
        getRepository: (entity: any) => {
          if (entity === GithubBranch) return branchRepo;
          if (entity === GithubRepository) return repoRepo;
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

  // Project settings served by global-management. scanOnCommitEnabled is left
  // absent by default so the fail-open path is what every unrelated test sees.
  const projectGet = jest.fn(() =>
    of({ sastEnabled: true, iacEnabled: false, scaEnabled: true }),
  );

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
      GithubService,
      {
        provide: getRepositoryToken(GithubIntegration),
        useValue: repoIntegration,
      },
      {
        provide: getRepositoryToken(GithubRepository),
        useValue: repoRepo,
      },
      {
        provide: getRepositoryToken(GithubBranch),
        useValue: branchRepo,
      },
      { provide: DataSource, useValue: dataSource },
      {
        provide: ConfigService,
        useValue: { get: (k: string) => gmConfig.get(k) },
      },
      { provide: SecretsService, useValue: secrets },
      { provide: Logger, useValue: loggerMock },
      { provide: ENTITLEMENTS_PORT, useValue: new CommunityEntitlements() },
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
        provide: 'GLOBAL_MANAGEMENT_SERVICE',
        useValue: {
          getService: jest.fn(() => ({ get: projectGet })),
        },
      },
      {
        provide: RepoScanQueueService,
        useValue: repoScanQueue,
      },
      { provide: PendingRescanStore, useValue: pendingRescans },
      {
        provide: RepoHistoryService,
        useValue: {
          prepare: jest.fn(),
          publish: jest.fn(),
          cleanup: jest.fn(),
        },
      },
      {
        provide: PRODUCT_LINKS_PORT,
        useValue: {
          ticketFooterUrl: () => 'https://appsec.example.org',
          githubInstallReturnUri: () => 'https://appsec.example.org',
        },
      },
    ],
  }).compile();

  const service = module.get(GithubService);
  await (service as any).onModuleInit?.();

  return {
    service,
    pendingRescans,
    repoIntegration,
    repoRepo,
    branchRepo,
    dataSource,
    branchInserts,
    loggerMock,
    repoScanQueue,
    projectGet,
    scanServiceClient,
  };
}

// ---------------------------------------------------------------------------
// Community Edition: a push or a link starts no scan, but branches
// and webhooks still sync.
// ---------------------------------------------------------------------------

describe('GithubService in the Community Edition', () => {
  let built: Awaited<ReturnType<typeof buildService>>;
  let service: GithubService;

  const pushedSha = 'd'.repeat(40);
  const pushRequest = () => ({
    bodyJson: JSON.stringify({
      installation: { id: 999 },
      ref: 'refs/heads/main',
      after: pushedSha,
      repository: { id: 12345, default_branch: 'main' },
    }),
    signature: 'sha256=fake',
    event: 'push',
    action: '',
  });
  const linkedRepository = {
    id: 'repo-1',
    githubId: 12345,
    projectId: 'p1',
    scanBranch: 'main',
    fullName: 'acme/widgets',
    integration: { installationId: 999, organizationId: 'org-1' },
  };

  beforeEach(async () => {
    built = await buildService();
    service = built.service;
    jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
    built.repoIntegration.findOneBy = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-1' });
    (built.repoRepo.findOne as any).mockResolvedValue(linkedRepository);
    built.projectGet.mockReturnValue(
      of({ scanOnCommitEnabled: true, sastEnabled: true, scaEnabled: true }),
    );
  });

  it('a push logs WEBHOOK_IGNORED_COMMUNITY_EDITION and starts no scan', async () => {
    const res = await service.handleWebhookEvent(pushRequest() as any);

    expect(res).toEqual({ success: true });
    expect(built.loggerMock.log).toHaveBeenCalledWith(
      expect.stringMatching(/^WEBHOOK_IGNORED_COMMUNITY_EDITION org=org-1 /),
    );
    expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
  });

  it('a push still updates the branch', async () => {
    // Branch tracking goes through the same webhook entry point: a
    // branch-lifecycle event still upserts the branch row.
    (built.repoRepo.findOne as any).mockResolvedValue({
      id: 'repo-1',
      githubId: 999,
      fullName: 'org/cool-repo',
      defaultBranch: 'main',
    });

    await service.handleWebhookEvent({
      bodyJson: JSON.stringify({
        ref: 'feature/foo',
        ref_type: 'branch',
        repository: { id: 999 },
        installation: { id: 999 },
      }),
      signature: 'sha256=fake',
      event: 'create',
      action: '',
    } as any);

    expect(built.branchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'feature/foo', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
  });

  it('a link saves the repository and logs LINK_SCAN_SKIPPED', async () => {
    (built.repoRepo.findOne as any)
      .mockResolvedValueOnce({
        id: 'r1',
        githubId: 123,
        name: 'repository',
        fullName: 'owner/repository',
        private: true,
        projectId: null,
        scanBranch: null,
        defaultBranch: 'main',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        integration: { organizationId: 'o1', installationId: 77 },
      })
      .mockResolvedValueOnce(null);
    (built.repoRepo.save as any).mockImplementation(async (r: unknown) => r);
    const initialScan = jest
      .spyOn(service, 'startScanForLastCommitAndProject')
      .mockResolvedValue({
        success: true,
        message: '',
        scanId: 's1',
        detectedLanguages: [],
      });

    const res = await service.linkProject({
      repositoryId: 'r1',
      projectId: 'p1',
      organizationId: 'o1',
      scanBranch: '',
    } as any);

    expect(res.projectId).toBe('p1');
    expect(built.repoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
    );
    expect(built.loggerMock.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^LINK_SCAN_SKIPPED reason=community_edition repo=r1 project=p1/,
      ),
    );
    expect(initialScan).not.toHaveBeenCalled();
  });

  it('a deferred rescan is dropped', async () => {
    const entry = {
      provider: 'github' as const,
      projectId: 'p1',
      branch: 'main',
      commitSha: pushedSha,
      githubRepositoryId: 12345,
      recordedAt: 1,
    };

    await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

    expect(built.loggerMock.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^PENDING_RESCAN_DROPPED reason=community_edition org=org-1/,
      ),
    );
    expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
  });

  it('a manual scan is refused', async () => {
    const startForCommit = jest.spyOn(service, 'startScanForCommitAndProject');

    await expect(
      service.startScanForLastCommitAndProject({
        repositoryId: 'r1',
        projectId: 'p1',
        branch: '',
      } as any),
    ).rejects.toMatchObject({
      error: {
        code: GrpcStatus.FAILED_PRECONDITION,
        message: 'SCANNERS_NOT_AVAILABLE',
      },
    });
    // Refused before any download: the repository is not even read.
    expect(built.repoRepo.findOne).not.toHaveBeenCalled();
    expect(startForCommit).not.toHaveBeenCalled();
  });
});
