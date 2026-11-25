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
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { of, throwError } from 'rxjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';
import axios from 'axios';
import { GithubService } from './github.service';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubBranch } from '../../entities/github-branch.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { ConfigService } from '@nestjs/config';
import SecretsService from '../../core/secrets/secrets.service';
import { Logger } from 'nestjs-pino';
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
import { PRODUCT_LINKS_PORT } from '../../edition/ports/product-links.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';
import { PendingRescanStore } from '../pending-rescan/pending-rescan.store';
import Redis from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');

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
  entitlements: jest.Mocked<EntitlementsPort>;
  repoScanQueue: { enqueueRepoScan: jest.Mock; getQueueBacklog: jest.Mock };
  projectGet: jest.Mock;
  scanServiceClient: ScanServiceClientMock;
  fileServiceClient: { uploadFile: jest.Mock };
  repoHistory: RepoHistoryMock;
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

  // The port double: the AppSec path by default, so the blocks that stay
  // keep their behaviour (the product blocks live in the closed edition).
  const entitlements = entitlementsMock();

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
      { provide: ENTITLEMENTS_PORT, useValue: entitlements },
      {
        provide: 'SECURITY_SCANNING_SERVICE',
        useValue: { getService: jest.fn(() => scanServiceClient) },
      },
      {
        provide: 'FILE_MANAGEMENT_SERVICE',
        useValue: { getService: jest.fn(() => fileServiceClient) },
      },
      {
        provide: 'GLOBAL_MANAGEMENT_SERVICE',
        useValue: {
          getService: jest.fn(() => ({ get: projectGet })),
        },
      },
      { provide: RepoHistoryService, useValue: repoHistory },
      {
        provide: RepoScanQueueService,
        useValue: repoScanQueue,
      },
      { provide: PendingRescanStore, useValue: pendingRescans },
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
    entitlements,
    projectGet,
    scanServiceClient,
    fileServiceClient,
    repoHistory,
  };
}

// ---------------------------------------------------------------------------
// Helpers for filesystem fixtures
// ---------------------------------------------------------------------------

