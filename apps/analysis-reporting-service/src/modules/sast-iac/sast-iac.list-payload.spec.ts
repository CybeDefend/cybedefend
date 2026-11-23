import { of } from 'rxjs';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  mapSastDetectionEntityToInterface,
  mapSastDetectionEntityToListInterface,
} from './sast-iac.mapper';
import { SastIacService } from './sast-iac.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ResultService } from '../result/result.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

function makeFatSastDetection() {
  const codeExamples = Array.from({ length: 30 }, (_, i) => ({
    filename: `example-${i}.js`,
    content: '// Lengthy code example with markdown\n'.repeat(500),
  }));
  const references = Array.from({ length: 50 }, (_, i) => ({
    id: `r-${i}`,
    url: `https://example.test/advisory-${i}-${'p'.repeat(300)}`,
    name: `Advisory ${i}`,
  }));
  return {
    id: 'det-fat',
    projectId: 'p1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    currentState: 'to_verify',
    currentSeverity: 'critical',
    currentPriority: 'critical_urgent',
    branch: 'main',
    scoringSource: 'static',
    codeSnippets: [],
    historyItems: [],
    autofixRecords: [],
    path: 'src/app.js',
    vulnerableStartLine: 100,
    vulnerableEndLine: 100,
    vulnerability: {
      id: 'v-fat',
      name: 'Server-Side Injection',
      shortDescription: 'short',
      description: 'X'.repeat(80_000),
      howToPrevent: 'Y'.repeat(40_000),
      owaspTop10: ['A03:2021'],
      severity: 'critical',
      language: 'JavaScript',
      vulnerabilityType: 'sast',
      cwe: ['CWE-94'],
      references,
      cvss3: { baseScore: '9.8', vector: 'CVSS:3.1/...' },
      codeExamples,
      sourceMetadata: { category: 'security', technology: ['javascript'] },
    },
  } as any;
}

describe('SAST list payload size guard', () => {
  it('full mapper proves the bloat (sanity check, > 300 KB)', () => {
    const det = makeFatSastDetection();
    const full = mapSastDetectionEntityToInterface(det);
    const sizeKb = JSON.stringify(full).length / 1024;
    expect(sizeKb).toBeGreaterThan(300);
  });

  it('list mapper stays well under the gRPC budget per detection (< 50 KB)', () => {
    const det = makeFatSastDetection();
    const light = mapSastDetectionEntityToListInterface(det);
    const sizeKb = JSON.stringify(light).length / 1024;
    expect(sizeKb).toBeLessThan(50);
  });

  it('list mapper preserves critical UI signals (name + cwe + severity + path)', () => {
    const det = makeFatSastDetection();
    const light = mapSastDetectionEntityToListInterface(det);
    expect(light.vulnerability?.name).toBe('Server-Side Injection');
    expect(light.vulnerability?.cwe).toEqual(['CWE-94']);
    expect(light.currentSeverity).toBe('critical');
    expect(light.path).toBe('src/app.js');
  });
});

