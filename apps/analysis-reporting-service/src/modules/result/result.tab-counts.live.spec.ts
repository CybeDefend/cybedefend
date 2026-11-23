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
  DISPLAYABLE_SEVERITIES,
  effectiveSeveritySql,
} from '../cvss/effective-severity-sql';
import { resolveScaEffectiveBranches } from '../sca/sca-branch.util';
import { ResultService } from './result.service';
import { liveEnabled } from '../../core/db/live-database';

/**
 * LIVE spec against a REAL MySQL: the per-type tab
 * counts, six COUNTs awaited one after the other before the rewrite, are one UNION
 * ALL. On one data set (two projects, three branches and a NULL branch, the
 * legacy SCA '' partition, malware, every severity input including the NULL
 * band and a score of 0, detections without a package) every count is the
 * one the six COUNTs gave, for every project and branch asked.
 *
 * Skipped unless `RESULT_TAB_COUNTS_MYSQL_LIVE=1`. It creates and drops its
 * own database. How to run (the local docker MySQL listens on 3308):
 *   RESULT_TAB_COUNTS_MYSQL_LIVE=1 RESULTS_LIVE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=tab-counts.live --runInBand
 */
const LIVE = liveEnabled('RESULT_TAB_COUNTS');
const describeLive = LIVE ? describe : describe.skip;

describeLive('tab counts in one UNION ALL — real MySQL ', () => {
  jest.setTimeout(180_000);

  let live: ResultsLiveDb;
  let service: ResultService;
  const { P, Q, EMPTY } = LIVE_PROJECTS;

  /**
   * getCountVulnerabilitiesCountByType as it was before the rewrite: one COUNT per
   * table, the SCA one on its package's project.
   */
  const countsBeforeL10 = async (
    projectId: string,
    branch: string | undefined,
    scaBranches: string[],
  ) => {
    const count = (
      repo: Repository<ObjectLiteral>,
      alias: string,
      projectIdExpr: string,
      opts: {
        joinScaPackage?: boolean;
        branches?: string[];
        excludeMalware?: boolean;
      } = {},
    ) => {
      const qb = repo.createQueryBuilder(alias);
      if (opts.joinScaPackage) {
        qb.innerJoin(`${alias}.scaDetectedPackage`, 'pkg');
      }
      qb.where(`${projectIdExpr} = :projectId`, { projectId })
        .andWhere(`${alias}.currentState IN (:...activeStates)`, {
          activeStates: [...ACTIVE_VULN_STATES],
        })
        .andWhere(`${effectiveSeveritySql(alias)} IN (:...displayable)`, {
          displayable: [...DISPLAYABLE_SEVERITIES],
        });
      if (opts.excludeMalware) {
        qb.andWhere(`${alias}.is_malware = :isMalware`, { isMalware: false });
      }
      if (opts.branches) {
        qb.andWhere(`${alias}.branch IN (:...branches)`, {
          branches: opts.branches,
        });
      } else if (branch) {
        qb.andWhere(`${alias}.branch = :branch`, { branch });
      }
      return qb.getCount();
    };
    const ds = live.dataSource;
    return {
      sast: await count(
        ds.getRepository(SastVulnerabilityDetections),
        'sast',
        'sast.projectId',
      ),
      iac: await count(
        ds.getRepository(IacVulnerabilityDetections),
        'iac',
        'iac.projectId',
      ),
      cicd: await count(
        ds.getRepository(CicdVulnerabilityDetections),
        'cicd',
        'cicd.projectId',
      ),
      secret: await count(
        ds.getRepository(SecretVulnerabilityDetections),
        'secret',
        'secret.projectId',
      ),
      sca: await count(
        ds.getRepository(ScaVulnerabilityDetections),
        'sca',
        'pkg.projectId',
        { joinScaPackage: true, branches: scaBranches, excludeMalware: true },
      ),
      container: await count(
        ds.getRepository(VulnerabilityDetectionsContainer),
        'container',
        'container.projectId',
      ),
      aibom: 0,
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
      prefix: 'back240_l10_tabs',
      envPrefix: 'RESULT_TAB_COUNTS',
    });
    await seedResultsDataset(live.dataSource);
    service = liveResultService(live.dataSource);
  });

  afterAll(async () => {
    await live?.close();
  });

  it.each(CASES)(
    'project %s, branch %s: every per-type count equals the six COUNTs',
    async (projectId, branch) => {
      const scaBranches = resolveScaEffectiveBranches(
        ['main', 'master'],
        branch,
      );
      const now = await service.getCountVulnerabilitiesCountByType(
        projectId,
        branch,
        scaBranches,
      );
      expect(now).toEqual(
        await countsBeforeL10(projectId, branch, scaBranches),
      );
    },
  );

  it('counts something on every type for a seeded project (the comparison is not 0 = 0)', async () => {
    const now = await service.getCountVulnerabilitiesCountByType(
      P,
      undefined,
      resolveScaEffectiveBranches(['main', 'master'], undefined),
    );
    for (const type of [
      'sast',
      'iac',
      'cicd',
      'secret',
      'sca',
      'container',
    ] as const) {
      expect(now[type]).toBeGreaterThan(0);
    }
  });

  it('reads the six tables in one round-trip', async () => {
    live.queries.length = 0;
    await service.getCountVulnerabilitiesCountByType(P, 'main', ['main', '']);
    expect(live.queries).toHaveLength(1);
    expect(live.queries[0].sql.match(/UNION ALL/g)).toHaveLength(5);
  });
});
