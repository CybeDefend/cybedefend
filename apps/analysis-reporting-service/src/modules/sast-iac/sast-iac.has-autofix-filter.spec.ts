/**
 * `hasAutofix` must mean "a SUCCESSFUL fix exists", not "a row
 * exists in autofix_records".
 *
 * The AutoFix page splits a project's findings in two lists off this single
 * flag: "To Fix" (`hasAutofix=false`) and "Fix Proposed" (`hasAutofix=true`).
 * The dashboard used to re-filter the page it received client-side, dropping
 * records whose status was `no_fix` / `error` / `failed` — while keeping the
 * backend's `totalCount`, so the pagination lied on every page.
 *
 * The client filter is gone (the backend owns sorting and filtering now), so
 * the SQL must carry that meaning itself: a finding whose only autofix attempt
 * failed belongs in "To Fix", never in "Fix Proposed". Today's async pipeline
 * deletes a non-successful record on finalize, but legacy rows from the
 * synchronous era still carry those statuses in production.
 */
import { of } from 'rxjs';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SastIacService, successfulAutofixSubquery } from './sast-iac.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ResultService } from '../result/result.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { Logger } from 'nestjs-pino';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

describe('SastIacService – hasAutofix selects SUCCESSFUL fixes only', () => {
  let service: SastIacService;
  let repos: Record<string, any>;

  function buildQbMock() {
    const qb: any = {
      andWhereCalls: [] as Array<[string, any]>,
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    };
    qb.andWhere = jest.fn((sql: any, params?: any) => {
      qb.andWhereCalls.push([String(sql), params]);
      return qb;
    });
    return qb;
  }

  /** Every andWhere predicate touching the autofix_records table. */
  function autofixPredicates(): string[] {
    return Object.values(repos)
      .flatMap((r: any) => r.__qbs || [])
      .flatMap((qb: any) => qb.andWhereCalls)
      .map(([sql]: [string, any]) => sql)
      .filter((sql: string) => /autofix_records/.test(sql));
  }

  beforeEach(async () => {
    repos = {};
    for (const key of ['sast', 'iac', 'cicd', 'secret', 'sca', 'autofix']) {
      const repo: any = createMockRepository();
      repo.__qbs = [];
      repo.createQueryBuilder = jest.fn(() => {
        const qb = buildQbMock();
        repo.__qbs.push(qb);
        return qb;
      });
      repos[key] = repo;
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        {
          provide: ResultService,
          useValue: {
            getCountVulnerabilitiesCountByType: jest.fn().mockResolvedValue({}),
            getAutofixCountByType: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: SastIacUtilsService, useValue: {} },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: repos.sast,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: repos.iac,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: repos.cicd,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: repos.secret,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: repos.sca,
        },
        { provide: getRepositoryToken(AutoFixRecord), useValue: repos.autofix },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SchedulerRegistry,
          useValue: { addInterval: jest.fn(), deleteInterval: jest.fn() },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanation: jest.fn() },
        },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SastIacService);
    (service as any).projectServiceClient = { get: () => of({ id: 'p1' }) };
    (service as any).scanServiceClient = {
      getLastScanStatus: () => of({ id: 's1' }),
    };
  });

  const listers: [string, (req: any) => Promise<any>][] = [];

  beforeEach(() => {
    listers.length = 0;
    listers.push(
      ['sast', (r) => service.getProjectSastVulnerabilities(r)],
      ['iac', (r) => service.getProjectIacVulnerabilities(r)],
      ['cicd', (r) => service.getProjectCicdVulnerabilities(r)],
      ['secret', (r) => service.getProjectSecretVulnerabilities(r)],
    );
  });

  const baseRequest = {
    projectId: 'p1',
    pageNumber: 1,
    pageSizeNumber: 10,
  };

  it.each([['sast'], ['iac'], ['cicd'], ['secret']])(
    '%s – hasAutofix=true only matches records with a successful status',
    async (type) => {
      const lister = listers.find(([t]) => t === type)![1];
      await lister({ ...baseRequest, hasAutofix: true });

      const predicates = autofixPredicates();
      expect(predicates.length).toBeGreaterThan(0);
      for (const sql of predicates) {
        expect(sql).toMatch(/^\s*EXISTS/);
        // the unsuccessful statuses must be excluded by the subquery itself
        expect(sql).toMatch(/afr\.status NOT IN/i);
        for (const bad of ['error', 'failed', 'no_fix', 'noop']) {
          expect(sql).toContain(`'${bad}'`);
        }
      }
    },
  );

  it.each([['sast'], ['iac'], ['cicd'], ['secret']])(
    '%s – hasAutofix=false keeps findings whose only fix attempt failed',
    async (type) => {
      const lister = listers.find(([t]) => t === type)![1];
      await lister({ ...baseRequest, hasAutofix: false });

      const predicates = autofixPredicates();
      expect(predicates.length).toBeGreaterThan(0);
      for (const sql of predicates) {
        expect(sql).toMatch(/^\s*NOT EXISTS/);
        expect(sql).toMatch(/afr\.status NOT IN/i);
      }
    },
  );

  it.each([['sast'], ['iac'], ['cicd'], ['secret']])(
    '%s – the predicate quotes no identifier with backticks',
    async (type) => {
      const lister = listers.find(([t]) => t === type)![1];
      await lister({ ...baseRequest, hasAutofix: true });
      await lister({ ...baseRequest, hasAutofix: false });

      const predicates = autofixPredicates();
      expect(predicates.length).toBeGreaterThan(0);
      for (const sql of predicates) expect(sql).not.toContain('`');
    },
  );
});

describe('successfulAutofixSubquery', () => {
  // PostgreSQL reads a backtick as a syntax error, and folds an unquoted
  // camelCase name to lower case: the alias and the column are quoted with
  // double quotes there. MySQL gets them as written.
  it('quotes the detection alias for PostgreSQL', () => {
    const sql = successfulAutofixSubquery('vulnDetection', 'postgres');
    expect(sql).toContain('= "vulnDetection"."id"');
    expect(sql).toContain('"afr"."detectionId"');
    expect(sql).not.toContain('`');
  });

  it('leaves the names as written for MySQL', () => {
    const sql = successfulAutofixSubquery('vulnDetection', 'mysql');
    expect(sql).toContain('afr.detectionId = vulnDetection.id');
    expect(sql).not.toContain('`');
  });
});