// The MCP list ran the dashboard's whole handler — the
// project Get, the last scan status, the per-type and autofix counters, the
// languages facet, every history item with its user — for ~15 fields per
// finding (dozens of queries for one page). `slim: true` asks for the page only;
// `hasCybeAnalysis`, which the MCP item shows, is read for the page's ids.
describe('SastIacService – flat lists', () => {
  type Qb = Record<string, jest.Mock> & { calls: [string, unknown[]][] };
  interface SlimListResponse {
    total: number;
    languages: string[];
    vulnerabilities: {
      base: {
        id: string;
        vulnerability: { name: string };
        hasCybeAnalysis: boolean;
      };
    }[];
  }
  type Lister = (request: Record<string, unknown>) => Promise<SlimListResponse>;

  const detection = () => ({
    id: 'd1',
    projectId: 'p1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    currentState: 'to_verify',
    currentSeverity: 'high',
    currentPriority: 'normal',
    language: 'python',
    path: 'src/a.py',
    vulnerableStartLine: 1,
    vulnerableEndLine: 1,
    scannerType: 'opengrep',
    autofixRecords: [],
    vulnerability: {
      id: 'v1',
      name: 'SQL injection',
      shortDescription: 'short',
      cwe: ['CWE-89'],
      code: 'CD-SAST-0001',
    },
  });

  async function build() {
    const builders: Qb[] = [];
    const makeQb = (): Qb => {
      const qb = { calls: [] } as unknown as Qb;
      const chain = [
        'leftJoinAndSelect',
        'leftJoin',
        'innerJoin',
        'select',
        'addSelect',
        'where',
        'andWhere',
        'orderBy',
        'addOrderBy',
        'skip',
        'take',
        'distinct',
      ];
      for (const method of chain) {
        qb[method] = jest.fn((...args: unknown[]) => {
          qb.calls.push([method, args]);
          return qb;
        });
      }
      qb.getManyAndCount = jest.fn().mockResolvedValue([[detection()], 1]);
      // The page flags query: d1 has an AI agent history row.
      qb.getRawMany = jest.fn().mockResolvedValue([{ id: 'd1' }]);
      builders.push(qb);
      return qb;
    };
    const repos: Record<string, Record<string, jest.Mock>> = {};
    for (const key of ['sast', 'iac', 'cicd', 'secret', 'sca', 'autofix']) {
      repos[key] = createMockRepository() as Record<string, jest.Mock>;
      repos[key].createQueryBuilder = jest.fn(makeQb);
    }
    const resultService = {
      getCountVulnerabilitiesCountByType: jest.fn().mockResolvedValue({}),
      getAutofixCountByType: jest.fn().mockResolvedValue({}),
    };
    const module = await Test.createTestingModule({
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
        { provide: ResultService, useValue: resultService },
        { provide: SastIacUtilsService, useValue: {} },
        SastIacService,
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
          useValue: { buildExplanationForEntity: jest.fn() },
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
    const service = module.get(SastIacService);
    const loose = service as unknown as Record<string, unknown>;
    const projectGet = jest.fn(() => of({ name: 'p', parsedBranches: [] }));
    const lastScan = jest.fn(() => of({ id: 's1', state: 'completed' }));
    const userGet = jest.fn(() => of({ id: 'u1' }));
    loose.projectServiceClient = { get: projectGet };
    loose.scanServiceClient = { getLastScanStatus: lastScan };
    loose.userServiceClient = { getById: userGet };
    return { service, builders, resultService, projectGet, lastScan, userGet };
  }

  const listers: [string, string][] = [
    ['sast', 'getProjectSastVulnerabilities'],
    ['iac', 'getProjectIacVulnerabilities'],
    ['cicd', 'getProjectCicdVulnerabilities'],
    ['secret', 'getProjectSecretVulnerabilities'],
  ];

  it.each(listers)(
    '%s: slim=true reads the page only — no Get, no counters, no history',
    async (_type, method) => {
      const ctx = await build();
      const call = (ctx.service as unknown as Record<string, Lister>)[
        method
      ].bind(ctx.service);

      const res = await call({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 20,
        slim: true,
      });

      expect(ctx.projectGet).not.toHaveBeenCalled();
      expect(ctx.lastScan).not.toHaveBeenCalled();
      expect(
        ctx.resultService.getCountVulnerabilitiesCountByType,
      ).not.toHaveBeenCalled();
      expect(ctx.resultService.getAutofixCountByType).not.toHaveBeenCalled();
      expect(ctx.userGet).not.toHaveBeenCalled();
      const joins = ctx.builders.flatMap((qb) =>
        qb.calls
          .filter(([m]) => m === 'leftJoinAndSelect')
          .map(([, args]) => args[0]),
      );
      expect(joins).not.toContain('vulnDetection.historyItems');
      // No languages facet query (SELECT DISTINCT language).
      const selects = ctx.builders.flatMap((qb) =>
        qb.calls.filter(([m]) => m === 'select').map(([, args]) => args[0]),
      );
      expect(selects).not.toContain('DISTINCT vulnDetection.language');

      expect(res.total).toBe(1);
      expect(res.languages).toEqual([]);
      const [item] = res.vulnerabilities;
      expect(item.base.id).toBe('d1');
      expect(item.base.vulnerability.name).toBe('SQL injection');
      expect(item.base.hasCybeAnalysis).toBe(true);
    },
  );

  it.each(listers)(
    '%s: without slim, the dashboard answer is unchanged',
    async (_type, method) => {
      const ctx = await build();
      const call = (ctx.service as unknown as Record<string, Lister>)[
        method
      ].bind(ctx.service);

      await call({ projectId: 'p1', pageNumber: 1, pageSizeNumber: 20 });

      expect(ctx.projectGet).toHaveBeenCalled();
      expect(ctx.lastScan).toHaveBeenCalled();
      expect(
        ctx.resultService.getCountVulnerabilitiesCountByType,
      ).toHaveBeenCalled();
      const joins = ctx.builders.flatMap((qb) =>
        qb.calls
          .filter(([m]) => m === 'leftJoinAndSelect')
          .map(([, args]) => args[0]),
      );
      expect(joins).toContain('vulnDetection.historyItems');
    },
  );
  // Step 6: an explicit page size is clamped, silently, at 500 — not 100:
  // the IDE extension asks for 500 rows in one call and never pages
  // (cybedefend-ide SecurityApiService.ts:260). 0 (what an absent size
  // decodes to) keeps the whole list: policy-management evaluates every
  // finding after a scan that way (fetchAllVulnerabilities).
  const takenPageSize = (builders: Qb[]): unknown =>
    builders[0].calls
      .filter(([m]) => m === 'take')
      .map(([, args]) => args[0])[0];

  it.each(listers)(
    '%s: pageSizeNumber=100000 takes 500 rows',
    async (_type, method) => {
      const ctx = await build();
      const call = (ctx.service as unknown as Record<string, Lister>)[
        method
      ].bind(ctx.service);

      const res = await call({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 100000,
      });

      expect(takenPageSize(ctx.builders)).toBe(500);
      expect((res as unknown as { limit: number }).limit).toBe(500);
    },
  );

  it.each(listers)(
    '%s: pageSizeNumber=500 (the IDE) still takes 500 rows',
    async (_type, method) => {
      const ctx = await build();
      const call = (ctx.service as unknown as Record<string, Lister>)[
        method
      ].bind(ctx.service);

      await call({ projectId: 'p1', pageNumber: 1, pageSizeNumber: 500 });

      expect(takenPageSize(ctx.builders)).toBe(500);
    },
  );

  it.each(listers)(
    '%s: pageSizeNumber=0 still returns the whole list (policy evaluation)',
    async (_type, method) => {
      const ctx = await build();
      const call = (ctx.service as unknown as Record<string, Lister>)[
        method
      ].bind(ctx.service);

      await call({ projectId: 'p1', pageNumber: 0, pageSizeNumber: 0 });

      expect(takenPageSize(ctx.builders)).toBe(0);
    },
  );
});
