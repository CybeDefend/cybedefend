import { DataSource } from 'typeorm';
import { currentDialect, ident, sql } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { getLicenseInfo } from 'src/modules/sca/license.utils';
import { OrganizationOverviewService } from './organization-overview.service';

/**
 * LIVE spec of the organization overview's license distribution (
 * ) against a REAL database: the GROUP BY must run under
 * `only_full_group_by` (as production runs; PostgreSQL always enforces it), and its
 * counts must equal what the former per-row JS ranking gave on the same rows,
 * with and without a branch filter.
 *
 * It runs on both engines, on the one LIVE_DB_TYPE selects, against
 * the real `sca_detected_packages` of that engine's migration tracks
 * (createLiveDatabase) instead of a TEMPORARY copy of its columns.
 *
 * Skipped unless `ORG_OVERVIEW_LICENSES_LIVE=1` (the former
 * `ORG_OVERVIEW_LICENSES_MYSQL_LIVE=1` still works and means MySQL), so
 * `pnpm run test` stays hermetic. It creates a throwaway database and drops
 * it at the end.
 *
 *   ORG_OVERVIEW_LICENSES_LIVE=1 LIVE_DB_TYPE=mysql \
 *   ORG_OVERVIEW_LICENSES_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=licenses.live --runInBand
 *   ORG_OVERVIEW_LICENSES_LIVE=1 LIVE_DB_TYPE=postgres \
 *   ORG_OVERVIEW_LICENSES_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=licenses.live --runInBand
 */
const LIVE = liveEnabled('ORG_OVERVIEW_LICENSES');
const describeLive = LIVE ? describe : describe.skip;

type Row = {
  projectId: string;
  branch: string;
  licenses: string | null;
};

/** The former implementation: every row loaded, each one ranked in JS. */
function rankRowByRow(rows: Row[]) {
  const out = {
    totalPackages: rows.length,
    packagesWithLicenses: 0,
    permissiveCount: 0,
    weakCopyleftCount: 0,
    strongCopyleftCount: 0,
    unknownCount: 0,
  };
  const order = ['PERMISSIVE', 'WEAK_COPYLEFT', 'STRONG_COPYLEFT', 'UNKNOWN'];
  for (const row of rows) {
    const licenses: string[] = row.licenses ? JSON.parse(row.licenses) : [];
    if (licenses.length === 0) {
      out.unknownCount++;
      continue;
    }
    out.packagesWithLicenses++;
    let highest = 'PERMISSIVE';
    for (const lic of licenses) {
      const category = getLicenseInfo(lic).category;
      if (order.indexOf(category) > order.indexOf(highest)) highest = category;
    }
    if (highest === 'PERMISSIVE') out.permissiveCount++;
    else if (highest === 'WEAK_COPYLEFT') out.weakCopyleftCount++;
    else if (highest === 'STRONG_COPYLEFT') out.strongCopyleftCount++;
    else out.unknownCount++;
  }
  return out;
}

