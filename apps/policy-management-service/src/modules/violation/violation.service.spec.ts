import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ViolationService } from './violation.service';
import { PolicyViolation } from '@entities/policy-violation.entity';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { PolicyService } from '../policy/policy.service';
import { of, throwError } from 'rxjs';
import { GetOrganizationComplianceOverviewRequest } from '@grpc/policy-management/violation';

/**
 * One query built through a mocked `createQueryBuilder`: every builder call is
 * recorded, so a test can read what the service asked the database for, and
 * the rows it gets back are chosen by the test from that same record.
 */
interface RecordedQuery {
  alias: string;
  calls: { method: string; args: unknown[] }[];
  /** Every builder call, flattened, for matching on the SQL fragments. */
  text: () => string;
  /** The merged named parameters of every where/andWhere/setParameter call. */
  params: () => Record<string, unknown>;
}

type RowsFor = (query: RecordedQuery) => unknown[] | Promise<unknown[]>;

function recordingQueryBuilderFactory(rowsFor: RowsFor) {
  const queries: RecordedQuery[] = [];
  const createQueryBuilder = jest.fn((alias: string) => {
    const query: RecordedQuery = {
      alias,
      calls: [],
      text: () =>
        query.calls
          .map(
            (c) =>
              `${c.method}(${c.args
                .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
                .join(', ')})`,
          )
          .join(' '),
      params: () =>
        query.calls.reduce<Record<string, unknown>>((acc, c) => {
          for (const arg of c.args) {
            if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
              Object.assign(acc, arg);
            }
          }
          if (c.method === 'setParameter') {
            acc[c.args[0] as string] = c.args[1];
          }
          return acc;
        }, {}),
    };
    queries.push(query);
    const terminal = () => Promise.resolve(rowsFor(query));
    const qb: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          // Not a thenable: an async function may return the builder.
          if (prop === 'then') return undefined;
          if (prop === 'getRawMany' || prop === 'getMany') return terminal;
          if (prop === 'getRawOne' || prop === 'getOne') {
            return () => terminal().then((rows) => rows[0]);
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(prop), args });
            return qb;
          };
        },
      },
    );
    return qb;
  });
  return { createQueryBuilder, queries };
}

/**
 * The violation stats of a project read three counters and a status, never
 * every violation of the project (each carries the jsonb snapshot of every
 * affected vulnerability) counted in JS, nor two whole evaluation rows.
 */
