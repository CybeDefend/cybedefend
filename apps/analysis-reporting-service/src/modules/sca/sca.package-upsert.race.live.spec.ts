import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { currentDialect, ident, sql } from '@cybedefend/db-dialect';
import { Library } from '@grpc/analysis-reporting/result';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { createLoggerMock } from '../../test-utils/typeorm-mock.util';
import { ScaService } from './sca.service';

/**
 * LIVE spec: the package upsert of an SCA ingestion
 * (`upsertPackageRows`, `orUpdate` on the unique (projectId, packageName,
 * packageVersion, branch): ON DUPLICATE KEY UPDATE on MySQL, ON CONFLICT on
 * PostgreSQL), reached through its public caller `ScaService.ingestMatched`,
 * against two ingestions at once and against a deadlock. The package name and
 * version compare case-insensitively on both engines (MySQL's collation,
 * PostgreSQL's citext): `Lodash` and `lodash` are one row.
 *
 *   AR_SCA_UPSERT_LIVE=1 LIVE_DB_TYPE=mysql AR_SCA_UPSERT_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=sca.package-upsert.race.live
 *   AR_SCA_UPSERT_LIVE=1 LIVE_DB_TYPE=postgres AR_SCA_UPSERT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=sca.package-upsert.race.live
 *
 * The schema is built by the dialect's migration tracks in a throwaway
 * database, dropped at the end.
 */
const LIVE = liveEnabled('AR_SCA_UPSERT');
const describeLive = LIVE ? describe : describe.skip;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const library = (over: Partial<Library>): Library =>
  ({
    name: 'lodash',
    version: '4.17.21',
    isDev: false,
    isTransitive: false,
    file: 'package.json',
    ecosystem: 'npm',
    path: ['root'],
    ...over,
  }) as Library;

