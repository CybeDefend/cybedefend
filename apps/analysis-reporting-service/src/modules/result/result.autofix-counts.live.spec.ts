import { ObjectLiteral, Repository } from 'typeorm';

import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import {
  LIVE_PROJECTS,
  liveResultService,
  openResultsLiveDb,
  ResultsLiveDb,
  seedResultsDataset,
} from 'src/test-utils/results-live-db';
import { ACTIVE_VULN_STATES } from '../cyber-risk/cyber-risk.constants';
import { resolveScaEffectiveBranches } from '../sca/sca-branch.util';
import { ResultService } from './result.service';
import { liveEnabled } from '../../core/db/live-database';
import { rawBool, rawIdent } from '../../core/db/raw-sql';

/**
 * LIVE spec against a REAL MySQL: the autofix
 * counts, ten COUNTs awaited one after the other before the rewrite (with / without
 * an autofix record, per table), are one COUNT(*) + SUM(EXISTS(...)) per
 * table, the five in parallel, "without" being the total minus "with". The
 * SCA one now filters on the detection's own projectId.
 *
 * On the shared data set (detections with one or two autofix records or
 * none, SCA records with and without an available fix, two on some, the
 * legacy '' partition, detections without a package) every pair equals the
 * ten COUNTs, for two projects, an empty one and every branch shape.
 *
 * Skipped unless `RESULT_AUTOFIX_COUNTS_MYSQL_LIVE=1`. It creates and drops
 * its own database. How to run (the local docker MySQL listens on 3308):
 *   RESULT_AUTOFIX_COUNTS_MYSQL_LIVE=1 RESULTS_LIVE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=autofix-counts.live --runInBand
 */
const LIVE = liveEnabled('RESULT_AUTOFIX_COUNTS');
const describeLive = LIVE ? describe : describe.skip;

describeLive('autofix counts, one query per table — real MySQL', () => {
  jest.setTimeout(180_000);

  let live: ResultsLiveDb;
  let service: ResultService;
  const { P, Q, EMPTY } = LIVE_PROJECTS;
  const states = [...ACTIVE_VULN_STATES];

  /** getAutofixCountByType as it was before the rewrite: ten COUNTs. */
  const countsBeforeL10 = async (
    projectId: string,
    branch: string | undefined,
    scaBranches: string[],
  ) => {
    const ds = live.dataSource;
    const code = async (repo: Repository<ObjectLiteral>) => {
      const one = (exists: 'EXISTS' | 'NOT EXISTS') => {
        const qb = repo
          .createQueryBuilder('v')
          .where('v.projectId = :projectId', { projectId })
          .andWhere('v.currentState IN (:...states)', { states })
          .andWhere(
            `${exists} (SELECT 1 FROM autofix_records ar WHERE ${rawIdent('ar.detectionId')} = v.id)`,
          );
        if (branch) qb.andWhere('v.branch = :branch', { branch });
        return qb.getCount();
      };
      return {
        withAutofix: await one('EXISTS'),
        withoutAutofix: await one('NOT EXISTS'),
      };
    };
    const sca = async () => {
      const one = (exists: 'EXISTS' | 'NOT EXISTS') =>
        ds
          .getRepository(ScaVulnerabilityDetections)
          .createQueryBuilder('v')
          .innerJoin('v.scaDetectedPackage', 'pkg')
          .where('pkg.projectId = :projectId', { projectId })
          .andWhere('v.currentState IN (:...states)', { states })
          .andWhere(
            `${exists} (SELECT 1 FROM sca_autofix_records sar WHERE ${rawIdent('sar.scaVulnerabilityDetectionId')} = v.id AND ${rawIdent('sar.hasFixAvailable')} = ${rawBool(true)})`,
          )
          .andWhere('pkg.branch IN (:...branches)', { branches: scaBranches })
          .getCount();
      return {
        withAutofix: await one('EXISTS'),
        withoutAutofix: await one('NOT EXISTS'),
      };
    };
    return {
      sast: await code(ds.getRepository(SastVulnerabilityDetections)),
      iac: await code(ds.getRepository(IacVulnerabilityDetections)),
      cicd: await code(ds.getRepository(CicdVulnerabilityDetections)),
      secret: await code(ds.getRepository(SecretVulnerabilityDetections)),
      sca: await sca(),
    };
  };

  const CASES: Array<[string, string | undefined]> = [];
  for (const projectId of [P, Q, EMPTY]) {
    for (const branch of [undefined, 'main', 'master', 'feat', '']) {
      CASES.push([projectId, branch]);
    }
  }

  beforeAll(async () => {
    live = await openResultsLiveDb({
      prefix: 'back240_l10_autofix',
      envPrefix: 'RESULT_AUTOFIX_COUNTS',
    });
    await seedResultsDataset(live.dataSource);
    service = liveResultService(live.dataSource);
  });

  afterAll(async () => {
    await live?.close();
  });

  it.each(CASES)(
    'project %s, branch %s: every with/without pair equals the ten COUNTs',
    async (projectId, branch) => {
      const scaBranches = resolveScaEffectiveBranches(
        ['main', 'master'],
        branch,
      );
      expect(
        await service.getAutofixCountByType(projectId, branch, scaBranches),
      ).toEqual(await countsBeforeL10(projectId, branch, scaBranches));
    },
  );

  it('has both kinds on every table for a seeded project (the comparison is not 0 = 0)', async () => {
    const now = await service.getAutofixCountByType(P, undefined, [
      'main',
      'master',
      '',
    ]);
    for (const type of ['sast', 'iac', 'cicd', 'secret', 'sca'] as const) {
      expect(now[type].withAutofix).toBeGreaterThan(0);
      expect(now[type].withoutAutofix).toBeGreaterThan(0);
    }
  });

  it('reads each table once, the five queries in flight together', async () => {
    live.queries.length = 0;
    await service.getAutofixCountByType(P, 'main', ['main', '']);
    expect(live.queries).toHaveLength(5);
    expect(live.queries.map((q) => q.sql).join('\n')).not.toContain(
      '`pkg`.`projectId`',
    );
  });
});