/** Create a fake GitHub-style zipball (entries under a top-level dir). */
function createFakeGithubZip(tmpDir: string): string {
  const zipPath = path.join(tmpDir, 'input.zip');
  const zip = new AdmZip();
  zip.addFile('top-abc123/src/app.js', Buffer.from('console.log("hello")'));
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

describe('GithubService', () => {
  let service: GithubService;
  let repoIntegration: any;
  let repoRepo: any;
  let loggerMock: ReturnType<typeof createLoggerMock>;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoRepo = built.repoRepo;
    loggerMock = built.loggerMock;
  });

  it('getInstallationForOrga returns integration if found', async () => {
    (repoIntegration.findOne as any).mockResolvedValue({
      id: 'id1',
      installationId: 123,
      userId: 'u1',
      organizationId: 'org1',
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-02'),
    });
    const res = await service.getInstallationForOrga({
      organizationId: 'org1',
    } as any);
    expect(res.installationId).toBe(123);
    expect(res.organizationId).toBe('org1');
  });

  it('getInstallationForOrga throws NOT_FOUND when missing', async () => {
    (repoIntegration.findOne as any).mockResolvedValue(null);
    await expect(
      service.getInstallationForOrga({ organizationId: 'org1' } as any),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('linkProject preserves NOT_FOUND without logging it as an error', async () => {
    (repoRepo.findOne as any).mockResolvedValue(null);
    await expect(
      service.linkProject({
        repositoryId: 'r1',
        projectId: 'p1',
        organizationId: 'o1',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.NOT_FOUND }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('logs a server-side initial scan RpcException as an error', async () => {
    const repository = {
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
      integration: { organizationId: 'o1' },
    };
    (repoRepo.findOne as any)
      .mockResolvedValueOnce(repository)
      .mockResolvedValueOnce(null);
    (repoRepo.save as any).mockResolvedValue(repository);
    jest.spyOn(service, 'startScanForLastCommitAndProject').mockRejectedValue(
      new RpcException({
        code: GrpcStatus.UNAVAILABLE,
        message: 'Scan service unavailable',
      }),
    );

    await service.linkProject({
      repositoryId: 'r1',
      projectId: 'p1',
      organizationId: 'o1',
    } as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Initial GitHub scan failed'),
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('unlinkProject preserves NOT_FOUND without logging it as an error', async () => {
    (repoRepo.findOne as any).mockResolvedValue(null);

    await expect(
      service.unlinkProject({
        repositoryId: 'r1',
        projectId: 'p1',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.NOT_FOUND }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  describe('unlinkProject across two organisations', () => {
    // Two organisations, each with its own GitHub installation and a
    // repository linked to one of its projects. The fake repository honours
    // the `where` clause, so an unscoped lookup would find the other
    // organisation's row.
    const rows = () => [
      {
        id: 'repo-a',
        projectId: 'project-a',
        scanBranch: 'main',
        name: 'a',
        fullName: 'org-a/a',
        integration: { organizationId: 'org-a' },
      },
      {
        id: 'repo-b',
        projectId: 'project-b',
        scanBranch: 'main',
        name: 'b',
        fullName: 'org-b/b',
        integration: { organizationId: 'org-b' },
      },
    ];
    let table: ReturnType<typeof rows>;

    beforeEach(() => {
      table = rows();
      (repoRepo.findOne as any).mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) =>
          table.find((row) =>
            Object.entries(where).every(
              ([key, value]) => (row as Record<string, unknown>)[key] === value,
            ),
          ) ?? null,
      );
      (repoRepo.save as any).mockImplementation(async (row: unknown) => row);
    });

    it("refuses to unlink another organisation's repository from the caller's own project", async () => {
      await expect(
        service.unlinkProject({
          repositoryId: 'repo-b',
          projectId: 'project-a',
          organizationId: 'org-a',
        }),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.NOT_FOUND }),
      });
      expect(repoRepo.save).not.toHaveBeenCalled();
      expect(table[1].projectId).toBe('project-b');
    });

    it('refuses a project id that matches the row but an organisation that does not own it', async () => {
      await expect(
        service.unlinkProject({
          repositoryId: 'repo-b',
          projectId: 'project-b',
          organizationId: 'org-a',
        }),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.NOT_FOUND }),
      });
      expect(repoRepo.save).not.toHaveBeenCalled();
      expect(table[1].projectId).toBe('project-b');
    });

    it('unlinks the repository of the caller project and organisation', async () => {
      const res = await service.unlinkProject({
        repositoryId: 'repo-a',
        projectId: 'project-a',
        organizationId: 'org-a',
      });
      expect(res.id).toBe('repo-a');
      expect(table[0].projectId).toBeNull();
      expect(table[0].scanBranch).toBeNull();
      expect(table[1].projectId).toBe('project-b');
    });
  });

  it('preserves downstream gRPC errors when loading project scan types', async () => {
    (service as any).projectServiceClient.get = jest.fn(() =>
      throwError(() => ({
        code: GrpcStatus.PERMISSION_DENIED,
        details: 'Project access denied',
      })),
    );

    await expect(
      (service as any).getProjectScanTypes('p1'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.PERMISSION_DENIED }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('preserves NOT_FOUND when the target branch has no commits', async () => {
    (repoRepo.findOne as any).mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      fullName: 'owner/repository',
      scanBranch: null,
      integration: { installationId: 123, organizationId: 'o1' },
    });
    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'main' } })
      .mockResolvedValueOnce({ data: [] });

    await expect(
      service.startScanForLastCommitAndProject({
        repositoryId: 'r1',
        projectId: 'p1',
        branch: '',
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.NOT_FOUND }),
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getBranches (DB-backed lazy-fill)
//
// New behaviour: read branches from MySQL by default; only call the GitHub
// API when branchesSyncedAt is NULL (first sync). Existing guards
// (PERMISSION_DENIED, NOT_FOUND, INTERNAL on invalid fullName) preserved.
// ---------------------------------------------------------------------------

describe('GithubService.getBranches (DB-backed)', () => {
  let service: GithubService;
  let repoRepo: any;
  let branchRepo: any;
  let dataSource: { transaction: jest.Mock };
  let branchInserts: BranchInsert[];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOctokitInstance.request.mockReset();
    const built = await buildService();
    service = built.service;
    repoRepo = built.repoRepo;
    branchRepo = built.branchRepo;
    dataSource = built.dataSource;
    branchInserts = built.branchInserts;
  });

  /** Build a base repository entity with sane defaults. */
  const makeRepoEntity = (overrides: any = {}) => ({
    id: 'repo-1',
    githubId: 42,
    nodeId: 'node-1',
    name: 'cool-repo',
    fullName: 'org/cool-repo',
    private: false,
    projectId: null,
    defaultBranch: 'main',
    scanBranch: null,
    integrationId: 'int-1',
    branchesSyncedAt: null,
    integration: {
      id: 'int-1',
      installationId: 7777,
      organizationId: 'org-1',
    },
    ...overrides,
  });

  it('1. DB hit — does NOT call Octokit, returns rows from DB with correct isDefault', async () => {
    // Repository was previously synced; branchesSyncedAt is set.
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);
    (branchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'feature', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b2', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
    expect(branchRepo.find).toHaveBeenCalledWith({
      where: { repositoryId: 'repo-1' },
      order: { name: 'ASC' },
    });
    expect(res.branches).toEqual([
      { name: 'feature', isDefault: false, isProtected: false },
      { name: 'main', isDefault: true, isProtected: true },
    ]);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('2. Lazy-fill happy path — upserts branches, deletes orphans, sets branchesSyncedAt', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'main' } })
      .mockResolvedValueOnce({
        data: [
          { name: 'main', protected: true },
          { name: 'develop', protected: false },
          { name: 'feature/x', protected: false },
        ],
      });

    // Final find() returns the upserted rows (after lazy-fill).
    (branchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'develop', isProtected: false, repositoryId: 'repo-1' },
      {
        id: 'b2',
        name: 'feature/x',
        isProtected: false,
        repositoryId: 'repo-1',
      },
      { id: 'b3', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    // Track createQueryBuilder calls (orphan delete inside transaction).
    const orphanDeleteExec = jest.fn().mockResolvedValue({ affected: 0 });
    (branchRepo.createQueryBuilder as any) = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: orphanDeleteExec,
    }));

    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(2);
    // Every branch upserted, in one multi-row statement.
    expect(branchInserts).toHaveLength(1);
    expect(branchInserts[0].rows).toEqual([
      { repositoryId: 'repo-1', name: 'main', isProtected: true },
      { repositoryId: 'repo-1', name: 'develop', isProtected: false },
      { repositoryId: 'repo-1', name: 'feature/x', isProtected: false },
    ]);
    // Orphan delete query was executed (qb path with NOT IN).
    expect(orphanDeleteExec).toHaveBeenCalled();
    // branchesSyncedAt set on the entity + saved.
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
    // The repo save happens within the transaction (we mocked manager.getRepository
    // for GithubRepository to return repoRepo) — so repoRepo.save was called.
    expect(repoRepo.save).toHaveBeenCalledWith(repo);
    // Final response shape.
    expect(res.branches).toEqual([
      { name: 'develop', isDefault: false, isProtected: false },
      { name: 'feature/x', isDefault: false, isProtected: false },
      { name: 'main', isDefault: true, isProtected: true },
    ]);
  });

  it('3. Lazy-fill API failure — no transaction, branchesSyncedAt stays null, RpcException INTERNAL', async () => {
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    mockOctokitInstance.request.mockRejectedValue(new Error('GitHub 500'));

    await expect(
      service.getBranches({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
      } as any),
    ).rejects.toBeInstanceOf(RpcException);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(branchRepo.upsert).not.toHaveBeenCalled();
    expect(repo.branchesSyncedAt).toBeNull();
  });

  it('3b. Lazy-fill API failure — RpcException carries INTERNAL status', async () => {
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    (repoRepo.findOne as any).mockResolvedValue(repo);
    mockOctokitInstance.request.mockRejectedValue(new Error('boom'));

    try {
      await service.getBranches({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
      } as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errObj = err.getError() as any;
      expect(errObj.code).toBe(GrpcStatus.INTERNAL);
    }
  });

  it('4. DB-only resilience — even if Octokit would 500, DB hit avoids the call', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);
    (branchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);
    // If anyone calls Octokit, blow up loudly.
    mockOctokitInstance.request.mockImplementation(() => {
      throw new Error('Octokit must not be called when DB is populated');
    });

    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
    expect(res.branches).toEqual([
      { name: 'main', isDefault: true, isProtected: true },
    ]);
  });

  it('5. Permission denied preserved — org mismatch throws PERMISSION_DENIED, no Octokit, no DB writes', async () => {
    const repo = makeRepoEntity({
      integration: {
        id: 'int-1',
        installationId: 7777,
        organizationId: 'other-org',
      },
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    try {
      await service.getBranches({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
      } as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errObj = err.getError() as any;
      expect(errObj.code).toBe(GrpcStatus.PERMISSION_DENIED);
    }

    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
    expect(branchRepo.upsert).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('6. Not found preserved — missing repository throws NOT_FOUND', async () => {
    (repoRepo.findOne as any).mockResolvedValue(null);

    try {
      await service.getBranches({
        organizationId: 'org-1',
        repositoryId: 'missing-id',
      } as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      const errObj = err.getError() as any;
      expect(errObj.code).toBe(GrpcStatus.NOT_FOUND);
    }

    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('6b. Not found preserved — repo without integration throws NOT_FOUND', async () => {
    const repo = makeRepoEntity({ integration: undefined });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    await expect(
      service.getBranches({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
      } as any),
    ).rejects.toBeInstanceOf(RpcException);

    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
  });

  it('7. Default branch drift — repoData.default_branch differs, entity updated in tx, isDefault on new name', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'master' } })
      .mockResolvedValueOnce({
        data: [
          { name: 'master', protected: true },
          { name: 'develop', protected: false },
        ],
      });

    // After lazy-fill, final find returns the upserted rows.
    (branchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'develop', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b2', name: 'master', isProtected: true, repositoryId: 'repo-1' },
    ]);

    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    // The entity's defaultBranch must have been mutated to 'master' before save.
    expect(repo.defaultBranch).toBe('master');
    expect(repoRepo.save).toHaveBeenCalledWith(repo);
    // isDefault now matches 'master', not the stale 'main'.
    expect(res.branches.find((b) => b.name === 'master')?.isDefault).toBe(true);
    expect(res.branches.find((b) => b.name === 'develop')?.isDefault).toBe(
      false,
    );
  });

  it('8. Orphan reconciliation — NOT IN clause uses fresh branch names, removes stale rows', async () => {
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'main' } })
      .mockResolvedValueOnce({
        data: [
          { name: 'main', protected: true },
          { name: 'feature', protected: false },
        ],
      });

    const orphanWhere = jest.fn().mockReturnThis();
    const orphanExec = jest.fn().mockResolvedValue({ affected: 1 });
    (branchRepo.createQueryBuilder as any) = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: orphanWhere,
      andWhere: jest.fn().mockReturnThis(),
      execute: orphanExec,
    }));

    (branchRepo.find as any).mockResolvedValue([
      { id: 'b1', name: 'feature', isProtected: false, repositoryId: 'repo-1' },
      { id: 'b2', name: 'main', isProtected: true, repositoryId: 'repo-1' },
    ]);

    await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
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

  it('9. Empty branch list from API — full delete (no NOT IN), branchesSyncedAt still set', async () => {
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'main' } })
      .mockResolvedValueOnce({ data: [] });

    const fullDeleteWhere = jest.fn().mockReturnThis();
    const fullDeleteExec = jest.fn().mockResolvedValue({ affected: 0 });
    (branchRepo.createQueryBuilder as any) = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: fullDeleteWhere,
      andWhere: jest.fn().mockReturnThis(),
      execute: fullDeleteExec,
    }));

    (branchRepo.find as any).mockResolvedValue([]);

    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(branchRepo.upsert).not.toHaveBeenCalled();
    // No INSERT either: TypeORM refuses an insert without values.
    expect(branchInserts).toEqual([]);
    expect(fullDeleteWhere).toHaveBeenCalled();
    // No NOT IN constraint — just plain where on repositoryId.
    const [whereSql, whereParams] = (fullDeleteWhere.mock.calls[0] ||
      []) as any[];
    expect(whereSql).not.toContain('NOT IN');
    expect(whereParams).toEqual({ id: 'repo-1' });
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
    expect(repoRepo.save).toHaveBeenCalledWith(repo);
    expect(res.branches).toEqual([]);
  });

  it('10. Lazy-fill pagination — fetches ALL pages for a repo with >100 branches', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    // 250 branches spread across three GitHub pages (100 + 100 + 50).
    const mkPage = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `b${start + i}`,
        protected: false,
      }));
    const page1 = mkPage(0, 100);
    const page2 = mkPage(100, 100);
    const page3 = mkPage(200, 50);

    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'main' } }) // repo metadata
      .mockResolvedValueOnce({ data: page1 })
      .mockResolvedValueOnce({ data: page2 })
      .mockResolvedValueOnce({ data: page3 });

    // Capture the orphan-reconciliation NOT IN names so we can prove the full
    // 250-branch set — not just page 1 — drives the reconciliation.
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
    (branchRepo.createQueryBuilder as any) = jest.fn(() => qb);
    (branchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    // 1 repo-metadata call + 3 branch pages.
    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(4);
    // Each branch page is requested with an explicit, incrementing page param.
    expect(mockOctokitInstance.request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/branches',
      expect.objectContaining({
        owner: 'org',
        repo: 'cool-repo',
        per_page: 100,
        page: 1,
      }),
    );
    expect(mockOctokitInstance.request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/branches',
      expect.objectContaining({ per_page: 100, page: 3 }),
    );
    // Every one of the 250 branches is upserted — including page-3 branches.
    const written = branchInserts.flatMap((insert) => insert.rows);
    expect(written).toHaveLength(250);
    expect(written).toContainEqual({
      repositoryId: 'repo-1',
      name: 'b249',
      isProtected: false,
    });
    // The orphan reconciliation sees the FULL 250-name set, so a page-3 branch
    // is preserved rather than wrongly deleted.
    expect(capturedNames).toHaveLength(250);
    expect(capturedNames).toContain('b249');
  });

  it('11. Lazy-fill pagination — exactly per_page branches triggers a final empty page then stops', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      name: `b${i}`,
      protected: false,
    }));

    mockOctokitInstance.request
      .mockResolvedValueOnce({ data: { default_branch: 'main' } }) // repo metadata
      .mockResolvedValueOnce({ data: fullPage }) // page 1 — exactly full
      .mockResolvedValueOnce({ data: [] }); // page 2 — empty, end of list

    const qb: any = {
      delete: jest.fn(() => qb),
      from: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    (branchRepo.createQueryBuilder as any) = jest.fn(() => qb);
    (branchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    // repo metadata + page 1 (full) + page 2 (empty) = 3 calls.
    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(3);
    expect(branchInserts.flatMap((insert) => insert.rows)).toHaveLength(100);
  });

  it('12. Lazy-fill pagination — hitting MAX_PAGES marks the sync truncated: no orphan delete, branchesSyncedAt left unset', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    // Repo metadata, then an endless stream of FULL branch pages → drives the
    // loop to the MAX_PAGES (100) cap with a known-incomplete list.
    mockOctokitInstance.request.mockImplementation(async (route: string) => {
      if (route === 'GET /repos/{owner}/{repo}') {
        return { data: { default_branch: 'main' } };
      }
      return {
        data: Array.from({ length: 100 }, (_, i) => ({
          name: `b${i}`,
          protected: false,
        })),
      };
    });

    // createQueryBuilder is only used by the orphan-delete step; a truncated
    // sync must not touch it. The stub stays functional so the pre-fix code
    // path fails on the ASSERTION below (delete ran) rather than crashing.
    const cqb = jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }));
    (branchRepo.createQueryBuilder as any) = cqb;
    (branchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    // 1 repo-metadata call + exactly MAX_PAGES branch pages — the cap held.
    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(101);
    // Truncated sync must NOT run the destructive orphan reconciliation...
    expect(cqb).not.toHaveBeenCalled();
    // ...and must NOT be cached, so the next read retries instead of trusting
    // an incomplete branch list.
    expect(repo.branchesSyncedAt).toBeNull();
  });

  // One upsert per branch would be 2 statements per branch (the INSERT, then
  // TypeORM's SELECT reloading the generated columns). The branches go in
  // batches of 500 rows, without the reload.
  it('13. Lazy-fill writes 1 200 branches in 3 multi-row upserts, without reloading them', async () => {
    const repo = makeRepoEntity({
      branchesSyncedAt: null,
      defaultBranch: 'main',
    });
    (repoRepo.findOne as any).mockResolvedValue(repo);

    const branches = Array.from({ length: 1200 }, (_, i) => ({
      name: `b${i}`,
      protected: i % 2 === 0,
    }));
    mockOctokitInstance.request.mockImplementation(
      async (route: string, params: { page?: number }) => {
        if (route === 'GET /repos/{owner}/{repo}') {
          return { data: { default_branch: 'main' } };
        }
        const start = ((params.page ?? 1) - 1) * 100;
        return { data: branches.slice(start, start + 100) };
      },
    );
    (branchRepo.find as any).mockResolvedValue([]);

    await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(branchRepo.upsert).not.toHaveBeenCalled();
    expect(branchInserts.map((i) => i.rows.length)).toEqual([500, 500, 200]);
    for (const insert of branchInserts) {
      expect(insert.target).toBe(GithubBranch);
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
// addGitDirToArchive — tested directly (does not involve AdmZip constructor)
// ---------------------------------------------------------------------------

describe('GithubService.addGitDirToArchive', () => {
  let service: GithubService;
  let tmpDir: string;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-svc-git-'));
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

describe('GithubService.processZipFile', () => {
  let service: GithubService;
  let tmpDir: string;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-svc-zip-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips top-level directory from github zipball entries', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip);

    const result = new AdmZip(outputZip);
    const names = result
      .getEntries()
      .map((e: any) => e.entryName)
      .sort();
    expect(names).toContain('src/app.js');
    expect(names).toContain('README.md');
    // top-level dir prefix must be gone
    expect(names.every((n: string) => !n.startsWith('top-'))).toBe(true);
  });

  it('does NOT add any .git entries when gitDir is not provided', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip);

    const result = new AdmZip(outputZip);
    const gitEntries = result
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });

  it('does NOT add any .git entries when gitDir is undefined', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip, undefined);

    const result = new AdmZip(outputZip);
    const gitEntries = result
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });

  it('injects .git/* files when gitDir is provided and exists', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const gitDir = createFakeGitDir(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await service['processZipFile'](inputZip, outputZip, gitDir);

    const result = new AdmZip(outputZip);
    const names = result
      .getEntries()
      .map((e: any) => e.entryName)
      .sort();

    // Source files still present
    expect(names).toContain('src/app.js');
    expect(names).toContain('README.md');

    // .git files injected
    expect(names).toContain('.git/HEAD');
    expect(names).toContain('.git/config');
    expect(names).toContain('.git/objects/pack/pack-abc.pack');
  });

  it('injected .git/HEAD has correct content', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
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
    const inputZip = createFakeGithubZip(tmpDir);
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
// downloadAndUploadInBackground — the git history of the scanned branch
// ---------------------------------------------------------------------------

describe('GithubService.downloadAndUploadInBackground — git history', () => {
  let built: Awaited<ReturnType<typeof buildService>>;
  let service: GithubService;
  let tmpDir: string;
  let tmpPath: string;
  let cleanedPath: string;
  let auth: jest.Mock;
  let processZip: jest.SpyInstance;
  let uploadArchive: jest.SpyInstance;
  let downloadArchive: jest.SpyInstance;

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
      repositoryKey: 'github:acme-org/cool-repo',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    built = await buildService();
    service = built.service;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-history-'));
    tmpPath = path.join(tmpDir, 'input.zip');
    cleanedPath = path.join(tmpDir, 'cleaned.zip');
    jest
      .spyOn(service as any, 'generateTempPaths')
      .mockReturnValue({ tmpPath, cleanedPath });
    auth = jest.fn().mockResolvedValue({ token: 'my-secret-token' });
    jest
      .spyOn(service as any, 'createInstallationOctokit')
      .mockReturnValue({ auth });
    downloadArchive = jest
      .spyOn(service as any, 'downloadGithubArchive')
      .mockImplementation(async () => {
        createFakeGithubZip(tmpDir);
      });
    processZip = jest
      .spyOn(service as any, 'processZipInWorker')
      .mockImplementation(async (...args: unknown[]) => {
        fs.writeFileSync(args[1] as string, 'cleaned');
      });
    uploadArchive = jest
      .spyOn(service as any, 'uploadToSignedUrl')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const run = (branch = 'main') =>
    service['downloadAndUploadInBackground'](
      'acme-org',
      'cool-repo',
      'sha-1',
      1,
      'scan-1',
      'project-1',
      'org-1',
      branch,
      'sast',
    );

  it('fetches the history of the scanned branch with the installation token', async () => {
    await run('release/1.2');

    expect(built.repoHistory.prepare).toHaveBeenCalledWith({
      scanId: 'scan-1',
      projectId: 'project-1',
      branch: 'release/1.2',
      repositoryKey: 'github:acme-org/cool-repo',
      cloneUrl:
        'https://x-access-token:my-secret-token@github.com/acme-org/cool-repo.git',
    });
  });

  it('fetches no history when no installation token can be had, and still scans', async () => {
    auth.mockRejectedValue(new Error('Bad credentials'));

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
    const unavailable = historyUnavailable('github:acme-org/cool-repo');
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
// A push refused by a running scan is rescanned later
// ---------------------------------------------------------------------------

describe('GithubService — push refused by a running scan, rescanned later', () => {
  let built: Awaited<ReturnType<typeof buildService>>;
  let service: GithubService;

  const pushedSha = 'b'.repeat(40);
  const pushBody = {
    installation: { id: 999 },
    ref: 'refs/heads/main',
    after: pushedSha,
    repository: { id: 12345, default_branch: 'main' },
  };
  const pushRequest = (body: Record<string, unknown> = pushBody) => ({
    bodyJson: JSON.stringify(body),
    signature: 'sha256=fake',
    event: 'push',
    action: '',
  });
  const linkedRepository = (overrides: Record<string, unknown> = {}) => ({
    id: 'repo-1',
    githubId: 12345,
    projectId: 'p1',
    scanBranch: 'main',
    fullName: 'acme/widgets',
    integration: { installationId: 999, organizationId: 'org-1' },
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
    jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
    built.repoIntegration.findOneBy = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-1' });
    (built.repoRepo.findOne as any).mockResolvedValue(linkedRepository());
    built.projectGet.mockReturnValue(
      of({ scanOnCommitEnabled: true, sastEnabled: true, scaEnabled: true }),
    );
  });

  describe('the push', () => {
    it('answers success and records the pushed commit when a scan of the branch is running', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );

      const res = await service.handleWebhookEvent(pushRequest() as any);

      expect(res).toEqual({ success: true });
      expect(built.pendingRescans.record).toHaveBeenCalledTimes(1);
      expect(built.pendingRescans.record).toHaveBeenCalledWith({
        provider: 'github',
        projectId: 'p1',
        branch: 'main',
        commitSha: pushedSha,
        githubRepositoryId: 12345,
      });
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
      expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
    });

    it('a refused push of the commit already being scanned answers success, and nothing is rescanned', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );
      // The store finds that this commit's scan is the one that started.
      built.pendingRescans.record.mockResolvedValue(false);

      const res = await service.handleWebhookEvent(pushRequest() as any);

      expect(res).toEqual({ success: true });
      expect(built.loggerMock.log).toHaveBeenCalledWith(
        expect.stringContaining('WEBHOOK_PUSH_RESCAN_SKIPPED'),
      );
      expect(built.loggerMock.log).not.toHaveBeenCalledWith(
        expect.stringContaining('WEBHOOK_PUSH_RESCAN_DEFERRED'),
      );
    });

    it('defers too when the conflict is caught by createScan (two pushes racing)', async () => {
      built.scanServiceClient.createScan.mockReturnValue(alreadyExists());

      const res = await service.handleWebhookEvent(pushRequest() as any);

      expect(res).toEqual({ success: true });
      expect(built.pendingRescans.record).toHaveBeenCalledWith(
        expect.objectContaining({ commitSha: pushedSha }),
      );
      expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
    });

    it('does not defer a push whose commit id is not one: the former 409', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );

      await expect(
        service.handleWebhookEvent(
          pushRequest({ ...pushBody, after: 'not-a-sha' }) as any,
        ),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
      });
      expect(built.pendingRescans.record).not.toHaveBeenCalled();
    });

    it('defers nothing but a running scan: any other refusal is unchanged', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE, details: 'down' })),
      );

      await expect(
        service.handleWebhookEvent(pushRequest() as any),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.UNAVAILABLE }),
      });
      expect(built.pendingRescans.record).not.toHaveBeenCalled();
    });

    it('a push that starts its scan supersedes the pushes refused before it', async () => {
      const before = Date.now();

      await service.handleWebhookEvent(pushRequest() as any);

      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);
      expect(built.pendingRescans.supersede).toHaveBeenCalledTimes(1);
      const [projectId, branch, startedAt, commitSha] =
        built.pendingRescans.supersede.mock.calls[0];
      expect([projectId, branch]).toEqual(['p1', 'main']);
      // The started commit, so a refused push of it is not recorded again.
      expect(commitSha).toBe(pushedSha);
      // Taken when the start began, before security-scanning was asked.
      expect(startedAt).toBeGreaterThanOrEqual(before);
      expect(startedAt).toBeLessThanOrEqual(Date.now());
      expect(
        built.scanServiceClient.checkExistingScan.mock.invocationCallOrder[0],
      ).toBeLessThan(
        built.pendingRescans.supersede.mock.invocationCallOrder[0],
      );
    });

    it('a scan start does not fail because the supersede could not run', async () => {
      built.pendingRescans.supersede.mockRejectedValue(new Error('redis down'));

      await expect(
        service.handleWebhookEvent(pushRequest() as any),
      ).resolves.toEqual({ success: true });
      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);
    });

    // A graph-only scan
    // runs no scanner, so it does not stand for the AppSec scan a refused
    // push is waiting for.
    it('a graph-only scan does not supersede the pushes refused before it', async () => {
      await service.startScanForCommitAndProject(
        12345,
        pushedSha,
        'main',
        'refs/heads/main',
        'org-1',
        { graphOnly: true },
      );

      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);
      expect(built.pendingRescans.supersede).not.toHaveBeenCalled();
    });
  });

  // Real store on the local Redis: the duplicate is refused by the Lua
  // scripts themselves, not by a double. PENDING_RESCAN_REDIS_LIVE=1.
  (process.env.PENDING_RESCAN_REDIS_LIVE === '1' ? describe : describe.skip)(
    'with the real store (live Redis)',
    () => {
      const prefix = `gh-rescan-live-${process.pid}-${Date.now()}`;
      let redis: Redis;
      let store: PendingRescanStore;

      beforeAll(() => {
        redis = new Redis(
          process.env.REDIS_LIVE_URL ?? 'redis://127.0.0.1:6379',
        );
        store = new PendingRescanStore(redis, prefix);
      });
      beforeEach(() => {
        (service as any).pendingRescans = store;
      });
      afterEach(async () => {
        const keys = await redis.keys(`${prefix}:*`);
        if (keys.length > 0) await redis.del(...keys);
      });
      afterAll(async () => {
        await redis.quit();
      });

      it('push X accepted, then the same push replayed during its scan records nothing', async () => {
        await service.handleWebhookEvent(pushRequest() as any);
        expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledTimes(1);

        // X's scan is running: the replay (gateway retry, redelivery) is
        // refused by security-scanning.
        built.scanServiceClient.checkExistingScan.mockReturnValue(
          alreadyExists(),
        );
        const replay = await service.handleWebhookEvent(pushRequest() as any);

        expect(replay).toEqual({ success: true });
        expect(await redis.exists(store.entryKey('p1', 'main'))).toBe(0);
        expect(await redis.zcard(`${prefix}:due`)).toBe(0);

        // Another commit pushed during the same scan is still deferred.
        const newer = 'e'.repeat(40);
        await service.handleWebhookEvent(
          pushRequest({ ...pushBody, after: newer }) as any,
        );
        const entry = JSON.parse(
          (await redis.get(store.entryKey('p1', 'main'))) as string,
        );
        expect(entry.commitSha).toBe(newer);
      });

      it('out of order: B accepted, A (older) delivered late is recorded, then never rescanned', async () => {
        const b = 'f'.repeat(40);
        const a = 'a'.repeat(40);
        await service.handleWebhookEvent(
          pushRequest({ ...pushBody, after: b }) as any,
        );
        built.scanServiceClient.checkExistingScan.mockReturnValue(
          alreadyExists(),
        );
        await service.handleWebhookEvent(
          pushRequest({ ...pushBody, after: a }) as any,
        );
        const claimed = JSON.parse(
          (await redis.get(store.entryKey('p1', 'main'))) as string,
        );
        expect(claimed.commitSha).toBe(a);

        // B's scan is over; GitHub reports B as the head.
        built.scanServiceClient.checkExistingScan.mockReturnValue(
          of({ exists: false }),
        );
        mockOctokitInstance.request.mockResolvedValue({
          data: { commit: { sha: b } },
        });
        built.repoScanQueue.enqueueRepoScan.mockClear();

        await expect(service.runPendingRescan(claimed)).resolves.toBe(
          'dropped',
        );
        expect(built.repoScanQueue.enqueueRepoScan).not.toHaveBeenCalled();
      });
    },
  );

  describe('runPendingRescan (the consumer, once the running scan may be over)', () => {
    const entry = {
      provider: 'github' as const,
      projectId: 'p1',
      branch: 'main',
      commitSha: pushedSha,
      githubRepositoryId: 12345,
      recordedAt: 1,
    };

    /** The branch head GitHub reports (GET /repos/{owner}/{repo}/branches/{branch}). */
    const branchHeadIs = (sha: string) =>
      mockOctokitInstance.request.mockImplementation(async (route: string) => {
        if (route === 'GET /repos/{owner}/{repo}/branches/{branch}') {
          return { data: { name: 'main', commit: { sha } } };
        }
        throw new Error(`Unexpected Octokit route in test: ${route}`);
      });

    beforeEach(() => {
      mockOctokitInstance.request.mockReset();
      branchHeadIs(pushedSha);
    });

    // The SHA claimed may be stale by the time the branch is
    // free. The head is read from GitHub when the rescan starts.
    describe('the commit it scans', () => {
      it('reads the branch head of the linked repository', async () => {
        await service.runPendingRescan(entry);

        expect(mockOctokitInstance.request).toHaveBeenCalledWith(
          'GET /repos/{owner}/{repo}/branches/{branch}',
          { owner: 'acme', repo: 'widgets', branch: 'main' },
        );
      });

      it('scans the head when a newer commit was pushed after the claim', async () => {
        const newer = 'f'.repeat(40);
        branchHeadIs(newer);

        await expect(service.runPendingRescan(entry)).resolves.toBe('started');

        expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
          expect.objectContaining({ commitSha: newer }),
        );
      });

      it('out of order: an older push refused after the newer one started is not rescanned', async () => {
        // B was delivered first and its scan started; A, older, came after.
        const newer = 'f'.repeat(40);
        branchHeadIs(newer);
        built.pendingRescans.startedCommit.mockResolvedValue(newer);

        await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

        expect(built.pendingRescans.startedCommit).toHaveBeenCalledWith(
          'p1',
          'main',
        );
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
        expect(built.loggerMock.log).toHaveBeenCalledWith(
          expect.stringContaining('reason=already_scanned'),
        );
      });

      it('a branch gone from GitHub (404) is dropped, and says so', async () => {
        mockOctokitInstance.request.mockRejectedValue(
          Object.assign(new Error('Not Found'), { status: 404 }),
        );

        await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
        expect(built.loggerMock.log).toHaveBeenCalledWith(
          expect.stringMatching(
            /PENDING_RESCAN_DROPPED reason=branch_head_unavailable project=p1 branch=main/,
          ),
        );
      });

      it('GitHub failing otherwise is checked again later', async () => {
        mockOctokitInstance.request.mockRejectedValue(
          Object.assign(new Error('Bad Gateway'), { status: 502 }),
        );

        await expect(service.runPendingRescan(entry)).resolves.toBe('busy');
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
        expect(built.loggerMock.log).not.toHaveBeenCalledWith(
          expect.stringContaining('PENDING_RESCAN_DROPPED'),
        );
      });
    });

    it('stays busy while a scan of the branch runs, asking nothing else', async () => {
      built.scanServiceClient.checkExistingScan.mockReturnValue(
        alreadyExists(),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe('busy');

      expect(built.scanServiceClient.checkExistingScan).toHaveBeenCalledWith({
        projectId: 'p1',
        branch: 'main',
      });
      expect(built.projectGet).not.toHaveBeenCalled();
      expect(built.entitlements.decidePushScan).not.toHaveBeenCalled();
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    });

    it('starts the scan of the recorded commit like the push would have', async () => {
      await expect(service.runPendingRescan(entry)).resolves.toBe('started');

      expect(built.entitlements.decidePushScan).toHaveBeenCalledWith(
        'org-1',
        // The edition reads the project as an AppSec one (the community answer).
        true,
      );
      expect(built.scanServiceClient.createScan).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          branch: 'main',
          initializerUserId: 'github-integration',
          sourceType: 'github',
        }),
      );
      expect(
        built.scanServiceClient.createScan.mock.calls[0][0],
      ).not.toHaveProperty('isDiffScan');
      expect(built.repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          organizationId: 'org-1',
          branch: 'main',
          commitSha: pushedSha,
          typeScan: 'sast,sca',
        }),
      );
    });

    it('is dropped when scan-on-commit was turned off meanwhile', async () => {
      built.projectGet.mockReturnValue(of({ scanOnCommitEnabled: false }));

      await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    });

    // An unexpected failure is retried; the TTL bounds it.
    it('an unexpected failure before the scan exists is checked again later', async () => {
      built.scanServiceClient.createScan.mockReturnValue(
        throwError(() => new Error('socket hang up')),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe('busy');
    });

    // Once createScan succeeded, a retry would create one
    // more scan, left waiting_for_file, on every attempt.
    it('a queue failure after the scan was created is dropped, and says so', async () => {
      built.repoScanQueue.enqueueRepoScan.mockRejectedValue(
        new Error('Connection is closed.'),
      );

      await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');

      expect(built.scanServiceClient.createScan).toHaveBeenCalledTimes(1);
      expect(built.loggerMock.log).toHaveBeenCalledWith(
        expect.stringMatching(
          /PENDING_RESCAN_DROPPED reason=enqueue_failed_after_create project=p1 branch=main .*Connection is closed/,
        ),
      );
    });

    it('is dropped when the organization can no longer write (never bypasses isWritable)', async () => {
      built.entitlements.decidePushScan.mockResolvedValue({
        scan: 'none',
        reason: 'writes_blocked',
      });

      await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
      expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
    });

    it.each([
      ['unlinked', null],
      ['linked to another project', linkedRepository({ projectId: 'p2' })],
      ['scanning another branch', linkedRepository({ scanBranch: 'develop' })],
    ])(
      'is dropped when the repository was %s meanwhile',
      async (_label, repository) => {
        (built.repoRepo.findOne as any).mockResolvedValue(repository);

        await expect(service.runPendingRescan(entry)).resolves.toBe('dropped');
        expect(built.scanServiceClient.createScan).not.toHaveBeenCalled();
      },
    );

    it.each([
      [GrpcStatus.ALREADY_EXISTS, 'busy'],
      [GrpcStatus.UNAVAILABLE, 'busy'],
      [GrpcStatus.DEADLINE_EXCEEDED, 'busy'],
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
// handleWebhookEvent — per-project scan-on-commit opt-out
// ---------------------------------------------------------------------------

describe('GithubService.handleWebhookEvent (scanOnCommitEnabled gate)', () => {
  let service: GithubService;
  let repoIntegration: any;
  let repoRepo: any;
  let loggerMock: ReturnType<typeof createLoggerMock>;
  let projectGet: jest.Mock;

  const installationId = 999;
  const orgId = 'org-1';
  const pushBody = {
    installation: { id: installationId },
    ref: 'refs/heads/main',
    after: 'commit-sha-abc',
    repository: { id: 12345, default_branch: 'main' },
  };

  const buildPushRequest = () => ({
    bodyJson: JSON.stringify(pushBody),
    signature: 'sha256=fake',
    event: 'push',
    action: '',
  });

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoRepo = built.repoRepo;
    loggerMock = built.loggerMock;
    projectGet = built.projectGet;

    jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
    repoIntegration.findOneBy = jest
      .fn()
      .mockResolvedValue({ organizationId: orgId });
    (repoRepo.findOne as any).mockResolvedValue({
      githubId: 12345,
      projectId: 'p1',
      scanBranch: 'main',
      integration: { installationId },
    });
  });

  it('skips the scan when the project has scanOnCommitEnabled=false', async () => {
    projectGet.mockReturnValue(of({ scanOnCommitEnabled: false }));
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForCommitAndProject')
      .mockResolvedValue(undefined);

    const res = await service.handleWebhookEvent(buildPushRequest() as any);

    expect(projectGet).toHaveBeenCalledWith(leanProjectRead('p1'));
    expect(startScanSpy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('scans when the project has scanOnCommitEnabled=true', async () => {
    projectGet.mockReturnValue(of({ scanOnCommitEnabled: true }));
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForCommitAndProject')
      .mockResolvedValue(undefined);

    await service.handleWebhookEvent(buildPushRequest() as any);

    expect(startScanSpy).toHaveBeenCalled();
  });

  // A global-management running behind this service omits the field entirely.
  // Reading that as "disabled" would silently stop scanning every project, so
  // absence must mean enabled.
  it('scans when the field is absent from the project response', async () => {
    projectGet.mockReturnValue(of({ sastEnabled: true }));
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForCommitAndProject')
      .mockResolvedValue(undefined);

    await service.handleWebhookEvent(buildPushRequest() as any);

    expect(startScanSpy).toHaveBeenCalled();
  });

  // Fail open: a missed scan is a security gap, so a transient gRPC failure
  // must not silently suppress scanning.
  it('scans and warns when the project lookup fails', async () => {
    projectGet.mockImplementation(() => {
      throw new Error('global-management unavailable');
    });
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForCommitAndProject')
      .mockResolvedValue(undefined);

    await service.handleWebhookEvent(buildPushRequest() as any);

    expect(startScanSpy).toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('scanOnCommitEnabled'),
    );
  });

  // A push needs the scan-on-commit opt-out and the scan types: one lean
  // project read serves both, never two full ProjectService/Get calls.
  describe('one project read per push', () => {
    let repoScanQueue: { enqueueRepoScan: jest.Mock };

    beforeEach(async () => {
      const built = await buildService();
      service = built.service;
      repoIntegration = built.repoIntegration;
      repoRepo = built.repoRepo;
      loggerMock = built.loggerMock;
      projectGet = built.projectGet;
      repoScanQueue = built.repoScanQueue;

      jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
      repoIntegration.findOneBy = jest
        .fn()
        .mockResolvedValue({ organizationId: orgId });
      (repoRepo.findOne as any).mockResolvedValue({
        githubId: 12345,
        projectId: 'p1',
        scanBranch: 'main',
        fullName: 'acme/widgets',
        integration: { installationId },
      });
    });

    it('reads the project once, with the lean read, and scans with its types', async () => {
      projectGet.mockReturnValue(
        of({
          scanOnCommitEnabled: true,
          sastEnabled: true,
          iacEnabled: false,
          scaEnabled: true,
        }),
      );

      await service.handleWebhookEvent(buildPushRequest() as any);

      expect(projectGet).toHaveBeenCalledTimes(1);
      expect(projectGet).toHaveBeenCalledWith(leanProjectRead('p1'));
      expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1', typeScan: 'sast,sca' }),
      );
    });

    it('a failed read keeps the former behaviour: scan anyway, types read again', async () => {
      projectGet
        .mockImplementationOnce(() =>
          throwError(() => ({ code: GrpcStatus.UNAVAILABLE, details: 'down' })),
        )
        .mockReturnValueOnce(
          of({ sastEnabled: false, iacEnabled: true, scaEnabled: false }),
        );

      await service.handleWebhookEvent(buildPushRequest() as any);

      expect(projectGet).toHaveBeenCalledTimes(2);
      expect(projectGet).toHaveBeenNthCalledWith(2, leanProjectRead('p1'));
      expect(repoScanQueue.enqueueRepoScan).toHaveBeenCalledWith(
        expect.objectContaining({ typeScan: 'iac' }),
      );
    });
  });

  // The opt-out is webhook-only: linking a repo and manual scans must still work.
  it('does not gate the manual scan RPC on the flag', async () => {
    projectGet.mockReturnValue(of({ scanOnCommitEnabled: false }));
    (repoRepo.findOne as any).mockResolvedValue({
      id: 'repo-1',
      githubId: 12345,
      projectId: 'p1',
      fullName: 'acme/widgets',
      defaultBranch: 'main',
      integration: { installationId },
    });
    jest.spyOn(service as any, 'createInstallationOctokit').mockReturnValue({
      request: jest
        .fn()
        .mockResolvedValueOnce({ data: { default_branch: 'main' } })
        .mockResolvedValueOnce({ data: [{ sha: 'sha-1' }] }),
    });
    const startScanSpy = jest
      .spyOn(service as any, 'startScanForCommitAndProject')
      .mockResolvedValue({ success: true });

    await service.startScanForLastCommitAndProject({
      repositoryId: 'repo-1',
    } as any);

    expect(startScanSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature hashes the RAW body (not re-serialized JSON) and
// uses crypto.timingSafeEqual.
// ---------------------------------------------------------------------------

describe('GithubService.verifyWebhookSignature (raw-body HMAC)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cryptoLib = require('node:crypto');
  // Generated per run so the spec holds no literal key.
  const secret: string = cryptoLib.randomBytes(24).toString('hex');
  let service: GithubService;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
  });

  /** Build the GitHub-style `sha256=<hex>` header for an exact byte sequence. */
  const sign = (raw: string) =>
    'sha256=' +
    cryptoLib.createHmac('sha256', secret).update(raw).digest('hex');

  it('accepts a signature computed over the raw body string', () => {
    const raw = '{"hello":"world"}';
    const sig = sign(raw);
    expect(service.verifyWebhookSignature(raw, sig, secret)).toBe(true);
  });

  it('rejects a tampered signature of correct length', () => {
    const raw = '{"hello":"world"}';
    const validSig = sign(raw);
    const tampered = 'sha256=' + '0'.repeat(validSig.length - 'sha256='.length);
    expect(service.verifyWebhookSignature(raw, tampered, secret)).toBe(false);
  });

  it('rejects when the raw body bytes differ from the signed bytes', () => {
    // The body differs only by whitespace: a parse-then-stringify path would
    // normalize it and accept it. The verifier hashes the bytes as-is.
    const received = '{ "hello" : "world" }';
    const signedAsCanonical = sign('{"hello":"world"}');
    expect(
      service.verifyWebhookSignature(received, signedAsCanonical, secret),
    ).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    const raw = '{}';
    expect(service.verifyWebhookSignature(raw, 'sha256=abc', '')).toBe(false);
    expect(
      service.verifyWebhookSignature(raw, 'sha256=abc', undefined as any),
    ).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const raw = '{}';
    expect(service.verifyWebhookSignature(raw, undefined as any, secret)).toBe(
      false,
    );
    expect(service.verifyWebhookSignature(raw, '', secret)).toBe(false);
  });

  it('does not throw on signature with wrong length', () => {
    const raw = '{}';
    expect(() =>
      service.verifyWebhookSignature(raw, 'sha256=short', secret),
    ).not.toThrow();
    expect(service.verifyWebhookSignature(raw, 'sha256=short', secret)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// handleWebhookEvent must pass the RAW request body string to the verifier
// (no JSON.parse(JSON.stringify(...)) round-trip).
// ---------------------------------------------------------------------------

describe('GithubService.handleWebhookEvent (raw body forwarded)', () => {
  let service: GithubService;
  let repoIntegration: any;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoIntegration.findOneBy = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-x' });
  });

  it('passes the raw bodyJson string (not re-serialized JSON) to verifyWebhookSignature', async () => {
    // Whitespace + key-order tweaks: only the original raw bytes will match
    // the upstream HMAC, so the verifier MUST receive the original string.
    const rawBodyJson = '{ "installation" : { "id" : 1 }, "extra": null }';

    const verifySpy = jest
      .spyOn(service, 'verifyWebhookSignature')
      .mockReturnValue(true);

    await service.handleWebhookEvent({
      bodyJson: rawBodyJson,
      signature: 'sha256=any',
      event: 'ping',
      action: '',
    } as any);

    expect(verifySpy).toHaveBeenCalled();
    // First positional argument MUST be the raw string we received over the
    // wire — *not* JSON.stringify(JSON.parse(rawBodyJson)).
    expect(verifySpy.mock.calls[0][0]).toBe(rawBodyJson);
  });
});

// ---------------------------------------------------------------------------
// installation_repositories webhook handlers — idempotency + missing-row
// tolerance. The `IDX_github_repositories_unique_repo_per_install` unique
// index (githubId, integrationId) was added in commit 02bb4f76c alongside
// idempotent retries in callbackInstall and handleInstallationsEvent — but
// handleRepositoryCreationEvent / handleRepositoryDeletionEvent were left
// non-idempotent, which loses newly-added repos when GitHub retries the
// webhook or batches an already-known repo.
// ---------------------------------------------------------------------------

describe('GithubService.handleRepositoryCreationEvent', () => {
  let service: GithubService;
  let repoIntegration: any;
  let repoRepo: any;

  const installation = { id: 'int-1', installationId: 42 };

  const newRepo = (id: number, name: string) => ({
    id,
    node_id: `MDEw${id}`,
    name,
    full_name: `org/${name}`,
    private: false,
  });

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoRepo = built.repoRepo;
    (repoIntegration.findOne as any).mockResolvedValue(installation);
  });

  it('throws NOT_FOUND when the installation does not exist', async () => {
    (repoIntegration.findOne as any).mockResolvedValue(null);
    await expect(
      service.handleRepositoryCreationEvent(99, [newRepo(1, 'a')]),
    ).rejects.toBeInstanceOf(RpcException);
    expect(repoRepo.save).not.toHaveBeenCalled();
  });

  it('persists every repository in the batch on a happy path', async () => {
    (repoRepo.save as any).mockResolvedValue(undefined);
    await service.handleRepositoryCreationEvent(42, [
      newRepo(1, 'a'),
      newRepo(2, 'b'),
    ]);
    expect(repoRepo.save).toHaveBeenCalledTimes(2);
    const first = (repoRepo.save as any).mock.calls[0][0];
    expect(first.githubId).toBe(1);
    expect(first.fullName).toBe('org/a');
    expect(first.integration).toBe(installation);
  });

  it('swallows ER_DUP_ENTRY from save (idempotent on webhook retries)', async () => {
    (repoRepo.save as any).mockRejectedValue({ code: 'ER_DUP_ENTRY' });
    await expect(
      service.handleRepositoryCreationEvent(42, [newRepo(1, 'a')]),
    ).resolves.toBeUndefined();
  });

  it('refreshes the name and visibility of an already-known repository instead of skipping it', async () => {
    // GitHub re-sends every accessible repository when the installation's
    // repository access changes. A repo renamed on GitHub then collides with
    // its stored row: skipping it kept the old name forever.
    (repoRepo.save as any).mockRejectedValue({ code: 'ER_DUP_ENTRY' });
    await service.handleRepositoryCreationEvent(42, [
      { ...newRepo(1, 'Agents'), private: true },
    ]);
    expect(repoRepo.update).toHaveBeenCalledWith(
      { githubId: 1, integrationId: 'int-1' },
      { name: 'Agents', fullName: 'org/Agents', private: true },
    );
  });

  it('continues the batch when one repo collides with the unique index', async () => {
    (repoRepo.save as any)
      .mockRejectedValueOnce({ driverError: { code: 'ER_DUP_ENTRY' } })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await service.handleRepositoryCreationEvent(42, [
      newRepo(1, 'a'),
      newRepo(2, 'b'),
      newRepo(3, 'c'),
    ]);
    expect(repoRepo.save).toHaveBeenCalledTimes(3);
  });

  it('re-throws non-duplicate save errors (e.g., connection lost)', async () => {
    (repoRepo.save as any).mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      service.handleRepositoryCreationEvent(42, [newRepo(1, 'a')]),
    ).rejects.toThrow('ECONNRESET');
  });
});

describe('GithubService.handleUninstallEvent', () => {
  let service: GithubService;
  let repoIntegration: any;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
  });

  it('deletes the integration when it exists', async () => {
    (repoIntegration.findOne as any).mockResolvedValue({
      id: 'int-1',
      installationId: 42,
    });
    (repoIntegration.delete as any).mockResolvedValue({ affected: 1 });

    await service.handleUninstallEvent(42);

    expect(repoIntegration.delete).toHaveBeenCalledWith('int-1');
  });

  it('is idempotent when the integration is already gone', async () => {
    // GitHub retries installation.deleted on transient 5xx; once the first
    // delivery deleted the row, retries must not throw — otherwise we keep
    // returning 5xx and GitHub stays stuck in its retry budget.
    (repoIntegration.findOne as any).mockResolvedValue(null);

    await expect(service.handleUninstallEvent(42)).resolves.toBeUndefined();
    expect(repoIntegration.delete).not.toHaveBeenCalled();
  });
});

describe('GithubService.handleRepositoryDeletionEvent', () => {
  let service: GithubService;
  let repoRepo: any;

  const removedRepo = (id: number, name: string) => ({
    id,
    node_id: `MDEw${id}`,
    name,
    full_name: `org/${name}`,
    private: false,
  });

  /** Build a fluent createQueryBuilder mock whose getOne returns successive values. */
  const mockQbReturning = (values: any[]) => {
    let i = 0;
    return jest.fn().mockImplementation(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(() => Promise.resolve(values[i++])),
    }));
  };

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoRepo = built.repoRepo;
  });

  it('deletes each existing repository in the batch', async () => {
    repoRepo.createQueryBuilder = mockQbReturning([
      { id: 'row-1' },
      { id: 'row-2' },
    ]);
    (repoRepo.delete as any).mockResolvedValue({ affected: 1 });
    await service.handleRepositoryDeletionEvent(42, [
      removedRepo(1, 'a'),
      removedRepo(2, 'b'),
    ]);
    expect(repoRepo.delete).toHaveBeenCalledTimes(2);
    expect(repoRepo.delete).toHaveBeenNthCalledWith(1, 'row-1');
    expect(repoRepo.delete).toHaveBeenNthCalledWith(2, 'row-2');
  });

  it('does not crash when a removed repo is unknown to our database', async () => {
    repoRepo.createQueryBuilder = mockQbReturning([null, { id: 'row-2' }]);
    (repoRepo.delete as any).mockResolvedValue({ affected: 1 });
    await expect(
      service.handleRepositoryDeletionEvent(42, [
        removedRepo(1, 'missing'),
        removedRepo(2, 'b'),
      ]),
    ).resolves.toBeUndefined();
    expect(repoRepo.delete).toHaveBeenCalledTimes(1);
    expect(repoRepo.delete).toHaveBeenCalledWith('row-2');
  });
});