describeLive('SCA package upsert under concurrency', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  let live: LiveDatabase;
  let ds: DataSource;
  let service: ScaService;
  let logger: ReturnType<typeof createLoggerMock>;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_sca_upsert',
      envPrefix: 'AR_SCA_UPSERT',
      migrations: 'track',
    });
    ds = live.dataSource;
    logger = createLoggerMock();
    const repo = (entity: new () => unknown) => ({
      provide: getRepositoryToken(entity),
      useValue: ds.getRepository(entity),
    });
    const module = await Test.createTestingModule({
      providers: [
        ScaService,
        repo(ScaDetectedPackages),
        repo(ScaVulnerabilityDetections),
        repo(VulnerabilityDetectionHistory),
        repo(HistoryItem),
        repo(ScaLicenseOverride),
        { provide: getDataSourceToken(), useValue: ds },
        { provide: Logger, useValue: logger },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: () => null },
        },
        { provide: CvssExplainerService, useValue: {} },
        { provide: ResultService, useValue: {} },
        { provide: IssueIntegrationService, useValue: {} },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({ get: () => of({ parsedBranches: [] }) }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({ getScan: () => of({ branch: 'main' }) }),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: async () => undefined },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: { getScoringBranches: async () => ['main', 'master'] },
        },
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: async () => null },
        },
      ],
    }).compile();
    service = module.get(ScaService);
    service.onModuleInit();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  const ingest = (projectId: string, scanId: string, libraries: Library[]) =>
    service.ingestMatched(
      { projectId, scanId, vulnerabilityType: 'CRITICAL,HIGH,MEDIUM,LOW' },
      libraries.map((l) => ({ library: l, affected: [] })),
    );

  /** The server session of a runner, as the lock views name it. */
  const sessionOf = async (
    runner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<number> => {
    const [{ id }] = await runner.query(
      currentDialect() === 'mysql'
        ? 'SELECT PS_CURRENT_THREAD_ID() AS id'
        : 'SELECT pg_backend_pid() AS id',
    );
    return Number(id);
  };

  /**
   * Resolves once a session of this test's database waits for the holder
   * (on MySQL the server's lock waits: INNODB_TRX may still say RUNNING for a
   * waiting upsert). Only a wait on the holder counts: any other lock wait on
   * the server would answer before the ingestion locked anything, and the
   * holder would then take x first, with no cycle to detect.
   */
  const waitUntilBlockedBy = async (holderSession: number) => {
    const query =
      currentDialect() === 'mysql'
        ? sql`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA = DATABASE() AND w.BLOCKING_THREAD_ID = ${holderSession}`
        : sql`SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND ${holderSession}::int = ANY(pg_blocking_pids(pid))`;
    for (let i = 0; i < 200; i += 1) {
      const [{ n }] = await ds.query(query.text, query.params);
      if (Number(n) > 0) return;
      await pause(10);
    }
    throw new Error('the ingestion never waited for the holder');
  };

  const packagesOf = (projectId: string) =>
    ds.getRepository(ScaDetectedPackages).find({
      where: { projectId, branch: 'main' },
      order: { packageName: 'ASC' },
    });

  it('two concurrent ingestions of the same packages keep one row per (package, version, branch), whatever the case', async () => {
    for (let round = 0; round < 5; round += 1) {
      const projectId = randomUUID();
      const first = {
        scanId: `scan-a-${round}`,
        libraries: [
          library({ name: 'Lodash', file: 'package.json', path: ['a'] }),
          library({ name: 'react', version: '18.3.1', path: ['a'] }),
        ],
      };
      const second = {
        scanId: `scan-b-${round}`,
        libraries: [
          library({ name: 'lodash', file: 'package-lock.json', path: ['b'] }),
          library({ name: 'React', version: '18.3.1', path: ['b'] }),
        ],
      };

      await Promise.all([
        ingest(projectId, first.scanId, first.libraries),
        ingest(projectId, second.scanId, second.libraries),
      ]);

      const rows = await packagesOf(projectId);
      expect(
        rows.map((r) => [r.packageName.toLowerCase(), r.packageVersion]),
      ).toEqual([
        ['lodash', '4.17.21'],
        ['react', '18.3.1'],
      ]);
      // Each row is one ingestion's write, never a mix of the two.
      const lodash = rows[0];
      expect([
        ['package.json', ['a'], first.scanId],
        ['package-lock.json', ['b'], second.scanId],
      ]).toContainEqual([lodash.fileName, lodash.path, lodash.lastScanId]);

      // The later ingestion's fields win, whatever the case it spells.
      await ingest(projectId, `scan-c-${round}`, [
        library({ name: 'LODASH', file: 'yarn.lock', path: ['c'] }),
      ]);
      const after = await packagesOf(projectId);
      expect(after).toHaveLength(2);
      expect([after[0].fileName, after[0].path, after[0].lastScanId]).toEqual([
        'yarn.lock',
        ['c'],
        `scan-c-${round}`,
      ]);
      expect(after[0].id).toBe(lodash.id);
    }
  });

  it('a deadlock retry leaves no partial row', async () => {
    const projectId = randomUUID();
    const row = (
      packageName: string,
      over: Partial<ScaDetectedPackages> = {},
    ) => ({
      id: randomUUID(),
      projectId,
      branch: 'main',
      packageName,
      packageVersion: '1.0.0',
      fileName: 'package.json',
      ecosystem: 'npm',
      isTransitive: false,
      isDev: false,
      lastScanId: 'seed',
      ...over,
    });
    const x = row('a-pkg');
    const y = row('b-pkg');
    // Rows the holder updates first, so that MySQL picks the ingestion (the
    // lighter transaction) as the deadlock victim; PostgreSQL aborts the
    // first waiter, which is the ingestion too.
    const noise = Array.from({ length: 300 }, (_, i) =>
      row(`noise-${i}`, { projectId: randomUUID() }),
    );
    await ds
      .createQueryBuilder()
      .insert()
      .into(ScaDetectedPackages)
      .values([x, y, ...noise])
      .updateEntity(false)
      .execute();

    const exec = (
      runner: ReturnType<DataSource['createQueryRunner']>,
      s: ReturnType<typeof sql>,
    ) => runner.query(s.text, s.params);

    const holder = ds.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    let ingestion: Promise<unknown> | undefined;
    try {
      const holderSession = await sessionOf(holder);
      for (const n of noise) {
        await exec(
          holder,
          sql`UPDATE sca_detected_packages SET ${ident('lastScanId')} = ${'holder'} WHERE id = ${n.id}`,
        );
      }
      // The holder locks y.
      await exec(
        holder,
        sql`UPDATE sca_detected_packages SET ${ident('lastScanId')} = ${'holder'} WHERE id = ${y.id}`,
      );
      // The ingestion upserts x, y and a new z in key order: it locks x, then
      // waits for y.
      logger.warn.mockClear();
      ingestion = ingest(projectId, 'scan-deadlock', [
        library({ name: 'a-pkg', version: '1.0.0', path: ['scan'] }),
        library({ name: 'b-pkg', version: '1.0.0', path: ['scan'] }),
        library({ name: 'c-pkg', version: '1.0.0', path: ['scan'] }),
      ]);
      await waitUntilBlockedBy(holderSession);
      // The holder now waits for x: a cycle. The ingestion's statement is
      // rolled back as a whole (MySQL detects it at once; PostgreSQL when the
      // ingestion's deadlock_timeout, 1 s, expires), then retried once it can
      // run.
      await exec(
        holder,
        sql`UPDATE sca_detected_packages SET ${ident('lastScanId')} = ${'holder'} WHERE id = ${x.id}`,
      );
      // While the holder is open, the rolled-back statement left nothing.
      const z = await exec(
        holder,
        sql`SELECT COUNT(*) AS n FROM sca_detected_packages WHERE ${ident('projectId')} = ${projectId} AND ${ident('packageName')} = ${'c-pkg'}`,
      );
      expect(Number(z[0].n)).toBe(0);
      await holder.commitTransaction();
    } catch (e) {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      throw e;
    } finally {
      await holder.release();
    }
    await ingestion;

    // On failure the received list says what happened instead.
    expect(logger.warn.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining(
        'deadlock on a 3-row package upsert, retrying once',
      ),
    );
    const rows = await packagesOf(projectId);
    expect(rows.map((r) => [r.packageName, r.lastScanId, r.path])).toEqual([
      ['a-pkg', 'scan-deadlock', ['scan']],
      ['b-pkg', 'scan-deadlock', ['scan']],
      ['c-pkg', 'scan-deadlock', ['scan']],
    ]);
    expect(currentDialect()).toBe(live.dialect);
  });
});
