import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResultService } from './result.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { HistoryItem as HistoryItemEntity } from '../../entities/history-item.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ContainerService } from '../container/container.service';
import { ScaService } from '../sca/sca.service';
import { SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { OrganizationOverviewService } from './organization-overview.service';
import { PriorityCalculatorService } from './priority-calculator.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { CyberRiskService } from '../cyber-risk/cyber-risk.service';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ActiveVulnFetcher } from '../cyber-risk/active-vuln-fetcher.service';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { AIBOM_INVENTORY } from '../../edition/ports/aibom-inventory.port';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import {
  MockType,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

describe('ResultService.getTopVulnerabilities', () => {
  let service: ResultService;
  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;
  let priorityCalculator: { calculate: jest.Mock; decompose: jest.Mock };

  const provideRepo = (token: any, repo: MockType<any>) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  beforeEach(async () => {
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    cicdRepo = createMockRepository();
    secretRepo = createMockRepository();
    scaRepo = createMockRepository();
    containerRepo = createMockRepository();
    // The advisory reads: no imported advisory.
    for (const repo of [scaRepo, containerRepo]) {
      (repo as unknown as { manager: unknown }).manager = {
        find: jest.fn().mockResolvedValue([]),
      };
    }

    priorityCalculator = {
      calculate: jest.fn(),
      decompose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultService,
        provideRepo(SastVulnerabilityDetections, sastRepo),
        provideRepo(IacVulnerabilityDetections, iacRepo),
        provideRepo(CicdVulnerabilityDetections, cicdRepo),
        provideRepo(SecretVulnerabilityDetections, secretRepo),
        provideRepo(ScaVulnerabilityDetections, scaRepo),
        provideRepo(VulnerabilityDetectionsContainer, containerRepo),
        provideRepo(ScaDetectedPackages, createMockRepository()),
        provideRepo(ContainerDetectedImage, createMockRepository()),
        provideRepo(ContainerDetectedPackage, createMockRepository()),
        provideRepo(HistoryItemEntity, createMockRepository()),
        provideRepo(AutoFixRecord, createMockRepository()),
        { provide: ContainerService, useValue: {} },
        { provide: ScaService, useValue: {} },
        { provide: SastIacUtilsService, useValue: {} },
        { provide: SastIacService, useValue: {} },
        {
          provide: OrganizationOverviewService,
          useValue: { getOrganizationOverview: jest.fn() },
        },
        { provide: PriorityCalculatorService, useValue: priorityCalculator },
        {
          provide: CvssCalculatorService,
          useValue: { applyEnvironmentalMetrics: jest.fn() },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({
              getProjectSecurityContext: jest.fn(),
            }),
          },
        },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
        // Stub CybeRiskService (live 7-day level), the persisted-score
        // repo and the backfill enqueuer so DI resolves.
        {
          provide: CyberRiskService,
          useValue: {
            computeProjectScoreLevelSince: jest.fn().mockResolvedValue('low'),
            computeBatchLevelsSince: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: ProjectCyberRiskRepository,
          useValue: {
            findByProjectId: jest.fn().mockResolvedValue(null),
            findByProjectIds: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ActiveVulnFetcher,
          useValue: {
            fetchActiveVulns: jest.fn().mockResolvedValue([]),
            fetchActiveVulnsBatch: jest.fn().mockResolvedValue(new Map()),
            fetchActiveVulnsWithMeta: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: {
            getReferenceBranch: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: AIBOM_INVENTORY,
          useValue: { countMergedComponents: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            syncLinearFindingStates: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(ResultService);
    // Need to trigger onModuleInit to set up gRPC clients
    service.onModuleInit();
  });

  function makeSastDetection(overrides: Partial<any> = {}) {
    return {
      id: 'sast-1',
      projectId: 'proj-1',
      currentSeverity: 'HIGH',
      currentState: 'to_verify',
      path: 'src/main.ts',
      vulnerableStartLine: 10,
      cvss4EnvironmentalScore: 8.0,
      cvss4BaseScore: 7.5,
      epssScore: 0.5,
      exploitabilityScore: 0.7,
      exploitabilityVerdict: 'proven',
      exploitabilityReason: 'Data flow confirmed',
      priorityManualOverride: false,
      vulnerability: {
        name: 'SQL Injection',
        shortDescription: 'SQL injection in query builder',
        cwe: ['CWE-89'],
      },
      ...overrides,
    };
  }

  function makeScaDetection(overrides: Partial<any> = {}) {
    return {
      id: 'sca-1',
      projectId: 'proj-1',
      currentSeverity: 'CRITICAL',
      currentState: 'confirmed',
      cvss4EnvironmentalScore: 9.5,
      cvss4BaseScore: 9.0,
      epssScore: 0.9,
      exploitabilityScore: 0.9,
      exploitabilityVerdict: 'actively_exploited',
      exploitabilityReason: 'Known exploit in the wild',
      priorityManualOverride: false,
      vulnerability: {
        id: 'CVE-2024-1234',
        summary: 'Remote code execution in lodash',
      },
      scaDetectedPackage: {
        packageName: 'lodash',
      },
      ...overrides,
    };
  }

  it('should return top vulnerabilities sorted by composite score descending', async () => {
    const sastVuln = makeSastDetection();
    const scaVuln = makeScaDetection();

    sastRepo.find!.mockResolvedValue([sastVuln]);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([scaVuln]);
    containerRepo.find!.mockResolvedValue([]);

    // SCA has higher composite score
    priorityCalculator.calculate
      .mockReturnValueOnce({ priority: 'urgent', compositeScore: 0.65 }) // sast
      .mockReturnValueOnce({
        priority: 'critical_urgent',
        compositeScore: 0.92,
      }); // sca

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 5,
    });

    expect(result.items).toHaveLength(2);
    // SCA should be first (higher score)
    expect(result.items[0].id).toBe('sca-1');
    expect(result.items[0].vulnerabilityType).toBe('sca');
    expect(result.items[0].compositeScore).toBe(0.92);
    expect(result.items[0].cveId).toBe('CVE-2024-1234');
    expect(result.items[0].packageName).toBe('lodash');

    // SAST should be second
    expect(result.items[1].id).toBe('sast-1');
    expect(result.items[1].vulnerabilityType).toBe('sast');
    expect(result.items[1].compositeScore).toBe(0.65);
    expect(result.items[1].filePath).toBe('src/main.ts');
  });

  it('should respect the limit parameter', async () => {
    const vulns = Array.from({ length: 10 }, (_, i) =>
      makeSastDetection({ id: `sast-${i}` }),
    );
    sastRepo.find!.mockResolvedValue(vulns);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    vulns.forEach((_, i) => {
      priorityCalculator.calculate.mockReturnValueOnce({
        priority: 'normal',
        compositeScore: 0.5 - i * 0.01,
      });
    });

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 3,
    });

    expect(result.items).toHaveLength(3);
  });

  it('should default to limit=5 when limit is 0 or not provided', async () => {
    const vulns = Array.from({ length: 10 }, (_, i) =>
      makeSastDetection({ id: `sast-${i}` }),
    );
    sastRepo.find!.mockResolvedValue(vulns);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    vulns.forEach((_, i) => {
      priorityCalculator.calculate.mockReturnValueOnce({
        priority: 'normal',
        compositeScore: 0.5 - i * 0.01,
      });
    });

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 0,
    });

    expect(result.items).toHaveLength(5);
  });

  it('should skip detections with manual override (null from calculator)', async () => {
    const vuln = makeSastDetection({ priorityManualOverride: true });
    sastRepo.find!.mockResolvedValue([vuln]);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    priorityCalculator.calculate.mockReturnValue(null);

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 5,
    });

    // Manual override vulns still appear, using score 0
    expect(result.items).toHaveLength(1);
    expect(result.items[0].compositeScore).toBe(0);
  });

  it('should throw INVALID_ARGUMENT when projectId is missing', async () => {
    await expect(
      service.getTopVulnerabilities({ projectId: '', limit: 5 }),
    ).rejects.toThrow();
  });

  it('should return empty items when no active vulnerabilities exist', async () => {
    sastRepo.find!.mockResolvedValue([]);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 5,
    });

    expect(result.items).toHaveLength(0);
  });

  // `limit` came straight from the query string, and
  // each of the six tables was read for max(limit * 4, 20) rows. The limit is
  // now clamped, silently, at 50: at most 200 rows per table.
  it('clamps limit=100000 to 50, so no table is read for more than 200 rows', async () => {
    const vulns = Array.from({ length: 300 }, (_, i) =>
      makeSastDetection({ id: `sast-${i}` }),
    );
    for (const repo of [
      iacRepo,
      cicdRepo,
      secretRepo,
      scaRepo,
      containerRepo,
    ]) {
      repo.find!.mockResolvedValue([]);
    }
    sastRepo.find!.mockResolvedValue(vulns);
    priorityCalculator.calculate.mockReturnValue({
      priority: 'normal',
      compositeScore: 0.5,
    });

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 100000,
    });

    for (const repo of [
      sastRepo,
      iacRepo,
      cicdRepo,
      secretRepo,
      scaRepo,
      containerRepo,
    ]) {
      expect(repo.find!.mock.calls[0][0].take).toBeLessThanOrEqual(200);
    }
    expect(result.items).toHaveLength(50);
  });

  // The top hydrated 6 × 20 whole detections
  // and their whole catalogue entry (description, how-to-prevent, code
  // examples) for 5 rows. Each table is now read for the columns the score
  // and the item need.
  it('reads each table with an explicit select, without the long catalogue columns', async () => {
    for (const repo of [
      sastRepo,
      iacRepo,
      cicdRepo,
      secretRepo,
      scaRepo,
      containerRepo,
    ]) {
      repo.find!.mockResolvedValue([]);
    }

    await service.getTopVulnerabilities({ projectId: 'proj-1', limit: 5 });

    for (const repo of [sastRepo, iacRepo, cicdRepo, secretRepo]) {
      const { select } = repo.find!.mock.calls[0][0];
      expect(select).toBeDefined();
      expect(select.id).toBe(true);
      expect(select.priorityScore).toBe(true);
      expect(select.contextualExplanation).toBeUndefined();
      expect(select.vulnerability).toEqual({
        id: true,
        name: true,
        shortDescription: true,
        cwe: true,
      });
    }
    const sca = scaRepo.find!.mock.calls[0][0].select;
    expect(sca.vulnerability).toEqual({ id: true, summary: true });
    expect(sca.scaDetectedPackage).toEqual({ id: true, packageName: true });
    const container = containerRepo.find!.mock.calls[0][0].select;
    expect(container.vulnerabilityIdentifier).toBe(true);
    expect(container.vulnerability).toEqual({ id: true, summary: true });
  });

  it('should pre-fetch per type ordered by priorityScore DESC (not severity lexicographic)', async () => {
    // Regression guard: using currentSeverity ASC was WRONG because the
    // lexicographic order is critical < high < info < low < medium, which
    // drops medium below low/info. We must fetch the highest priorityScore
    // rows first so perTypeLimit truncation does not discard top items.
    sastRepo.find!.mockResolvedValue([]);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    await service.getTopVulnerabilities({ projectId: 'proj-1', limit: 5 });

    for (const repo of [
      sastRepo,
      iacRepo,
      cicdRepo,
      secretRepo,
      scaRepo,
      containerRepo,
    ]) {
      expect(repo.find).toHaveBeenCalledTimes(1);
      const options = repo.find!.mock.calls[0][0];
      expect(options.order).toBeDefined();
      // Primary sort must be priorityScore DESC (highest first) — this is
      // the fix. `currentSeverity` is only acceptable as a secondary
      // deterministic tie-breaker, NEVER as the primary sort.
      const orderKeys = Object.keys(options.order);
      expect(orderKeys[0]).toBe('priorityScore');
      expect(options.order.priorityScore).toBe('DESC');
    }
  });

  it('should propagate exploitabilitySource for sast-like, sca and container detections', async () => {
    const sastVuln = makeSastDetection({
      id: 'sast-static',
      exploitabilitySource: 'static',
    });
    const scaVuln = makeScaDetection({
      id: 'sca-agent',
      exploitabilitySource: 'agent',
    });
    const containerVuln = {
      id: 'container-manual',
      projectId: 'proj-1',
      currentSeverity: 'MEDIUM',
      currentState: 'to_verify',
      cvss4EnvironmentalScore: 5.0,
      exploitabilitySource: 'manual',
      vulnerabilityIdentifier: 'CVE-2024-9999',
      vulnerability: { id: 'CVE-2024-9999', summary: 'sum' },
      detectedPackage: { name: 'libfoo' },
    };

    sastRepo.find!.mockResolvedValue([sastVuln]);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([scaVuln]);
    containerRepo.find!.mockResolvedValue([containerVuln]);

    priorityCalculator.calculate
      .mockReturnValueOnce({ priority: 'normal', compositeScore: 0.5 })
      .mockReturnValueOnce({ priority: 'normal', compositeScore: 0.4 })
      .mockReturnValueOnce({ priority: 'normal', compositeScore: 0.3 });

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 5,
    });

    const byId = Object.fromEntries(result.items.map((it) => [it.id, it]));
    expect(byId['sast-static'].exploitabilitySource).toBe('static');
    expect(byId['sca-agent'].exploitabilitySource).toBe('agent');
    expect(byId['container-manual'].exploitabilitySource).toBe('manual');
  });

  it('should return items in priorityScore DESC order even when severities are low/medium/high', async () => {
    // Scenario from the bug report: currentSeverity ∈ {low, medium, high}
    // but priorityScore ∈ {9.5, 5.0, 2.0} — the result MUST follow
    // priorityScore, not lexicographic severity ordering.
    const highSev = makeSastDetection({
      id: 'sast-high',
      currentSeverity: 'high',
      priorityScore: 2.0,
    });
    const mediumSev = makeSastDetection({
      id: 'sast-medium',
      currentSeverity: 'medium',
      priorityScore: 5.0,
    });
    const lowSev = makeSastDetection({
      id: 'sast-low',
      currentSeverity: 'low',
      priorityScore: 9.5,
    });

    // Simulate a DB that respected our ORDER BY priorityScore DESC:
    // the repository would return [lowSev (9.5), mediumSev (5.0), highSev (2.0)].
    // If the code still sorts by severity lexicographic, it would never
    // reach this ordering.
    sastRepo.find!.mockImplementation(async (opts: any) => {
      const rows: any[] = [highSev, mediumSev, lowSev];
      const order = opts?.order ?? {};
      if (order.priorityScore === 'DESC') {
        return [...rows].sort(
          (a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0),
        );
      }
      // legacy severity ASC behaviour (bug)
      return [...rows].sort((a, b) =>
        String(a.currentSeverity).localeCompare(String(b.currentSeverity)),
      );
    });
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    // Composite scores mirror priorityScore ordering: low (9.5) > medium (5.0) > high (2.0)
    priorityCalculator.calculate
      .mockReturnValueOnce({ priority: 'urgent', compositeScore: 0.95 }) // lowSev
      .mockReturnValueOnce({ priority: 'normal', compositeScore: 0.5 }) // mediumSev
      .mockReturnValueOnce({ priority: 'low', compositeScore: 0.2 }); // highSev

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 5,
    });

    expect(result.items.map((it) => it.id)).toEqual([
      'sast-low',
      'sast-medium',
      'sast-high',
    ]);
  });

  it('ranks secrets by their deterministic priorityScore (not the composite) and hides exploitability', async () => {
    const secret = {
      id: 'secret-1',
      projectId: 'proj-1',
      currentSeverity: 'CRITICAL',
      currentState: 'to_verify',
      path: 'src/config.ts',
      vulnerableStartLine: 3,
      priorityScore: 100,
      // legacy exploitability columns that must NOT be exposed for secrets
      exploitabilityVerdict: 'proven',
      exploitabilityScore: 0.75,
      exploitabilitySource: 'static',
      priorityManualOverride: false,
      vulnerability: {
        name: 'Hardcoded AWS key',
        shortDescription: 'hardcoded credential',
        cwe: ['CWE-798'],
      },
    };
    sastRepo.find!.mockResolvedValue([]);
    iacRepo.find!.mockResolvedValue([]);
    cicdRepo.find!.mockResolvedValue([]);
    secretRepo.find!.mockResolvedValue([secret]);
    scaRepo.find!.mockResolvedValue([]);
    containerRepo.find!.mockResolvedValue([]);

    const result = await service.getTopVulnerabilities({
      projectId: 'proj-1',
      limit: 5,
    });

    // The multi-signal composite is never consulted for a secret.
    expect(priorityCalculator.calculate).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.vulnerabilityType).toBe('secret');
    expect(item.compositeScore).toBe(1); // priorityScore 100 / 100
    expect(item.exploitabilityVerdict ?? null).toBeNull();
    expect(item.exploitabilitySource ?? null).toBeNull();
  });
});
