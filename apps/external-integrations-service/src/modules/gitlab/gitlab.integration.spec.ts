/**
 * GitLab integration spec — Task E (final).
 *
 * Goal: prove the lazy-fill + DB-cache + webhook-maintained branch list end-to-end
 * INSIDE the same Node process as the real `GitlabService`. We:
 *   - Wire a real `GitlabService` instance via `Test.createTestingModule()`.
 *   - Use **nock** to intercept the actual `axios` calls to
 *     `https://gitlab.com/api/v4` (the canonical use case for nock — axios goes
 *     through Node's http/https modules).
 *   - Back the TypeORM repositories with hand-rolled in-memory maps that
 *     faithfully emulate `find`, `findOne`, `upsert`, `delete`, `save` and the
 *     fluent `createQueryBuilder().delete().from().where().execute()` pathway,
 *     so the test exercises the real upsert / delete / save / find chain that
 *     production code calls — no spec-style cheating with `jest.spyOn`.
 *
 * The three flows covered:
 *   1. Cache miss → cache hit (nock satisfied exactly once across two getBranches calls).
 *   2. Webhook drift correction (branch-creation push event → next getBranches
 *      reflects new branch without any extra HTTP call).
 *   3. Webhook delete (branch-deletion push event → next getBranches no longer
 *      shows the branch, again without any HTTP call).
 *
 * Together these cover the full Task A–D contract at the gRPC service entry
 * point — the same code paths a gateway E2E would have exercised, but without
 * the cross-process barrier that prevents nock from intercepting downstream
 * Octokit/axios calls in a true gateway-only E2E.
 */

// IMPORTANT: do NOT `jest.mock('axios')` — nock cannot intercept a mocked axios.
// We let nock intercept the real axios instance.

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import nock from 'nock';

import { GitlabService } from './gitlab.service';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import { createLoggerMock } from '../../test-utils/mocks';
import SecretsService from '../../core/secrets/secrets.service';
import { PendingRescanStore } from '../pending-rescan/pending-rescan.store';
import { RepoHistoryService } from '../repo-scan-queue/git-history/repo-history.service';

const GITLAB_API = 'https://gitlab.com';
const GITLAB_API_BASE = '/api/v4';

class FakeSecrets extends (SecretsService as any) {
  private cache = new Map<string, string>();
  async getSecret(key: string) {
    return this.cache.get(key);
  }
  setSecret(key: string, val: string) {
    this.cache.set(key, val);
  }
}

// ---------------------------------------------------------------------------
// In-memory repo emulations — emulate just enough of TypeORM's surface that
// `GitlabService` actually exercises its upsert / find / delete / save paths.
// Each helper returns a `jest.Mocked<Repository<T>>`-shaped object whose
// methods are wired to a backing array.
// ---------------------------------------------------------------------------

function buildInMemoryRepositoryRepo() {
  const rows: any[] = [];

  const findOne = jest.fn(async (opts: any) => {
    const where = opts?.where ?? {};
    return (
      rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
      null
    );
  });

  const find = jest.fn(async (opts: any = {}) => {
    const where = opts?.where ?? {};
    return rows.filter((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v),
    );
  });

  const save = jest.fn(async (entity: any) => {
    const idx = rows.findIndex((r) => r.id === entity.id);
    if (idx >= 0) {
      Object.assign(rows[idx], entity);
    } else {
      rows.push(entity);
    }
    return entity;
  });

  const upsert = jest.fn(async (entity: any) => {
    return save(entity);
  });

  const del = jest.fn(async (where: any) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (Object.entries(where).every(([k, v]) => r[k] === v)) {
        rows.splice(i, 1);
      }
    }
    return { affected: before - rows.length };
  });

  const repo: any = {
    findOne,
    find,
    save,
    upsert,
    delete: del,
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
    __rows: rows,
    __push: (r: any) => rows.push(r),
  };
  return repo;
}

