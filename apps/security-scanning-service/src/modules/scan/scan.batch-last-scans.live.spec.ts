import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { ident, run, sql } from '@cybedefend/db-dialect';
import { Scan } from 'src/entities/scan.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { ScanService } from './scan.service';
import {
  ProjectAppsecMarker,
  ScanPipelineEvents,
  ScanStateStore,
} from './core';

/**
 * LIVE spec against a REAL database on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`, default mysql): the project list's "last
 * scan" date (GetBatchLastScans) counts a `completed_degraded` scan, a normal
 * terminal state, like the project page does. Only a real database shows the
 * MAX(createAt) GROUP BY picking the right row; the unit spec can only check
 * the state list it is given.
 *
 * It is skipped unless `SS_BATCH_LAST_SCANS_LIVE=1` (the legacy
 * `SS_BATCH_LAST_SCANS_MYSQL_LIVE=1` pins mysql), so `pnpm run test` stays
 * hermetic. It creates a throwaway database with `createLiveDatabase`, builds
 * the schema with the service's real migrations on the selected engine, and
 * drops the database at the end.
 *
 * How to run:
 *   SS_BATCH_LAST_SCANS_LIVE=1 LIVE_DB_TYPE=postgres SS_BATCH_LAST_SCANS_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --testPathPatterns=batch-last-scans.live --runInBand
 *   SS_BATCH_LAST_SCANS_LIVE=1 LIVE_DB_TYPE=mysql SS_BATCH_LAST_SCANS_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --testPathPatterns=batch-last-scans.live --runInBand
 */
const describeLive = liveEnabled('SS_BATCH_LAST_SCANS')
  ? describe
  : describe.skip;

describeLive('ScanService.getBatchLastScans on a real database', () => {
  jest.setTimeout(180_000);

  let db: LiveDatabase;
  let dataSource: DataSource;
  let service: ScanService;

  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  /** Inserts a scan, then sets its createAt (a CreateDateColumn). */
  const scanAt = async (
    projectId: string,
    state: string,
    createAt: Date,
    isDiffScan = false,
  ) => {
    const scan = await dataSource.getRepository(Scan).save({
      name: `${state}-${createAt.toISOString()}`,
      state,
      language: ['python'],
      projectId,
      organizationId: 'org-live',
      isDiffScan,
    });
    await run(
      dataSource,
      sql`UPDATE ${ident('scan')} SET ${ident('createAt')} = ${createAt} WHERE ${ident('id')} = ${scan.id}`,
    );
  };

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ss_batch_last_scans',
      envPrefix: 'SS_BATCH_LAST_SCANS',
    });
    dataSource = db.dataSource;

    const module = await Test.createTestingModule({
      providers: [
        ScanService,
        // The real core primitives.
        ScanStateStore,
        ScanPipelineEvents,
        ProjectAppsecMarker,
        {
          provide: getRepositoryToken(Scan),
          useValue: dataSource.getRepository(Scan),
        },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback?: string) => fallback },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    })
      // getBatchLastScans reads the scan table only.
      .useMocker(() => ({}))
      .compile();
    service = module.get(ScanService);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('dates the last scan from a completed_degraded scan of yesterday, not a completed one of five days ago', async () => {
    const yesterday = daysAgo(1);
    await scanAt('p-a', 'completed', daysAgo(5));
    await scanAt('p-a', 'completed_degraded', yesterday);
    await scanAt('p-a', 'failed', daysAgo(10));
    // Neither a scan still running nor a diff scan dates the project.
    await scanAt('p-a', 'running', daysAgo(0));
    await scanAt('p-a', 'completed', daysAgo(0), true);
    // A project whose only terminal scan is degraded has a last scan too.
    await scanAt('p-b', 'completed_degraded', daysAgo(2));

    const { scans } = await service.getBatchLastScans({
      projectIds: ['p-a', 'p-b', 'p-none'],
    });

    const byProject = Object.fromEntries(
      scans.map((s) => [s.projectId, s.lastScan]),
    );
    // Within a second: the column's precision is the server's business.
    expect(
      Math.abs(Date.parse(byProject['p-a']) - yesterday.getTime()),
    ).toBeLessThan(1000);
    expect(byProject['p-b']).not.toBe('');
    expect(byProject['p-none']).toBe('');
  });

  // The project's branch list (GET /project/:projectId/branches/list), the
  // default branch first: PostgreSQL refuses a SELECT DISTINCT whose ORDER
  // BY holds an expression outside the select list (42P10), which would
  // answer 500 on every branch list.
  it('lists the distinct branches of a project, the default one first, without diff scans', async () => {
    const at = daysAgo(1);
    for (const branch of ['dev', 'main', 'feature', 'dev']) {
      const scan = await dataSource.getRepository(Scan).save({
        name: `branch-${branch}`,
        state: 'completed',
        language: ['python'],
        projectId: 'p-branches',
        organizationId: 'org-live',
        branch,
      });
      await run(
        dataSource,
        sql`UPDATE ${ident('scan')} SET ${ident('createAt')} = ${at} WHERE ${ident('id')} = ${scan.id}`,
      );
    }
    await dataSource.getRepository(Scan).save({
      name: 'diff',
      state: 'completed',
      language: ['python'],
      projectId: 'p-branches',
      organizationId: 'org-live',
      branch: 'diff-only',
      isDiffScan: true,
    });

    const list = (defaultBranch: string) =>
      service.getProjectBranchesFromScansPaginated({
        projectId: 'p-branches',
        page: 1,
        pageSize: 30,
        search: '',
        includeArchived: false,
        archivedNames: [],
        defaultBranch,
      });

    const byMain = await list('main');
    expect(byMain.total).toBe(3);
    expect(byMain.branches.map((b) => b.name)).toEqual([
      'main',
      'dev',
      'feature',
    ]);
    expect(byMain.branches[0].isDefault).toBe(true);
    expect((await list('feature')).branches.map((b) => b.name)).toEqual([
      'feature',
      'dev',
      'main',
    ]);
  });

  // The branch search ignores case on both engines, as MySQL's collation
  // does.
  it('finds Feature/Login by feature/login and by LOGIN', async () => {
    for (const branch of ['Feature/Login', 'release/1.0']) {
      await dataSource.getRepository(Scan).save({
        name: `search-${branch}`,
        state: 'completed',
        language: ['python'],
        projectId: 'p-search',
        organizationId: 'org-live',
        branch,
      });
    }
    for (const search of ['feature/login', 'LOGIN', 'Feature/Login']) {
      const res = await service.getProjectBranchesFromScansPaginated({
        projectId: 'p-search',
        page: 1,
        pageSize: 30,
        search,
        includeArchived: false,
        archivedNames: [],
        defaultBranch: '',
      });
      expect(res.branches.map((b) => b.name)).toEqual(['Feature/Login']);
      expect(res.total).toBe(1);
    }
  });
});
