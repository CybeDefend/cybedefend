import { ObjectLiteral, Repository } from 'typeorm';

import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import {
  LIVE_PROJECTS,
  liveResultService,
  openResultsLiveDb,
  ResultsLiveDb,
  seedResultsDataset,
} from 'src/test-utils/results-live-db';
import { ACTIVE_VULN_STATES } from '../cyber-risk/cyber-risk.constants';
import {
  effectiveSeveritySql,
  UNLABELLED_SEVERITY,
} from '../cvss/effective-severity-sql';
import { accumulateOpenOverTime, OverTimeRawRow } from './over-time.util';
import { ResultService } from './result.service';
import { dateBucket } from '@cybedefend/db-dialect';
import { liveEnabled } from '../../core/db/live-database';

/**
 * LIVE spec against a REAL MySQL: the project overview,
 * 24 queries awaited one after the other before the rewrite, is one GROUP BY
 * (severity, state) per table and one UNION ALL of the 12 trend series. On the
 * shared data set (two projects, three branches and a NULL branch, every
 * state, every severity input including the NULL band and a score of 0,
 * closed rows dated by resolution, triage or update date, SCA detections
 * without a package and malware) the four breakdowns are the ones the 24
 * queries gave, for every branch filter.
 *
 * The breakdown arrays are compared by key: their order comes from MySQL's
 * GROUP BY output, which neither version fixed, and the dashboard sorts them
 * before display.
 *
 * Skipped unless `RESULT_OVERVIEW_MYSQL_LIVE=1`. It creates and drops its own
 * database. How to run (the local docker MySQL listens on 3308):
 *   RESULT_OVERVIEW_MYSQL_LIVE=1 RESULTS_LIVE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=overview.live --runInBand
 */
const LIVE = liveEnabled('RESULT_OVERVIEW');
const describeLive = LIVE ? describe : describe.skip;