describe('ViolationService - getViolationStats', () => {
  const projectId = 'pppppppp-pppp-pppp-pppp-pppppppppppp';

  let service: ViolationService;
  let violationFind: jest.Mock;
  let evaluationFindOne: jest.Mock;
  let getEffectivePolicy: jest.Mock;
  let countRows: () => unknown[] | Promise<unknown[]>;
  let statusRows: () => unknown[] | Promise<unknown[]>;
  let violationQueries: RecordedQuery[];
  let evaluationQueries: RecordedQuery[];

  beforeEach(async () => {
    countRows = () => [
      { actionTaken: 'BLOCK', count: '2' },
      { actionTaken: 'WARN', count: '3' },
    ];
    statusRows = () => [{ status: 'COMPLETED' }];
    violationFind = jest.fn().mockResolvedValue([]);
    evaluationFindOne = jest.fn().mockResolvedValue(null);
    getEffectivePolicy = jest.fn().mockResolvedValue({
      effectiveConfig: { rules: [], exclusions: [] },
      appliedPolicies: [{ id: 'pol-1' }, { id: 'pol-2' }, { id: 'pol-3' }],
    });

    const violations = recordingQueryBuilderFactory(() => countRows());
    const evaluations = recordingQueryBuilderFactory(() => statusRows());
    violationQueries = violations.queries;
    evaluationQueries = evaluations.queries;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationService,
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: {
            find: violationFind,
            createQueryBuilder: violations.createQueryBuilder,
          },
        },
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: {
            findOne: evaluationFindOne,
            createQueryBuilder: evaluations.createQueryBuilder,
          },
        },
        { provide: getRepositoryToken(SecurityPolicy), useValue: {} },
        { provide: PolicyService, useValue: { getEffectivePolicy } },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();

    service = module.get(ViolationService);
  });

  it('counts the violations with one GROUP BY and never loads them', async () => {
    const stats = await service.getViolationStats(projectId);

    expect(violationFind).not.toHaveBeenCalled();
    expect(violationQueries).toHaveLength(1);
    const count = violationQueries[0].text();
    expect(count).toContain('COUNT(*)');
    expect(count).toContain('groupBy(v.actionTaken)');
    expect(count).not.toContain('violationDetails');
    expect(violationQueries[0].params()).toEqual(
      expect.objectContaining({ projectId }),
    );
    expect(stats).toEqual({
      totalViolations: 5,
      blockedCount: 2,
      warnedCount: 3,
      applicablePoliciesCount: 3,
      complianceStatus: 'Non-Compliant',
    });
  });

  it('reads only the status of the evaluations, in one query', async () => {
    await service.getViolationStats(projectId);

    expect(evaluationFindOne).not.toHaveBeenCalled();
    expect(evaluationQueries).toHaveLength(1);
    const statuses = evaluationQueries[0].text();
    expect(statuses).toContain('select(e.status, status)');
    expect(statuses).not.toContain('resultDetails');
    expect(evaluationQueries[0].params()).toEqual(
      expect.objectContaining({ projectId }),
    );
  });

  it('starts the effective policy before the count has returned', async () => {
    let releaseCount: (rows: unknown[]) => void = () => undefined;
    const count = new Promise<unknown[]>((resolve) => {
      releaseCount = resolve;
    });
    countRows = () => count;
    // Whichever way the violations are counted, the count is still running.
    violationFind.mockReturnValue(count.then(() => []));

    const pending = service.getViolationStats(projectId);
    await new Promise((resolve) => setImmediate(resolve));

    expect(getEffectivePolicy).toHaveBeenCalledWith(projectId);
    releaseCount([{ actionTaken: 'WARN', count: '1' }]);
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ totalViolations: 1, warnedCount: 1 }),
    );
  });

  it('keeps the compliance status rules', async () => {
    statusRows = () => [];
    await expect(service.getViolationStats(projectId)).resolves.toEqual(
      expect.objectContaining({ complianceStatus: 'Pending' }),
    );

    statusRows = () => [{ status: 'COMPLETED' }, { status: 'IN_PROGRESS' }];
    await expect(service.getViolationStats(projectId)).resolves.toEqual(
      expect.objectContaining({ complianceStatus: 'Pending' }),
    );

    statusRows = () => [{ status: 'COMPLETED' }, { status: 'FAILED' }];
    countRows = () => [{ actionTaken: 'WARN', count: '4' }];
    await expect(service.getViolationStats(projectId)).resolves.toEqual(
      expect.objectContaining({
        complianceStatus: 'Compliant',
        totalViolations: 4,
        blockedCount: 0,
        warnedCount: 4,
      }),
    );
  });

  it('still answers, with no applicable policy, when the effective policy fails', async () => {
    getEffectivePolicy.mockRejectedValue(new Error('5 NOT_FOUND: no project'));

    await expect(service.getViolationStats(projectId)).resolves.toEqual(
      expect.objectContaining({
        applicablePoliciesCount: 0,
        totalViolations: 5,
      }),
    );
  });

  it('applies the organization and date filters to the count', async () => {
    await service.getViolationStats(projectId, {
      organizationId: 'org-1',
      fromDate: Date.UTC(2026, 0, 1),
      toDate: Date.UTC(2026, 1, 1),
    });

    const count = violationQueries[0];
    expect(count.text()).toContain('v.organizationId = :organizationId');
    expect(count.text()).toContain('v.createdAt BETWEEN :fromDate AND :toDate');
    expect(count.params()).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        fromDate: new Date(Date.UTC(2026, 0, 1)),
        toDate: new Date(Date.UTC(2026, 1, 1)),
      }),
    );
  });
});

/**
 * Tenant isolation of violations.
 *
 * `getScanViolations` is project-scoped: the query is scoped by `projectId`,
 * so a scanId of another project returns none of its violations.
 */
