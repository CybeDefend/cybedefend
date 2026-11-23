// analysis-reporting-service/src/modules/result/result.service.detectedLanguages.spec.ts
//
// Focused unit test: getVulnerabilitiesCount returns the deduped+sorted union
// of languages across the 4 code detection tables. Uses the project's standard
// TestingModule pattern (Object.create is impractical given the large number of
// constructor-injected deps).

import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
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
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { CyberRiskService } from '../cyber-risk/cyber-risk.service';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ActiveVulnFetcher } from '../cyber-risk/active-vuln-fetcher.service';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { OrganizationOverviewService } from './organization-overview.service';
import { PriorityCalculatorService } from './priority-calculator.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { AIBOM_INVENTORY } from '../../edition/ports/aibom-inventory.port';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import {
  MockType,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

/**
 * Build a mock query builder that always resolves getRawMany to the given rows.
 * Used to stub both the severity-count queries and the language-distinct queries.
 */
function makeQb(rows: any[]) {
  const qb: any = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    groupBy: jest.fn(() => qb),
    addGroupBy: jest.fn(() => qb),
    getRawMany: jest.fn(async () => rows),
  };
  return qb;
}

describe('ResultService.getVulnerabilitiesCount detectedLanguages', () => {
  let service: ResultService;

  // Repositories — each one needs createQueryBuilder to handle both the
  // severity-count call and the language-distinct call. We return empty rows
  // for severity (so totals are all 0) and language-specific rows for language.
  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;

  const provideRepo = (token: any, repo: any) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  beforeEach(async () => {
    // SAST: Python + Go languages; severity query returns []
    sastRepo = createMockRepository();
    (sastRepo as any).createQueryBuilder.mockImplementation(() =>
      makeQb([{ language: 'Python' }, { language: 'Go' }]),
    );

    // IaC: Terraform language
    iacRepo = createMockRepository();
    (iacRepo as any).createQueryBuilder.mockImplementation(() =>
      makeQb([{ language: 'Terraform' }]),
    );

    // CICD: no languages
    cicdRepo = createMockRepository();
    (cicdRepo as any).createQueryBuilder.mockImplementation(() => makeQb([]));

    // Secret: Python (duplicate — should be deduped)
    secretRepo = createMockRepository();
    (secretRepo as any).createQueryBuilder.mockImplementation(() =>
      makeQb([{ language: 'Python' }]),
    );

    // SCA / Container: no language column — return empty rows
    scaRepo = createMockRepository();
    (scaRepo as any).createQueryBuilder.mockImplementation(() => makeQb([]));
    containerRepo = createMockRepository();
    (containerRepo as any).createQueryBuilder.mockImplementation(() =>
      makeQb([]),
    );

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
        {
          provide: PriorityCalculatorService,
          useValue: { calculate: jest.fn(), decompose: jest.fn() },
        },
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
          useValue: {
            getService: () => ({
              getLastScanStatus: () => ({
                subscribe: () => undefined,
              }),
            }),
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
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
            getScoringBranches: jest.fn().mockResolvedValue(['main', 'master']),
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

    // Override the gRPC client set by onModuleInit so safeGrpcCall works without
    // a real gRPC server. Mirror the pattern from result.service.spec.ts.
    (service as any).scanServiceClient = {
      getLastScanStatus: jest.fn().mockReturnValue(of(null)),
    };
  });

  it('returns deduped, sorted union of languages across SAST/IaC/CICD/Secret', async () => {
    const res = await service.getVulnerabilitiesCount({ projectId: 'p-1' });

    // Python appears in SAST and Secret — must be deduped.
    // Result must be alphabetically sorted.
    expect(res.detectedLanguages).toEqual(['Go', 'Python', 'Terraform']);
  });
});
