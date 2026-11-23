import { randomUUID } from 'crypto';
import { of } from 'rxjs';

import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import {
  LIVE_PROJECTS,
  liveResultService,
  openResultsLiveDb,
  ResultsLiveDb,
  SeededResults,
  seedResultsDataset,
} from 'src/test-utils/results-live-db';
import { makeEmptyRepository } from 'src/test-utils/project-lookup.harness';
import { ACTIVE_VULN_STATES } from '../cyber-risk/cyber-risk.constants';
import {
  DISPLAYABLE_SEVERITIES,
  effectiveSeveritySql,
} from '../cvss/effective-severity-sql';
import { resolveScaEffectiveBranches } from '../sca/sca-branch.util';
import { ResultService } from './result.service';
import { currentDialect } from '@cybedefend/db-dialect';
import { liveEnabled } from '../../core/db/live-database';
import { rawBool, rawIdent } from '../../core/db/raw-sql';
import { scopingBranchesFor } from '../cyber-risk/branch-scoping.util';

/**
 * LIVE spec against a REAL MySQL: the SCA tab count now
 * filters on the detection's own `projectId` (indexed) instead of its
 * package's, keeping the INNER JOIN that leaves out detections whose package
 * is gone.
 *
 * - On one data set (two projects, the legacy '' partition, malware, a NULL
 *   band, detections without a package, other tenants' rows) the count is the
 *   same as the one computed on `pkg.projectId`.
 * - The new query reads the SCA table through an index (EXPLAIN `key` set).
 * - The project-list pills (getBatchVulnerabilitiesCount, with and without a
 *   reference branch) and the organisation totals (getTotalIssuesProjects)
 *   moved to the same predicate and give the same SCA numbers.
 * - The two predicates only agree while a detection carries its package's
 *   project and branch. A detection that does not is counted under another
 *   project: the deployment prerequisite (a read-only query on the replica)
 *   is that this query returns 0.
 *
 * Skipped unless `RESULT_SCA_COUNT_MYSQL_LIVE=1`. It creates and drops its own
 * database. How to run (the local docker MySQL listens on 3308):
 *   RESULT_SCA_COUNT_MYSQL_LIVE=1 RESULTS_LIVE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=sca-count.live --runInBand
 */
const LIVE = liveEnabled('RESULT_SCA_COUNT');
const describeLive = LIVE ? describe : describe.skip;

/**
 * The read-only check to run on the production replica before deploying (its
 * MySQL text is unchanged; the identifiers are quoted on PostgreSQL only).
 */
const SCA_PACKAGE_DIVERGENCE_CHECK = `SELECT COUNT(*) AS divergent
  FROM vulnerability_detections_sca s
  JOIN sca_detected_packages p ON p.id = ${rawIdent('s.scaDetectedPackageId')}
  WHERE ${rawIdent('s.projectId')} <> ${rawIdent('p.projectId')} OR s.branch <> p.branch`;