function buildInMemoryBranchRepo() {
  const rows: any[] = [];
  let nextId = 1;

  const findOne = jest.fn(async (opts: any) => {
    const where = opts?.where ?? {};
    return (
      rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
      null
    );
  });

  const find = jest.fn(async (opts: any = {}) => {
    const where = opts?.where ?? {};
    let filtered = rows.filter((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v),
    );
    const order = opts?.order;
    if (order?.name === 'ASC') {
      filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    } else if (order?.name === 'DESC') {
      filtered = [...filtered].sort((a, b) => b.name.localeCompare(a.name));
    }
    return filtered;
  });

  const upsert = jest.fn(async (entity: any) => {
    const arr = Array.isArray(entity) ? entity : [entity];
    for (const r of arr) {
      const idx = rows.findIndex(
        (b) => b.repositoryId === r.repositoryId && b.name === r.name,
      );
      if (idx >= 0) {
        Object.assign(rows[idx], r, { lastSeenAt: new Date() });
      } else {
        rows.push({
          id: `branch-${nextId++}`,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          ...r,
        });
      }
    }
    return { identifiers: [], generatedMaps: [], raw: {} };
  });

  const save = jest.fn(async (entity: any) => {
    const arr = Array.isArray(entity) ? entity : [entity];
    for (const r of arr) {
      const idx = rows.findIndex((b) => b.id === r.id);
      if (idx >= 0) Object.assign(rows[idx], r);
      else rows.push({ id: `branch-${nextId++}`, ...r });
    }
    return entity;
  });

  const del = jest.fn(async (where: any) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (Object.entries(where).every(([k, v]) => r[k] === v)) {
        rows.splice(i, 1);
      }
    }
    return { affected: before - rows.length };
  });

  // Fluent QueryBuilder emulation — supports the orphan-delete path used by
  // `lazyFillGitlabBranches`:
  //   branchRepo.createQueryBuilder().delete().from(GitlabBranch)
  //     .where('repositoryId = :id AND name NOT IN (:...names)', { id, names })
  //     .execute();
  // We parse the SQL string just enough to apply the correct filter to `rows`.
  const createQueryBuilder = jest.fn(() => {
    let pendingWhere: { sql: string; params: any } | null = null;
    const qb: any = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn((sql: string, params: any) => {
        pendingWhere = { sql, params };
        return qb;
      }),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => {
        if (!pendingWhere) return { affected: 0 };
        const { sql, params } = pendingWhere;
        const before = rows.length;
        if (sql.includes('NOT IN')) {
          // Drop rows for this repo whose name is NOT in the provided list.
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            if (
              r.repositoryId === params.id &&
              !params.names.includes(r.name)
            ) {
              rows.splice(i, 1);
            }
          }
        } else {
          // Plain `repositoryId = :id` — drop every row for this repo.
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].repositoryId === params.id) {
              rows.splice(i, 1);
            }
          }
        }
        return { affected: before - rows.length };
      }),
    };
    return qb;
  });

  const repo: any = {
    findOne,
    find,
    save,
    upsert,
    delete: del,
    update: jest.fn(),
    createQueryBuilder,
    __rows: rows,
  };
  return repo;
}

// ---------------------------------------------------------------------------
// Test module builder
// ---------------------------------------------------------------------------