describe('ViolationService - inter-org tenant isolation', () => {
  let service: ViolationService;
  let violationRepo: jest.Mocked<Repository<PolicyViolation>>;

  const scanId = 'ssssssss-ssss-ssss-ssss-ssssssssssss';
  const projectId = 'pppppppp-pppp-pppp-pppp-pppppppppppp';

  beforeEach(async () => {
    violationRepo = {
      findAndCount: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<PolicyViolation>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationService,
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: violationRepo,
        },
        { provide: getRepositoryToken(PolicyEvaluation), useValue: {} },
        { provide: getRepositoryToken(SecurityPolicy), useValue: {} },
        { provide: PolicyService, useValue: {} },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();

    service = module.get(ViolationService);
  });

  describe('getScanViolations', () => {
    it('scopes the query by projectId so a foreign scanId returns nothing', async () => {
      (violationRepo.findAndCount as jest.Mock).mockResolvedValue([[], 0]);

      const result = await service.getScanViolations(scanId, projectId, 1, 20);

      expect(violationRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { scanId, projectId },
        }),
      );
      expect(result.total).toBe(0);
      expect(result.violations).toEqual([]);
    });
  });
});

/**
 * The organization compliance overview: the table, its total and its
 * statuses cover every readable project, filtered and sorted as a whole
 * before paging (filtering one page of the project list only is wrong as soon
 * as there is more than one page); the trend reads a bounded window, never
 * every completed evaluation of the organization.
 */