describeLive('SCA tab count on sca.projectId — real MySQL', () => {
  jest.setTimeout(180_000);

  let live: ResultsLiveDb;
  let seeded: SeededResults;
  let service: ResultService;
  const { P, Q, EMPTY } = LIVE_PROJECTS;

  /** The SCA count as it was computed before the rewrite: on the package's project. */
  const countOnPackageProject = (projectId: string, branches: string[]) =>
    live.dataSource
      .getRepository(ScaVulnerabilityDetections)
      .createQueryBuilder('sca')
      .innerJoin('sca.scaDetectedPackage', 'pkg')
      .where('pkg.projectId = :projectId', { projectId })
      .andWhere('sca.currentState IN (:...activeStates)', {
        activeStates: [...ACTIVE_VULN_STATES],
      })
      .andWhere(`${effectiveSeveritySql('sca')} IN (:...displayable)`, {
        displayable: [...DISPLAYABLE_SEVERITIES],
      })
      .andWhere('sca.is_malware = :isMalware', { isMalware: false })
      .andWhere('sca.branch IN (:...branches)', { branches })
      .getCount();

  const countNow = async (projectId: string, branch: string | undefined) => {
    const branches = resolveScaEffectiveBranches(['main', 'master'], branch);
    const counts = await service.getCountVulnerabilitiesCountByType(
      projectId,
      branch,
      branches,
    );
    return { branches, sca: counts.sca };
  };

  const CASES: Array<[string, string | undefined]> = [
    [P, undefined],
    [P, 'main'],
    [P, 'master'],
    [P, ''],
    [P, 'feat'],
    [Q, undefined],
    [Q, 'main'],
    [Q, 'feat'],
    [EMPTY, undefined],
  ];

  beforeAll(async () => {
    live = await openResultsLiveDb({
      prefix: 'back240_l10_sca',
      envPrefix: 'RESULT_SCA_COUNT',
    });
    seeded = await seedResultsDataset(live.dataSource);
    // Other tenants: enough rows that reading the whole table costs more than
    // the project's index range, as in production.
    const packages = live.dataSource.getRepository(ScaDetectedPackages);
    const detections = live.dataSource.getRepository(
      ScaVulnerabilityDetections,
    );
    for (let tenant = 0; tenant < 40; tenant += 1) {
      const projectId = randomUUID();
      const packageId = randomUUID();
      await packages.insert({
        id: packageId,
        projectId,
        branch: 'main',
        packageName: 'noise',
        packageVersion: '1.0.0',
        fileName: 'package.json',
        ecosystem: 'npm',
        isTransitive: false,
        isDev: false,
      });
      await detections.insert(
        Array.from({ length: 100 }, (_, i) => ({
          id: randomUUID(),
          projectId,
          branch: 'main',
          scaDetectedPackage: { id: packageId },
          currentState: i % 2 ? 'to_verify' : 'resolved',
          currentCVSS: 0,
          cvss4EnvironmentalScore: 8,
        })),
      );
    }
    await live.dataSource.query(
      currentDialect() === 'mysql'
        ? 'ANALYZE TABLE vulnerability_detections_sca, sca_detected_packages'
        : 'ANALYZE vulnerability_detections_sca, sca_detected_packages',
    );
    service = liveResultService(live.dataSource);
  });

  afterAll(async () => {
    await live?.close();
  });

  it('seeds detections that always carry their package project and branch', async () => {
    expect(seeded.scaIds.length).toBeGreaterThan(100);
    const [{ divergent }] = await live.dataSource.query(
      SCA_PACKAGE_DIVERGENCE_CHECK,
    );
    expect(Number(divergent)).toBe(0);
  });

  it.each(CASES)(
    'counts project %s on branch %s exactly as the pkg.projectId count did',
    async (projectId, branch) => {
      const { branches, sca } = await countNow(projectId, branch);
      expect(sca).toBe(await countOnPackageProject(projectId, branches));
    },
  );

  it('still leaves out a detection whose package is gone', async () => {
    const withoutPackage = await live.dataSource
      .getRepository(ScaVulnerabilityDetections)
      .createQueryBuilder('sca')
      .where('sca.projectId = :projectId', { projectId: P })
      .andWhere('sca.scaDetectedPackageId IS NULL')
      .andWhere('sca.currentState IN (:...s)', { s: [...ACTIVE_VULN_STATES] })
      .andWhere('sca.branch IN (:...b)', { b: ['main', 'master', ''] })
      .getCount();
    expect(withoutPackage).toBe(2);

    const { sca } = await countNow(P, undefined);
    const everyActiveDisplayableNonMalware = await live.dataSource
      .getRepository(ScaVulnerabilityDetections)
      .createQueryBuilder('sca')
      .where('sca.projectId = :projectId', { projectId: P })
      .andWhere('sca.currentState IN (:...s)', { s: [...ACTIVE_VULN_STATES] })
      .andWhere(`${effectiveSeveritySql('sca')} IN (:...d)`, {
        d: [...DISPLAYABLE_SEVERITIES],
      })
      .andWhere(`sca.is_malware = ${rawBool(false)}`)
      .andWhere('sca.branch IN (:...b)', { b: ['main', 'master', ''] })
      .getCount();
    expect(sca).toBe(everyActiveDisplayableNonMalware - withoutPackage);
  });

  // On pkg.projectId MySQL either scanned the whole SCA table (every tenant)
  // or started from every package of the project, all branches, and reached
  // the detections through their package. On sca.projectId it reads the
  // project's detections through an index that leads with projectId.
  it('reads the SCA table through an index on its own projectId (EXPLAIN key is set)', async () => {
    const mysql = currentDialect() === 'mysql';
    // The indexes whose first column is projectId.
    const projectIdIndexes: Array<{ Key_name: string }> = mysql
      ? await live.dataSource.query(
          "SHOW INDEX FROM vulnerability_detections_sca WHERE Seq_in_index = 1 AND Column_name = 'projectId'",
        )
      : await live.dataSource.query(
          `SELECT i.relname AS "Key_name"
               FROM pg_index x
               JOIN pg_class i ON i.oid = x.indexrelid
               JOIN pg_class t ON t.oid = x.indrelid
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
              WHERE t.relname = 'vulnerability_detections_sca' AND a.attname = 'projectId'`,
        );
    const byProject = projectIdIndexes.map((i) => i.Key_name);
    expect(byProject).toContain('IDX_vd_sca_proj_state');

    live.queries.length = 0;
    await countNow(P, undefined);
    const quotedTable = mysql
      ? '`vulnerability_detections_sca`'
      : '"vulnerability_detections_sca"';
    const scaQueries = live.queries.filter((q) => q.sql.includes(quotedTable));
    expect(scaQueries.length).toBeGreaterThan(0);

    for (const q of scaQueries) {
      // One row per access to the table aliased `sca`: its access type and
      // the index it reads (MySQL EXPLAIN `type` / `key`; on PostgreSQL the
      // plan node, a Seq Scan being MySQL's ALL).
      const scaRows: Array<{ type: string; key: string | null }> = [];
      if (mysql) {
        const plan: Array<{
          table: string;
          key: string | null;
          type: string;
        }> = await live.dataSource.query(`EXPLAIN ${q.sql}`, q.parameters);
        scaRows.push(...plan.filter((row) => row.table === 'sca'));
      } else {
        type PlanNode = {
          'Node Type': string;
          Alias?: string;
          'Index Name'?: string;
          Plans?: PlanNode[];
        };
        const [{ 'QUERY PLAN': plan }] = (await live.dataSource.query(
          `EXPLAIN (FORMAT JSON) ${q.sql}`,
          q.parameters,
        )) as Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>;
        const visit = (node: PlanNode): void => {
          if (node.Alias === 'sca') {
            const bitmapIndex = (node.Plans ?? []).find(
              (child) => child['Node Type'] === 'Bitmap Index Scan',
            );
            scaRows.push({
              type:
                node['Node Type'] === 'Seq Scan' ? 'ALL' : node['Node Type'],
              key: node['Index Name'] ?? bitmapIndex?.['Index Name'] ?? null,
            });
          }
          (node.Plans ?? []).forEach(visit);
        };
        visit(plan[0].Plan);
      }
      expect(scaRows.length).toBeGreaterThan(0);
      for (const row of scaRows) {
        expect(row.type).not.toBe('ALL');
        expect(row.key).not.toBeNull();
        expect(byProject).toContain(row.key);
      }
    }
  });

  /**
   * Per-project SCA severity buckets as the pkg.projectId queries gave them,
   * on the package branches `branchesOf` names (every branch when it
   * answers null).
   */
  const scaBucketsOnPackageProject = async (
    projectIds: string[],
    branchesOf: (projectId: string) => string[] | null,
  ) => {
    const buckets = new Map<string, Record<string, number>>();
    for (const projectId of projectIds) {
      const qb = live.dataSource
        .getRepository(ScaVulnerabilityDetections)
        .createQueryBuilder('sca')
        .innerJoin('sca.scaDetectedPackage', 'pkg')
        .select(effectiveSeveritySql('sca'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('pkg.projectId = :projectId', { projectId })
        .andWhere('sca.currentState IN (:...states)', {
          states: [...ACTIVE_VULN_STATES],
        });
      const branches = branchesOf(projectId);
      if (branches) {
        qb.andWhere('pkg.branch IN (:...branches)', { branches });
      }
      const rows = await qb
        .groupBy(effectiveSeveritySql('sca'))
        .getRawMany<{ severity: string | null; count: string }>();
      const entry = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const row of rows) {
        const band = row.severity?.toLowerCase() ?? '';
        if (band in entry)
          entry[band as keyof typeof entry] = Number(row.count);
      }
      buckets.set(projectId, entry);
    }
    return buckets;
  };

  it.each([
    ['without reference branches', new Map<string, string>()],
    ['with a reference branch on one project', new Map([[Q, 'main']])],
    [
      'with a reference branch on both projects',
      new Map([
        [P, 'feat'],
        [Q, 'main'],
      ]),
    ],
  ])(
    'project-list pills (getBatchVulnerabilitiesCount) %s: the same SCA buckets',
    async (_name, referenceBranches) => {
      const batch = liveResultService(live.dataSource, {
        scanServiceClient: {
          getBatchLastScans: () => of({ scans: [] }),
        },
        projectCyberRiskRepo: { findByProjectIds: async () => [] },
        cyberiskEnqueuer: { enqueue: async () => undefined },
      });
      const projectIds = [P, Q, EMPTY];
      const { counts } = await batch.getBatchVulnerabilitiesCount({
        projectIds,
        referenceBranches: [...referenceBranches].map(
          ([projectId, referenceBranch]) => ({ projectId, referenceBranch }),
        ),
      });
      // Each project is counted on the branches its
      // CybeRisk is scoped on (reference branch, else the git default, else
      // main/master), plus SCA's legacy '' partition; no git default here.
      const expected = await scaBucketsOnPackageProject(
        projectIds,
        (projectId) =>
          resolveScaEffectiveBranches(
            scopingBranchesFor(referenceBranches.get(projectId), null),
          ),
      );
      for (const projectId of projectIds) {
        const sca = counts
          .find((c) => c.projectId === projectId)!
          .analyses.find((a) => a.type === 'sca')!;
        expect({
          critical: sca.critical,
          high: sca.high,
          medium: sca.medium,
          low: sca.low,
        }).toEqual(expected.get(projectId));
      }
      expect(
        Object.values(expected.get(P)!).reduce((a, b) => a + b, 0),
      ).toBeGreaterThan(0);
    },
  );

  it('organisation totals (getTotalIssuesProjects): the same SCA numbers', async () => {
    // Only the SCA query reads rows here: the other tables answer nothing.
    const scaOnly = liveResultService(live.dataSource, {
      sastVulnDetectRepository: makeEmptyRepository(),
      iacVulnDetectRepository: makeEmptyRepository(),
      containerVulnDetectRepository: makeEmptyRepository(),
    });
    const projectIds = [P, Q];
    const now = await scaOnly.getTotalIssuesProjects(projectIds);
    const expected = await scaBucketsOnPackageProject(projectIds, () => null);
    const sum = (band: 'critical' | 'high' | 'medium' | 'low') =>
      projectIds.reduce((total, id) => total + expected.get(id)![band], 0);
    expect(now).toEqual({
      criticalIssues: sum('critical'),
      highIssues: sum('high'),
      mediumIssues: sum('medium'),
      lowIssues: sum('low'),
    });
    expect(now.criticalIssues + now.highIssues).toBeGreaterThan(0);
  });

  // The two predicates agree only under the invariant above. A detection
  // carrying another project than its package's moves from one project's
  // badge to the other's; the replica check finds exactly such rows.
  it('shows the divergence a detection/package project mismatch would cause, and the check that finds it', async () => {
    const detections = live.dataSource.getRepository(
      ScaVulnerabilityDetections,
    );
    const id = randomUUID();
    await detections.insert({
      id,
      projectId: Q,
      branch: 'main',
      scaDetectedPackage: { id: seeded.scaPackageIds[`${P}:main`] },
      currentState: 'to_verify',
      currentCVSS: 0,
      cvss4EnvironmentalScore: 9.5,
    });
    try {
      const [{ divergent }] = await live.dataSource.query(
        SCA_PACKAGE_DIVERGENCE_CHECK,
      );
      expect(Number(divergent)).toBe(1);

      const p = await countNow(P, undefined);
      const q = await countNow(Q, undefined);
      expect(p.sca).toBe((await countOnPackageProject(P, p.branches)) - 1);
      expect(q.sca).toBe((await countOnPackageProject(Q, q.branches)) + 1);
    } finally {
      await detections.delete({ id });
    }
  });
});
