/**
 * Unit tests for scoring_source filter on getProjectScaVulnerabilities.
 * Filter SCA detections by static vs. agent-produced scoring.
 */
import { of } from 'rxjs';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ScaService } from './sca.service';
import { ADVISORY_MATCHER } from '../../edition/ports/advisory-matcher.port';
import { DETECTION_ENRICHERS } from '../../edition/ports/detection-enrichers.port';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { ResultService } from '../result/result.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';

describe('ScaService.getProjectScaVulnerabilities – scoring_source filter', () => {
  let service: ScaService;
  let scaVulnRepo: any;

  function buildQbMock() {
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    return qb;
  }

  function stubGrpcClients(svc: ScaService) {
    (svc as any).projectServiceClient = {
      get: () =>
        of({
          id: 'p1',
          name: 'Project 1',
          createdAt: new Date().toISOString(),
        }),
    };
    (svc as any).scanServiceClient = {
      getLastScanStatus: () =>
        of({
          id: 'scan-1',
          state: 'completed',
          createAt: new Date().toISOString(),
          scanType: 'full',
        }),
    };
  }

  beforeEach(async () => {
    scaVulnRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScaService,
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: scaVulnRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(HistoryItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: createMockRepository(),
        },
        {
          provide: ADVISORY_MATCHER,
          useValue: { findMatchingVulnerabilities: jest.fn() },
        },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn() },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: DETECTION_ENRICHERS,
          useValue: [{ name: 'EPSS', enrichDetections: jest.fn() }],
        },
        {
          provide: ResultService,
          useValue: {
            getCountVulnerabilitiesCountByType: jest.fn().mockResolvedValue({
              sast: 0,
              iac: 0,
              sca: 0,
              secret: 0,
              container: 0,
              cicd: 0,
            }),
            getAutofixCountByType: jest
              .fn()
              .mockResolvedValue({ sast: 0, sca: 0 }),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForVulnerabilities: jest.fn(),
            createIssuesForScan: jest.fn(),
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: getDataSourceToken(),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: {
            getScoringBranches: jest.fn().mockResolvedValue(['main', 'master']),
          },
        },
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(ScaService);
    stubGrpcClients(service);
  });

  it('filters by scoringSource when scoringSource is "agent"', async () => {
    const qb = buildQbMock();
    scaVulnRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectScaVulnerabilities({
      projectId: 'p1',
      scoringSource: 'agent',
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        'vulnDetection.exploitabilitySource = :agentExploitabilitySource',
      ),
      expect.objectContaining({
        scoringSource: 'agent',
        agentExploitabilitySource: 'agent',
      }),
    );
  });

  it('does not filter by scoringSource when absent', async () => {
    const qb = buildQbMock();
    scaVulnRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectScaVulnerabilities({
      projectId: 'p1',
    } as any);

    const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.includes('scoringSource'))).toBe(false);
  });

  // The vuln list must scope to the full logical branch partition
  // (canonical branch + legacy '' rows), matching the resolver and the
  // package/license reads, instead of an exact single-branch equality.
  it('scopes vulnerabilities to the full effective-branch partition', async () => {
    const qb = buildQbMock();
    scaVulnRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectScaVulnerabilities({
      projectId: 'p1',
      branch: 'main',
    } as any);

    const branchCall = qb.andWhere.mock.calls.find((c: any[]) =>
      /branch IN/.test(c[0]),
    );
    expect(branchCall).toBeTruthy();
    expect(branchCall[1]).toEqual({ branches: ['main', ''] });
    // the old exact-equality branch filter must be gone
    const exact = qb.andWhere.mock.calls.find((c: any[]) =>
      /branch = :branch/.test(c[0]),
    );
    expect(exact).toBeUndefined();
  });

  // Perf — the vuln list resolves the SCA effective branches once and
  // threads them into the count + autofix sub-queries, so getScoringBranches is
  // not re-resolved 3× per request.
  it('threads the resolved effective branches into the count and autofix calls', async () => {
    const qb = buildQbMock();
    scaVulnRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);
    const resultService: any = (service as any).resultService;

    await service.getProjectScaVulnerabilities({
      projectId: 'p1',
      branch: 'main',
    } as any);

    expect(
      resultService.getCountVulnerabilitiesCountByType,
    ).toHaveBeenCalledWith('p1', 'main', ['main', '']);
    expect(resultService.getAutofixCountByType).toHaveBeenCalledWith(
      'p1',
      'main',
      ['main', ''],
    );
  });
});