async function buildIntegrationService() {
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

  const gitlabIntegrationRepo = buildInMemoryRepositoryRepo();
  const gitlabRepositoryRepo = buildInMemoryRepositoryRepo();
  const gitlabBranchRepo = buildInMemoryBranchRepo();
  const loggerMock = createLoggerMock();

  // DataSource stub — `transaction(cb)` executes cb with a manager whose
  // `getRepository(entity)` returns the matching in-memory repo. The whole
  // point of integration-style testing is to NOT cheat — the callback must
  // actually exercise upsert/delete/save/find pathways against our backing
  // arrays.
  // The manager's query builder serves the lazy-fill's multi-row branch
  // upsert: it writes through the same in-memory table.
  const insertQueryBuilder = () => {
    let target: unknown;
    let rows: any[] = [];
    const qb: any = {
      insert: () => qb,
      into: (entity: unknown) => {
        target = entity;
        return qb;
      },
      values: (values: any[]) => {
        rows = values;
        return qb;
      },
      orUpdate: () => qb,
      updateEntity: () => qb,
      execute: async () => {
        if (target !== GitlabBranch) {
          throw new Error(`unexpected insert into ${String(target)}`);
        }
        return gitlabBranchRepo.upsert(rows);
      },
    };
    return qb;
  };

  const dataSource = {
    transaction: jest.fn(async (cb: any) =>
      cb({
        getRepository: (entity: any) => {
          if (entity === GitlabBranch) return gitlabBranchRepo;
          if (entity === GitlabRepository) return gitlabRepositoryRepo;
          return null;
        },
        createQueryBuilder: insertQueryBuilder,
      }),
    ),
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
      { provide: Logger, useValue: loggerMock },
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
          getService: jest.fn(() => ({
            get: jest.fn(() =>
              of({ sastEnabled: true, iacEnabled: false, scaEnabled: true }),
            ),
            createSystemApiKeyForProject: jest.fn(() => of({ apiKey: 'k' })),
          })),
        },
      },
      {
        provide: RepoScanQueueService,
        useValue: {
          enqueueRepoScan: jest.fn().mockResolvedValue(undefined),
          getQueueBacklog: jest.fn(),
        },
      },
      {
        provide: PendingRescanStore,
        useValue: {
          record: jest.fn().mockResolvedValue(true),
          supersede: jest.fn().mockResolvedValue(false),
        },
      },
      {
        provide: RepoHistoryService,
        useValue: {
          prepare: jest.fn(),
          publish: jest.fn(),
          cleanup: jest.fn(),
        },
      },
      {
        provide: 'SECURITY_SCANNING_SERVICE',
        useValue: {
          getService: jest.fn(() => ({
            createFailedScan: jest.fn(() => of({ success: true })),
            checkExistingScan: jest.fn(() => of({ exists: false })),
            createScan: jest.fn(() => of({ success: true })),
            startScan: jest.fn(() => of({ detectedLanguages: [] })),
          })),
        },
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
      // The port double: the AppSec path by default, as today.
      { provide: ENTITLEMENTS_PORT, useValue: entitlementsMock() },
    ],
  }).compile();

  const service = module.get(GitlabService);
  await (service as any).onModuleInit?.();

  // The service decrypts the persisted accessToken before hitting the GitLab
  // API. We bypass the AES round-trip by stubbing decryptToken — the spec is
  // about HTTP-boundary behaviour, not cryptography.
  jest
    .spyOn<any, any>(service as any, 'decryptToken')
    .mockResolvedValue('valid-access-token');

  return {
    service,
    gitlabIntegrationRepo,
    gitlabRepositoryRepo,
    gitlabBranchRepo,
    dataSource,
    loggerMock,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoEntity(overrides: any = {}) {
  return {
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
      scope: 'read_repository write_repository',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitlabService integration — branch lifecycle (lazy-fill + cache + webhook)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.cleanAll();
    // nock patches the http and https modules when it loads, and an in-band
    // run shares them with every later spec file: without restore, a later
    // spec that opens a real TLS connection goes through its interceptor.
    nock.restore();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('1. cache miss → cache hit: nock answers ONCE across two getBranches calls; DB is the source of truth on the second', async () => {
    const built = await buildIntegrationService();
    const { service, gitlabRepositoryRepo, gitlabBranchRepo } = built;

    // Seed: repository row with branchesSyncedAt = NULL → triggers lazy-fill.
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    gitlabRepositoryRepo.__push(repo);

    // Nock the GitLab API ONCE — three branches returned.
    const scope = nock(GITLAB_API)
      .get(`${GITLAB_API_BASE}/projects/12345/repository/branches`)
      .query({ per_page: '100', page: '1' })
      .reply(200, [
        { name: 'main', default: true, protected: true },
        { name: 'develop', default: false, protected: false },
        { name: 'feature/x', default: false, protected: false },
      ]);

    // First call — must hit nock exactly once, persist rows, set branchesSyncedAt.
    const first = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(scope.isDone()).toBe(true); // The mock was consumed.
    expect(first.branches).toEqual([
      { name: 'develop', isDefault: false, isProtected: false },
      { name: 'feature/x', isDefault: false, isProtected: false },
      { name: 'main', isDefault: true, isProtected: true },
    ]);
    expect(first.repositoryId).toBe('repo-1');
    expect(first.defaultBranch).toBe('main');

    // The repo row in the in-memory store now has branchesSyncedAt set.
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
    // Three branch rows persisted.
    expect(gitlabBranchRepo.__rows).toHaveLength(3);

    // Second call — NO new nock interceptor was set up. If the service makes
    // any HTTP request, `nock.disableNetConnect()` + the absence of an
    // interceptor turns it into a hard failure. We assert: there are no
    // pending mocks AND the second call returns the same payload.
    expect(nock.pendingMocks()).toEqual([]);

    const second = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(second.branches).toEqual(first.branches);
    // Still nothing pending — proves the second call was served from MySQL.
    expect(nock.pendingMocks()).toEqual([]);
    // Still 3 rows in the branch table — no duplicates from the second pass.
    expect(gitlabBranchRepo.__rows).toHaveLength(3);
  });

  it('1b. cache miss with >100 branches: follows the real X-Next-Page header across pages and persists every branch', async () => {
    const built = await buildIntegrationService();
    const { service, gitlabRepositoryRepo, gitlabBranchRepo } = built;

    const repo = makeRepoEntity({ branchesSyncedAt: null });
    gitlabRepositoryRepo.__push(repo);

    // 250 branches across three pages. The X-Next-Page header is set on the
    // real HTTP reply, so this proves the header round-trips through axios
    // (lower-cased to `x-next-page`) and drives the pagination loop end-to-end.
    const mkPage = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `b${String(start + i).padStart(3, '0')}`,
        default: false,
        protected: false,
      }));

    const scope1 = nock(GITLAB_API)
      .get(`${GITLAB_API_BASE}/projects/12345/repository/branches`)
      .query({ per_page: '100', page: '1' })
      .reply(200, mkPage(0, 100), { 'X-Next-Page': '2' });
    const scope2 = nock(GITLAB_API)
      .get(`${GITLAB_API_BASE}/projects/12345/repository/branches`)
      .query({ per_page: '100', page: '2' })
      .reply(200, mkPage(100, 100), { 'X-Next-Page': '3' });
    const scope3 = nock(GITLAB_API)
      .get(`${GITLAB_API_BASE}/projects/12345/repository/branches`)
      .query({ per_page: '100', page: '3' })
      .reply(200, mkPage(200, 50), { 'X-Next-Page': '' });

    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    // All three pages were consumed — proves the loop followed X-Next-Page.
    expect(scope1.isDone()).toBe(true);
    expect(scope2.isDone()).toBe(true);
    expect(scope3.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);

    // All 250 branches persisted (page-3 branch present, not silently dropped).
    expect(gitlabBranchRepo.__rows).toHaveLength(250);
    expect(res.branches).toHaveLength(250);
    expect(res.branches.map((b) => b.name)).toContain('b249');
  });

  it('2. webhook drift correction: branch-creation push event → next getBranches shows the new branch, NO HTTP call', async () => {
    const built = await buildIntegrationService();
    const { service, gitlabRepositoryRepo, gitlabBranchRepo } = built;

    // Seed: repo already cached (branchesSyncedAt is set, two rows in DB).
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    gitlabRepositoryRepo.__push(repo);
    gitlabBranchRepo.__rows.push(
      {
        id: 'b1',
        repositoryId: 'repo-1',
        name: 'main',
        isProtected: true,
      },
      {
        id: 'b2',
        repositoryId: 'repo-1',
        name: 'develop',
        isProtected: false,
      },
    );

    // No nock interceptors. Any HTTP call → hard failure.
    expect(nock.pendingMocks()).toEqual([]);

    // GitLab signals branch creation via a `push` event with before=SHA_ZERO.
    const SHA_ZERO = '0'.repeat(40);
    await (service as any).handlePushEvent({
      project: { id: 12345 },
      ref: 'refs/heads/feat/new-shiny',
      before: SHA_ZERO,
      after: 'abc123def456',
    });

    // The new branch should now be in the DB.
    expect(
      gitlabBranchRepo.__rows.find((b) => b.name === 'feat/new-shiny'),
    ).toBeTruthy();

    // Now read branches — must come from DB, zero HTTP.
    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(res.branches.map((b) => b.name).sort()).toEqual([
      'develop',
      'feat/new-shiny',
      'main',
    ]);
    expect(res.branches.find((b) => b.name === 'feat/new-shiny')).toEqual({
      name: 'feat/new-shiny',
      isDefault: false,
      isProtected: false,
    });
  });

  it('3. webhook delete: branch-deletion push event → next getBranches no longer shows the branch, NO HTTP call', async () => {
    const built = await buildIntegrationService();
    const { service, gitlabRepositoryRepo, gitlabBranchRepo } = built;

    // Seed: repo cached with three branches including the one to delete.
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    gitlabRepositoryRepo.__push(repo);
    gitlabBranchRepo.__rows.push(
      {
        id: 'b1',
        repositoryId: 'repo-1',
        name: 'main',
        isProtected: true,
      },
      {
        id: 'b2',
        repositoryId: 'repo-1',
        name: 'develop',
        isProtected: false,
      },
      {
        id: 'b3',
        repositoryId: 'repo-1',
        name: 'feat/abandoned',
        isProtected: false,
      },
    );

    expect(nock.pendingMocks()).toEqual([]);

    // GitLab signals branch deletion via a `push` event with after=SHA_ZERO.
    const SHA_ZERO = '0'.repeat(40);
    await (service as any).handlePushEvent({
      project: { id: 12345 },
      ref: 'refs/heads/feat/abandoned',
      before: 'abc123def456',
      after: SHA_ZERO,
    });

    // Branch row removed.
    expect(
      gitlabBranchRepo.__rows.find((b) => b.name === 'feat/abandoned'),
    ).toBeUndefined();

    // getBranches reads from DB; the deleted branch is gone.
    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(res.branches.map((b) => b.name).sort()).toEqual(['develop', 'main']);
  });
});