// ---------------------------------------------------------------------------
// Branch create/delete webhook handlers — keep `github_branches` in sync
// incrementally from GitHub `create` and `delete` events.
//
// Both handlers must:
//   - upsert / delete only when ref_type === 'branch'
//   - no-op (skipped + log) on tag events or unknown repos
//   - never throw on invalid payloads
//   - be idempotent (repeated upserts/deletes do not error)
// ---------------------------------------------------------------------------

describe('GithubService.handleWebhookEvent — branch create/delete', () => {
  let service: GithubService;
  let repoRepo: any;
  let branchRepo: any;
  let loggerMock: ReturnType<typeof createLoggerMock>;

  const createBranchBody = {
    ref: 'feature/foo',
    ref_type: 'branch',
    repository: { id: 999 },
    installation: { id: 12345 },
  };
  const createTagBody = { ...createBranchBody, ref_type: 'tag' };
  const deleteBranchBody = { ...createBranchBody };
  const deleteTagBody = { ...createBranchBody, ref_type: 'tag' };

  const knownRepo = {
    id: 'repo-1',
    githubId: 999,
    fullName: 'org/cool-repo',
    defaultBranch: 'main',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    repoRepo = built.repoRepo;
    branchRepo = built.branchRepo;
    loggerMock = built.loggerMock;
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  it('1. create event with ref_type=branch and known repo upserts the branch', async () => {
    (repoRepo.findOne as any).mockResolvedValue(knownRepo);

    await expect(
      (service as any).handleBranchCreateEvent(createBranchBody),
    ).resolves.toBeUndefined();

    expect(repoRepo.findOne).toHaveBeenCalledWith({
      where: { githubId: 999 },
    });
    expect(branchRepo.upsert).toHaveBeenCalledTimes(1);
    expect(branchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'feature/foo', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
  });

  it('2. create event is idempotent — calling twice does not error and upserts twice', async () => {
    (repoRepo.findOne as any).mockResolvedValue(knownRepo);

    await (service as any).handleBranchCreateEvent(createBranchBody);
    await (service as any).handleBranchCreateEvent(createBranchBody);

    expect(branchRepo.upsert).toHaveBeenCalledTimes(2);
    expect(branchRepo.upsert).toHaveBeenNthCalledWith(
      1,
      { repositoryId: 'repo-1', name: 'feature/foo', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
    expect(branchRepo.upsert).toHaveBeenNthCalledWith(
      2,
      { repositoryId: 'repo-1', name: 'feature/foo', isProtected: false },
      { conflictPaths: ['repositoryId', 'name'] },
    );
  });

  it('3. create event with ref_type=tag is a no-op (no DB calls)', async () => {
    await expect(
      (service as any).handleBranchCreateEvent(createTagBody),
    ).resolves.toBeUndefined();

    expect(repoRepo.findOne).not.toHaveBeenCalled();
    expect(branchRepo.upsert).not.toHaveBeenCalled();
  });

  it('4. create event for unknown githubId — no upsert, no throw, warn log', async () => {
    (repoRepo.findOne as any).mockResolvedValue(null);

    await expect(
      (service as any).handleBranchCreateEvent(createBranchBody),
    ).resolves.toBeUndefined();

    expect(repoRepo.findOne).toHaveBeenCalledWith({
      where: { githubId: 999 },
    });
    expect(branchRepo.upsert).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown_repo'),
    );
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  it('5. delete event with ref_type=branch and known repo deletes the branch row', async () => {
    (repoRepo.findOne as any).mockResolvedValue(knownRepo);
    (branchRepo.delete as any).mockResolvedValue({ affected: 1 });

    await expect(
      (service as any).handleBranchDeleteEvent(deleteBranchBody),
    ).resolves.toBeUndefined();

    expect(repoRepo.findOne).toHaveBeenCalledWith({
      where: { githubId: 999 },
    });
    expect(branchRepo.delete).toHaveBeenCalledTimes(1);
    expect(branchRepo.delete).toHaveBeenCalledWith({
      repositoryId: 'repo-1',
      name: 'feature/foo',
    });
  });

  it('6. delete event is idempotent for a non-existent branch (affected: 0)', async () => {
    (repoRepo.findOne as any).mockResolvedValue(knownRepo);
    (branchRepo.delete as any).mockResolvedValue({ affected: 0 });

    await expect(
      (service as any).handleBranchDeleteEvent(deleteBranchBody),
    ).resolves.toBeUndefined();

    expect(branchRepo.delete).toHaveBeenCalledTimes(1);
    expect(branchRepo.delete).toHaveBeenCalledWith({
      repositoryId: 'repo-1',
      name: 'feature/foo',
    });
  });

  it('7. delete event with ref_type=tag is a no-op (no DB calls)', async () => {
    await expect(
      (service as any).handleBranchDeleteEvent(deleteTagBody),
    ).resolves.toBeUndefined();

    expect(repoRepo.findOne).not.toHaveBeenCalled();
    expect(branchRepo.delete).not.toHaveBeenCalled();
  });

  it('8. delete event for unknown githubId — no delete, no throw, warn log', async () => {
    (repoRepo.findOne as any).mockResolvedValue(null);

    await expect(
      (service as any).handleBranchDeleteEvent(deleteBranchBody),
    ).resolves.toBeUndefined();

    expect(repoRepo.findOne).toHaveBeenCalledWith({
      where: { githubId: 999 },
    });
    expect(branchRepo.delete).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown_repo'),
    );
  });
});

// ---------------------------------------------------------------------------
// getRepositoryBranchesPaginated
// ---------------------------------------------------------------------------

describe('GithubService.getRepositoryBranchesPaginated', () => {
  let service: GithubService;
  let repoRepo: any;
  let branchRepo: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    repoRepo = built.repoRepo;
    branchRepo = built.branchRepo;
  });

  const makeRepo = (o: any = {}) => ({
    id: 'repo-1',
    fullName: 'org/cool-repo',
    defaultBranch: 'main',
    scanBranch: 'develop',
    branchesSyncedAt: new Date('2026-01-01'),
    integration: { id: 'int-1', installationId: 7777, organizationId: 'org-1' },
    ...o,
  });

  it('searches + paginates + excludes archived + default-first, returns total', async () => {
    (repoRepo.findOne as any).mockResolvedValue(makeRepo());
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      setParameter: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          { name: 'main', isProtected: true },
          { name: 'feature/x', isProtected: false },
        ],
        42,
      ]),
    };
    (branchRepo.createQueryBuilder as any) = jest.fn(() => qb);

    const res = await service.getRepositoryBranchesPaginated({
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

  it('repo not found for project → RpcException', async () => {
    (repoRepo.findOne as any).mockResolvedValue(null);
    await expect(
      service.getRepositoryBranchesPaginated({
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
    (repoRepo.findOne as any).mockResolvedValue(makeRepo());
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      setParameter: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue([[{ name: 'old-release', isProtected: false }], 1]),
    };
    (branchRepo.createQueryBuilder as any) = jest.fn(() => qb);

    const res = await service.getRepositoryBranchesPaginated({
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
    (repoRepo.findOne as any).mockResolvedValue(repo);
    const lazySpy = jest
      .spyOn<any, any>(service as any, 'lazyFillBranches')
      .mockResolvedValue(undefined);
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      setParameter: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    (branchRepo.createQueryBuilder as any) = jest.fn(() => qb);

    await service.getRepositoryBranchesPaginated({
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
// callbackInstall: object-level authorization of the installation.
//
// The OAuth `code` returned by GitHub after an App installation MUST be
// exchanged for a user-to-server token, and the caller MUST be proven to have
// access to the target installation, BEFORE any DB write: installation ids
// are sequential, so knowing one must never be enough to bind it (and its
// private repos) to another organization.
// ---------------------------------------------------------------------------

describe('GithubService.callbackInstall (OAuth code + installation ownership)', () => {
  let service: GithubService;
  let repoIntegration: any;
  let repoRepo: any;
  let originalFetch: typeof global.fetch;

  const MY_ORG = 'my-org';
  const MY_USER = 'user-1';
  const TARGET_INSTALLATION_ID = 4242;
  const TARGET_ACCOUNT_ID = 5150;

  /** Route the shared Octokit mock by request path. */
  const routeOctokit = (opts: { userInstallations?: () => any } = {}) => {
    mockOctokitInstance.request.mockImplementation(async (route: string) => {
      if (route.startsWith('GET /user/installations')) {
        return opts.userInstallations?.() ?? { data: { installations: [] } };
      }
      if (route.startsWith('GET /app/installations')) {
        return {
          data: {
            id: TARGET_INSTALLATION_ID,
            // Installed moments ago: the normal onboarding path.
            created_at: new Date().toISOString(),
            account: {
              id: TARGET_ACCOUNT_ID,
              login: 'target-account',
              type: 'User',
            },
          },
        };
      }
      if (route === 'GET /user') {
        // The authorizing GitHub user is the account that installed the App.
        return { data: { id: TARGET_ACCOUNT_ID } };
      }
      if (route.startsWith('GET /installation/repositories')) {
        return { data: { repositories: [] } };
      }
      throw new Error(`Unexpected Octokit route in test: ${route}`);
    });
  };

  /** Stub the GitHub OAuth token-exchange endpoint (POST .../access_token). */
  const mockTokenExchange = (
    body: Record<string, unknown> = {
      access_token: 'user-tok',
      token_type: 'bearer',
    },
    ok = true,
  ) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 401,
      json: async () => body,
    }) as any;
  };

  const callDto = (overrides: Partial<Record<string, unknown>> = {}) => ({
    installationId: TARGET_INSTALLATION_ID,
    organizationId: MY_ORG,
    userId: MY_USER,
    code: 'oauth-code',
    ...overrides,
  });

  const routesCalled = () =>
    mockOctokitInstance.request.mock.calls.map((c: any[]) => c[0] as string);

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOctokitInstance.request.mockReset();
    originalFetch = global.fetch;
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoRepo = built.repoRepo;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('answers PERMISSION_DENIED and writes nothing when the caller cannot manage the installation', async () => {
    // The caller completed OAuth (valid token) but the installation is NOT
    // in their /user/installations list.
    mockTokenExchange();
    routeOctokit({
      userInstallations: () => ({ data: { installations: [{ id: 99 }] } }),
    });

    try {
      await service.callbackInstall(callDto() as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      expect(err.getError().code).toBe(GrpcStatus.PERMISSION_DENIED);
    }

    // The code WAS exchanged and ownership WAS checked...
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(
      routesCalled().some((r) => r.startsWith('GET /user/installations')),
    ).toBe(true);
    // ...but nothing was written and the app-level installation was never read.
    expect(repoIntegration.save).not.toHaveBeenCalled();
    expect(repoRepo.save).not.toHaveBeenCalled();
    expect(
      routesCalled().some((r) => r.startsWith('GET /app/installations')),
    ).toBe(false);
  });

  it('HAPPY PATH: exchanges the code with our client credentials, verifies ownership, then binds the installation to the org', async () => {
    mockTokenExchange({ access_token: 'user-tok' });
    routeOctokit({
      userInstallations: () => ({
        data: { installations: [{ id: TARGET_INSTALLATION_ID }] },
      }),
    });
    (repoIntegration.findOne as any).mockResolvedValue(null);
    (repoIntegration.save as any).mockImplementation(async (e: any) => ({
      id: 'int-new',
      ...e,
    }));

    const res = await service.callbackInstall(callDto() as any);

    // The address the edition's binding gives, never a fixed host.
    expect(res).toEqual({ returnUri: 'https://appsec.example.org' });

    // Code was exchanged against GitHub's OAuth endpoint with our client creds.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      client_id: 'cid',
      client_secret: 'csecret',
      code: 'oauth-code',
    });

    // Ownership was verified against /user/installations.
    expect(
      routesCalled().some((r) => r.startsWith('GET /user/installations')),
    ).toBe(true);

    // The integration was persisted bound to the caller's org.
    expect(repoIntegration.save).toHaveBeenCalled();
    const savedOrgs = (repoIntegration.save as jest.Mock).mock.calls.map(
      (c) => c[0].organizationId,
    );
    expect(savedOrgs).toContain(MY_ORG);
  });

  it('BAD CODE: PERMISSION_DENIED, ownership never checked, nothing written when GitHub rejects the code', async () => {
    // GitHub answers 200 with an error payload for a bad/expired code.
    mockTokenExchange({ error: 'bad_verification_code' });
    routeOctokit();

    try {
      await service.callbackInstall(callDto() as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      expect(err.getError().code).toBe(GrpcStatus.PERMISSION_DENIED);
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Identity never proven → must not reach the installation listing or DB.
    expect(
      routesCalled().some((r) => r.startsWith('GET /user/installations')),
    ).toBe(false);
    expect(repoIntegration.save).not.toHaveBeenCalled();
  });

  it('MISSING CODE: INVALID_ARGUMENT and GitHub is never called when the code is empty', async () => {
    mockTokenExchange();
    routeOctokit();

    try {
      await service.callbackInstall(callDto({ code: '' }) as any);
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcException);
      expect(err.getError().code).toBe(GrpcStatus.INVALID_ARGUMENT);
    }

    expect(global.fetch).not.toHaveBeenCalled();
    expect(repoIntegration.save).not.toHaveBeenCalled();
  });

  // An installation removed at GitHub whose installation.deleted webhook
  // never arrived still has its row: the old installation is checked (App
  // JWT, no installation token) before a reinstallation is refused
  // ALREADY_EXISTS.
  describe('another installation already recorded for the organization', () => {
    const OLD_INSTALLATION_ID = 111;
    const oldRow = {
      id: 'int-old',
      installationId: OLD_INSTALLATION_ID,
      organizationId: MY_ORG,
    };

    /** GitHub's answer for the OLD installation; the new one exists. */
    const oldInstallationAnswers = (answer: () => Promise<unknown>) =>
      mockOctokitInstance.request.mockImplementation(
        async (route: string, params: { installation_id?: number }) => {
          if (route.startsWith('GET /user/installations')) {
            return {
              data: { installations: [{ id: TARGET_INSTALLATION_ID }] },
            };
          }
          if (route === 'GET /app/installations/{installation_id}') {
            if (params.installation_id === OLD_INSTALLATION_ID) {
              return answer();
            }
            return {
              data: {
                id: TARGET_INSTALLATION_ID,
                created_at: new Date().toISOString(),
                account: {
                  id: TARGET_ACCOUNT_ID,
                  login: 'target-account',
                  type: 'User',
                },
              },
            };
          }
          if (route === 'GET /user') {
            return { data: { id: TARGET_ACCOUNT_ID } };
          }
          if (route.startsWith('GET /installation/repositories')) {
            return { data: { repositories: [] } };
          }
          throw new Error(`Unexpected Octokit route in test: ${route}`);
        },
      );

    beforeEach(() => {
      mockTokenExchange();
      (repoIntegration.findOne as any).mockImplementation(
        async (opts: { where: Record<string, unknown> }) => {
          if ('organizationId' in opts.where) return oldRow; // the other one
          if (opts.where.installationId === OLD_INSTALLATION_ID) return oldRow;
          return null; // the new installation is not recorded yet
        },
      );
      (repoIntegration.save as any).mockImplementation(async (e: any) => ({
        id: 'int-new',
        ...e,
      }));
      (repoIntegration.delete as any).mockResolvedValue({ affected: 1 });
    });

    it('removes it when GitHub no longer knows it (404), and accepts the reinstallation', async () => {
      oldInstallationAnswers(async () => {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      });

      await expect(service.callbackInstall(callDto() as any)).resolves.toEqual({
        returnUri: expect.any(String),
      });

      expect(repoIntegration.delete).toHaveBeenCalledWith('int-old');
      expect(repoIntegration.save).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: TARGET_INSTALLATION_ID,
          organizationId: MY_ORG,
        }),
      );
    });

    it('still refuses while GitHub knows it', async () => {
      oldInstallationAnswers(async () => ({
        data: { id: OLD_INSTALLATION_ID, account: { login: 'other' } },
      }));

      await expect(
        service.callbackInstall(callDto() as any),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
      });
      expect(repoIntegration.delete).not.toHaveBeenCalled();
      expect(repoIntegration.save).not.toHaveBeenCalled();
    });

    it('still refuses when GitHub cannot tell (5xx)', async () => {
      oldInstallationAnswers(async () => {
        throw Object.assign(new Error('Bad Gateway'), { status: 502 });
      });

      await expect(
        service.callbackInstall(callDto() as any),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
      });
      expect(repoIntegration.delete).not.toHaveBeenCalled();
    });
  });

  // The GitHub account is stored with the installation, so the
  // GHCR status no longer mints a token to learn it.
  it('records the GitHub account of a new installation', async () => {
    mockTokenExchange();
    routeOctokit({
      userInstallations: () => ({
        data: { installations: [{ id: TARGET_INSTALLATION_ID }] },
      }),
    });
    (repoIntegration.findOne as any).mockResolvedValue(null);
    (repoIntegration.save as any).mockImplementation(async (e: any) => ({
      id: 'int-new',
      ...e,
    }));

    await service.callbackInstall(callDto() as any);

    expect(repoIntegration.save).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: TARGET_INSTALLATION_ID,
        organizationId: MY_ORG,
        githubOwner: 'target-account',
      }),
    );
  });

  it('fills the GitHub account of an installation row recorded without one', async () => {
    mockTokenExchange();
    routeOctokit({
      userInstallations: () => ({
        data: { installations: [{ id: TARGET_INSTALLATION_ID }] },
      }),
    });
    const row = {
      id: 'int-1',
      installationId: TARGET_INSTALLATION_ID,
      organizationId: MY_ORG,
      userId: MY_USER,
      githubOwner: null,
    };
    (repoIntegration.findOne as any)
      .mockResolvedValueOnce(null) // no other installation for the org
      .mockResolvedValueOnce(row); // this installation, already recorded

    await service.callbackInstall(callDto() as any);

    expect(repoIntegration.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'int-1', githubOwner: 'target-account' }),
    );
  });
});