describeLive(
  'OrganizationOverviewService license distribution – real MySQL',
  () => {
    jest.setTimeout(60_000);

    let live: LiveDatabase;
    let dataSource: DataSource;
    let service: OrganizationOverviewService;

    const longList = (last: string) =>
      JSON.stringify([...Array.from({ length: 120 }, () => 'MIT'), last]);
    const rows: Row[] = [
      { projectId: 'p1', branch: 'main', licenses: '["MIT"]' },
      { projectId: 'p1', branch: 'main', licenses: '["MIT"]' },
      { projectId: 'p1', branch: 'dev', licenses: '["GPL-3.0-only"]' },
      { projectId: 'p1', branch: 'main', licenses: null },
      { projectId: 'p1', branch: 'dev', licenses: null },
      // Same list but for the case: the collation calls them equal, the
      // ranking does not (Ruby is in the SPDX table, RUBY falls to UNKNOWN).
      { projectId: 'p1', branch: 'main', licenses: '["Ruby"]' },
      { projectId: 'p2', branch: 'main', licenses: '["RUBY"]' },
      { projectId: 'p2', branch: 'main', licenses: '["MIT","LGPL-2.1-only"]' },
      // Longer than max_sort_length (1024 bytes), differing only at the end.
      { projectId: 'p2', branch: 'main', licenses: longList('MIT') },
      { projectId: 'p2', branch: 'dev', licenses: longList('AGPL-3.0-only') },
      // Out of the scope: never counted.
      { projectId: 'p9', branch: 'main', licenses: '["GPL-2.0-only"]' },
    ];

    const ctx = (overrides: Record<string, unknown> = {}) => ({
      projectIds: ['p1', 'p2'],
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: [],
      branches: [],
      projectBranchMap: new Map<string, string[]>(),
      includeResolved: false,
      trendPeriodDays: 7,
      ...overrides,
    });

    beforeAll(async () => {
      const mysql = currentDialect() === 'mysql';
      live = await createLiveDatabase({
        prefix: 'org_overview_licenses',
        envPrefix: 'ORG_OVERVIEW_LICENSES',
        migrations: 'track',
        // One connection on MySQL: the session sql_mode below only holds on it.
        ...(mysql ? { extra: { connectionLimit: 1 } } : {}),
      });
      dataSource = live.dataSource;
      if (mysql) {
        // What production runs with: a non-aggregated column outside GROUP BY fails.
        await dataSource.query(
          "SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES'",
        );
      }
      let i = 0;
      for (const row of rows) {
        i++;
        const insert = sql`INSERT INTO sca_detected_packages
          (id, ${ident('projectId')}, ${ident('packageName')}, ${ident('packageVersion')}, branch, licenses,
           ${ident('fileName')}, ecosystem, ${ident('isTransitive')}, ${ident('isDev')})
          VALUES (${`id-${i}`}, ${row.projectId}, ${`pkg-${i}`}, ${'1.0.0'}, ${row.branch}, ${row.licenses},
           ${'package.json'}, ${'npm'}, ${false}, ${false})`;
        await dataSource.query(insert.text, insert.params);
      }

      service = new OrganizationOverviewService(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        dataSource.getRepository(ScaDetectedPackages),
        null,
        null,
        null,
        null,
      );
    });

    afterAll(async () => {
      await live?.drop();
    });

    const aggregate = (c: ReturnType<typeof ctx>) =>
      (
        service as unknown as {
          aggregateLicenseDistribution(
            c: ReturnType<typeof ctx>,
          ): Promise<ReturnType<typeof rankRowByRow>>;
        }
      ).aggregateLicenseDistribution(c);

    // MySQL's case- and accent-insensitive collation (and max_sort_length)
    // is why the query groups on MD5(licenses); PostgreSQL's text column
    // compares bytes, so there is no merge to show there.
    const mysqlOnly = currentDialect() === 'mysql' ? it : it.skip;
    mysqlOnly(
      'a plain GROUP BY on the column would merge lists that rank differently',
      async () => {
        const plain = await dataSource.query(
          "SELECT COUNT(*) AS n FROM (SELECT licenses FROM sca_detected_packages WHERE projectId IN ('p1','p2') GROUP BY licenses) g",
        );
        const hashed = await dataSource.query(
          "SELECT COUNT(*) AS n FROM (SELECT MD5(licenses) FROM sca_detected_packages WHERE projectId IN ('p1','p2') GROUP BY MD5(licenses)) g",
        );
        expect(Number(plain[0].n)).toBeLessThan(Number(hashed[0].n));
      },
    );

    it('matches the row-by-row ranking with no branch filter', async () => {
      const inScope = rows.filter((r) => ['p1', 'p2'].includes(r.projectId));
      await expect(aggregate(ctx())).resolves.toEqual(rankRowByRow(inScope));
    });

    it('matches the row-by-row ranking of the branches picked per project', async () => {
      const picked = rows.filter(
        (r) =>
          (r.projectId === 'p1' && r.branch === 'main') ||
          (r.projectId === 'p2' && r.branch === 'dev'),
      );
      const res = await aggregate(
        ctx({
          projectBranchMap: new Map([
            ['p1', ['main']],
            ['p2', ['dev']],
          ]),
        }),
      );
      expect(res).toEqual(rankRowByRow(picked));
      expect(res.totalPackages).toBe(5);
    });

    it('matches the row-by-row ranking of a branch picked for every project', async () => {
      const picked = rows.filter(
        (r) => ['p1', 'p2'].includes(r.projectId) && r.branch === 'dev',
      );
      await expect(aggregate(ctx({ branches: ['dev'] }))).resolves.toEqual(
        rankRowByRow(picked),
      );
    });
  },
);
