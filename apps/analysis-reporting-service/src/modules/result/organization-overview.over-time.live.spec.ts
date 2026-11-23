import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ScaAutoFixRecord } from '../../entities/sca-autofix-record.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { OrganizationOverviewService } from './organization-overview.service';
import { ResultService } from './result.service';
import { findCybeAnalysedDetectionIds } from './cybe-analysed-detections.helper';
import { HAS_IMPORT_LOCATIONS_SQL } from '../sca/sca.service';

/**
 * LIVE spec: the read path of the overview and the results returns
 * the same values on both engines, on the engine LIVE_DB_TYPE selects. Run it
 * in a time zone ahead of UTC, so a day bucket or a timestamp read back in
 * local time would move the 23:30Z row to the next day.
 *
 *   TZ=Europe/Paris AR_OVER_TIME_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_OVER_TIME_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=over-time.live
 *   TZ=Europe/Paris AR_OVER_TIME_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_OVER_TIME_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=over-time.live
 *
 * The schema is built by the dialect's migration tracks in a throwaway
 * database, dropped at the end. Every expectation is a literal, so both
 * engines are held to the same values.
 */
const LIVE = liveEnabled('AR_OVER_TIME');
const describeLive = LIVE ? describe : describe.skip;

const P = '0e0e0e0e-0000-4000-8000-00000000000a';
const Q = '0e0e0e0e-0000-4000-8000-00000000000b';
/** Owns the SCA detection the SCA autofix records point at; never in scope. */
const R = '0e0e0e0e-0000-4000-8000-00000000000c';

const utc = (iso: string) => new Date(iso);
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

interface FilterContextLike {
  projectIds: string[];
  teamIds: string[];
  severityFilter: string[];
  statusFilter: string[];
  analysisTypes: string[];
  branches: string[];
  projectBranchMap: Map<string, string[]>;
  includeResolved: boolean;
  trendPeriodDays: number;
  dateFrom?: Date;
  dateTo?: Date;
}

const ctx = (over: Partial<FilterContextLike> = {}): FilterContextLike => ({
  projectIds: [P, Q],
  teamIds: [],
  severityFilter: [],
  statusFilter: [],
  analysisTypes: [],
  branches: [],
  projectBranchMap: new Map(),
  includeResolved: false,
  trendPeriodDays: 7,
  ...over,
});

type Overview = Record<string, (...args: unknown[]) => Promise<unknown>>;

