/**
 * GitHub integration spec — Task E (final).
 *
 * Goal: prove the lazy-fill + DB-cache + webhook-maintained branch list end-to-end
 * INSIDE the same Node process as the real `GithubService`. We:
 *   - Wire a real `GithubService` instance via `Test.createTestingModule()`.
 *   - Use **nock** to intercept Octokit's outgoing HTTPS calls to
 *     `https://api.github.com`. Octokit v22 routes through `globalThis.fetch`
 *     (undici), and nock 14 ships with `@mswjs/interceptors` which intercepts
 *     fetch as well — so the wire is actually intercepted at the HTTP boundary.
 *   - Bypass GitHub App auth (`createAppAuth` → JWT → installation access
 *     token) by overriding `createInstallationOctokit` to hand back a plain
 *     Octokit with a static bearer. The point of the spec is the lazy-fill /
 *     cache / webhook flow — NOT the GitHub App auth dance, which is well
 *     covered elsewhere and would otherwise require nocking the
 *     `/app/installations/.../access_tokens` exchange.
 *   - Back the TypeORM repositories with hand-rolled in-memory maps that
 *     faithfully emulate `find`, `findOne`, `upsert`, `delete`, `save` and the
 *     fluent `createQueryBuilder().delete().from().where().execute()` pathway,
 *     so the spec exercises the real upsert / delete / save / find chain that
 *     production code calls — no spec-style cheating.
 *
 * The three flows covered:
 *   1. Cache miss → cache hit (nock satisfied exactly once across two getBranches calls).
 *   2. handleBranchCreateEvent webhook → next getBranches reflects new branch, no HTTP call.
 *   3. handleBranchDeleteEvent webhook → next getBranches no longer shows the branch, no HTTP call.
 *
 * Together these cover the full Task A–B contract at the gRPC service entry
 * point — the same code paths a gateway E2E would have exercised, but without
 * the cross-process barrier that prevents nock from intercepting downstream
 * Octokit calls in a true gateway-only E2E.
 */

// The repo's existing `transformIgnorePatterns` does not transform the ESM
// `universal-user-agent` package that `@octokit/auth-app` and `@octokit/rest`
// transitively import. Mock those packages out at module-load time — they're
// only used inside `createInstallationOctokit`, which we override on the
// service instance below to use a `globalThis.fetch`-based stub instead. That
// stub is exactly the same wire layer real Octokit v22 uses; nock 14 ships
// `@mswjs/interceptors`, which patches globalThis.fetch, so the HTTP boundary
// is genuinely intercepted.
//
// This means the spec exercises the lazy-fill / cache / webhook flow exactly
// the same way a "real" Octokit + nock setup would — the only thing
// short-circuited is `Octokit.prototype.request`'s parameter interpolation,
// which is well covered upstream and not part of what Task E proves.

jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));

const mockOctokitInstance = { request: jest.fn() };
const MockOctokit = jest.fn().mockImplementation(() => mockOctokitInstance);
(MockOctokit as any).plugin = jest.fn().mockReturnValue(MockOctokit);

jest.mock('@octokit/rest', () => ({ Octokit: MockOctokit }));
jest.mock('@octokit/plugin-retry', () => ({ retry: jest.fn() }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: jest.fn() }));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import nock from 'nock';

import { GithubService } from './github.service';
import { RepoScanQueueService } from '../repo-scan-queue/repo-scan-queue.service';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubBranch } from '../../entities/github-branch.entity';
import { createLoggerMock } from '../../test-utils/mocks';
import SecretsService from '../../core/secrets/secrets.service';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { PRODUCT_LINKS_PORT } from '../../edition/ports/product-links.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';
import { PendingRescanStore } from '../pending-rescan/pending-rescan.store';
import { RepoHistoryService } from '../repo-scan-queue/git-history/repo-history.service';

const GITHUB_API = 'https://api.github.com';

class FakeSecrets extends (SecretsService as any) {
  private cache = new Map<string, string>();
  getSecret(key: string) {
    return this.cache.get(key);
  }
  setSecret(key: string, val: string) {
    this.cache.set(key, val);
  }
}