// ---------------------------------------------------------------------------
// callbackInstall: proof that the caller administers an installation that is
// not fresh. `GET /user/installations` lists every installation in which the
// user can see one repository, a read-only collaborator included, so it does
// not prove the right to bind an orphan installation (installed earlier, never
// connected, or recorded by the installation.created webhook without an
// organization) to the caller's organization.
// ---------------------------------------------------------------------------

describe('GithubService.callbackInstall (proof of administration of an older installation)', () => {
  let service: GithubService;
  let repoIntegration: any;
  let originalFetch: typeof global.fetch;

  const MY_ORG = 'my-org';
  const OTHER_ORG = 'other-org';
  const MY_USER = 'user-1';
  const INSTALLATION_ID = 4242;
  const GITHUB_USER_ID = 777;
  const ACCOUNT_ID = 9001;

  const minutesAgo = (m: number) =>
    new Date(Date.now() - m * 60 * 1000).toISOString();

  type RepoPermission = { id: number; admin: boolean };
  interface GithubWorld {
    createdAt?: string;
    accountType: 'User' | 'Organization';
    accountId?: number;
    authenticatedUserId?: number;
    membership?: () => Promise<unknown>;
    installationRepoIds?: number[];
    userRepos?: RepoPermission[];
    failRoute?: string;
  }

  const PROOF_ROUTES = [
    'GET /user',
    'GET /user/memberships/orgs/{org}',
    'GET /user/installations/{installation_id}/repositories',
  ];

  const page = <T>(
    items: T[],
    params: { page?: number; per_page?: number },
  ) => {
    const perPage = params.per_page ?? 30;
    const start = ((params.page ?? 1) - 1) * perPage;
    return items.slice(start, start + perPage);
  };

  /** Route the shared Octokit mock by exact route, like GitHub would answer. */
  const github = (world: GithubWorld) => {
    mockOctokitInstance.request.mockImplementation(
      async (route: string, params: Record<string, any> = {}) => {
        if (world.failRoute === route) {
          throw Object.assign(new Error('Server Error'), { status: 502 });
        }
        switch (route) {
          case 'GET /user/installations':
            return { data: { installations: [{ id: INSTALLATION_ID }] } };
          case 'GET /app/installations/{installation_id}':
            return {
              data: {
                id: INSTALLATION_ID,
                created_at: world.createdAt,
                account: {
                  id: world.accountId ?? ACCOUNT_ID,
                  login: 'acme',
                  type: world.accountType,
                },
              },
            };
          case 'GET /installation/repositories': {
            const repos = (world.installationRepoIds ?? []).map((id) => ({
              id,
              node_id: `n${id}`,
              name: `r${id}`,
              full_name: `acme/r${id}`,
              private: true,
            }));
            return { data: { repositories: page(repos, params) } };
          }
          case 'GET /user':
            return { data: { id: world.authenticatedUserId ?? 1 } };
          case 'GET /user/memberships/orgs/{org}':
            if (!world.membership) {
              throw Object.assign(new Error('Not Found'), { status: 404 });
            }
            return world.membership();
          case 'GET /user/installations/{installation_id}/repositories': {
            const repos = (world.userRepos ?? []).map((r) => ({
              id: r.id,
              permissions: { admin: r.admin, push: true, pull: true },
            }));
            return {
              data: {
                total_count: repos.length,
                repositories: page(repos, params),
              },
            };
          }
          default:
            throw new Error(`Unexpected Octokit route in test: ${route}`);
        }
      },
    );
  };

  /** The rows the database holds: no other installation for MY_ORG. */
  const recorded = (row: Record<string, unknown> | null) => {
    (repoIntegration.findOne as any).mockImplementation(
      async (opts: { where: Record<string, unknown> }) => {
        if ('organizationId' in opts.where) return null;
        return row;
      },
    );
  };

  const callDto = () => ({
    installationId: INSTALLATION_ID,
    organizationId: MY_ORG,
    userId: MY_USER,
    code: 'oauth-code',
  });

  const routesCalled = () =>
    mockOctokitInstance.request.mock.calls.map((c: any[]) => c[0] as string);

  // The organizations written to the installation row, by an insert or
  // save, or by the conditional update that binds a row with none.
  const savedOrganizations = () => [
    ...(repoIntegration.save as jest.Mock).mock.calls.map(
      (c) => c[0].organizationId,
    ),
    ...(repoIntegration.update as jest.Mock).mock.calls.map(
      (c) => c[1].organizationId,
    ),
  ];

  const expectRefused = async () => {
    let caught: unknown;
    try {
      await service.callbackInstall(callDto() as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RpcException);
    const error = (caught as RpcException).getError() as {
      code: number;
      message: string;
    };
    expect(error.code).toBe(GrpcStatus.PERMISSION_DENIED);
    expect(error.message).toBe(
      'An administrator of the GitHub account must connect this installation.',
    );
    expect(savedOrganizations()).not.toContain(MY_ORG);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOctokitInstance.request.mockReset();
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'user-tok' }),
    }) as any;
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    (repoIntegration.save as any).mockImplementation(async (e: any) => ({
      id: 'int-new',
      ...e,
    }));
    // The row is still unbound: the conditional update changes it.
    (repoIntegration.update as any).mockResolvedValue({ affected: 1 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('a fresh installation is refused for a GitHub user who can only read one of its repositories', async () => {
    github({
      createdAt: minutesAgo(2),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'member' } }),
      installationRepoIds: [1, 2, 3],
      userRepos: [{ id: 2, admin: false }],
    });
    recorded(null);

    await expectRefused();
    expect(repoIntegration.save).not.toHaveBeenCalled();
    // The proof ran although the installation is seconds old.
    expect(routesCalled()).toContain('GET /user/memberships/orgs/{org}');
  });

  it('a fresh installation recorded by the webhook stays unbound for a read-only collaborator', async () => {
    github({
      createdAt: minutesAgo(1),
      accountType: 'Organization',
      installationRepoIds: [1],
      userRepos: [{ id: 1, admin: false }],
    });
    const row = {
      id: 'int-1',
      installationId: INSTALLATION_ID,
      organizationId: null,
      userId: null,
    };
    recorded(row);

    await expectRefused();
    expect(row.organizationId).toBeNull();
  });

  it('a fresh installation is bound for an owner of its GitHub organization', async () => {
    github({
      createdAt: minutesAgo(2),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'admin' } }),
      installationRepoIds: [1],
    });
    recorded(null);

    await service.callbackInstall(callDto() as any);

    expect(savedOrganizations()).toContain(MY_ORG);
    expect(routesCalled().filter((r) => PROOF_ROUTES.includes(r))).toEqual([
      'GET /user/memberships/orgs/{org}',
    ]);
  });

  it('an older installation with no row: a read-only collaborator is refused', async () => {
    github({
      createdAt: minutesAgo(60 * 24),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'member' } }),
      installationRepoIds: [1, 2],
      userRepos: [{ id: 1, admin: false }],
    });
    recorded(null);

    await expectRefused();
    expect(repoIntegration.save).not.toHaveBeenCalled();
  });

  it('an older installation recorded by the webhook without an organization stays unbound for a read-only collaborator', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'member' } }),
      installationRepoIds: [1],
      userRepos: [{ id: 1, admin: false }],
    });
    const row = {
      id: 'int-1',
      installationId: INSTALLATION_ID,
      organizationId: null,
      userId: null,
    };
    recorded(row);

    await expectRefused();
    expect(repoIntegration.save).not.toHaveBeenCalled();
    expect(repoIntegration.update).not.toHaveBeenCalled();
    expect(row.organizationId).toBeNull();
  });

  it('an installation without a creation date is treated as older (fail closed)', async () => {
    github({
      createdAt: undefined,
      accountType: 'User',
      authenticatedUserId: GITHUB_USER_ID,
      accountId: ACCOUNT_ID,
    });
    recorded(null);

    await expectRefused();
  });

  it('a personal account installation: another GitHub user is refused', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'User',
      authenticatedUserId: GITHUB_USER_ID,
      accountId: ACCOUNT_ID,
    });
    recorded(null);

    await expectRefused();
  });

  it('a personal account installation: the account owner is accepted', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'User',
      authenticatedUserId: ACCOUNT_ID,
      accountId: ACCOUNT_ID,
    });
    recorded(null);

    await service.callbackInstall(callDto() as any);

    expect(savedOrganizations()).toContain(MY_ORG);
  });

  it('an organization installation: an active organization owner is accepted', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'admin' } }),
    });
    const row = {
      id: 'int-1',
      installationId: INSTALLATION_ID,
      organizationId: null,
      userId: null,
      githubOwner: 'acme',
    };
    recorded(row);

    await service.callbackInstall(callDto() as any);

    expect(savedOrganizations()).toContain(MY_ORG);
    expect(mockOctokitInstance.request).toHaveBeenCalledWith(
      'GET /user/memberships/orgs/{org}',
      expect.objectContaining({ org: 'acme' }),
    );
  });

  it('an organization installation: a pending owner invitation is not enough', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'pending', role: 'admin' } }),
      installationRepoIds: [1],
      userRepos: [{ id: 1, admin: false }],
    });
    recorded(null);

    await expectRefused();
  });

  it('an organization installation: an administrator of every covered repository is accepted (membership refused)', async () => {
    const covered = Array.from({ length: 101 }, (_, i) => i + 1);
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      installationRepoIds: covered,
      userRepos: covered.map((id) => ({ id, admin: true })),
    });
    recorded(null);

    await service.callbackInstall(callDto() as any);

    expect(savedOrganizations()).toContain(MY_ORG);
    // Both pages of the user's repositories were read.
    const userRepoPages = mockOctokitInstance.request.mock.calls.filter(
      (c: any[]) =>
        c[0] === 'GET /user/installations/{installation_id}/repositories',
    );
    expect(userRepoPages.length).toBe(2);
    expect(userRepoPages[0][1]).toMatchObject({
      installation_id: INSTALLATION_ID,
    });
  });

  it('an organization installation: an administrator of only some covered repositories is refused', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      installationRepoIds: [1, 2, 3],
      userRepos: [
        { id: 1, admin: true },
        { id: 2, admin: true },
      ],
    });
    recorded(null);

    await expectRefused();
  });

  it('an organization installation: an administrator of a repository that is not admin on another is refused', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      installationRepoIds: [1, 2],
      userRepos: [
        { id: 1, admin: true },
        { id: 2, admin: false },
      ],
    });
    recorded(null);

    await expectRefused();
  });

  it('an organization installation covering no repository is refused', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      installationRepoIds: [],
      userRepos: [],
    });
    recorded(null);

    await expectRefused();
  });

  it.each([
    ['GET /user', 'User'],
    ['GET /installation/repositories', 'Organization'],
    ['GET /user/installations/{installation_id}/repositories', 'Organization'],
  ] as const)(
    'a GitHub error during the proof (%s) refuses',
    async (failRoute, accountType) => {
      github({
        createdAt: minutesAgo(60),
        accountType,
        authenticatedUserId: ACCOUNT_ID,
        accountId: ACCOUNT_ID,
        installationRepoIds: [1],
        userRepos: [{ id: 1, admin: true }],
        failRoute,
      });
      recorded(null);

      await expectRefused();
    },
  );

  it('an installation bound to another organization answers ALREADY_EXISTS and stays where it was', async () => {
    github({
      createdAt: minutesAgo(1),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'admin' } }),
    });
    const row = {
      id: 'int-1',
      installationId: INSTALLATION_ID,
      organizationId: OTHER_ORG,
      userId: 'someone',
      githubOwner: 'acme',
    };
    recorded(row);

    await expect(
      service.callbackInstall(callDto() as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
    });

    expect(repoIntegration.save).not.toHaveBeenCalled();
    expect(row).toEqual({
      id: 'int-1',
      installationId: INSTALLATION_ID,
      organizationId: OTHER_ORG,
      userId: 'someone',
      githubOwner: 'acme',
    });
  });

  it('an installation already bound to the same organization answers success and changes nothing', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
    });
    recorded({
      id: 'int-1',
      installationId: INSTALLATION_ID,
      organizationId: MY_ORG,
      userId: 'someone',
      githubOwner: 'acme',
    });

    await expect(service.callbackInstall(callDto() as any)).resolves.toEqual({
      returnUri: expect.any(String),
    });
    expect(repoIntegration.save).not.toHaveBeenCalled();
  });

  it('an installation bound by the webhook path to another organization while the callback ran answers ALREADY_EXISTS', async () => {
    github({
      createdAt: minutesAgo(60),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'active', role: 'admin' } }),
      installationRepoIds: [1],
    });
    let reads = 0;
    (repoIntegration.findOne as any).mockImplementation(
      async (opts: { where: Record<string, unknown> }) => {
        if ('organizationId' in opts.where) return null;
        reads += 1;
        // First read: no row yet. After the insert collides, the row that
        // won belongs to another organization.
        return reads === 1
          ? null
          : {
              id: 'int-1',
              installationId: INSTALLATION_ID,
              organizationId: OTHER_ORG,
              userId: 'someone',
            };
      },
    );
    (repoIntegration.save as any).mockImplementation(async () => {
      throw Object.assign(new Error('Duplicate entry'), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      });
    });

    await expect(
      service.callbackInstall(callDto() as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
    });
  });

  it('a GitHub organization member whose membership is pending is refused, even on a fresh installation', async () => {
    github({
      createdAt: minutesAgo(1),
      accountType: 'Organization',
      membership: async () => ({ data: { state: 'pending', role: 'member' } }),
      installationRepoIds: [1],
      userRepos: [{ id: 1, admin: false }],
    });
    recorded(null);

    await expectRefused();
    expect(repoIntegration.save).not.toHaveBeenCalled();
  });

  it('an outside collaborator (not a member of the GitHub organization) who can write to a repository is refused', async () => {
    github({
      createdAt: minutesAgo(1),
      accountType: 'Organization',
      // No membership: GitHub answers 404 for an outside collaborator.
      installationRepoIds: [1, 2],
      userRepos: [{ id: 1, admin: false }],
    });
    recorded(null);

    await expectRefused();
    expect(repoIntegration.save).not.toHaveBeenCalled();
  });

  // Two proven administrators of the same GitHub account, each in their own
  // organization, finish the flow for an installation the webhook recorded
  // without an organization. Exactly one binds it; the other is told.
  describe('two organizations binding the same unbound installation', () => {
    type Row = {
      id: string;
      installationId: number;
      organizationId: string | null;
      userId: string | null;
      githubOwner: string | null;
    };
    let stored: Row;

    const isNullOperator = (value: unknown): boolean =>
      (value as { type?: string } | null)?.type === 'isNull';

    /**
     * The table, as one row: `update` applies its criteria atomically, like
     * the database; `save` writes the entity as given, like TypeORM's
     * update by primary key.
     */
    const table = (readBarrier?: Promise<void>, onRead?: () => void) => {
      (repoIntegration.findOne as any).mockImplementation(
        async (opts: { where: Record<string, unknown> }) => {
          if ('organizationId' in opts.where) return null;
          const snapshot = { ...stored };
          onRead?.();
          if (readBarrier) await readBarrier;
          return snapshot;
        },
      );
      (repoIntegration.update as any).mockImplementation(
        async (criteria: Record<string, unknown>, changes: Partial<Row>) => {
          const matches =
            criteria.id === stored.id &&
            (!('organizationId' in criteria) ||
              (isNullOperator(criteria.organizationId)
                ? stored.organizationId === null
                : criteria.organizationId === stored.organizationId));
          if (!matches) return { affected: 0 };
          Object.assign(stored, changes);
          return { affected: 1 };
        },
      );
      (repoIntegration.save as any).mockImplementation(async (row: Row) => {
        Object.assign(stored, row);
        return { ...stored };
      });
    };

    const dtoFor = (organizationId: string, userId: string) => ({
      installationId: INSTALLATION_ID,
      organizationId,
      userId,
      code: 'oauth-code',
    });

    beforeEach(() => {
      stored = {
        id: 'int-1',
        installationId: INSTALLATION_ID,
        organizationId: null,
        userId: null,
        githubOwner: 'acme',
      };
      github({
        createdAt: minutesAgo(60),
        accountType: 'Organization',
        membership: async () => ({ data: { state: 'active', role: 'admin' } }),
      });
    });

    it('both read the row before either writes: one binds it, the other answers ALREADY_EXISTS', async () => {
      let reads = 0;
      let release: () => void = () => undefined;
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      table(bothRead, () => {
        reads += 1;
        if (reads === 2) release();
      });

      const results = await Promise.allSettled([
        service.callbackInstall(dtoFor(MY_ORG, 'user-a') as any),
        service.callbackInstall(dtoFor(OTHER_ORG, 'user-b') as any),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
      });
      const winner = results[0].status === 'fulfilled' ? MY_ORG : OTHER_ORG;
      expect(stored.organizationId).toBe(winner);
    });

    it('a callback that read the row before another one finished answers ALREADY_EXISTS and leaves the binding alone', async () => {
      // B reads the row while it is still unbound...
      let releaseB: () => void = () => undefined;
      const bMayWrite = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      let markBRead: () => void = () => undefined;
      const bHasRead = new Promise<void>((resolve) => {
        markBRead = resolve;
      });
      let reads = 0;
      table(undefined, undefined);
      (repoIntegration.findOne as any).mockImplementation(
        async (opts: { where: Record<string, unknown> }) => {
          if ('organizationId' in opts.where) return null;
          const snapshot = { ...stored };
          reads += 1;
          // Only B is running when the first read happens. It goes on once
          // A has fully bound the row.
          if (reads === 1) {
            markBRead();
            await bMayWrite;
          }
          return snapshot;
        },
      );

      const b = service.callbackInstall(dtoFor(OTHER_ORG, 'user-b') as any);
      await bHasRead;
      await expect(
        service.callbackInstall(dtoFor(MY_ORG, 'user-a') as any),
      ).resolves.toEqual({ returnUri: expect.any(String) });
      expect(stored.organizationId).toBe(MY_ORG);

      releaseB();
      await expect(b).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
      });
      expect(stored.organizationId).toBe(MY_ORG);
      expect(stored.userId).toBe('user-a');
    });

    it('two callbacks of the same organization both answer success', async () => {
      let reads = 0;
      let release: () => void = () => undefined;
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      table(bothRead, () => {
        reads += 1;
        if (reads === 2) release();
      });

      const results = await Promise.allSettled([
        service.callbackInstall(dtoFor(MY_ORG, 'user-a') as any),
        service.callbackInstall(dtoFor(MY_ORG, 'user-c') as any),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(stored.organizationId).toBe(MY_ORG);
    });
  });
});