describe('ViolationService - organization compliance overview', () => {
  const organizationId = 'oooooooo-oooo-oooo-oooo-oooooooooooo';
  const userId = 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu';
  const DAY = 24 * 60 * 60 * 1000;

  interface FakeProject {
    projectId: string;
    name: string;
    teamId?: string;
  }
  interface FakeEvaluation {
    projectId: string;
    scanId: string;
    status: string;
    createdAt: Date;
    /** Whether a BLOCK violation is recorded on this evaluation's scan. */
    hasBlock?: boolean;
  }
  interface FakeViolation {
    projectId: string;
    scanId: string;
    actionTaken: 'BLOCK' | 'WARN';
    ruleName: string;
  }

  let readable: FakeProject[];
  let evaluations: FakeEvaluation[];
  let violations: FakeViolation[];
  let service: ViolationService;
  let violationQueries: RecordedQuery[];
  let evaluationQueries: RecordedQuery[];
  let getReadableProjectsInOrganization: jest.Mock;
  let getAllFromOrganization: jest.Mock;
  let countProjectsInOrganization: jest.Mock;

  /** Rows of the projects a query is restricted to, as the SQL would. */
  const within = <T extends { projectId: string }>(
    rows: T[],
    query: RecordedQuery,
  ): T[] => {
    const ids = query.params().projectIds;
    return Array.isArray(ids)
      ? rows.filter((r) => ids.includes(r.projectId))
      : rows;
  };

  const groupCount = <T>(rows: T[], key: (row: T) => string) => {
    const counts = new Map<string, number>();
    for (const row of rows)
      counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
    return counts;
  };

  const latestPerProject = (rows: FakeEvaluation[]) => {
    const latest = new Map<string, FakeEvaluation>();
    for (const e of rows) {
      const current = latest.get(e.projectId);
      if (!current || e.createdAt > current.createdAt)
        latest.set(e.projectId, e);
    }
    return [...latest.values()];
  };

  const violationRows = (query: RecordedQuery): unknown[] => {
    const text = query.text();
    const rows = within(violations, query);
    if (text.includes('ruleName')) {
      return [...groupCount(rows, (v) => `${v.ruleName}|${v.actionTaken}`)].map(
        ([key, count]) => {
          const [ruleType, actionTaken] = key.split('|');
          return { ruleType, actionTaken, count: String(count) };
        },
      );
    }
    if (text.includes('groupBy(v.projectId)')) {
      return [
        ...groupCount(rows, (v) => `${v.projectId}|${v.actionTaken}`),
      ].map(([key, count]) => {
        const [projectId, actionTaken] = key.split('|');
        return { projectId, actionTaken, count: String(count) };
      });
    }
    if (text.includes('DISTINCT v.projectId')) {
      return [
        ...new Set(
          rows.filter((v) => v.actionTaken === 'BLOCK').map((v) => v.projectId),
        ),
      ].map((projectId) => ({ projectId }));
    }
    if (text.includes('DISTINCT v.scanId')) {
      return [
        ...new Set(
          rows.filter((v) => v.actionTaken === 'BLOCK').map((v) => v.scanId),
        ),
      ].map((scanId) => ({ scanId }));
    }
    return [...groupCount(rows, (v) => v.actionTaken)].map(
      ([actionTaken, count]) => ({ actionTaken, count: String(count) }),
    );
  };

  const evaluationRows = (query: RecordedQuery): unknown[] => {
    const text = query.text();
    const rows = within(evaluations, query);
    const trendStart = query.params().trendStart as Date | undefined;
    const completed = rows.filter((e) => e.status === 'COMPLETED');
    const asRow = (e: FakeEvaluation) => ({ ...e, hasBlock: !!e.hasBlock });
    if (text.includes('< :trendStart')) {
      return latestPerProject(
        completed.filter((e) => e.createdAt < trendStart!),
      ).map(asRow);
    }
    if (text.includes('>= :trendStart')) {
      return completed
        .filter((e) => e.createdAt >= trendStart!)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(asRow);
    }
    if (text.includes('completedStatus')) {
      // The former trend: every completed evaluation, without a time bound.
      return completed;
    }
    return latestPerProject(rows).map(asRow);
  };

  beforeEach(async () => {
    readable = [];
    evaluations = [];
    violations = [];

    const violationQb = recordingQueryBuilderFactory(violationRows);
    const evaluationQb = recordingQueryBuilderFactory(evaluationRows);
    violationQueries = violationQb.queries;
    evaluationQueries = evaluationQb.queries;

    getReadableProjectsInOrganization = jest.fn(() =>
      of({ projects: readable }),
    );
    // The former path: the home-page project list, paged in its own order.
    getAllFromOrganization = jest.fn(
      (req: { pageNumber: number; pageSizeNumber: number }) =>
        of({
          projects: readable.slice(
            (req.pageNumber - 1) * req.pageSizeNumber,
            req.pageNumber * req.pageSizeNumber,
          ),
          totalProjects: readable.length,
        }),
    );
    countProjectsInOrganization = jest.fn(() =>
      of({ totalProjects: readable.length }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationService,
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: violationQb.createQueryBuilder,
          },
        },
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: { createQueryBuilder: evaluationQb.createQueryBuilder },
        },
        {
          provide: getRepositoryToken(SecurityPolicy),
          useValue: { count: jest.fn().mockResolvedValue(2) },
        },
        { provide: PolicyService, useValue: {} },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: jest.fn(() => ({
              getReadableProjectsInOrganization,
              getAllFromOrganization,
              countProjectsInOrganization,
            })),
          },
        },
      ],
    }).compile();

    service = module.get(ViolationService);
    service.onModuleInit();
  });

  const overview = (
    options: Partial<GetOrganizationComplianceOverviewRequest> = {},
  ) =>
    service.getOrganizationComplianceOverview({
      organizationId,
      userId,
      page: 1,
      pageSize: 20,
      ...options,
    });

  const evaluated = (
    projectId: string,
    daysAgo: number,
    extra: Partial<FakeEvaluation> = {},
  ): FakeEvaluation => ({
    projectId,
    scanId: `${projectId}-scan-${daysAgo}`,
    status: 'COMPLETED',
    createdAt: new Date(Date.now() - daysAgo * DAY),
    ...extra,
  });

  const blocks = (projectId: string, n: number): FakeViolation[] =>
    Array.from({ length: n }, (_, i) => ({
      projectId,
      scanId: `${projectId}-scan-1`,
      actionTaken: 'BLOCK' as const,
      ruleName: `rule-${i % 2}`,
    }));

  /** A, B, C as the project list returns them (A first), B 5 BLOCK, C 2. */
  const threeEvaluatedProjects = () => {
    readable = [
      { projectId: 'a', name: 'A', teamId: 'team-a' },
      { projectId: 'b', name: 'B', teamId: 'team-b' },
      { projectId: 'c', name: 'C', teamId: 'team-c' },
    ];
    evaluations = ['a', 'b', 'c'].map((id) => evaluated(id, 1));
    violations = [...blocks('b', 5), ...blocks('c', 2)];
  };

  it('reads the projects this user may read once, from the readable projection', async () => {
    threeEvaluatedProjects();

    await overview();

    expect(getReadableProjectsInOrganization).toHaveBeenCalledTimes(1);
    expect(getReadableProjectsInOrganization.mock.calls[0][0]).toEqual({
      organizationId,
      userId,
    });
    // Neither the paged home-page list (and its fan-out) nor a second count.
    expect(getAllFromOrganization).not.toHaveBeenCalled();
    expect(countProjectsInOrganization).not.toHaveBeenCalled();
  });

  it('sorts every readable project before it paginates (A 0, B 5, C 2, pageSize 2 → [B, C])', async () => {
    threeEvaluatedProjects();

    const result = await overview({ pageSize: 2 });

    expect(result.projects.map((p) => p.projectName)).toEqual(['B', 'C']);
    expect(result.projects.map((p) => p.blockedCount)).toEqual([5, 2]);
    expect(result.total).toBe(3);

    const second = await overview({ page: 2, pageSize: 2 });
    expect(second.projects.map((p) => p.projectName)).toEqual(['A']);

    const ascending = await overview({ pageSize: 2, sortOrder: 'asc' });
    expect(ascending.projects.map((p) => p.projectName)).toEqual(['A', 'C']);
  });

  it('filters by status and name before it paginates, and counts what it filtered', async () => {
    threeEvaluatedProjects();
    readable.push({ projectId: 'd', name: 'Billing D' });

    const nonCompliant = await overview({
      complianceStatusFilter: 'Non-Compliant',
      page: 2,
      pageSize: 1,
    });
    expect(nonCompliant.projects.map((p) => p.projectName)).toEqual(['C']);
    expect(nonCompliant.total).toBe(2);

    const searched = await overview({ search: 'd' });
    expect(searched.projects.map((p) => p.projectName)).toEqual(['Billing D']);
    expect(searched.projects[0].complianceStatus).toBe('Pending');
    expect(searched.total).toBe(1);

    // Case and accents do not matter, as in the project list's search.
    readable.push({ projectId: 'e', name: 'Équipe Sécurité' });
    const accented = await overview({ search: 'SECURITE' });
    expect(accented.projects.map((p) => p.projectName)).toEqual([
      'Équipe Sécurité',
    ]);
    readable.pop();

    // The stats describe every readable project, whatever the filters.
    expect(searched.stats).toEqual(
      expect.objectContaining({
        totalProjects: 4,
        compliantProjects: 1,
        nonCompliantProjects: 2,
        pendingProjects: 1,
        totalViolations: 7,
        totalBlocked: 7,
        complianceRate: 33.33,
      }),
    );
  });

  it('keeps every number within the projects this user may read', async () => {
    threeEvaluatedProjects();
    // A project of the same organization this user may not read.
    evaluations.push(evaluated('hidden', 1));
    violations.push(...blocks('hidden', 4));

    const result = await overview();

    expect(result.projects.map((p) => p.projectId).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(result.stats).toEqual(
      expect.objectContaining({
        totalProjects: 3,
        nonCompliantProjects: 2,
        totalViolations: 7,
        totalBlocked: 7,
      }),
    );
    expect(
      result.violationBreakdown.reduce((sum, row) => sum + row.count, 0),
    ).toBe(7);
    for (const query of [...violationQueries, ...evaluationQueries]) {
      expect(query.params().projectIds).toEqual(['a', 'b', 'c']);
    }
  });

  it('bounds the trend with createdAt >= trendStart, and a project evaluated at D-200 is compliant on every point', async () => {
    readable = [{ projectId: 'p', name: 'P' }];
    evaluations = [evaluated('p', 200)];

    const before = Date.now();
    const result = await overview();

    const windowQuery = evaluationQueries.find((q) =>
      q.text().includes('>= :trendStart'),
    );
    expect(windowQuery).toBeDefined();
    const trendStart = (windowQuery!.params().trendStart as Date).getTime();
    // The window starts 30 calendar days ago on the host's clock (setDate),
    // which is not 30 × 24 h when a daylight-saving change falls inside it:
    // compute the expected start the same way, whatever the time zone.
    const expectedStart = new Date(before);
    expectedStart.setDate(expectedStart.getDate() - 30);
    expect(Math.abs(trendStart - expectedStart.getTime())).toBeLessThan(60_000);
    // No query reads the completed evaluations without a time bound any more.
    expect(
      evaluationQueries.filter(
        (q) =>
          q.text().includes('COMPLETED') && !q.text().includes('trendStart'),
      ),
    ).toEqual([]);

    expect(result.trend.length).toBeGreaterThan(28);
    for (const point of result.trend) {
      expect(point).toEqual(
        expect.objectContaining({
          compliantCount: 1,
          nonCompliantCount: 0,
          pendingCount: 0,
          complianceRate: 100,
        }),
      );
    }
  });

  it('starts a project from its last state before the window, then follows it', async () => {
    readable = [
      { projectId: 'p', name: 'P' },
      { projectId: 'q', name: 'Q' },
    ];
    evaluations = [
      evaluated('p', 100, { hasBlock: true }),
      evaluated('p', 10, { hasBlock: false }),
      // q is evaluated for the first time inside the window.
      evaluated('q', 5, { hasBlock: true }),
    ];

    const result = await overview();

    const at = (daysAgo: number) => {
      const target = Date.now() - daysAgo * DAY;
      return result.trend.reduce((best, point) =>
        Math.abs(point.date - target) < Math.abs(best.date - target)
          ? point
          : best,
      );
    };
    expect(at(20)).toEqual(
      expect.objectContaining({
        compliantCount: 0,
        nonCompliantCount: 1,
        pendingCount: 1,
      }),
    );
    expect(at(7)).toEqual(
      expect.objectContaining({
        compliantCount: 1,
        nonCompliantCount: 0,
        pendingCount: 1,
      }),
    );
    expect(at(0)).toEqual(
      expect.objectContaining({
        compliantCount: 1,
        nonCompliantCount: 1,
        pendingCount: 0,
      }),
    );
  });

  it('carries each project team, its last evaluation and the active policies', async () => {
    threeEvaluatedProjects();

    const result = await overview();
    const b = result.projects.find((p) => p.projectId === 'b')!;

    expect(b).toEqual(
      expect.objectContaining({
        projectName: 'B',
        complianceStatus: 'Non-Compliant',
        totalViolations: 5,
        blockedCount: 5,
        warnedCount: 0,
        applicablePoliciesCount: 2,
        lastScanId: 'b-scan-1',
        teamIds: ['team-b'],
      }),
    );
    expect(b.lastEvaluatedAt).toBe(evaluations[1].createdAt.getTime());
  });

  it('answers an empty overview, without a query, when this user may read no project', async () => {
    readable = [];

    const result = await overview();

    expect(result).toEqual(
      expect.objectContaining({
        projects: [],
        violationBreakdown: [],
        trend: [],
        total: 0,
        stats: expect.objectContaining({
          totalProjects: 0,
          activePoliciesCount: 2,
          complianceRate: 100,
        }),
      }),
    );
    expect(violationQueries).toEqual([]);
    expect(evaluationQueries).toEqual([]);
  });

  it('fails with INTERNAL when the readable projects cannot be read', async () => {
    getReadableProjectsInOrganization.mockImplementation(() =>
      throwError(() =>
        Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
      ),
    );
    // The former path read the count first.
    countProjectsInOrganization.mockImplementation(() =>
      throwError(() =>
        Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
      ),
    );

    await expect(overview()).rejects.toMatchObject({
      error: expect.objectContaining({ code: 13 }),
    });
  });
});