describeLive('the overview and results read path on both engines', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  let db: LiveDatabase;
  let ds: DataSource;
  let overview: Overview;
  const ids = {
    d1: randomUUID(),
    d2: randomUUID(),
    d3: randomUUID(),
    d4: randomUUID(),
    q1: randomUUID(),
  };

  const sastRow = (
    id: string,
    projectId: string,
    over: Record<string, unknown>,
  ) => ({
    id,
    projectId,
    branch: 'main',
    currentPriority: 'normal',
    currentSeverity: 'low',
    language: 'typescript',
    path: `src/${id}.ts`,
    vulnerableStartLine: 1,
    vulnerableEndLine: 1,
    scannerType: 'sast',
    ...over,
  });

  beforeAll(async () => {
    // The core entities only (never src/ee), schema from the migration tracks.
    db = await createLiveDatabase({
      prefix: 'ar_over_time',
      envPrefix: 'AR_OVER_TIME',
      migrations: 'track',
    });
    ds = db.dataSource;

    await ds.getRepository(SastVulnerabilityDetections).insert([
      sastRow(ids.d1, P, {
        currentState: 'to_verify',
        cvss4EnvironmentalScore: 9.5,
        createdAt: utc('2026-07-01T10:00:00Z'),
        updateAt: utc('2026-07-01T10:00:00Z'),
      }),
      // 23:30Z: still 2026-07-01 in UTC, already 2026-07-02 in Paris.
      sastRow(ids.d2, P, {
        currentState: 'to_verify',
        cvss4EnvironmentalScore: 7.5,
        createdAt: utc('2026-07-01T23:30:00Z'),
        updateAt: utc('2026-07-01T23:30:00Z'),
      }),
      // Fixed in exactly 3 days.
      sastRow(ids.d3, P, {
        currentState: 'resolved',
        cvss4EnvironmentalScore: 5,
        createdAt: utc('2026-07-02T09:00:00Z'),
        resolvedAt: utc('2026-07-05T09:00:00Z'),
        updateAt: utc('2026-07-05T09:00:00Z'),
      }),
      // Dismissed after 1.5 days: counted as 1 whole day.
      sastRow(ids.d4, P, {
        currentState: 'not_exploitable',
        cvss4EnvironmentalScore: 2,
        createdAt: utc('2026-07-03T12:00:00Z'),
        triagedAt: utc('2026-07-05T00:00:00Z'),
        updateAt: utc('2026-07-05T00:00:00Z'),
      }),
      // Project Q, on the 'feat' branch only.
      sastRow(ids.q1, Q, {
        branch: 'feat',
        language: 'python',
        currentState: 'confirmed',
        cvss4EnvironmentalScore: 9.1,
        createdAt: daysAgo(1),
        updateAt: daysAgo(1),
      }),
    ]);

    const history = (
      detectionId: string,
      userId: string,
      date: Date,
      type = 'comment',
      value = 'analysed',
    ) => ({
      id: randomUUID(),
      type,
      value,
      date,
      userId,
      sastVulnerabilityDetection: { id: detectionId },
    });
    await ds.getRepository(HistoryItem).insert([
      history(ids.d1, 'system', daysAgo(1)),
      history(ids.d1, 'system', daysAgo(1), 'status_change', 'ignored'),
      // Out of the 30-day window.
      history(ids.d2, 'system', daysAgo(31)),
      history(ids.d2, 'system', daysAgo(31), 'status_change', 'ignored'),
      // Not the AI agent: another case of the same word (out of the 30-day
      // window, which compares userId as each engine's collation does).
      history(ids.d3, 'System', daysAgo(40)),
      history(ids.d4, 'user-1', daysAgo(1)),
    ]);

    const scaDetectionId = randomUUID();
    await ds.getRepository(ScaVulnerabilityDetections).insert({
      id: scaDetectionId,
      projectId: R,
      branch: 'main',
      currentState: 'to_verify',
      currentSeverity: 'high',
      currentCVSS: 0,
      isMalware: false,
    });
    const scaAutofix = (createdAt: Date, prUrl: string | null) => ({
      id: randomUUID(),
      projectId: P,
      scaVulnerabilityDetectionId: scaDetectionId,
      cveId: 'GHSA-1',
      severity: 'high',
      vulnerablePackage: 'pkg',
      vulnerableVersion: '1.0.0',
      dependencyPath: [],
      ecosystem: 'npm',
      status: 'ok',
      prUrl,
      createdAt,
    });
    await ds
      .getRepository(ScaAutoFixRecord)
      .insert([
        scaAutofix(daysAgo(1), 'https://example.test/pr/1'),
        scaAutofix(daysAgo(1), null),
        scaAutofix(daysAgo(31), 'https://example.test/pr/2'),
      ]);

    const pkg = (
      name: string,
      importLocations: { file: string; line: number }[] | null,
    ) => ({
      id: randomUUID(),
      projectId: P,
      branch: 'main',
      packageName: name,
      packageVersion: '1.0.0',
      fileName: 'package.json',
      ecosystem: 'npm',
      isTransitive: false,
      isDev: false,
      importLocations,
    });
    await ds
      .getRepository(ScaDetectedPackages)
      .insert([
        pkg('with-locations', [{ file: 'src/a.ts', line: 3 }]),
        pkg('empty-locations', []),
        pkg('no-locations', null),
      ]);

    overview = new OrganizationOverviewService(
      ds.getRepository(SastVulnerabilityDetections),
      ds.getRepository(IacVulnerabilityDetections),
      ds.getRepository(ScaVulnerabilityDetections),
      ds.getRepository(VulnerabilityDetectionsContainer),
      ds.getRepository(CicdVulnerabilityDetections),
      ds.getRepository(SecretVulnerabilityDetections),
      ds.getRepository(AutoFixRecord),
      ds.getRepository(ScaDetectedPackages),
      null,
      null,
      null,
      null,
    ) as unknown as Overview;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.drop();
  }, HOOK_TIMEOUT);

  const series = (rows: unknown) =>
    (rows as { date: string; severity: string; count: string | number }[])
      .map((r) => `${r.date} ${r.severity} ${Number(r.count)}`)
      .sort();

  it('the per-day series is the same on both engines', async () => {
    const created = await overview.fetchCreatedOverTime('sast', [P], ctx());
    expect(series(created)).toEqual([
      '2026-07-01 CRITICAL 1',
      '2026-07-01 HIGH 1',
      '2026-07-02 MEDIUM 1',
      '2026-07-03 LOW 1',
    ]);
    for (const row of created as { date: unknown }[]) {
      expect(typeof row.date).toBe('string');
    }

    const closed = await overview.fetchClosedOverTime('sast', [P], ctx());
    expect(series(closed)).toEqual(['2026-07-05 LOW 1', '2026-07-05 MEDIUM 1']);

    // The whole chart: what was open at the end of each UTC day.
    const open = (await overview.aggregateVulnerabilitiesOverTime(
      ctx({ projectIds: [P], analysisTypes: ['SAST'] }),
    )) as { date: string; severity: string; count: number }[];
    const at = (date: string) =>
      open
        .filter((r) => r.date === date && r.count > 0)
        .map((r) => `${r.severity} ${r.count}`)
        .sort();
    expect(at('2026-07-01')).toEqual(['CRITICAL 1', 'HIGH 1']);
    expect(at('2026-07-03')).toEqual([
      'CRITICAL 1',
      'HIGH 1',
      'LOW 1',
      'MEDIUM 1',
    ]);
    expect(at('2026-07-05')).toEqual(['CRITICAL 1', 'HIGH 1']);
  });

  it('the mean time to fix in days is the same on both engines', async () => {
    await expect(
      overview.calculateMeanTimeToRemediate(ctx({ projectIds: [P] })),
    ).resolves.toBe(2);
  });

  it('the 30-day window excludes a 31-day-old row', async () => {
    const results = Object.assign(Object.create(ResultService.prototype), {
      historyItemRepository: ds.getRepository(HistoryItem),
      autoFixRepo: ds.getRepository(AutoFixRecord),
    }) as unknown as Overview;

    await expect(results.getAgentActivityCounts([P, Q])).resolves.toEqual({
      analyses: 1,
      triage: 1,
      falsePositives: 1,
    });
    await expect(results.getAgentAutofixCount([P, Q])).resolves.toBe(1);
  });

  it('system history rows are told apart case-sensitively', async () => {
    const analysed = await findCybeAnalysedDetectionIds(
      ds.getRepository(SastVulnerabilityDetections),
      P,
      [ids.d1, ids.d2, ids.d3, ids.d4],
    );
    expect([...analysed].sort()).toEqual([ids.d1, ids.d2].sort());
    expect(analysed.has(ids.d3)).toBe(false);
  });

  it('import locations are counted', async () => {
    const rows = await ds
      .getRepository(ScaDetectedPackages)
      .createQueryBuilder('pkg')
      .select('pkg.packageName', 'packageName')
      .where('pkg.projectId = :projectId', { projectId: P })
      .andWhere('pkg.importLocations IS NOT NULL')
      .andWhere(HAS_IMPORT_LOCATIONS_SQL)
      .getRawMany<{ packageName: string }>();
    expect(rows.map((r) => r.packageName)).toEqual(['with-locations']);
  });

  it('every camelCase alias of the overview reads back as written', async () => {
    const bySeverity = await overview.aggregateSeverityByProjects(
      ctx({ dateFrom: utc('2026-01-01T00:00:00Z') }),
    );
    expect(bySeverity).toEqual(
      expect.arrayContaining([
        { severity: 'CRITICAL', count: 2 },
        { severity: 'HIGH', count: 1 },
      ]),
    );
    expect((bySeverity as unknown[]).length).toBe(2);

    const byState = (await overview.aggregateStateByProjects(ctx())) as {
      state: string;
      count: number;
    }[];
    expect(byState.map((r) => `${r.state} ${r.count}`).sort()).toEqual([
      'confirmed 1',
      'not_exploitable 1',
      'resolved 1',
      'to_verify 2',
    ]);

    const byType = await overview.aggregateAnalysisTypeByProjects(
      ctx({
        severityFilter: ['CRITICAL', 'HIGH'],
        statusFilter: ['to_verify'],
      }),
    );
    expect(
      (byType as { analysisType: string; count: number }[])
        .map((r) => `${r.analysisType} ${r.count}`)
        .sort(),
    ).toEqual([
      'CICD 0',
      'CONTAINER 0',
      'IAC 0',
      'SAST 2',
      'SCA 0',
      'SECRET 0',
    ]);

    // Per project, with a branch picked per project.
    const stats = (await overview.getProjectLevelStats(
      ctx({
        projectBranchMap: new Map([
          [P, ['main']],
          [Q, ['feat']],
        ]),
        includeResolved: true,
      }),
    )) as Map<string, Record<string, unknown>>;
    expect(stats.get(P)).toMatchObject({
      total: 4,
      sast: 4,
      critical: 1,
      high: 1,
      medium: 1,
      low: 1,
      open: 2,
      resolved: 2,
    });
    expect(stats.get(Q)).toMatchObject({ total: 1, sast: 1, critical: 1 });
    expect([...(stats.get(Q).languages as Set<string>)]).toEqual(['python']);
    // Q's row is a day old: new in the 7-day period, on its project's key.
    expect(stats.get(Q)).toMatchObject({ newLast7Days: 1 });

    const trend = (await overview.fetchProjectTrendStatsOptimized(
      ctx(),
      7,
    )) as { projectId: string; newCount: number; resolvedCount: number }[];
    expect(trend).toEqual(
      expect.arrayContaining([
        { projectId: P, newCount: 0, resolvedCount: 0 },
        { projectId: Q, newCount: 1, resolvedCount: 0 },
      ]),
    );

    const licenses = await overview.aggregateLicenseDistribution(
      ctx({ projectIds: [P] }),
    );
    expect(licenses).toMatchObject({ totalPackages: 3, unknownCount: 3 });
  });
});