describe('GithubService — GitHub account stored with the installation', () => {
  let service: GithubService;
  let repoIntegration: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
  });

  it('the installation.created webhook records the account', async () => {
    (repoIntegration.findOne as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'int-1', installationId: 5 });

    await service.handleInstallationsEvent({
      installation: { id: 5, account: { login: 'acme' } },
      repositories: [],
    });

    expect(repoIntegration.save).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 5, githubOwner: 'acme' }),
    );
  });

  it('an account renamed on GitHub (installation_target.renamed) is renamed here', async () => {
    repoIntegration.findOneBy = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-1' });

    const res = await service.handleWebhookEvent({
      bodyJson: JSON.stringify({
        action: 'renamed',
        installation: { id: 5 },
        account: { login: 'acme-new' },
        changes: { login: { from: 'acme' } },
        target_type: 'Organization',
      }),
      signature: 'sha256=fake',
      event: 'installation_target',
      action: 'renamed',
    } as any);

    expect(res.success).toBe(true);
    expect(repoIntegration.update).toHaveBeenCalledWith(
      { installationId: 5 },
      { githubOwner: 'acme-new' },
    );
  });
});

// ---------------------------------------------------------------------------
// Repository metadata drift — a repository renamed (or made private/public,
// or transferred) on GitHub must reach `github_repositories`. These `repository`
// events used to fall into the `Unhandled event` default branch, so a renamed
// repo kept its old name forever in the create-project picker.
// ---------------------------------------------------------------------------