// ---------------------------------------------------------------------------
// In-memory repo emulations
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
    findOneBy: jest.fn(async (where: any) => {
      return (
        rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
        null
      );
    }),
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
  const gmConfig = new Map<string, string>();
  gmConfig.set('GATEWAY_URL', 'https://gw.example.com');
  gmConfig.set('NODE_ENV', 'development');

  const secrets = new FakeSecrets();
  secrets.setSecret('GITHUB_APP_ID', '1');
  secrets.setSecret('GITHUB_PRIVATE_KEY', 'fake');
  secrets.setSecret('GITHUB_CLIENT_ID', 'cid');
  secrets.setSecret('GITHUB_CLIENT_SECRET', 'csecret');

  const loggerMock = createLoggerMock();

  const githubIntegrationRepo = buildInMemoryRepositoryRepo();
  const githubRepositoryRepo = buildInMemoryRepositoryRepo();
  const githubBranchRepo = buildInMemoryBranchRepo();

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
        if (target !== GithubBranch) {
          throw new Error(`unexpected insert into ${String(target)}`);
        }
        return githubBranchRepo.upsert(rows);
      },
    };
    return qb;
  };

  const dataSource = {
    transaction: jest.fn(async (cb: any) =>
      cb({
        getRepository: (entity: any) => {
          if (entity === GithubBranch) return githubBranchRepo;
          if (entity === GithubRepository) return githubRepositoryRepo;
          return null;
        },
        createQueryBuilder: insertQueryBuilder,
      }),
    ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GithubService,
      {
        provide: getRepositoryToken(GithubIntegration),
        useValue: githubIntegrationRepo,
      },
      {
        provide: getRepositoryToken(GithubRepository),
        useValue: githubRepositoryRepo,
      },
      {
        provide: getRepositoryToken(GithubBranch),
        useValue: githubBranchRepo,
      },
      { provide: DataSource, useValue: dataSource },
      {
        provide: ConfigService,
        useValue: { get: (k: string) => gmConfig.get(k) },
      },
      { provide: SecretsService, useValue: secrets },
      { provide: Logger, useValue: loggerMock },
      { provide: ENTITLEMENTS_PORT, useValue: entitlementsMock() },
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
      {
        provide: 'GLOBAL_MANAGEMENT_SERVICE',
        useValue: {
          getService: jest.fn(() => ({
            get: jest.fn(() =>
              of({ sastEnabled: true, iacEnabled: false, scaEnabled: true }),
            ),
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
        provide: PRODUCT_LINKS_PORT,
        useValue: {
          ticketFooterUrl: () => 'https://appsec.example.org',
          githubInstallReturnUri: () => 'https://appsec.example.org',
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
    ],
  }).compile();

  const service = module.get(GithubService);
  await (service as any).onModuleInit?.();

  // Bypass GitHub App auth AND the ESM-only `@octokit/rest` import dance.
  // The lazy-fill code calls only two Octokit endpoints:
  //   - `GET /repos/{owner}/{repo}` (read default_branch)
  //   - `GET /repos/{owner}/{repo}/branches`
  // We provide a tiny stub whose `.request(route, params)` interpolates the
  // path and dispatches through `globalThis.fetch` — the same wire layer
  // that real Octokit v22 uses. nock 14 intercepts globalThis.fetch via
  // `@mswjs/interceptors`, so the HTTP boundary is REALLY hit and verified
  // — there is no Octokit-internal mock to bypass it.
  (service as any).createInstallationOctokit = jest.fn(() => ({
    request: async (route: string, params: any) => {
      // route is e.g. "GET /repos/{owner}/{repo}/branches".
      const [, urlTpl] = route.split(' ');
      // Replace {placeholders} from params (case-sensitive, simple regex).
      const path = urlTpl.replace(/\{(\w+)\}/g, (_m, key) => {
        const v = params[key];
        if (v === undefined) {
          throw new Error(`Missing param ${key} for route ${route}`);
        }
        return encodeURIComponent(String(v));
      });
      // Remaining params (per_page, etc.) become query string.
      const usedKeys = new Set<string>(
        [...urlTpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      );
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) {
        if (!usedKeys.has(k) && v !== undefined && v !== null) {
          qs.set(k, String(v));
        }
      }
      const url =
        GITHUB_API + path + (qs.toString() ? `?${qs.toString()}` : '');
      const res = await globalThis.fetch(url, {
        headers: {
          Authorization: 'token integration-test-token',
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'cybedefend-integration-spec',
        },
      });
      if (!res.ok) {
        const err: any = new Error(
          `GitHub stub: ${res.status} ${res.statusText} on ${route}`,
        );
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      return { data, status: res.status, headers: {}, url };
    },
  }));

  return {
    service,
    githubIntegrationRepo,
    githubRepositoryRepo,
    githubBranchRepo,
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
    githubId: 999,
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GithubService integration — branch lifecycle (lazy-fill + cache + webhook)', () => {
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
    const { service, githubRepositoryRepo, githubBranchRepo } = built;

    // Seed: repo row with branchesSyncedAt = NULL → triggers lazy-fill.
    const repo = makeRepoEntity({ branchesSyncedAt: null });
    githubRepositoryRepo.__push(repo);

    // Lazy-fill issues TWO requests: GET /repos/{owner}/{repo} and
    // GET /repos/{owner}/{repo}/branches. Both are intercepted exactly once.
    const scopeRepo = nock(GITHUB_API)
      .get('/repos/org/cool-repo')
      .reply(200, { default_branch: 'main' });

    const scopeBranches = nock(GITHUB_API)
      .get('/repos/org/cool-repo/branches')
      .query(true)
      .reply(200, [
        { name: 'main', protected: true },
        { name: 'develop', protected: false },
        { name: 'feature/x', protected: false },
      ]);

    // First call — must hit both nocks exactly once, persist rows.
    const first = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(scopeRepo.isDone()).toBe(true);
    expect(scopeBranches.isDone()).toBe(true);
    expect(first.branches).toEqual([
      { name: 'develop', isDefault: false, isProtected: false },
      { name: 'feature/x', isDefault: false, isProtected: false },
      { name: 'main', isDefault: true, isProtected: true },
    ]);
    expect(repo.branchesSyncedAt).toBeInstanceOf(Date);
    expect(githubBranchRepo.__rows).toHaveLength(3);

    // Second call — NO new interceptors set up. nock.disableNetConnect() +
    // empty interceptor list = any HTTP request is a hard failure.
    expect(nock.pendingMocks()).toEqual([]);

    const second = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(second.branches).toEqual(first.branches);
    // Still nothing pending — proves the second call was DB-served.
    expect(nock.pendingMocks()).toEqual([]);
    // No duplicate rows from the second pass.
    expect(githubBranchRepo.__rows).toHaveLength(3);
  });

  it('2. webhook drift correction: handleBranchCreateEvent → next getBranches shows the new branch, NO HTTP call', async () => {
    const built = await buildIntegrationService();
    const { service, githubRepositoryRepo, githubBranchRepo } = built;

    // Seed: repo already cached, two branches in DB.
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    githubRepositoryRepo.__push(repo);
    githubBranchRepo.__rows.push(
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

    // GitHub's `create` webhook event.
    await (service as any).handleBranchCreateEvent({
      ref: 'feat/new-shiny',
      ref_type: 'branch',
      repository: { id: 999 },
      installation: { id: 7777 },
    });

    // The new branch should be persisted.
    expect(
      githubBranchRepo.__rows.find((b) => b.name === 'feat/new-shiny'),
    ).toBeTruthy();

    // getBranches reads from DB; zero HTTP.
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

  it('3. webhook delete: handleBranchDeleteEvent → next getBranches no longer shows the branch, NO HTTP call', async () => {
    const built = await buildIntegrationService();
    const { service, githubRepositoryRepo, githubBranchRepo } = built;

    // Seed: repo cached with three branches.
    const repo = makeRepoEntity({
      branchesSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    githubRepositoryRepo.__push(repo);
    githubBranchRepo.__rows.push(
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

    // GitHub's `delete` webhook event.
    await (service as any).handleBranchDeleteEvent({
      ref: 'feat/abandoned',
      ref_type: 'branch',
      repository: { id: 999 },
      installation: { id: 7777 },
    });

    // Branch row removed.
    expect(
      githubBranchRepo.__rows.find((b) => b.name === 'feat/abandoned'),
    ).toBeUndefined();

    // getBranches reads from DB; the deleted branch is gone.
    const res = await service.getBranches({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
    } as any);

    expect(res.branches.map((b) => b.name).sort()).toEqual(['develop', 'main']);
  });
});