describeLive('project overview in 8 queries — real MySQL', () => {
  jest.setTimeout(180_000);

  let live: ResultsLiveDb;
  let service: ResultService;
  const { P, Q, EMPTY } = LIVE_PROJECTS;

  /** getProjectOverview's four breakdowns as they were computed before the rewrite. */
  const overviewBeforeL10 = async (projectId: string, branches: string[]) => {
    const branchFilters = branches.map((b) => b.trim()).filter(Boolean);
    const ds = live.dataSource;
    const tables: Array<
      [string, Repository<ObjectLiteral>, string, 'updateAt' | 'updatedAt']
    > = [
      [
        'SAST',
        ds.getRepository(SastVulnerabilityDetections),
        'sast',
        'updateAt',
      ],
      ['IAC', ds.getRepository(IacVulnerabilityDetections), 'iac', 'updateAt'],
      ['SCA', ds.getRepository(ScaVulnerabilityDetections), 'sca', 'updatedAt'],
      [
        'CONTAINER',
        ds.getRepository(VulnerabilityDetectionsContainer),
        'container',
        'updatedAt',
      ],
      [
        'CICD',
        ds.getRepository(CicdVulnerabilityDetections),
        'cicd',
        'updateAt',
      ],
      [
        'SECRET',
        ds.getRepository(SecretVulnerabilityDetections),
        'secret',
        'updateAt',
      ],
    ];
    const activeStates = [...ACTIVE_VULN_STATES];
    const scoped = (repo: Repository<ObjectLiteral>, alias: string) => {
      const qb = repo
        .createQueryBuilder(alias)
        .where(`${alias}.projectId = :projectId`, { projectId });
      if (branchFilters.length) {
        qb.andWhere(`${alias}.branch IN (:...branches)`, {
          branches: branchFilters,
        });
      }
      return qb;
    };

    const severityMap: Record<string, number> = {};
    const stateMap: Record<string, number> = {};
    const totalByAnalysisType: Array<{
      analysisType: string;
      count: number;
    }> = [];
    const overTime: OverTimeRawRow[] = [];
    for (const [type, repo, alias, touched] of tables) {
      const band = effectiveSeveritySql(alias);
      const bySeverity = await scoped(repo, alias)
        .select(band, 'severity')
        .addSelect('COUNT(*)', 'count')
        .andWhere(`${alias}.currentState IN (:...states)`, {
          states: activeStates,
        })
        .groupBy(band)
        .getRawMany<{ severity: string | null; count: string }>();
      for (const item of bySeverity) {
        const key = (
          item.severity?.trim() ? item.severity : UNLABELLED_SEVERITY
        ).toUpperCase();
        severityMap[key] = (severityMap[key] || 0) + Number(item.count);
      }
      const byState = await scoped(repo, alias)
        .select(`${alias}.currentState`, 'state')
        .addSelect('COUNT(*)', 'count')
        .groupBy(`${alias}.currentState`)
        .getRawMany<{ state: string; count: string }>();
      for (const item of byState) {
        stateMap[item.state] = (stateMap[item.state] || 0) + Number(item.count);
      }
      totalByAnalysisType.push({
        analysisType: type,
        count: await scoped(repo, alias)
          .andWhere(`${alias}.currentState IN (:...states)`, {
            states: activeStates,
          })
          .getCount(),
      });
      const createdDay = dateBucket(`${alias}.createdAt`, 'day').text;
      const created = await scoped(repo, alias)
        .select(createdDay, 'date')
        .addSelect(band, 'severity')
        .addSelect('COUNT(*)', 'count')
        .groupBy(createdDay)
        .addGroupBy(band)
        .orderBy(createdDay, 'ASC')
        .addOrderBy(band, 'ASC')
        .getRawMany<OverTimeRawRow>();
      const closedOn = `COALESCE(${alias}.resolvedAt, ${alias}.triagedAt, ${alias}.${touched})`;
      const closedDay = dateBucket(closedOn, 'day').text;
      const closed = await scoped(repo, alias)
        .select(closedDay, 'date')
        .addSelect(band, 'severity')
        .addSelect('COUNT(*)', 'count')
        .andWhere(`${alias}.currentState IN (:...states)`, {
          states: ['resolved', 'ignored', 'not_exploitable'],
        })
        .andWhere(`${closedOn} IS NOT NULL`)
        .groupBy(closedDay)
        .addGroupBy(band)
        .orderBy(closedDay, 'ASC')
        .addOrderBy(band, 'ASC')
        .getRawMany<OverTimeRawRow>();
      overTime.push(
        ...created.map((x) => ({ ...x, action: 'created' })),
        ...closed.map((x) => ({ ...x, action: 'closed' })),
      );
    }
    return {
      totalBySeverity: Object.keys(severityMap).map((severity) => ({
        severity,
        count: severityMap[severity],
      })),
      totalByState: Object.keys(stateMap).map((state) => ({
        state,
        count: stateMap[state],
      })),
      totalByAnalysisType,
      vulnerabilitiesOverTime: accumulateOpenOverTime(overTime),
    };
  };

  const byKey = <T, K extends keyof T>(rows: T[], key: K): T[] =>
    [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));

  const CASES: Array<[string, string[]]> = [];
  for (const projectId of [P, Q, EMPTY]) {
    for (const branches of [[], ['main'], ['feat', 'main'], [' feat ', '']]) {
      CASES.push([projectId, branches]);
    }
  }

  beforeAll(async () => {
    live = await openResultsLiveDb({
      prefix: 'back240_l10_overview',
      envPrefix: 'RESULT_OVERVIEW',
    });
    await seedResultsDataset(live.dataSource);
    service = liveResultService(live.dataSource, {
      projectCyberRiskRepo: { findByProjectId: async () => null },
      cyberiskEnqueuer: { enqueue: async () => undefined },
      logger: { error: () => undefined },
    });
  });

  afterAll(async () => {
    await live?.close();
  });

  it.each(CASES)(
    'project %s, branches %j: the four breakdowns equal the 24 queries',
    async (projectId, branches) => {
      const now = await service.getProjectOverview({ projectId, branches });
      const before = await overviewBeforeL10(projectId, branches);

      expect(byKey(now.totalBySeverity, 'severity')).toEqual(
        byKey(before.totalBySeverity, 'severity'),
      );
      expect(byKey(now.totalByState, 'state')).toEqual(
        byKey(before.totalByState, 'state'),
      );
      expect(now.totalByAnalysisType).toEqual(before.totalByAnalysisType);
      expect(now.vulnerabilitiesOverTime).toEqual(
        before.vulnerabilitiesOverTime,
      );
    },
  );

  it('has something in every breakdown for a seeded project (the comparison is not empty = empty)', async () => {
    const now = await service.getProjectOverview({
      projectId: P,
      branches: [],
    });

    expect(now.totalBySeverity.map((s) => s.severity)).toEqual(
      expect.arrayContaining(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE']),
    );
    expect(now.totalByState).toHaveLength(6);
    for (const type of now.totalByAnalysisType) {
      expect(type.count).toBeGreaterThan(0);
    }
    expect(now.vulnerabilitiesOverTime.length).toBeGreaterThan(0);
    const sum = (rows: Array<{ count: number }>) =>
      rows.reduce((total, row) => total + row.count, 0);
    expect(sum(now.totalByAnalysisType)).toBe(sum(now.totalBySeverity));
  });

  it('reads the database in 7 detection queries (plus the score row)', async () => {
    live.queries.length = 0;
    await service.getProjectOverview({ projectId: P, branches: ['main'] });
    expect(live.queries).toHaveLength(7);
  });
});