describe('GithubService.handleWebhookEvent — repository metadata events', () => {
  let service: GithubService;
  let repoIntegration: any;
  let repoRepo: any;
  let loggerMock: ReturnType<typeof createLoggerMock>;
  let getOne: jest.Mock;
  let andWhere: jest.Mock;

  const INSTALLATION_ID = 90050812;
  const storedRow = () => ({
    id: 'row-1',
    githubId: 1160978766,
    name: 'chatbot',
    fullName: 'diagngrow/chatbot',
    private: false,
  });
  const githubRepo = (overrides: Record<string, unknown> = {}) => ({
    id: 1160978766,
    node_id: 'R_1',
    name: 'Agents',
    full_name: 'diagngrow/Agents',
    private: false,
    ...overrides,
  });

  const repositoryEvent = (
    action: string,
    repository: Record<string, unknown>,
  ) =>
    service.handleWebhookEvent({
      bodyJson: JSON.stringify({
        action,
        installation: { id: INSTALLATION_ID },
        repository,
      }),
      signature: 'sha256=any',
      event: 'repository',
      action,
    } as any);

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoRepo = built.repoRepo;
    loggerMock = built.loggerMock;
    jest.spyOn(service, 'verifyWebhookSignature').mockReturnValue(true);
    repoIntegration.findOneBy = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-1' });
    getOne = jest.fn().mockResolvedValue(storedRow());
    andWhere = jest.fn().mockReturnThis();
    repoRepo.createQueryBuilder = jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere,
      getOne,
    }));
    (repoRepo.save as any).mockImplementation(async (e: any) => e);
  });

  it('renamed: stores the new name and full name', async () => {
    await expect(repositoryEvent('renamed', githubRepo())).resolves.toEqual({
      success: true,
    });
    expect(repoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        name: 'Agents',
        fullName: 'diagngrow/Agents',
      }),
    );
    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Unhandled event'),
    );
  });

  it.each([
    ['privatized', true],
    ['publicized', false],
  ])('%s: stores the new visibility', async (action, isPrivate) => {
    await repositoryEvent(
      action,
      githubRepo({
        name: 'chatbot',
        full_name: 'diagngrow/chatbot',
        private: isPrivate,
      }),
    );
    expect(repoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', private: isPrivate }),
    );
  });

  it('transferred: stores the new owner in the full name', async () => {
    await repositoryEvent(
      'transferred',
      githubRepo({ name: 'chatbot', full_name: 'new-owner/chatbot' }),
    );
    expect(repoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'new-owner/chatbot' }),
    );
  });

  it('only touches the row of the installation that sent the event', async () => {
    await repositoryEvent('renamed', githubRepo());
    expect(andWhere).toHaveBeenCalledWith(
      'integration.installationId = :installationId',
      { installationId: INSTALLATION_ID },
    );
  });

  it('unknown repository: no write and no throw (GitHub would retry forever)', async () => {
    getOne.mockResolvedValue(null);
    await expect(repositoryEvent('renamed', githubRepo())).resolves.toEqual({
      success: true,
    });
    expect(repoRepo.save).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown repository'),
    );
  });

  it('actions that change no stored field (archived) are ignored without an Unhandled event warning', async () => {
    await expect(repositoryEvent('archived', githubRepo())).resolves.toEqual({
      success: true,
    });
    expect(repoRepo.save).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Unhandled event'),
    );
  });
});

// ---------------------------------------------------------------------------
// GetRepositories reconciliation — webhooks only cover changes made AFTER the
// fix ships (a rename done months ago never re-sends its event), and a lost
// delivery leaves the stored list stale forever. Serving the list therefore
// reconciles it with GitHub's paginated installation repositories endpoint:
// in the background (the read never waits on GitHub), TTL-throttled, one sync
// in flight per installation, fail-open, insert/update only (a repository is
// never deleted or unlinked from its project by a read).
// ---------------------------------------------------------------------------

describe('GithubService.getRepositories — reconciliation with GitHub', () => {
  let service: GithubService;
  let repoIntegration: any;
  let repoRepo: any;
  let loggerMock: ReturnType<typeof createLoggerMock>;

  const ORG = 'org-1';
  const INSTALLATION_ID = 90050812;
  const installationRow = (repositories: any[]) => ({
    id: 'int-1',
    installationId: INSTALLATION_ID,
    organizationId: ORG,
    repositories,
  });
  const storedRepo = (overrides: Record<string, unknown> = {}) => ({
    id: 'row-1',
    githubId: 1160978766,
    nodeId: 'R_1',
    name: 'chatbot',
    fullName: 'diagngrow/chatbot',
    private: false,
    projectId: null,
    defaultBranch: 'main',
    scanBranch: null,
    ...overrides,
  });
  const githubRepo = (overrides: Record<string, unknown> = {}) => ({
    id: 1160978766,
    node_id: 'R_1',
    name: 'Agents',
    full_name: 'diagngrow/Agents',
    private: false,
    ...overrides,
  });

  /** Serve GET /installation/repositories from `pages` (1-based `page`). */
  const routeInstallationRepositories = (pages: any[][]) => {
    mockOctokitInstance.request.mockImplementation(
      async (route: string, params: { page?: number } = {}) => {
        if (route.startsWith('GET /installation/repositories')) {
          const repositories = pages[(params.page ?? 1) - 1] ?? [];
          return {
            data: { total_count: pages.flat().length, repositories },
          };
        }
        throw new Error(`Unexpected Octokit route in test: ${route}`);
      },
    );
  };

  const fullNames = (res: any) =>
    res.repositories.flatMap((i: any) =>
      i.repository.map((r: any) => r.fullName),
    );

  /** Let the sync a read started in the background run to completion. */
  const backgroundSyncSettled = () =>
    new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOctokitInstance.request.mockReset();
    const built = await buildService();
    service = built.service;
    repoIntegration = built.repoIntegration;
    repoRepo = built.repoRepo;
    loggerMock = built.loggerMock;
  });

  it('serves the stored list without waiting for GitHub', async () => {
    repoIntegration.find.mockResolvedValue([installationRow([storedRepo()])]);
    mockOctokitInstance.request.mockImplementation(() => new Promise(() => {}));

    const res = await Promise.race([
      service.getRepositories({ organizationId: ORG }),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 200)),
    ]);

    expect(res).not.toBe('still waiting');
    expect(fullNames(res)).toEqual(['diagngrow/chatbot']);
  });

  it('stores a repository renamed on GitHub in the background, and the next read returns the new name', async () => {
    repoIntegration.find
      .mockResolvedValueOnce([installationRow([storedRepo()])])
      .mockResolvedValueOnce([
        installationRow([
          storedRepo({ name: 'Agents', fullName: 'diagngrow/Agents' }),
        ]),
      ]);
    routeInstallationRepositories([[githubRepo()]]);

    const first = await service.getRepositories({ organizationId: ORG });
    await backgroundSyncSettled();

    expect(fullNames(first)).toEqual(['diagngrow/chatbot']);
    expect(repoRepo.update).toHaveBeenCalledWith(
      { id: 'row-1' },
      { name: 'Agents', fullName: 'diagngrow/Agents', private: false },
    );
    const next = await service.getRepositories({ organizationId: ORG });
    expect(fullNames(next)).toEqual(['diagngrow/Agents']);
  });

  it('records a repository the installation can access but we never stored', async () => {
    const installation = installationRow([
      storedRepo({ name: 'Agents', fullName: 'diagngrow/Agents' }),
    ]);
    repoIntegration.find.mockResolvedValue([installation]);
    routeInstallationRepositories([
      [
        githubRepo(),
        githubRepo({
          id: 1225344791,
          node_id: 'R_2',
          name: 'OpenSandbox',
          full_name: 'diagngrow/OpenSandbox',
        }),
      ],
    ]);

    await service.getRepositories({ organizationId: ORG });
    await backgroundSyncSettled();

    expect(repoRepo.save).toHaveBeenCalledTimes(1);
    expect(repoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        githubId: 1225344791,
        nodeId: 'R_2',
        name: 'OpenSandbox',
        fullName: 'diagngrow/OpenSandbox',
        private: false,
        integration: installation,
      }),
    );
  });

  it('does not rewrite rows whose metadata already matches (visibility compared by truthiness)', async () => {
    repoIntegration.find.mockResolvedValue([
      installationRow([
        storedRepo({
          name: 'Agents',
          fullName: 'diagngrow/Agents',
          private: 1,
        }),
      ]),
    ]);
    routeInstallationRepositories([[githubRepo({ private: true })]]);

    await service.getRepositories({ organizationId: ORG });
    await backgroundSyncSettled();

    expect(repoRepo.update).not.toHaveBeenCalled();
    expect(repoRepo.save).not.toHaveBeenCalled();
  });

  it('never deletes or unlinks a stored repository missing from the GitHub list', async () => {
    repoIntegration.find.mockResolvedValue([
      installationRow([storedRepo({ projectId: 'project-1' })]),
    ]);
    routeInstallationRepositories([[]]);

    const res = await service.getRepositories({ organizationId: ORG });
    await backgroundSyncSettled();

    expect(repoRepo.delete).not.toHaveBeenCalled();
    expect(repoRepo.update).not.toHaveBeenCalled();
    expect(fullNames(res)).toEqual(['diagngrow/chatbot']);
  });

  it('does not call GitHub again within the sync TTL', async () => {
    repoIntegration.find.mockResolvedValue([
      installationRow([
        storedRepo({ name: 'Agents', fullName: 'diagngrow/Agents' }),
      ]),
    ]);
    routeInstallationRepositories([[githubRepo()]]);

    await service.getRepositories({ organizationId: ORG });
    await backgroundSyncSettled();
    await service.getRepositories({ organizationId: ORG });

    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(1);
  });

  it('fails open: a failed sync is logged, the stored list is served and the next read retries', async () => {
    repoIntegration.find.mockResolvedValue([installationRow([storedRepo()])]);
    mockOctokitInstance.request.mockRejectedValue(new Error('GitHub down'));

    const res = await service.getRepositories({ organizationId: ORG });
    await backgroundSyncSettled();

    expect(fullNames(res)).toEqual(['diagngrow/chatbot']);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('REPOSITORIES_SYNC'),
    );
    expect(loggerMock.error).not.toHaveBeenCalled();

    await service.getRepositories({ organizationId: ORG });
    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(2);
  });

  it('starts one sync per installation while it is still running, however many reads arrive', async () => {
    repoIntegration.find.mockResolvedValue([installationRow([storedRepo()])]);
    mockOctokitInstance.request.mockImplementation(() => new Promise(() => {}));

    await service.getRepositories({ organizationId: ORG });
    await service.getRepositories({ organizationId: ORG });
    await service.getRepositories({ organizationId: ORG });

    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(1);
  });

  it('a slow sync still lands, and a read within the TTL after it does not call GitHub again', async () => {
    repoIntegration.find.mockResolvedValue([installationRow([storedRepo()])]);
    let releaseGithub!: () => void;
    const githubAnswers = new Promise<void>((resolve) => {
      releaseGithub = resolve;
    });
    mockOctokitInstance.request.mockImplementation(async () => {
      await githubAnswers;
      return { data: { total_count: 1, repositories: [githubRepo()] } };
    });

    const first = await service.getRepositories({ organizationId: ORG });
    expect(fullNames(first)).toEqual(['diagngrow/chatbot']);

    releaseGithub();
    await backgroundSyncSettled();

    expect(repoRepo.update).toHaveBeenCalledWith(
      { id: 'row-1' },
      { name: 'Agents', fullName: 'diagngrow/Agents', private: false },
    );
    await service.getRepositories({ organizationId: ORG });
    expect(mockOctokitInstance.request).toHaveBeenCalledTimes(1);
  });

  it('pages through GET /installation/repositories 100 at a time', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      githubRepo({
        id: 1000 + i,
        node_id: `R_${i}`,
        name: `repo-${i}`,
        full_name: `diagngrow/repo-${i}`,
      }),
    );
    const page2 = [
      githubRepo({ id: 2000, name: 'last', full_name: 'diagngrow/last' }),
    ];
    routeInstallationRepositories([page1, page2]);

    const repos = await (service as any).getInstallationRepositoriesFromAPI(
      INSTALLATION_ID,
    );

    expect(repos).toHaveLength(101);
    expect(mockOctokitInstance.request).toHaveBeenNthCalledWith(
      1,
      'GET /installation/repositories',
      { per_page: 100, page: 1 },
    );
    expect(mockOctokitInstance.request).toHaveBeenNthCalledWith(
      2,
      'GET /installation/repositories',
      { per_page: 100, page: 2 },
    );
  });

  it.each([
    [
      'getInstallationRepositoriesFromAPI',
      'Failed to retrieve installation repositories',
    ],
    ['getInstallationDetails', 'Failed to retrieve installation details'],
  ])(
    '%s answers a stable message, never the API error’s text',
    async (method, message) => {
      const apiError = new Error(
        'Bad credentials - https://api.github.com/?token=private-value-5d1',
      );
      mockOctokitInstance.request.mockRejectedValue(apiError);

      const thrown = await (service as any)
        [method](INSTALLATION_ID)
        .catch((e: { getError: () => unknown }) => e.getError());

      expect(thrown).toEqual({ message, code: GrpcStatus.INTERNAL });
    },
  );
});

// ---------------------------------------------------------------------------
// A failed repository download must reach the scan WITH a reason
// ---------------------------------------------------------------------------

describe('GithubService — repo download failure reporting', () => {
  let service: GithubService;
  let scanServiceClient: ScanServiceClientMock;
  let tmpDir: string;

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

  /** Wire the background flow so only the zipball download can fail. */
  function stubBackgroundFlow(): void {
    jest.spyOn(service as any, 'generateTempPaths').mockReturnValue({
      tmpPath: path.join(tmpDir, 'input.zip'),
      cleanedPath: path.join(tmpDir, 'cleaned.zip'),
    });
    jest
      .spyOn(service as any, 'createInstallationOctokit')
      .mockReturnValue({ auth: jest.fn().mockResolvedValue({ token: 'tok' }) });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const built = await buildService();
    service = built.service;
    scanServiceClient = built.scanServiceClient;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-dl-failure-'));
    // Only the retry sleeps are virtualized; the stream/fs plumbing stays real.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports a rate-limited zipball (429 x3) through updateScanData with code 67, never through the container updateScan RPC', async () => {
    const axiosGet = jest
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosFailure(429, { 'x-ratelimit-remaining': '0' }));
    stubBackgroundFlow();

    const promise = service['downloadAndUploadInBackground'](
      'owner',
      'repo',
      'sha-429',
      1,
      'scan-429',
      'project-1',
      'org-1',
      'main',
      'sast',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await promise;

    // 3 attempts: the initial one plus two retries (2 s, then 4 s).
    expect(axiosGet).toHaveBeenCalledTimes(3);
    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-429',
      state: 'failed',
      errorMessage: expect.stringContaining('rate limit'),
      errorCode: 67,
    });
  });

  it('gives every zipball attempt a 30s header timeout', async () => {
    const axiosGet = jest
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosFailure(429));
    stubBackgroundFlow();

    const promise = service['downloadAndUploadInBackground'](
      'owner',
      'repo',
      'sha-timeout',
      1,
      'scan-timeout',
      'project-1',
      'org-1',
      'main',
      'sast',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(axiosGet).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/zipball/sha-timeout',
      expect.objectContaining({ responseType: 'stream', timeout: 30_000 }),
    );
  });

  it('reports a non-rate-limit download failure with code 66 and does not retry it', async () => {
    const axiosGet = jest
      .spyOn(axios, 'get')
      .mockRejectedValue(axiosFailure(404));
    stubBackgroundFlow();

    await service['downloadAndUploadInBackground'](
      'owner',
      'repo',
      'sha-404',
      1,
      'scan-404',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-404',
      state: 'failed',
      errorMessage: expect.stringContaining('HTTP 404'),
      errorCode: 66,
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
      errorCode: 66,
    });
  });

  // There is no post-download gate on the COMPRESSED size. Size is gated on
  // the UNCOMPRESSED total inside
  // `runZipProcessing` — that rejection arrives at the zip-processing catch
  // below, which still reports code 68. See `core/utils/zip-size-gate.spec.ts`.

  it('reports an archive that is not a ZIP with code 68', async () => {
    const tmpPath = path.join(tmpDir, 'input.zip');
    stubBackgroundFlow();
    jest
      .spyOn(service as any, 'downloadGithubArchive')
      .mockImplementation(() => {
        fs.writeFileSync(tmpPath, Buffer.from([0x00, 0x00, 0x00, 0x00]));
        return Promise.resolve();
      });

    await service['downloadAndUploadInBackground'](
      'owner',
      'repo',
      'sha-not-zip',
      1,
      'scan-not-zip',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-not-zip',
      state: 'failed',
      errorMessage:
        'Invalid archive format received from GitHub. Expected ZIP file.',
      errorCode: 68,
    });
  });

  it('reports a ZIP that cannot be processed with code 68', async () => {
    const tmpPath = path.join(tmpDir, 'input.zip');
    stubBackgroundFlow();
    jest
      .spyOn(service as any, 'downloadGithubArchive')
      .mockImplementation(() => {
        fs.writeFileSync(tmpPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        return Promise.resolve();
      });
    jest
      .spyOn(service as any, 'processZipInWorker')
      .mockRejectedValue(new Error('No END header found'));

    await service['downloadAndUploadInBackground'](
      'owner',
      'repo',
      'sha-bad-zip',
      1,
      'scan-bad-zip',
      'project-1',
      'org-1',
      'main',
      'sast',
    );

    expect(scanServiceClient.updateScan).not.toHaveBeenCalled();
    expect(scanServiceClient.updateScanData).toHaveBeenCalledWith({
      scanId: 'scan-bad-zip',
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

// Repository history (read by a closed rule miner): commits are read with the
// installation token, which never leaves the service, and no author field is
// ever mapped.
describe('GithubService - repository history', () => {
  let service: GithubService;
  const repoEntity = {
    id: 'repo-1',
    fullName: 'acme/shop',
    projectId: 'p1',
    integration: { installationId: 42 },
  } as unknown as GithubRepository;

  beforeEach(async () => {
    ({ service } = await buildService());
    mockOctokitInstance.request.mockReset();
    MockOctokit.mockClear();
  });

  it('lists commits of a branch and path with the installation octokit, without any author field', async () => {
    mockOctokitInstance.request.mockResolvedValue({
      data: [
        {
          sha: 'a'.repeat(40),
          commit: {
            message: 'feat: x\n\nbody',
            committer: {
              date: '2026-10-01T10:00:00Z',
              name: 'Jane',
              email: 'jane@example.com',
            },
            author: { name: 'Jane', email: 'jane@example.com' },
          },
          author: { login: 'jane' },
        },
      ],
    });

    const commits = await service.listCommitsForRepository(repoEntity, {
      branch: 'dev',
      path: 'src/app.ts',
      page: 2,
      perPage: 50,
    });

    expect(commits).toEqual([
      {
        sha: 'a'.repeat(40),
        date: '2026-10-01T10:00:00Z',
        message: 'feat: x\n\nbody',
      },
    ]);
    const [route, params] = mockOctokitInstance.request.mock.calls[0];
    expect(route).toBe('GET /repos/{owner}/{repo}/commits');
    expect(params).toMatchObject({
      owner: 'acme',
      repo: 'shop',
      sha: 'dev',
      path: 'src/app.ts',
      page: 2,
      per_page: 50,
    });
    // A bounded call: an abort signal and no automatic retry.
    expect(params.request.signal).toBeDefined();
    expect(params.request.retries).toBe(0);
    expect(MockOctokit.mock.calls[0][0].auth.installationId).toBe(42);
  });

  it('reuses one history octokit per installation for 10 minutes, so its installation token is minted once', async () => {
    // A mining reads up to ~85 history items: a fresh octokit per call minted a
    // fresh installation token per call (createAppAuth caches per instance).
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      mockOctokitInstance.request.mockResolvedValue({ data: [] });
      const opts = { branch: '', path: '', page: 1, perPage: 100 };
      await service.listCommitsForRepository(repoEntity, opts);
      await service.listCommitsForRepository(repoEntity, opts);
      mockOctokitInstance.request.mockResolvedValue({
        data: { sha: 'b'.repeat(40), commit: { message: 'm' }, files: [] },
      });
      await service.getCommitForRepository(repoEntity, 'bbbbbbb');
      expect(MockOctokit).toHaveBeenCalledTimes(1);

      const other = {
        ...repoEntity,
        integration: { installationId: 43 },
      } as unknown as GithubRepository;
      mockOctokitInstance.request.mockResolvedValue({ data: [] });
      await service.listCommitsForRepository(other, opts);
      expect(MockOctokit).toHaveBeenCalledTimes(2);

      now.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
      await service.listCommitsForRepository(repoEntity, opts);
      expect(MockOctokit).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it('omits sha and path when the branch and path are empty (default branch, every commit)', async () => {
    mockOctokitInstance.request.mockResolvedValue({ data: [] });
    await service.listCommitsForRepository(repoEntity, {
      branch: '',
      path: '',
      page: 1,
      perPage: 100,
    });
    const params = mockOctokitInstance.request.mock.calls[0][1];
    expect(params).not.toHaveProperty('sha');
    expect(params).not.toHaveProperty('path');
  });

  it('does not retry a rate limit on the history octokit', async () => {
    mockOctokitInstance.request.mockResolvedValue({ data: [] });
    await service.listCommitsForRepository(repoEntity, {
      branch: '',
      path: '',
      page: 1,
      perPage: 100,
    });
    const throttle = MockOctokit.mock.calls[0][0].throttle;
    expect(throttle.onRateLimit(10, { method: 'GET', url: 'u' }, {}, 0)).toBe(
      false,
    );
    expect(
      throttle.onSecondaryRateLimit(10, { method: 'GET', url: 'u' }, {}, 0),
    ).toBe(false);
  });

  it('reads one commit with its files', async () => {
    mockOctokitInstance.request.mockResolvedValue({
      data: {
        sha: 'b'.repeat(40),
        commit: {
          message: 'fix: y',
          committer: { date: '2026-10-02T10:00:00Z', email: 'x@example.com' },
        },
        files: [
          {
            filename: 'src/new.ts',
            previous_filename: 'src/old.ts',
            status: 'renamed',
            additions: 1,
            deletions: 2,
            patch: '@@ -1 +1 @@\n-a\n+b',
          },
          {
            filename: 'img.png',
            status: 'added',
            additions: 0,
            deletions: 0,
          },
        ],
      },
    });

    const commit = await service.getCommitForRepository(repoEntity, 'bbbbbbb');

    expect(mockOctokitInstance.request.mock.calls[0][0]).toBe(
      'GET /repos/{owner}/{repo}/commits/{ref}',
    );
    expect(mockOctokitInstance.request.mock.calls[0][1]).toMatchObject({
      owner: 'acme',
      repo: 'shop',
      ref: 'bbbbbbb',
    });
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
          patch: '@@ -1 +1 @@\n-a\n+b',
        },
        {
          path: 'img.png',
          oldPath: '',
          status: 'added',
          additions: 0,
          deletions: 0,
          patch: '',
        },
      ],
    });
  });

  it('flags more files when GitHub returns its 300-file page', async () => {
    mockOctokitInstance.request.mockResolvedValue({
      data: {
        sha: 'c'.repeat(40),
        commit: { message: 'm', committer: { date: 'd' } },
        files: Array.from({ length: 300 }, (_, i) => ({
          filename: `f${i}`,
          status: 'modified',
          additions: 0,
          deletions: 0,
        })),
      },
    });
    const commit = await service.getCommitForRepository(repoEntity, 'ccccccc');
    expect(commit.moreFiles).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findBranch: a container scan's branch must exist in the repo
// ---------------------------------------------------------------------------

describe('GithubService.findBranch', () => {
  let service: GithubService;
  let branchRepo: any;
  let loggerMock: any;

  const repository = {
    id: 'repo-1',
    fullName: 'org/cool-repo',
    defaultBranch: 'main',
    branchesSyncedAt: new Date('2026-01-01'),
    integration: { id: 'int-1', installationId: 7777, organizationId: 'org-1' },
  } as unknown as GithubRepository;

  /** An Octokit RequestError as GitHub answers it. */
  const githubError = (httpStatus: number, message: string) =>
    Object.assign(new Error(`${message} - https://docs.github.com`), {
      status: httpStatus,
      response: { status: httpStatus, data: { message } },
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOctokitInstance.request.mockReset();
    const built = await buildService();
    service = built.service;
    branchRepo = built.branchRepo;
    loggerMock = built.loggerMock;
  });

  it('answers from the synced branches, with their own spelling, without asking GitHub', async () => {
    branchRepo.findOne.mockResolvedValue({ id: 'b1', name: 'develop' });

    await expect(service.findBranch(repository, 'Develop')).resolves.toBe(
      'develop',
    );

    expect(branchRepo.findOne).toHaveBeenCalledWith({
      where: { repositoryId: 'repo-1', name: 'Develop' },
    });
    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
  });

  it('asks GitHub for a branch the webhooks have not brought yet, and keeps it', async () => {
    branchRepo.findOne.mockResolvedValue(null);
    mockOctokitInstance.request.mockResolvedValue({
      data: {
        name: 'feature/new',
        protected: true,
        commit: { sha: 'a'.repeat(40) },
      },
    });

    await expect(service.findBranch(repository, 'feature/new')).resolves.toBe(
      'feature/new',
    );

    expect(mockOctokitInstance.request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/branches/{branch}',
      { owner: 'org', repo: 'cool-repo', branch: 'feature/new' },
    );
    expect(branchRepo.upsert).toHaveBeenCalledWith(
      { repositoryId: 'repo-1', name: 'feature/new', isProtected: true },
      { conflictPaths: ['repositoryId', 'name'] },
    );
  });

  it('still answers the branch when keeping it fails: GitHub has confirmed it', async () => {
    branchRepo.findOne.mockResolvedValue(null);
    branchRepo.upsert.mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));
    mockOctokitInstance.request.mockResolvedValue({
      data: { name: 'feature/new', protected: false },
    });

    await expect(service.findBranch(repository, 'feature/new')).resolves.toBe(
      'feature/new',
    );
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('is null when GitHub answers "Branch not found": an image tag is not a branch', async () => {
    branchRepo.findOne.mockResolvedValue(null);
    mockOctokitInstance.request.mockRejectedValue(
      githubError(404, 'Branch not found'),
    );

    await expect(
      service.findBranch(repository, 'v2.102.0'),
    ).resolves.toBeNull();
    expect(branchRepo.upsert).not.toHaveBeenCalled();
  });

  it('is FAILED_PRECONDITION, not a missing branch, when GitHub cannot see the repository', async () => {
    // The App lost access to the repository (or was uninstalled): GitHub
    // answers a plain "Not Found" for any branch of it.
    branchRepo.findOne.mockResolvedValue(null);
    mockOctokitInstance.request.mockRejectedValue(
      githubError(404, 'Not Found'),
    );

    await expect(
      service.findBranch(repository, 'develop'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({
        code: GrpcStatus.FAILED_PRECONDITION,
        message: expect.stringContaining('org/cool-repo'),
      }),
    });
  });

  it('is UNAVAILABLE, never null, when GitHub cannot be asked', async () => {
    branchRepo.findOne.mockResolvedValue(null);
    mockOctokitInstance.request.mockRejectedValue(
      githubError(502, 'Bad gateway'),
    );

    await expect(
      service.findBranch(repository, 'develop'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAVAILABLE }),
    });
  });
});

// ---------------------------------------------------------------------------
// deleteProject: a deleted project's repositories are unlinked, all of them.
// The rows belong to the GitHub App installation and stay; only the link goes.
// A project with no repository is not an error.
// ---------------------------------------------------------------------------

describe('GithubService.deleteProject', () => {
  let service: GithubService;
  let repoRepo: any;

  beforeEach(async () => {
    const built = await buildService();
    service = built.service;
    repoRepo = built.repoRepo;
  });

  it('unlinks every GitHub repository of the project', async () => {
    const linked = [
      {
        id: 'r1',
        name: 'a',
        fullName: 'o/a',
        githubId: 1,
        private: false,
        projectId: 'p-1',
        scanBranch: 'dev',
      },
      {
        id: 'r2',
        name: 'b',
        fullName: 'o/b',
        githubId: 2,
        private: true,
        projectId: 'p-1',
        scanBranch: null,
      },
    ];
    (repoRepo.find as any).mockResolvedValue(linked);
    (repoRepo.save as any).mockImplementation((rows: any) =>
      Promise.resolve(rows),
    );

    await service.deleteProject({ projectId: 'p-1' });

    expect(repoRepo.find).toHaveBeenCalledWith({
      where: { projectId: 'p-1' },
    });
    const saved = (repoRepo.save as any).mock.calls.flatMap((c: any[]) =>
      Array.isArray(c[0]) ? c[0] : [c[0]],
    );
    expect(saved.map((r: any) => r.id).sort()).toEqual(['r1', 'r2']);
    for (const r of saved) {
      expect(r.projectId).toBeNull();
      expect(r.scanBranch).toBeNull();
    }
    expect(repoRepo.delete).not.toHaveBeenCalled();
  });

  it('does not throw when no repository is linked to the project', async () => {
    (repoRepo.find as any).mockResolvedValue([]);
    await expect(service.deleteProject({ projectId: 'p-1' })).resolves.toEqual(
      expect.objectContaining({ id: '', projectId: '' }),
    );
    expect(repoRepo.save).not.toHaveBeenCalled();
  });
});
