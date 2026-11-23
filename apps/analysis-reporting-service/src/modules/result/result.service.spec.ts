import { Test, TestingModule } from '@nestjs/testing';
import * as overTimeUtil from './over-time.util';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
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
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { CyberRiskService } from '../cyber-risk/cyber-risk.service';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ActiveVulnFetcher } from '../cyber-risk/active-vuln-fetcher.service';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { SastIacService } from '../sast-iac/sast-iac.service';
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
import { RpcException } from '@nestjs/microservices';
import { status as grpcStatus } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { join } from 'path';

describe('ResultService.updateScanResult', () => {
  let service: ResultService;

  // Repositories
  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;
  let scaPkgRepo: MockType<any>;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let autofixRepo: MockType<any>;

  // Services
  let containerService: { handleUpdateContainer: jest.Mock };
  let scaService: { handleUpdateSca: jest.Mock };
  let utilsService: {
    handleUpdateSast: jest.Mock;
    handleUpdateIac: jest.Mock;
  };

  const provideRepo = (token: any, repo: MockType<any>) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  beforeEach(async () => {
    // Initialize mocks
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    cicdRepo = createMockRepository();
    secretRepo = createMockRepository();
    scaRepo = createMockRepository();
    containerRepo = createMockRepository();
    scaPkgRepo = createMockRepository();
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    historyRepo = createMockRepository();
    autofixRepo = createMockRepository();

    containerService = { handleUpdateContainer: jest.fn() } as any;
    scaService = { handleUpdateSca: jest.fn() } as any;
    utilsService = {
      handleUpdateSast: jest.fn(),
      handleUpdateIac: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultService,
        provideRepo(SastVulnerabilityDetections, sastRepo),
        provideRepo(IacVulnerabilityDetections, iacRepo),
        provideRepo(CicdVulnerabilityDetections, cicdRepo),
        provideRepo(SecretVulnerabilityDetections, secretRepo),
        provideRepo(ScaVulnerabilityDetections, scaRepo),
        provideRepo(VulnerabilityDetectionsContainer, containerRepo),
        provideRepo(ScaDetectedPackages, scaPkgRepo),
        provideRepo(ContainerDetectedImage, imageRepo),
        provideRepo(ContainerDetectedPackage, pkgRepo),
        provideRepo(HistoryItemEntity, historyRepo),
        provideRepo(AutoFixRecord, autofixRepo),
        { provide: ContainerService, useValue: containerService },
        { provide: ScaService, useValue: scaService },
        { provide: SastIacUtilsService, useValue: utilsService },
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
        // gRPC clients not used by updateScanResult; provide dummies for DI
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
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
        // Stub CybeRiskService (live 7-day level), the persisted-score
        // repo and the backfill enqueuer — none of these unit tests exercise
        // scoring but DI must resolve.
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
  });

  const request = (projectId = 'p1', vulnerabilityId = 'v1') =>
    ({
      projectId,
      vulnerabilityId,
    }) as any;

  it('routes to ContainerService when container vuln found', async () => {
    const vuln = { id: 'v1', projectId: 'p1' };
    containerRepo.findOne!.mockResolvedValue(vuln);
    const expected = {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerability: { $case: 'container' },
    };
    containerService.handleUpdateContainer.mockResolvedValue(expected);

    const res = await service.updateScanResult(request());
    expect(containerService.handleUpdateContainer).toHaveBeenCalledWith(
      vuln,
      expect.objectContaining({ projectId: 'p1', vulnerabilityId: 'v1' }),
    );
    expect(res).toBe(expected as any);
  });

  it('routes to SAST utils when SAST vuln found', async () => {
    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValue({ id: 'v1', projectId: 'p1' });
    const expected = {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerability: { $case: 'sast' },
    };
    utilsService.handleUpdateSast.mockResolvedValue(expected);

    const res = await service.updateScanResult(request());
    expect(utilsService.handleUpdateSast).toHaveBeenCalled();
    expect(res).toBe(expected as any);
  });

  it('routes to IAC utils when IAC vuln found', async () => {
    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValue(null);
    iacRepo.findOne!.mockResolvedValue({ id: 'v1', projectId: 'p1' });
    const expected = {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerability: { $case: 'iac' },
    };
    utilsService.handleUpdateIac.mockResolvedValue(expected);

    const res = await service.updateScanResult(request());
    expect(utilsService.handleUpdateIac).toHaveBeenCalled();
    expect(res).toBe(expected as any);
  });

  it('routes to ScaService when SCA vuln found and package belongs to project', async () => {
    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValue(null);
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue({
      id: 'v1',
      scaDetectedPackage: { projectId: 'p1' },
    });
    const expected = {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerability: { $case: 'sca' },
    };
    scaService.handleUpdateSca.mockResolvedValue(expected);

    const res = await service.updateScanResult(request());
    expect(scaService.handleUpdateSca).toHaveBeenCalled();
    expect(res).toBe(expected as any);
  });

  it('throws NOT_FOUND when no vulnerability detection exists', async () => {
    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValue(null);
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue(null);

    await expect(service.updateScanResult(request())).rejects.toBeInstanceOf(
      RpcException,
    );
  });
});

describe('ResultService.batchUpdateScanResults', () => {
  let service: ResultService;

  // Repositories
  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;
  let scaPkgRepo: MockType<any>;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let autofixRepo: MockType<any>;

  // Services
  let containerService: { handleUpdateContainer: jest.Mock };
  let scaService: { handleUpdateSca: jest.Mock };
  let utilsService: {
    handleUpdateSast: jest.Mock;
    handleUpdateIac: jest.Mock;
    handleUpdateCicd: jest.Mock;
    handleUpdateSecret: jest.Mock;
  };

  const provideRepo = (token: any, repo: MockType<any>) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  beforeEach(async () => {
    // Initialize mocks
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    cicdRepo = createMockRepository();
    secretRepo = createMockRepository();
    scaRepo = createMockRepository();
    containerRepo = createMockRepository();
    scaPkgRepo = createMockRepository();
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    historyRepo = createMockRepository();
    autofixRepo = createMockRepository();

    containerService = { handleUpdateContainer: jest.fn() } as any;
    scaService = { handleUpdateSca: jest.fn() } as any;
    utilsService = {
      handleUpdateSast: jest.fn(),
      handleUpdateIac: jest.fn(),
      handleUpdateCicd: jest.fn(),
      handleUpdateSecret: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultService,
        provideRepo(SastVulnerabilityDetections, sastRepo),
        provideRepo(IacVulnerabilityDetections, iacRepo),
        provideRepo(CicdVulnerabilityDetections, cicdRepo),
        provideRepo(SecretVulnerabilityDetections, secretRepo),
        provideRepo(ScaVulnerabilityDetections, scaRepo),
        provideRepo(VulnerabilityDetectionsContainer, containerRepo),
        provideRepo(ScaDetectedPackages, scaPkgRepo),
        provideRepo(ContainerDetectedImage, imageRepo),
        provideRepo(ContainerDetectedPackage, pkgRepo),
        provideRepo(HistoryItemEntity, historyRepo),
        provideRepo(AutoFixRecord, autofixRepo),
        { provide: ContainerService, useValue: containerService },
        { provide: ScaService, useValue: scaService },
        { provide: SastIacUtilsService, useValue: utilsService },
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
        // gRPC clients not used by batchUpdateScanResults; provide dummies for DI
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
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
        // Stub CybeRiskService (live 7-day level), the persisted-score
        // repo and the backfill enqueuer — none of these unit tests exercise
        // scoring but DI must resolve.
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
  });

  it('successfully updates multiple vulnerabilities', async () => {
    // Setup: two SAST vulnerabilities
    const vuln1 = { id: 'v1', projectId: 'p1' };
    const vuln2 = { id: 'v2', projectId: 'p1' };

    // First call returns vuln1, second call returns vuln2
    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValueOnce(vuln1).mockResolvedValueOnce(vuln2);

    utilsService.handleUpdateSast
      .mockResolvedValueOnce({ projectId: 'p1', vulnerabilityId: 'v1' })
      .mockResolvedValueOnce({ projectId: 'p1', vulnerabilityId: 'v2' });

    const result = await service.batchUpdateScanResults({
      projectId: 'p1',
      items: [
        { vulnerabilityId: 'v1', status: 'resolved' },
        { vulnerabilityId: 'v2', status: 'not_exploitable' },
      ],
      userId: 'user1',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    });

    expect(result.projectId).toBe('p1');
    expect(result.totalCount).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(true);
  });

  it('handles partial failures gracefully', async () => {
    // Setup: first vuln found, second not found
    const vuln1 = { id: 'v1', projectId: 'p1' };

    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValueOnce(vuln1).mockResolvedValueOnce(null);
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue(null);
    cicdRepo.findOne!.mockResolvedValue(null);
    secretRepo.findOne!.mockResolvedValue(null);

    utilsService.handleUpdateSast.mockResolvedValueOnce({
      projectId: 'p1',
      vulnerabilityId: 'v1',
    });

    const result = await service.batchUpdateScanResults({
      projectId: 'p1',
      items: [
        { vulnerabilityId: 'v1', status: 'resolved' },
        { vulnerabilityId: 'v2', status: 'not_exploitable' },
      ],
      userId: 'user1',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    });

    expect(result.totalCount).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toBeDefined();
  });

  it('fails items with no update fields provided', async () => {
    const result = await service.batchUpdateScanResults({
      projectId: 'p1',
      items: [
        { vulnerabilityId: 'v1' }, // No status, priority, or comment
      ],
      userId: 'user1',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    });

    expect(result.totalCount).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('No update fields provided');
  });

  it('returns correct counts for empty items array', async () => {
    const result = await service.batchUpdateScanResults({
      projectId: 'p1',
      items: [],
      userId: 'user1',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    });

    expect(result.totalCount).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe('ResultService.applyBatchUpdate', () => {
  let service: ResultService;

  // Repositories
  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;
  let scaPkgRepo: MockType<any>;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let autofixRepo: MockType<any>;

  // Services
  let containerService: { handleUpdateContainer: jest.Mock };
  let scaService: { handleUpdateSca: jest.Mock };
  let utilsService: {
    handleUpdateSast: jest.Mock;
    handleUpdateIac: jest.Mock;
    handleUpdateCicd: jest.Mock;
    handleUpdateSecret: jest.Mock;
  };

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
    scaPkgRepo = createMockRepository();
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    historyRepo = createMockRepository();
    autofixRepo = createMockRepository();

    containerService = { handleUpdateContainer: jest.fn() } as any;
    scaService = { handleUpdateSca: jest.fn() } as any;
    utilsService = {
      handleUpdateSast: jest.fn(),
      handleUpdateIac: jest.fn(),
      handleUpdateCicd: jest.fn(),
      handleUpdateSecret: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultService,
        provideRepo(SastVulnerabilityDetections, sastRepo),
        provideRepo(IacVulnerabilityDetections, iacRepo),
        provideRepo(CicdVulnerabilityDetections, cicdRepo),
        provideRepo(SecretVulnerabilityDetections, secretRepo),
        provideRepo(ScaVulnerabilityDetections, scaRepo),
        provideRepo(VulnerabilityDetectionsContainer, containerRepo),
        provideRepo(ScaDetectedPackages, scaPkgRepo),
        provideRepo(ContainerDetectedImage, imageRepo),
        provideRepo(ContainerDetectedPackage, pkgRepo),
        provideRepo(HistoryItemEntity, historyRepo),
        provideRepo(AutoFixRecord, autofixRepo),
        { provide: ContainerService, useValue: containerService },
        { provide: ScaService, useValue: scaService },
        { provide: SastIacUtilsService, useValue: utilsService },
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
          useValue: { getService: () => ({}) },
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
  });

  it('calls onProgress exactly once per item with incrementing processed count', async () => {
    // 3 items: item1 succeeds, item2 has no fields (counted as failure), item3 throws
    const vuln1 = { id: 'v1', projectId: 'p1' };

    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo
      .findOne!.mockResolvedValueOnce(vuln1) // v1 found
      .mockResolvedValue(null); // v3 not found (all repos return null → RpcException NOT_FOUND)
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue(null);
    cicdRepo.findOne!.mockResolvedValue(null);
    secretRepo.findOne!.mockResolvedValue(null);

    utilsService.handleUpdateSast.mockResolvedValueOnce({
      projectId: 'p1',
      vulnerabilityId: 'v1',
    });

    const progressSnapshots: Array<{
      processed: number;
      succeeded: number;
      failed: number;
    }> = [];
    const onProgress = jest.fn(
      (p: { processed: number; succeeded: number; failed: number }) => {
        progressSnapshots.push({ ...p });
      },
    );

    const result = await service.applyBatchUpdate(
      {
        projectId: 'p1',
        items: [
          { vulnerabilityId: 'v1', status: 'resolved' }, // success
          { vulnerabilityId: 'v2' }, // no fields → failure
          { vulnerabilityId: 'v3', status: 'to_verify' }, // not found → error
        ],
        userId: 'user1',
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
      },
      onProgress,
    );

    // onProgress called once per item
    expect(onProgress).toHaveBeenCalledTimes(3);

    // processed increments 1 → 2 → 3
    expect(progressSnapshots[0].processed).toBe(1);
    expect(progressSnapshots[1].processed).toBe(2);
    expect(progressSnapshots[2].processed).toBe(3);

    // Final snapshot must match result counters
    expect(progressSnapshots[2].processed).toBe(result.totalCount);
    expect(progressSnapshots[2].succeeded).toBe(result.successCount);
    expect(progressSnapshots[2].failed).toBe(result.failureCount);
  });

  it('onProgress succeeded/failed values are correct at each step for mixed input', async () => {
    const vuln1 = { id: 'v1', projectId: 'p1' };

    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValueOnce(vuln1).mockResolvedValue(null);
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue(null);
    cicdRepo.findOne!.mockResolvedValue(null);
    secretRepo.findOne!.mockResolvedValue(null);

    utilsService.handleUpdateSast.mockResolvedValueOnce({
      projectId: 'p1',
      vulnerabilityId: 'v1',
    });

    const snapshots: Array<{
      processed: number;
      succeeded: number;
      failed: number;
    }> = [];
    await service.applyBatchUpdate(
      {
        projectId: 'p1',
        items: [
          { vulnerabilityId: 'v1', status: 'resolved' }, // succeeds → succeeded=1
          { vulnerabilityId: 'v2' }, // no fields → failed=1
        ],
        userId: 'user1',
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
      },
      (p) => {
        snapshots.push({ ...p });
      },
    );

    expect(snapshots).toHaveLength(2);
    // After item 1 (success): processed=1, succeeded=1, failed=0
    expect(snapshots[0]).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    // After item 2 (skip/no-fields → failure): processed=2, succeeded=1, failed=1
    expect(snapshots[1]).toEqual({ processed: 2, succeeded: 1, failed: 1 });
  });

  // The batch item carries its own dismissalReason, and
  // this loop is the ONLY place it can reach `assertDismissalReason`. Dropping
  // it here turns every bulk dismissal into an INVALID_ARGUMENT the caller has
  // no way to satisfy: the guard is downstream of this mapping.
  it('carries the per-item dismissalReason into the UpdateResultRequest it builds', async () => {
    const vuln1 = { id: 'v1', projectId: 'p1' };

    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValue(vuln1);
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue(null);
    cicdRepo.findOne!.mockResolvedValue(null);
    secretRepo.findOne!.mockResolvedValue(null);

    utilsService.handleUpdateSast.mockResolvedValue({
      projectId: 'p1',
      vulnerabilityId: 'v1',
    });

    await service.applyBatchUpdate({
      projectId: 'p1',
      items: [
        {
          vulnerabilityId: 'v1',
          status: 'ignored',
          dismissalReason: 'compensating control in place',
        },
      ],
      userId: 'user1',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    });

    expect(utilsService.handleUpdateSast).toHaveBeenCalledWith(
      vuln1,
      expect.objectContaining({
        status: 'ignored',
        dismissalReason: 'compensating control in place',
      }),
    );
  });

  it('batchUpdateScanResults still returns correct shape for mixed input (parity check)', async () => {
    // One success, one no-fields skip, one not-found error
    const vuln1 = { id: 'v1', projectId: 'p1' };

    containerRepo.findOne!.mockResolvedValue(null);
    sastRepo.findOne!.mockResolvedValueOnce(vuln1).mockResolvedValue(null);
    iacRepo.findOne!.mockResolvedValue(null);
    scaRepo.findOne!.mockResolvedValue(null);
    cicdRepo.findOne!.mockResolvedValue(null);
    secretRepo.findOne!.mockResolvedValue(null);

    utilsService.handleUpdateSast.mockResolvedValueOnce({
      projectId: 'p1',
      vulnerabilityId: 'v1',
    });

    const result = await service.batchUpdateScanResults({
      projectId: 'p1',
      items: [
        { vulnerabilityId: 'v1', status: 'resolved' },
        { vulnerabilityId: 'v2' }, // no fields
        { vulnerabilityId: 'v3', status: 'to_verify' }, // not found
      ],
      userId: 'user1',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    });

    expect(result.projectId).toBe('p1');
    expect(result.totalCount).toBe(3);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(2);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({ vulnerabilityId: 'v1', success: true });
    expect(result.results[1]).toEqual({
      vulnerabilityId: 'v2',
      success: false,
      error:
        'No update fields provided (status, priority, or comment required)',
    });
    expect(result.results[2].success).toBe(false);
    expect(result.results[2].error).toBeDefined();
  });
});

describe('ResultService.getPriorityDecomposition', () => {
  let service: ResultService;

  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;
  let scaPkgRepo: MockType<any>;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let autofixRepo: MockType<any>;

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
    scaPkgRepo = createMockRepository();
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    historyRepo = createMockRepository();
    autofixRepo = createMockRepository();

    priorityCalculator = {
      calculate: jest.fn(),
      decompose: jest.fn().mockReturnValue({
        priority: 'high',
        compositeScore: 0.5,
        cvss4Contribution: 0.3,
        epssContribution: 0.05,
        exploitContribution: 0.1,
        contextContribution: 0.05,
        w1: 0.35,
        w2: 0.2,
        w3: 0.3,
        w4: 0.15,
        isManualOverride: false,
      }),
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
        provideRepo(ScaDetectedPackages, scaPkgRepo),
        provideRepo(ContainerDetectedImage, imageRepo),
        provideRepo(ContainerDetectedPackage, pkgRepo),
        provideRepo(HistoryItemEntity, historyRepo),
        provideRepo(AutoFixRecord, autofixRepo),
        {
          provide: ContainerService,
          useValue: { handleUpdateContainer: jest.fn() },
        },
        { provide: ScaService, useValue: { handleUpdateSca: jest.fn() } },
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
        // Stub CybeRiskService (live 7-day level), the persisted-score
        // repo and the backfill enqueuer — none of these unit tests exercise
        // scoring but DI must resolve.
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
    // Avoid hitting the real gRPC call for the security context.
    jest.spyOn(service, 'getSecurityContextCached').mockResolvedValue({
      businessCriticality: 0,
      dataClassification: 0,
    } as any);
  });

  it('loads scaDetectedPackage relation and forwards its reachability for SCA', async () => {
    scaRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      cvss4EnvironmentalScore: 9.3,
      cvss4BaseScore: 9.3,
      currentSeverity: 'CRITICAL',
      epssScore: 0.05,
      exploitabilityScore: 0.88,
      priorityManualOverride: false,
      scaDetectedPackage: { reachability: 'used' },
    });

    await service.getPriorityDecomposition({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerabilityType: 'sca',
    });

    expect(scaRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', id: 'v1' },
        relations: ['scaDetectedPackage'],
      }),
    );
    expect(priorityCalculator.decompose).toHaveBeenCalledWith(
      expect.objectContaining({ reachability: 'used' }),
    );
  });

  it('recalculatePriority forces computation past a manual override when forceRecompute is set', async () => {
    (priorityCalculator.calculate as jest.Mock).mockReturnValue({
      priority: 'high',
      compositeScore: 0.8,
      priorityScore: 80,
    });

    const result = await service.recalculatePriority(
      {
        cvss4EnvironmentalScore: 9,
        cvss4BaseScore: 9,
        currentSeverity: 'CRITICAL',
        epssScore: 0.05,
        epssPercentile: null,
        exploitabilityScore: 0.75,
        priorityManualOverride: true,
      } as any,
      'p1',
      null,
      { forceRecompute: true },
    );

    expect(priorityCalculator.calculate).toHaveBeenCalledWith(
      expect.objectContaining({ priorityManualOverride: false }),
    );
    expect(result).toEqual(expect.objectContaining({ priority: 'high' }));
  });

  it('recalculatePriority honors the manual override when forceRecompute is absent', async () => {
    (priorityCalculator.calculate as jest.Mock).mockClear();

    await service.recalculatePriority(
      {
        cvss4EnvironmentalScore: 9,
        cvss4BaseScore: 9,
        currentSeverity: 'CRITICAL',
        epssScore: 0.05,
        epssPercentile: null,
        exploitabilityScore: 0.75,
        priorityManualOverride: true,
      } as any,
      'p1',
    );

    expect(priorityCalculator.calculate).toHaveBeenCalledWith(
      expect.objectContaining({ priorityManualOverride: true }),
    );
  });

  it('forwards null reachability for SCA when the package has none', async () => {
    scaRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      cvss4EnvironmentalScore: 9.3,
      cvss4BaseScore: 9.3,
      currentSeverity: 'CRITICAL',
      epssScore: 0.05,
      exploitabilityScore: 0.88,
      priorityManualOverride: false,
      scaDetectedPackage: { reachability: null },
    });

    await service.getPriorityDecomposition({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerabilityType: 'sca',
    });

    expect(priorityCalculator.decompose).toHaveBeenCalledWith(
      expect.objectContaining({ reachability: null }),
    );
  });

  it('keeps reachability null for non-SCA vulnerability types', async () => {
    sastRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      cvss4EnvironmentalScore: 7.0,
      cvss4BaseScore: 7.0,
      currentSeverity: 'HIGH',
      exploitabilityScore: 0.6,
      priorityManualOverride: false,
    });

    await service.getPriorityDecomposition({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerabilityType: 'sast',
    });

    expect(sastRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', id: 'v1' },
      }),
    );
    // Relations should NOT be requested for non-SCA types.
    const findOneCall = sastRepo.findOne!.mock.calls[0][0];
    expect(findOneCall.relations).toBeUndefined();
    expect(priorityCalculator.decompose).toHaveBeenCalledWith(
      expect.objectContaining({ reachability: null }),
    );
  });

  it('passes epssPercentile from the entity into PriorityInput', async () => {
    sastRepo.findOne.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      cvss4EnvironmentalScore: 8,
      cvss4BaseScore: 8,
      currentSeverity: 'HIGH',
      epssScore: 0.033,
      epssPercentile: 0.87,
      exploitabilityScore: 0.5,
      priorityManualOverride: false,
    });

    await service.getPriorityDecomposition({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerabilityType: 'sast',
    });

    expect(priorityCalculator.decompose).toHaveBeenCalledWith(
      expect.objectContaining({ epssPercentile: 0.87 }),
    );
  });

  it('returns a deterministic decomposition for secrets without running the composite', async () => {
    secretRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      currentSeverity: 'CRITICAL',
      currentPriority: 'critical_urgent',
      priorityScore: 100,
      // legacy/irrelevant exploitability columns must not be consulted
      exploitabilityScore: 0.5,
      priorityManualOverride: false,
    });

    const { decomposition } = await service.getPriorityDecomposition({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      vulnerabilityType: 'secret',
    });

    // Secrets bypass the multi-signal composite entirely.
    expect(priorityCalculator.decompose).not.toHaveBeenCalled();
    expect(decomposition?.priority).toBe('critical_urgent');
    expect(decomposition?.compositeScore).toBe(1);
    expect(decomposition?.exploitContribution).toBe(0);
    expect(decomposition?.cvss4Contribution).toBe(0);
  });
});

describe('ResultService.computeEnvironmentalForProject', () => {
  let service: ResultService;
  let cvssCalculator: jest.Mocked<CvssCalculatorService>;

  const provideRepo = (token: any, repo: any) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  const makeRepo = () => createMockRepository();

  beforeEach(async () => {
    cvssCalculator = {
      applyEnvironmentalMetrics: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultService,
        provideRepo(SastVulnerabilityDetections, makeRepo()),
        provideRepo(IacVulnerabilityDetections, makeRepo()),
        provideRepo(CicdVulnerabilityDetections, makeRepo()),
        provideRepo(SecretVulnerabilityDetections, makeRepo()),
        provideRepo(ScaVulnerabilityDetections, makeRepo()),
        provideRepo(VulnerabilityDetectionsContainer, makeRepo()),
        provideRepo(ScaDetectedPackages, makeRepo()),
        provideRepo(ContainerDetectedImage, makeRepo()),
        provideRepo(ContainerDetectedPackage, makeRepo()),
        provideRepo(HistoryItemEntity, makeRepo()),
        provideRepo(AutoFixRecord, makeRepo()),
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
        { provide: CvssCalculatorService, useValue: cvssCalculator },
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
        // Stub CybeRiskService (live 7-day level), the persisted-score
        // repo and the backfill enqueuer — none of these unit tests exercise
        // scoring but DI must resolve.
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
  });

  it('returns baseScore, environmentalScore and fullVector when context exists', async () => {
    // PRODUCTION=1, PUBLIC=1, REGULATED=4, HIGH=3, FLAT=1
    const mockContext = {
      environment: 1,
      internetExposure: 1,
      dataClassification: 4,
      businessCriticality: 3,
      networkSegmentation: 1,
      handlesPii: true,
      handlesPaymentData: false,
      safetyCritical: false,
    } as any;

    jest
      .spyOn(service, 'getSecurityContextCached')
      .mockResolvedValue(mockContext);

    const expectedResult = {
      baseScore: 9.3,
      environmentalScore: 9.5,
      fullVector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/CR:H/IR:H/AR:H',
    };
    cvssCalculator.applyEnvironmentalMetrics.mockReturnValue(expectedResult);

    const vector =
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H';
    const result = await service.computeEnvironmentalForProject('p1', vector);

    expect(result).not.toBeNull();
    expect(typeof result!.baseScore).toBe('number');
    expect(typeof result!.environmentalScore).toBe('number');
    expect(result!.fullVector).toContain('CR:H');
    expect(cvssCalculator.applyEnvironmentalMetrics).toHaveBeenCalledWith(
      vector,
      expect.objectContaining({
        environment: 'production',
        internetExposure: 'public',
        dataClassification: 'regulated',
      }),
    );
  });

  it('returns null when getSecurityContextCached returns null', async () => {
    jest.spyOn(service, 'getSecurityContextCached').mockResolvedValue(null);

    const result = await service.computeEnvironmentalForProject(
      'p1',
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H',
    );

    expect(result).toBeNull();
    expect(cvssCalculator.applyEnvironmentalMetrics).not.toHaveBeenCalled();
  });

  it('returns null when the provided cvss4Vector is invalid', async () => {
    const mockContext = {
      environment: 1,
      internetExposure: 1,
      dataClassification: 1,
      businessCriticality: 1,
      networkSegmentation: 1,
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    } as any;

    jest
      .spyOn(service, 'getSecurityContextCached')
      .mockResolvedValue(mockContext);
    cvssCalculator.applyEnvironmentalMetrics.mockReturnValue(null);

    const result = await service.computeEnvironmentalForProject(
      'p1',
      'INVALID_VECTOR',
    );

    expect(result).toBeNull();
  });
});

// Read path — all-time level/score come from the persisted
// project_cyber_risk row (lazy backfill enqueue when missing), the 7-day
// metric is computed live by CyberRiskService.
describe('ResultService cyber-risk read path', () => {
  let service: ResultService;
  let module: TestingModule;
  let cyberRiskRepo: {
    findByProjectId: jest.Mock;
    findByProjectIds: jest.Mock;
  };
  let cyberRiskService: {
    computeProjectScoreLevelSince: jest.Mock;
    computeBatchLevelsSince: jest.Mock;
  };
  let enqueuer: { enqueue: jest.Mock };
  let activeVulnFetcher: { fetchActiveVulnsWithMeta: jest.Mock };
  let organizationOverviewService: {
    getOrganizationOverview: jest.Mock;
    getIssueTrend: jest.Mock;
  };

  const provideRepo = (token: any, repo: any) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  const makeRepo = () => createMockRepository();

  beforeEach(async () => {
    organizationOverviewService = {
      getOrganizationOverview: jest.fn(),
      getIssueTrend: jest.fn().mockResolvedValue({
        newIssues: 0,
        newIssuesLastPeriod: 0,
        newIssuesPreviousPeriod: 0,
        solvedIssues: 0,
        solvedIssuesLastPeriod: 0,
        solvedIssuesPreviousPeriod: 0,
      }),
    };
    cyberRiskRepo = {
      findByProjectId: jest.fn().mockResolvedValue(null),
      findByProjectIds: jest.fn().mockResolvedValue([]),
    };
    cyberRiskService = {
      computeProjectScoreLevelSince: jest.fn().mockResolvedValue('low'),
      computeBatchLevelsSince: jest.fn().mockResolvedValue(new Map()),
    };
    enqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };
    activeVulnFetcher = {
      fetchActiveVulnsWithMeta: jest.fn().mockResolvedValue([]),
    };

    module = await Test.createTestingModule({
      providers: [
        ResultService,
        provideRepo(SastVulnerabilityDetections, makeRepo()),
        provideRepo(IacVulnerabilityDetections, makeRepo()),
        provideRepo(CicdVulnerabilityDetections, makeRepo()),
        provideRepo(SecretVulnerabilityDetections, makeRepo()),
        provideRepo(ScaVulnerabilityDetections, makeRepo()),
        provideRepo(VulnerabilityDetectionsContainer, makeRepo()),
        provideRepo(ScaDetectedPackages, makeRepo()),
        provideRepo(ContainerDetectedImage, makeRepo()),
        provideRepo(ContainerDetectedPackage, makeRepo()),
        provideRepo(HistoryItemEntity, makeRepo()),
        provideRepo(AutoFixRecord, makeRepo()),
        { provide: ContainerService, useValue: {} },
        { provide: ScaService, useValue: {} },
        { provide: SastIacUtilsService, useValue: {} },
        { provide: SastIacService, useValue: {} },
        {
          provide: OrganizationOverviewService,
          useValue: organizationOverviewService,
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
          useValue: { getService: () => ({}) },
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
        { provide: CyberRiskService, useValue: cyberRiskService },
        { provide: ProjectCyberRiskRepository, useValue: cyberRiskRepo },
        { provide: CyberiskRecomputeEnqueuer, useValue: enqueuer },
        { provide: ActiveVulnFetcher, useValue: activeVulnFetcher },
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
  });

  describe('calculateRiskLevel', () => {
    it('returns the persisted all-time level and the live 7-day level', async () => {
      cyberRiskRepo.findByProjectId.mockResolvedValue({
        projectId: 'p1',
        score: 120,
        level: 'high',
        computedAt: new Date(),
      });
      cyberRiskService.computeProjectScoreLevelSince.mockResolvedValue(
        'medium',
      );

      const res = await service.calculateRiskLevel('p1');

      expect(res).toEqual({
        riskLevel: 'high',
        riskLevelInLast7Days: 'medium',
      });
      expect(
        cyberRiskService.computeProjectScoreLevelSince,
      ).toHaveBeenCalledWith('p1', expect.any(Date));
      expect(enqueuer.enqueue).not.toHaveBeenCalled();
    });

    it('falls back to "low" and enqueues a backfill when no persisted row exists', async () => {
      cyberRiskRepo.findByProjectId.mockResolvedValue(null);

      const res = await service.calculateRiskLevel('p1');

      expect(res.riskLevel).toBe('low');
      expect(enqueuer.enqueue).toHaveBeenCalledWith('p1', 'backfill');
    });
  });

  describe('calculateRiskLevelInLast7Days', () => {
    it('delegates to the live 7-day computation', async () => {
      cyberRiskService.computeProjectScoreLevelSince.mockResolvedValue('low');

      const res = await service.calculateRiskLevelInLast7Days('p1');

      expect(res).toBe('low');
      expect(
        cyberRiskService.computeProjectScoreLevelSince,
      ).toHaveBeenCalledWith('p1', expect.any(Date));
    });
  });

  describe('getRiskLevelProjects', () => {
    it('maps persisted all-time levels and live 7-day levels per project', async () => {
      cyberRiskRepo.findByProjectIds.mockResolvedValue([
        {
          projectId: 'p1',
          score: 200,
          level: 'critical',
          level7Days: 'high',
          computedAt: new Date(),
        },
      ]);

      const res = await service.getRiskLevelProjects(['p1', 'p2']);

      expect(res).toEqual([
        {
          projectId: 'p1',
          riskLevel: 'critical',
          riskLevelInLast7Days: 'high',
        },
        { projectId: 'p2', riskLevel: 'low', riskLevelInLast7Days: 'low' },
      ]);
      // Both levels come from the persisted row — no live 7-day recompute.
      expect(cyberRiskService.computeBatchLevelsSince).not.toHaveBeenCalled();
      // p2 has no persisted row -> backfill enqueued, p1 does not.
      expect(enqueuer.enqueue).toHaveBeenCalledWith('p2', 'backfill');
      expect(enqueuer.enqueue).not.toHaveBeenCalledWith('p1', 'backfill');
    });
  });

  describe('getMainStatistics – single 7-day risk computation', () => {
    it('derives the InLast7Days risk counts from getRiskLevelProjects (no second 7-day pass)', async () => {
      jest.spyOn(service, 'getRiskLevelProjects').mockResolvedValue([
        {
          projectId: 'p1',
          riskLevel: 'critical',
          riskLevelInLast7Days: 'high',
        },
        {
          projectId: 'p2',
          riskLevel: 'high',
          riskLevelInLast7Days: 'critical',
        },
      ]);
      // Stub the remaining sub-queries so getMainStatistics runs without a DB.
      jest.spyOn(service as any, 'getTotalIssuesProjects').mockResolvedValue({
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
      });
      jest
        .spyOn(service as any, 'getAgentActivityCounts')
        .mockResolvedValue({ analyses: 0, triage: 0, falsePositives: 0 });
      jest.spyOn(service as any, 'getAgentAutofixCount').mockResolvedValue(0);

      const res = await service.getMainStatistics({
        projectIds: ['p1', 'p2'],
      } as any);

      expect(res.criticalRiskProjects).toBe(1); // p1 current
      expect(res.highRiskProjects).toBe(1); // p2 current
      expect(res.criticalRiskProjectsInLast7Days).toBe(1); // p2 (7-day)
      expect(res.highRiskProjectsInLast7Days).toBe(1); // p1 (7-day)
      // No separate 7-day pass: getRiskLevelProjects is spied, so the only path
      // that would call computeBatchLevelsSince is the (now removed) redundant
      // getRiskLevelProjectsInLast7Days. It must not run.
      expect(cyberRiskService.computeBatchLevelsSince).not.toHaveBeenCalled();
    });

    // Contract lock — criticalRiskProjects and highRiskProjects MUST be
    // returned as separate scalars (critical = riskLevel 'critical', score >=
    // 80; high = riskLevel 'high', score 50-79). The dashboard "Critical Risk
    // Projects" KPI card reads criticalRiskProjects; if these two were ever
    // re-merged into one counter, the card would mis-count CRITICAL projects.
    it('returns criticalRiskProjects (K) and highRiskProjects (J) as DISTINCT counts', async () => {
      const K = 3; // critical-risk projects
      const J = 2; // high-risk projects
      const riskLevels = [
        ...Array.from({ length: K }, (_, i) => ({
          projectId: `c${i}`,
          riskLevel: 'critical',
          riskLevelInLast7Days: 'low',
        })),
        ...Array.from({ length: J }, (_, i) => ({
          projectId: `h${i}`,
          riskLevel: 'high',
          riskLevelInLast7Days: 'low',
        })),
      ];
      jest
        .spyOn(service, 'getRiskLevelProjects')
        .mockResolvedValue(riskLevels as any);
      jest.spyOn(service as any, 'getTotalIssuesProjects').mockResolvedValue({
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
      });
      jest
        .spyOn(service as any, 'getAgentActivityCounts')
        .mockResolvedValue({ analyses: 0, triage: 0, falsePositives: 0 });
      jest.spyOn(service as any, 'getAgentAutofixCount').mockResolvedValue(0);

      const res = await service.getMainStatistics({
        projectIds: riskLevels.map((r) => r.projectId),
      } as any);

      expect(res.criticalRiskProjects).toBe(K);
      expect(res.highRiskProjects).toBe(J);
      // The two scalars must never collapse onto the same value.
      expect(res.criticalRiskProjects).not.toBe(res.highRiskProjects);
    });

    it('takes the new and solved counts from the overview, so the home cards and the overview agree', async () => {
      jest.spyOn(service, 'getRiskLevelProjects').mockResolvedValue([]);
      jest.spyOn(service as any, 'getTotalIssuesProjects').mockResolvedValue({
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
      });
      jest
        .spyOn(service as any, 'getAgentActivityCounts')
        .mockResolvedValue({ analyses: 0, triage: 0, falsePositives: 0 });
      jest.spyOn(service as any, 'getAgentAutofixCount').mockResolvedValue(0);
      organizationOverviewService.getIssueTrend.mockResolvedValue({
        newIssues: 30,
        newIssuesLastPeriod: 24,
        newIssuesPreviousPeriod: 6,
        solvedIssues: 9,
        solvedIssuesLastPeriod: 4,
        solvedIssuesPreviousPeriod: 5,
      });

      const res = await service.getMainStatistics({
        projectIds: ['p1', 'p2'],
      } as any);

      expect(organizationOverviewService.getIssueTrend).toHaveBeenCalledWith([
        'p1',
        'p2',
      ]);
      expect(res).toEqual(
        expect.objectContaining({
          newIssues: 30,
          newIssuesInLast7Days: 24,
          solvedIssues: 9,
          solvedIssuesInLast7Days: 4,
        }),
      );
    });
  });

  // The /overview detail path recomputes the byScanType /
  // topContributors breakdown live from the persisted score. Listings stay
  // breakdown-less.
  describe('getProjectOverview cyber-risk breakdown', () => {
    // A chainable QueryBuilder mock: every builder method returns the builder,
    // terminal getRawMany/getCount resolve to empty data (no vulns/counts).
    const stubDetectionQueryBuilders = () => {
      const detectionTokens = [
        SastVulnerabilityDetections,
        IacVulnerabilityDetections,
        CicdVulnerabilityDetections,
        ScaVulnerabilityDetections,
        VulnerabilityDetectionsContainer,
        SecretVulnerabilityDetections,
      ];
      for (const token of detectionTokens) {
        const repo: any = module.get(getRepositoryToken(token));
        repo.createQueryBuilder = jest.fn(() => {
          const qb: any = {};
          for (const m of [
            'select',
            'addSelect',
            'where',
            'andWhere',
            'groupBy',
            'addGroupBy',
            'orderBy',
            'addOrderBy',
          ]) {
            qb[m] = jest.fn().mockReturnValue(qb);
          }
          qb.getRawMany = jest.fn().mockResolvedValue([]);
          qb.getCount = jest.fn().mockResolvedValue(0);
          // The trend series are composed into one UNION ALL.
          qb.setParameter = jest.fn().mockReturnValue(qb);
          qb.getQueryAndParameters = jest.fn(() => ['SELECT 1', []]);
          return qb;
        });
        repo.query = jest.fn().mockResolvedValue([]);
      }
    };

    it('attaches a breakdown rebuilt from the active vulns when a row exists', async () => {
      stubDetectionQueryBuilders();
      cyberRiskRepo.findByProjectId.mockResolvedValue({
        projectId: 'p1',
        score: 42,
        level: 'high',
        computedAt: new Date('2026-05-29T00:00:00.000Z'),
      });
      activeVulnFetcher.fetchActiveVulnsWithMeta.mockResolvedValue([
        {
          id: 'c1',
          scanType: 'SAST',
          cvssEnvironmental: 10,
          cvss4: null,
          cvss3: null,
          severity: 'critical',
        },
      ]);

      const res = await service.getProjectOverview({
        projectId: 'p1',
        branches: [],
      } as any);

      // No referenceBranch in this module -> main/master fallback branches.
      expect(activeVulnFetcher.fetchActiveVulnsWithMeta).toHaveBeenCalledWith(
        'p1',
        ['main', 'master'],
      );
      expect(res.cyberRisk.score).toBe(42);
      expect(res.cyberRisk.breakdown).toBeDefined();
      expect(res.cyberRisk.breakdown!.base).toBe(42);
      expect(res.cyberRisk.breakdown!.byScanType.SAST.weightedScore).toBe(20);
      expect(res.cyberRisk.breakdown!.topContributors).toHaveLength(1);
      expect(enqueuer.enqueue).not.toHaveBeenCalled();
    });

    it('omits the breakdown and enqueues a backfill when no row exists', async () => {
      stubDetectionQueryBuilders();
      cyberRiskRepo.findByProjectId.mockResolvedValue(null);

      const res = await service.getProjectOverview({
        projectId: 'p1',
        branches: [],
      } as any);

      expect(res.cyberRisk.breakdown).toBeUndefined();
      expect(activeVulnFetcher.fetchActiveVulnsWithMeta).not.toHaveBeenCalled();
      expect(enqueuer.enqueue).toHaveBeenCalledWith('p1', 'backfill');
    });

    it('logs the underlying error server-side and rethrows a generic RpcException on failure', async () => {
      stubDetectionQueryBuilders();
      const boom = new Error(
        "ER_BAD_FIELD_ERROR: Unknown column 'sast.effective_severity' in 'field list'",
      );
      const sastRepo: any = module.get(
        getRepositoryToken(SastVulnerabilityDetections),
      );
      sastRepo.createQueryBuilder = jest.fn(() => {
        const qb: any = {};
        for (const m of [
          'select',
          'addSelect',
          'where',
          'andWhere',
          'groupBy',
          'addGroupBy',
          'orderBy',
          'addOrderBy',
        ]) {
          qb[m] = jest.fn().mockReturnValue(qb);
        }
        qb.getRawMany = jest.fn().mockRejectedValue(boom);
        qb.getCount = jest.fn().mockResolvedValue(0);
        qb.setParameter = jest.fn().mockReturnValue(qb);
        qb.getQueryAndParameters = jest.fn(() => ['SELECT 1', []]);
        return qb;
      });

      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.getProjectOverview({ projectId: 'p1', branches: [] } as any),
      ).rejects.toBeInstanceOf(RpcException);

      expect(errorSpy).toHaveBeenCalled();
      const loggedTheCause = errorSpy.mock.calls.some((call) =>
        call.some(
          (arg) => typeof arg === 'string' && arg.includes('Unknown column'),
        ),
      );
      expect(loggedTheCause).toBe(true);

      errorSpy.mockRestore();
    });
  });

  // BUG: the per-type tab badge showed 1 while the list showed 0 for an active
  // IaC detection whose effective severity is 'none' (CVSS score 0). The badge
  // must only count detections whose env-derived band is displayable.
  describe('getCountVulnerabilitiesCountByType displayable-severity guard', () => {
    const captureCountAndWhere = (): Array<[string, any]> => {
      const calls: Array<[string, any]> = [];
      const tokens = [
        SastVulnerabilityDetections,
        IacVulnerabilityDetections,
        CicdVulnerabilityDetections,
        ScaVulnerabilityDetections,
        VulnerabilityDetectionsContainer,
        SecretVulnerabilityDetections,
      ];
      for (const token of tokens) {
        const repo: any = module.get(getRepositoryToken(token));
        repo.createQueryBuilder = jest.fn(() => {
          const qb: any = {};
          for (const m of ['where', 'innerJoin', 'select', 'addSelect']) {
            qb[m] = jest.fn().mockReturnValue(qb);
          }
          qb.andWhere = jest.fn((sql: string, params?: any) => {
            calls.push([sql, params]);
            return qb;
          });
          qb.getCount = jest.fn().mockResolvedValue(0);
          // The parts of the counts' UNION ALL.
          qb.getQueryAndParameters = jest.fn(() => ['SELECT 1', []]);
          return qb;
        });
        repo.query = jest.fn().mockResolvedValue([]);
      }
      return calls;
    };

    it('counts only the 4 displayable bands, derived live from the CVSS4 scores', async () => {
      const calls = captureCountAndWhere();

      await service.getCountVulnerabilitiesCountByType('p1', undefined, [
        'main',
        'master',
        '',
      ]);

      const bandFilters = calls.filter(
        ([sql, params]) =>
          /cvss4_environmental_score/.test(sql) &&
          / IN \(:\.\.\.displayable\)/.test(sql) &&
          JSON.stringify(params?.displayable) ===
            JSON.stringify(['critical', 'high', 'medium', 'low']),
      );
      // One displayable-band constraint per detection type (6).
      expect(bandFilters).toHaveLength(6);
    });

    // The SCA tab badge (this count, returned alongside the SCA list)
    // must use the SAME logical branch partition as the list: the canonical
    // branch plus the legacy '' partition, not an exact single-branch equality
    // that misses orphaned '' rows (badge showed 0 while the list showed 24).
    it('scopes the SCA count to the effective branch partition (canonical + empty)', async () => {
      const calls = captureCountAndWhere();

      await service.getCountVulnerabilitiesCountByType('p1', 'main', [
        'main',
        '',
      ]);

      const scaInFilter = calls.find(([sql]) =>
        /sca\.branch IN \(:\.\.\.branches\)/.test(sql),
      );
      expect(scaInFilter).toBeTruthy();
      expect(scaInFilter![1]).toEqual({ branches: ['main', ''] });

      // the old exact-equality SCA branch filter must be gone
      const scaExact = calls.find(([sql]) => /sca\.branch = :branch/.test(sql));
      expect(scaExact).toBeUndefined();
    });

    // Perf — when the caller already resolved the SCA effective
    // branches (the SCA list does), it threads them in so this method does NOT
    // re-resolve them via a redundant getScoringBranches gRPC round-trip.
    it('honors a provided scaEffectiveBranches and skips the getScoringBranches lookup', async () => {
      const calls = captureCountAndWhere();
      const ref: any = module.get(ReferenceBranchResolver);
      ref.getScoringBranches.mockClear();

      await service.getCountVulnerabilitiesCountByType('p1', 'main', [
        'feat',
        '',
      ]);

      const scaInFilter = calls.find(([sql]) =>
        /sca\.branch IN \(:\.\.\.branches\)/.test(sql),
      );
      expect(scaInFilter![1]).toEqual({ branches: ['feat', ''] });
      expect(ref.getScoringBranches).not.toHaveBeenCalled();
    });

    // The partition is required: a caller that forgets it must
    // fail loudly, not quietly cost global-management one more Get.
    it('refuses to run without the partition instead of resolving it with a Get', async () => {
      captureCountAndWhere();
      const ref: any = module.get(ReferenceBranchResolver);
      ref.getScoringBranches.mockClear();

      const forgotten = service.getCountVulnerabilitiesCountByType as (
        projectId: string,
        branch?: string,
      ) => Promise<unknown>;
      await expect(
        forgotten.call(service, 'p1', 'main'),
      ).rejects.toBeInstanceOf(RpcException);
      expect(ref.getScoringBranches).not.toHaveBeenCalled();
    });
  });

  // The SCA autofix sub-counts (To Fix / Fix Proposed) are returned
  // alongside the SCA list; they must use the SAME logical branch partition
  // (canonical + '') as the list and the headline count, not an exact branch.
  describe('getAutofixCountByType SCA branch scoping', () => {
    const captureAutofixAndWhere = (): Array<[string, any]> => {
      const calls: Array<[string, any]> = [];
      const tokens = [
        SastVulnerabilityDetections,
        IacVulnerabilityDetections,
        CicdVulnerabilityDetections,
        SecretVulnerabilityDetections,
        ScaVulnerabilityDetections,
      ];
      for (const token of tokens) {
        const repo: any = module.get(getRepositoryToken(token));
        repo.createQueryBuilder = jest.fn(() => {
          const qb: any = {};
          for (const m of ['where', 'innerJoin', 'select', 'addSelect']) {
            qb[m] = jest.fn().mockReturnValue(qb);
          }
          qb.andWhere = jest.fn((sql: string, params?: any) => {
            calls.push([sql, params]);
            return qb;
          });
          qb.getCount = jest.fn().mockResolvedValue(0);
          // One COUNT(*) + SUM(EXISTS) row per table.
          qb.getRawOne = jest
            .fn()
            .mockResolvedValue({ total: '0', withAutofix: null });
          return qb;
        });
      }
      return calls;
    };

    it('scopes both SCA autofix sub-counts to the effective branch partition', async () => {
      const calls = captureAutofixAndWhere();

      await service.getAutofixCountByType('p1', 'main', ['main', '']);

      const scaIn = calls.filter(([sql]) =>
        /pkg\.branch IN \(:\.\.\.branches\)/.test(sql),
      );
      // One SCA query carries both sub-counts.
      expect(scaIn).toHaveLength(1);
      expect(scaIn[0][1]).toEqual({ branches: ['main', ''] });

      const scaExact = calls.find(([sql]) => /pkg\.branch = :branch/.test(sql));
      expect(scaExact).toBeUndefined();
    });

    // Perf — threads the caller-resolved SCA effective branches in to
    // avoid a redundant getScoringBranches gRPC round-trip.
    it('honors a provided scaEffectiveBranches and skips the getScoringBranches lookup', async () => {
      const calls = captureAutofixAndWhere();
      const ref: any = module.get(ReferenceBranchResolver);
      ref.getScoringBranches.mockClear();

      await service.getAutofixCountByType('p1', 'main', ['feat', '']);

      const scaIn = calls.filter(([sql]) =>
        /pkg\.branch IN \(:\.\.\.branches\)/.test(sql),
      );
      expect(scaIn).toHaveLength(1);
      expect(scaIn[0][1]).toEqual({ branches: ['feat', ''] });
      expect(ref.getScoringBranches).not.toHaveBeenCalled();
    });

    // Same rule as the per-type count.
    it('refuses to run without the partition instead of resolving it with a Get', async () => {
      captureAutofixAndWhere();
      const ref: any = module.get(ReferenceBranchResolver);
      ref.getScoringBranches.mockClear();

      const forgotten = service.getAutofixCountByType as (
        projectId: string,
        branch?: string,
      ) => Promise<unknown>;
      await expect(
        forgotten.call(service, 'p1', 'main'),
      ).rejects.toBeInstanceOf(RpcException);
      expect(ref.getScoringBranches).not.toHaveBeenCalled();
    });
  });

  // BUG: the home project-list pills counted base severity (12 critical) for
  // findings whose env band is lower (high). Buckets must use the live
  // env-derived band, not the raw scanner label.
  describe('getBatchVulnerabilitiesCount env-derived severity', () => {
    it('buckets per-project counts by the live env-derived band, not currentSeverity', async () => {
      const addSelectSqls: string[] = [];
      const tokens = [
        SastVulnerabilityDetections,
        IacVulnerabilityDetections,
        CicdVulnerabilityDetections,
        ScaVulnerabilityDetections,
        VulnerabilityDetectionsContainer,
        SecretVulnerabilityDetections,
      ];
      for (const token of tokens) {
        const repo: any = module.get(getRepositoryToken(token));
        repo.createQueryBuilder = jest.fn(() => {
          const qb: any = {};
          for (const m of [
            'select',
            'where',
            'andWhere',
            'innerJoin',
            'groupBy',
          ]) {
            qb[m] = jest.fn().mockReturnValue(qb);
          }
          qb.addSelect = jest.fn((sql: string) => {
            addSelectSqls.push(sql);
            return qb;
          });
          qb.getRawMany = jest.fn().mockResolvedValue([]);
          return qb;
        });
      }
      (service as any).scanServiceClient = {
        getBatchLastScans: jest.fn().mockReturnValue(of({ scans: [] })),
      };

      await service.getBatchVulnerabilitiesCount({ projectIds: ['p1'] });

      const liveBandSelects = addSelectSqls.filter(
        (s) => /cvss4_environmental_score/.test(s) && /CASE/.test(s),
      );
      // 6 detection types each bucketed by the env-derived band.
      expect(liveBandSelects.length).toBeGreaterThanOrEqual(6);
      // The raw scanner-label select must be gone.
      expect(addSelectSqls.some((s) => /^\w+\.currentSeverity$/.test(s))).toBe(
        false,
      );
    });
  });

  // A project's reference branch is written by any project admin
  // and was pasted into the WHERE of the project-list counts. These tests read
  // the SQL TypeORM really emits (metadata built, no connection).
  describe('getBatchVulnerabilitiesCount branch scoping', () => {
    const INJECTION = "main' OR '1'='1";
    let dataSource: DataSource;
    let emitted: Array<{ table: string; sql: string; params: unknown[] }>;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'mysql',
        database: 'unused',
        entities: [join(__dirname, '../../**/*.entity.ts')],
      });
      // Builds the entity metadata the query builders need; never connects.
      await (
        dataSource as unknown as { buildMetadatas(): Promise<void> }
      ).buildMetadatas();
    });

    beforeEach(() => {
      emitted = [];
      const tokens = [
        SastVulnerabilityDetections,
        IacVulnerabilityDetections,
        CicdVulnerabilityDetections,
        SecretVulnerabilityDetections,
        ScaVulnerabilityDetections,
        VulnerabilityDetectionsContainer,
      ];
      for (const token of tokens) {
        const repo: any = module.get(getRepositoryToken(token));
        repo.createQueryBuilder = (alias: string) => {
          const qb = dataSource.getRepository(token).createQueryBuilder(alias);
          qb.getRawMany = jest.fn(async () => {
            const [sql, params] = qb.getQueryAndParameters();
            emitted.push({ table: token.name, sql, params });
            return [];
          });
          return qb;
        };
      }
      (service as any).scanServiceClient = {
        getBatchLastScans: jest.fn().mockReturnValue(of({ scans: [] })),
      };
    });

    // The (project ids, branches) bound to each
    // `(x.projectId IN (…) AND y.branch IN (…))` scope of a query, in order.
    const scopes = (
      sql: string,
      params: unknown[],
    ): Array<{ projectIds: unknown[]; branches: unknown[] }> => {
      const found: Array<{ projectIds: unknown[]; branches: unknown[] }> = [];
      const scope =
        /\(`\w+`\.`projectId` IN \(([?, ]+)\) AND `\w+`\.`branch` IN \(([?, ]+)\)\)/g;
      for (const match of sql.matchAll(scope)) {
        const start = (sql.slice(0, match.index).match(/\?/g) ?? []).length;
        const ids = (match[1].match(/\?/g) ?? []).length;
        const branches = (match[2].match(/\?/g) ?? []).length;
        found.push({
          projectIds: params.slice(start, start + ids),
          branches: params.slice(start + ids, start + ids + branches),
        });
      }
      return found;
    };

    // SCA folds in its legacy '' partition, as its tab on the project page does
    // (resolveScaEffectiveBranches).
    const withLegacySca = (table: string, branches: string[]) =>
      table === 'ScaVulnerabilityDetections' ? [...branches, ''] : branches;

    it('binds every project and its branch as parameters, in all six tables', async () => {
      await service.getBatchVulnerabilitiesCount({
        projectIds: ['p-1', 'p-2'],
        referenceBranches: [
          { projectId: 'p-1', referenceBranch: INJECTION },
          { projectId: 'p-2', referenceBranch: 'release-1.2' },
        ],
      });

      expect(emitted.map((q) => q.table).sort()).toEqual([
        'CicdVulnerabilityDetections',
        'IacVulnerabilityDetections',
        'SastVulnerabilityDetections',
        'ScaVulnerabilityDetections',
        'SecretVulnerabilityDetections',
        'VulnerabilityDetectionsContainer',
      ]);
      for (const { table, sql, params } of emitted) {
        expect(sql).not.toContain(INJECTION);
        expect(sql).not.toContain("'p-1'");
        expect(scopes(sql, params)).toEqual([
          { projectIds: ['p-1'], branches: withLegacySca(table, [INJECTION]) },
          {
            projectIds: ['p-2'],
            branches: withLegacySca(table, ['release-1.2']),
          },
        ]);
      }
    });

    it('never puts a stored branch with an apostrophe into the SQL text', async () => {
      await service.getBatchVulnerabilitiesCount({
        projectIds: ['p-1'],
        referenceBranches: [{ projectId: 'p-1', referenceBranch: "o'brien" }],
      });

      expect(emitted).toHaveLength(6);
      for (const { table, sql, params } of emitted) {
        expect(sql).not.toContain('brien');
        expect(scopes(sql, params)).toEqual([
          { projectIds: ['p-1'], branches: withLegacySca(table, ["o'brien"]) },
        ]);
      }
    });

    // The list summed every branch a project was ever scanned on: a release
    // pipeline that scans its container image on each tag push stores every
    // tag as a branch, so the count disagreed with a CybeRisk scoped on main.
    // The list now counts the branches
    // the CybeRisk is scoped on (scopingBranchesFor), never all of them.
    it('counts a project without a reference branch on its git default branch only', async () => {
      await service.getBatchVulnerabilitiesCount({
        projectIds: ['p-1'],
        referenceBranches: [
          { projectId: 'p-1', referenceBranch: '', defaultBranch: 'develop' },
        ],
      });

      expect(emitted).toHaveLength(6);
      for (const { table, sql, params } of emitted) {
        expect(scopes(sql, params)).toEqual([
          { projectIds: ['p-1'], branches: withLegacySca(table, ['develop']) },
        ]);
      }
    });

    it('falls back to main and master, never every branch, when no branch is known', async () => {
      await service.getBatchVulnerabilitiesCount({ projectIds: ['p-1'] });

      expect(emitted).toHaveLength(6);
      for (const { table, sql, params } of emitted) {
        expect(scopes(sql, params)).toEqual([
          {
            projectIds: ['p-1'],
            branches: withLegacySca(table, ['main', 'master']),
          },
        ]);
      }
    });

    it('lets a configured reference branch win over the git default', async () => {
      await service.getBatchVulnerabilitiesCount({
        projectIds: ['p-1'],
        referenceBranches: [
          {
            projectId: 'p-1',
            referenceBranch: 'release',
            defaultBranch: 'main',
          },
        ],
      });

      for (const { table, sql, params } of emitted) {
        expect(scopes(sql, params)).toEqual([
          { projectIds: ['p-1'], branches: withLegacySca(table, ['release']) },
        ]);
      }
    });

    it('asks one condition per set of branches, not one per project', async () => {
      await service.getBatchVulnerabilitiesCount({
        projectIds: ['p-1', 'p-2', 'p-3'],
        referenceBranches: [
          { projectId: 'p-1', referenceBranch: '', defaultBranch: 'main' },
          { projectId: 'p-2', referenceBranch: 'main', defaultBranch: 'dev' },
        ],
      });

      for (const { table, sql, params } of emitted) {
        expect(scopes(sql, params)).toEqual([
          {
            projectIds: ['p-1', 'p-2'],
            branches: withLegacySca(table, ['main']),
          },
          {
            projectIds: ['p-3'],
            branches: withLegacySca(table, ['main', 'master']),
          },
        ]);
      }
    });
  });

  describe('getVulnerabilitiesCount (single-project severity counts)', () => {
    // Each detection repo's query builder yields table-specific grouped rows
    // via getRawMany — one row per (effective severity, count). The optimized
    // path must derive every per-type and total count from a single grouped
    // query per table, NOT a per-severity COUNT fan-out (4 queries × 6 tables).
    const stubGroupedCounts = (
      rowsByToken: Array<[unknown, Array<{ severity: string; count: string }>]>,
    ) => {
      const map = new Map<unknown, Array<{ severity: string; count: string }>>(
        rowsByToken,
      );
      const tokens = [
        SastVulnerabilityDetections,
        IacVulnerabilityDetections,
        CicdVulnerabilityDetections,
        SecretVulnerabilityDetections,
        ScaVulnerabilityDetections,
        VulnerabilityDetectionsContainer,
      ];
      for (const token of tokens) {
        const repo: any = module.get(getRepositoryToken(token));
        const rows = map.get(token) ?? [];
        repo.createQueryBuilder = jest.fn(() => {
          const qb: any = {};
          for (const m of [
            'select',
            'addSelect',
            'where',
            'andWhere',
            'groupBy',
            'addGroupBy',
          ]) {
            qb[m] = jest.fn().mockReturnValue(qb);
          }
          qb.getRawMany = jest.fn().mockResolvedValue(rows);
          // Legacy per-severity COUNT path — must no longer be exercised.
          qb.getCount = jest.fn().mockResolvedValue(0);
          return qb;
        });
      }
    };

    beforeEach(() => {
      (service as any).scanServiceClient = {
        getLastScanStatus: jest
          .fn()
          .mockReturnValue(of({ createAt: '2026-01-01T00:00:00.000Z' })),
      };
    });

    it('sums per-severity totals across all six scanner types from grouped rows', async () => {
      stubGroupedCounts([
        [
          SastVulnerabilityDetections,
          [
            { severity: 'critical', count: '2' },
            { severity: 'high', count: '3' },
          ],
        ],
        [
          IacVulnerabilityDetections,
          [
            { severity: 'high', count: '1' },
            { severity: 'medium', count: '4' },
          ],
        ],
        [
          ScaVulnerabilityDetections,
          [
            { severity: 'critical', count: '5' },
            { severity: 'low', count: '7' },
          ],
        ],
      ]);

      const res = await service.getVulnerabilitiesCount({
        projectId: 'p1',
      } as any);

      expect(res.critical).toBe(7); // 2 SAST + 5 SCA
      expect(res.high).toBe(4); // 3 SAST + 1 IaC
      expect(res.medium).toBe(4); // 4 IaC
      expect(res.low).toBe(7); // 7 SCA
    });

    it('reports the per-type severity breakdown and ignores non-displayable bands', async () => {
      stubGroupedCounts([
        [
          SastVulnerabilityDetections,
          [
            { severity: 'critical', count: '2' },
            { severity: 'high', count: '3' },
            // 'none' band must be ignored, never folded into a displayable total.
            { severity: 'none', count: '9' },
          ],
        ],
        [
          ScaVulnerabilityDetections,
          [
            { severity: 'critical', count: '5' },
            { severity: 'low', count: '7' },
          ],
        ],
      ]);

      const res = await service.getVulnerabilitiesCount({
        projectId: 'p1',
      } as any);

      const byType = Object.fromEntries(res.analyses.map((a) => [a.type, a]));
      expect(byType.sast).toMatchObject({
        critical: 2,
        high: 3,
        medium: 0,
        low: 0,
      });
      expect(byType.sca).toMatchObject({
        critical: 5,
        high: 0,
        medium: 0,
        low: 7,
      });
      expect(byType.iac).toMatchObject({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
      // The 'none' band on SAST must not leak into any total.
      expect(res.critical).toBe(7);
      expect(res.high).toBe(3);
    });

    it('logs the underlying error server-side and rethrows a generic RpcException when a query fails', async () => {
      stubGroupedCounts([]); // all six tables resolve empty…
      const boom = new Error(
        "ER_BAD_FIELD_ERROR: Unknown column 'd.cvss4_environmental_score' in 'field list'",
      );
      // …except SAST, whose aggregation rejects.
      const sastRepo: any = module.get(
        getRepositoryToken(SastVulnerabilityDetections),
      );
      sastRepo.createQueryBuilder = jest.fn(() => {
        const qb: any = {};
        for (const m of [
          'select',
          'addSelect',
          'where',
          'andWhere',
          'groupBy',
          'addGroupBy',
        ]) {
          qb[m] = jest.fn().mockReturnValue(qb);
        }
        qb.getRawMany = jest.fn().mockRejectedValue(boom);
        return qb;
      });

      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      // Client still gets the opaque message…
      await expect(
        service.getVulnerabilitiesCount({ projectId: 'p1' } as any),
      ).rejects.toBeInstanceOf(RpcException);

      // …but the real cause is logged server-side for diagnosis.
      expect(errorSpy).toHaveBeenCalled();
      const loggedTheCause = errorSpy.mock.calls.some((call) =>
        call.some(
          (arg) => typeof arg === 'string' && arg.includes('Unknown column'),
        ),
      );
      expect(loggedTheCause).toBe(true);

      errorSpy.mockRestore();
    });
  });

  // Global-management's ProjectService/Get only keeps the
  // persisted CybeRisk score and the detected languages. This RPC serves those
  // two fields without the six severity GROUP BY nor the security-scanning
  // GetLastScanStatus call that GetVulnerabilitiesCount ran for them.
  describe('getProjectRiskSummary', () => {
    const codeTables = [
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      CicdVulnerabilityDetections,
      SecretVulnerabilityDetections,
    ];
    const languagesByTable = new Map<unknown, Array<{ language: string }>>([
      [
        SastVulnerabilityDetections,
        [{ language: 'Python' }, { language: 'Go' }],
      ],
      [IacVulnerabilityDetections, [{ language: 'Terraform' }]],
      [CicdVulnerabilityDetections, []],
      [SecretVulnerabilityDetections, [{ language: 'Python' }]],
    ]);
    // Every SELECT expression and GROUP BY each repo was asked for.
    let selects: Map<unknown, string[]>;
    let getLastScanStatus: jest.Mock;

    beforeEach(() => {
      selects = new Map();
      for (const token of [
        ...codeTables,
        ScaVulnerabilityDetections,
        VulnerabilityDetectionsContainer,
      ]) {
        const repo: any = module.get(getRepositoryToken(token));
        selects.set(token, []);
        repo.createQueryBuilder = jest.fn(() => {
          const qb: any = {};
          const record =
            (m: string) =>
            (...args: unknown[]) => {
              selects.get(token).push(`${m}:${String(args[0])}`);
              return qb;
            };
          for (const m of [
            'select',
            'addSelect',
            'groupBy',
            'addGroupBy',
            'where',
            'andWhere',
          ]) {
            qb[m] = jest.fn(record(m));
          }
          qb.getRawMany = jest
            .fn()
            .mockResolvedValue(languagesByTable.get(token) ?? []);
          return qb;
        });
      }
      getLastScanStatus = jest.fn().mockReturnValue(of({ createAt: 'x' }));
      (service as any).scanServiceClient = { getLastScanStatus };
    });

    it('returns the persisted score and the languages without counting severities nor calling security-scanning', async () => {
      cyberRiskRepo.findByProjectId.mockResolvedValue({
        score: 42,
        level: 'high',
        computedAt: new Date('2026-10-01T00:00:00.000Z'),
      });

      const res = await service.getProjectRiskSummary({ projectId: 'p1' });

      expect(res).toEqual({
        projectId: 'p1',
        cyberRisk: {
          score: 42,
          level: 'high',
          computedAt: '2026-10-01T00:00:00.000Z',
        },
        detectedLanguages: ['Go', 'Python', 'Terraform'],
      });
      expect(cyberRiskRepo.findByProjectId).toHaveBeenCalledWith('p1');
      expect(getLastScanStatus).not.toHaveBeenCalled();
      // No severity count at all: SCA and container (no language column) are
      // never queried, and the code tables only select their language.
      expect(selects.get(ScaVulnerabilityDetections)).toEqual([]);
      expect(selects.get(VulnerabilityDetectionsContainer)).toEqual([]);
      for (const token of codeTables) {
        const issued = selects.get(token);
        expect(issued).toContain('select:d.language');
        expect(issued).toContain('groupBy:d.language');
        expect(issued.join(' ')).not.toMatch(/COUNT|severity|cvss/i);
      }
      // A persisted row needs no backfill.
      expect(enqueuer.enqueue).not.toHaveBeenCalled();
    });

    it('keeps the backfill: a project without a persisted score enqueues one', async () => {
      cyberRiskRepo.findByProjectId.mockResolvedValue(null);

      const res = await service.getProjectRiskSummary({ projectId: 'p1' });

      expect(enqueuer.enqueue).toHaveBeenCalledWith('p1', 'backfill');
      expect(res.cyberRisk.score).toBe(0);
      expect(res.detectedLanguages).toEqual(['Go', 'Python', 'Terraform']);
    });

    it('answers the same score and languages as GetVulnerabilitiesCount', async () => {
      cyberRiskRepo.findByProjectId.mockResolvedValue({
        score: 7,
        level: 'medium',
        computedAt: new Date('2026-10-02T00:00:00.000Z'),
      });

      const summary = await service.getProjectRiskSummary({ projectId: 'p1' });
      const counts = await service.getVulnerabilitiesCount({
        projectId: 'p1',
      } as any);

      expect(summary.cyberRisk).toEqual(counts.cyberRisk);
      expect(summary.detectedLanguages).toEqual(counts.detectedLanguages);
    });

    it('rejects a request without projectId', async () => {
      await expect(
        service.getProjectRiskSummary({ projectId: '' }),
      ).rejects.toMatchObject({
        error: expect.objectContaining({
          code: grpcStatus.INVALID_ARGUMENT,
        }),
      });
    });
  });

  // The tab counters and the project overview, read through
  // the SQL TypeORM really emits (metadata built, never connected). Every
  // round-trip a repository makes is recorded; its answer is a promise the
  // test controls.
  describe('round-trips of the counters and the overview', () => {
    type Answer = unknown | ((sql: string) => unknown);
    interface Emitted {
      kind: string;
      sql: string;
      params: unknown[];
    }
    let sqlSource: DataSource;
    let emitted: Emitted[];
    let answer: (e: Emitted) => Promise<unknown>;

    const TOKENS = [
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      CicdVulnerabilityDetections,
      SecretVulnerabilityDetections,
      ScaVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
    ];
    const DEFAULTS: Record<string, Answer> = {
      getCount: 0,
      getRawMany: [],
      getRawOne: undefined,
      getMany: [],
      query: [],
    };

    beforeAll(async () => {
      sqlSource = new DataSource({
        type: 'mysql',
        database: 'unused',
        entities: [join(__dirname, '../../**/*.entity.ts')],
      });
      await (
        sqlSource as unknown as { buildMetadatas(): Promise<void> }
      ).buildMetadatas();
    });

    beforeEach(() => {
      emitted = [];
      answer = (e) => {
        const a = DEFAULTS[e.kind];
        return Promise.resolve(typeof a === 'function' ? a(e.sql) : a);
      };
      for (const token of TOKENS) {
        const repo: any = module.get(getRepositoryToken(token));
        repo.createQueryBuilder = (alias: string) => {
          const qb: any = sqlSource
            .getRepository(token)
            .createQueryBuilder(alias);
          for (const kind of [
            'getCount',
            'getRawMany',
            'getRawOne',
            'getMany',
          ]) {
            qb[kind] = () => {
              const [sql, params] = qb.getQueryAndParameters();
              const e = { kind, sql, params };
              emitted.push(e);
              return answer(e);
            };
          }
          return qb;
        };
        repo.query = (sql: string, params: unknown[] = []) => {
          const e = { kind: 'query', sql, params };
          emitted.push(e);
          return answer(e);
        };
      }
    });

    describe('getCountVulnerabilitiesCountByType', () => {
      // B5: `pkg.projectId` made MySQL scan the whole SCA table (every tenant)
      // or every package of the project; `sca.projectId` is the leading column
      // of IDX_vd_sca_proj_state. The INNER JOIN stays: it keeps out the
      // detections whose package is gone, as the SCA list does.
      it('filters the SCA count on sca.projectId, keeps the INNER JOIN on its package, and never filters on pkg.projectId', async () => {
        await service.getCountVulnerabilitiesCountByType('p1', 'main', [
          'main',
          '',
        ]);

        const sca = emitted.filter((e) =>
          e.sql.includes('`vulnerability_detections_sca`'),
        );
        expect(sca.length).toBeGreaterThan(0);
        const scaSql = sca.map((e) => e.sql).join('\n');
        expect(scaSql).toContain('`sca`.`projectId` = ?');
        expect(scaSql).toMatch(
          /INNER JOIN `sca_detected_packages` `pkg` ON `pkg`.`id`\s*=\s*`sca`.`scaDetectedPackageId`/,
        );
        expect(emitted.map((e) => e.sql).join('\n')).not.toContain(
          '`pkg`.`projectId`',
        );
      });

      // B7: six COUNTs awaited one after the other. They are now one UNION
      // ALL, in parallel with the AI-BOM count (another table, another
      // service, which swallows its own errors).
      it('reads the six tables in one UNION ALL round-trip, in parallel with the AI-BOM count', async () => {
        const aibom: any = module.get(AIBOM_INVENTORY);
        let releaseAibom: (n: number) => void = () => undefined;
        aibom.countMergedComponents.mockReturnValueOnce(
          new Promise<number>((resolve) => (releaseAibom = resolve)),
        );
        let releaseUnion: (rows: unknown[]) => void = () => undefined;
        answer = () =>
          new Promise((resolve) => (releaseUnion = resolve as never));

        const pending = service.getCountVulnerabilitiesCountByType(
          'p1',
          'main',
          ['main', ''],
        );
        await new Promise((r) => setImmediate(r));

        // Both round-trips are in flight before either answered.
        expect(emitted).toHaveLength(1);
        expect(aibom.countMergedComponents).toHaveBeenCalledWith('p1', 'main');
        const [union] = emitted;
        expect(union.kind).toBe('query');
        expect(union.sql.match(/UNION ALL/g)).toHaveLength(5);
        for (const table of [
          'vulnerability_detections_sast',
          'vulnerability_detections_iac',
          'vulnerability_detections_cicd',
          'vulnerability_detections_secret',
          'vulnerability_detections_sca',
          'vulnerability_detections_container',
        ]) {
          expect(union.sql).toContain(`\`${table}\``);
        }
        // Every bound value travels as a parameter, in placeholder order.
        expect(union.params).toHaveLength(
          (union.sql.match(/\?/g) ?? []).length,
        );

        releaseUnion([
          { type: 'sast', count: '3' },
          { type: 'iac', count: 4 },
          { type: 'cicd', count: '0' },
          { type: 'secret', count: '7' },
          { type: 'sca', count: '11' },
          { type: 'container', count: '2' },
        ]);
        releaseAibom(5);
        await expect(pending).resolves.toEqual({
          sast: 3,
          iac: 4,
          cicd: 0,
          secret: 7,
          sca: 11,
          container: 2,
          aibom: 5,
        });
      });

      it('keeps every per-type filter inside its own part of the UNION ALL', async () => {
        await service.getCountVulnerabilitiesCountByType('p1', 'main', [
          'main',
          '',
        ]);

        const [union] = emitted;
        const parts = union.sql.split(' UNION ALL ');
        expect(parts).toHaveLength(6);
        let offset = 0;
        for (const part of parts) {
          const count = (part.match(/\?/g) ?? []).length;
          const params = union.params.slice(offset, offset + count);
          offset += count;
          // project, two active states, four displayable bands...
          expect(params.slice(0, 7)).toEqual([
            'p1',
            'to_verify',
            'confirmed',
            'critical',
            'high',
            'medium',
            'low',
          ]);
          if (part.includes('`vulnerability_detections_sca`')) {
            // ...malware out, then the SCA partition.
            expect(part).toContain('`sca`.`is_malware` = ?');
            expect(params.slice(7)).toEqual([false, 'main', '']);
          } else {
            expect(params.slice(7)).toEqual(['main']);
          }
        }
      });
    });

    describe('getAutofixCountByType', () => {
      const TABLES = [
        'vulnerability_detections_sast',
        'vulnerability_detections_iac',
        'vulnerability_detections_cicd',
        'vulnerability_detections_secret',
        'vulnerability_detections_sca',
      ];

      // Ten COUNTs (with / without autofix per table) awaited one
      // after the other. Now one COUNT(*) + SUM(EXISTS(...)) per table, the
      // five in parallel: "without" is the active total minus "with".
      it('runs at most 5 queries, all emitted before the first one answers', async () => {
        const pending: Array<(row: unknown) => void> = [];
        answer = () => new Promise((resolve) => pending.push(resolve as never));

        const counting = service.getAutofixCountByType('p1', 'main', [
          'main',
          '',
        ]);
        await new Promise((r) => setImmediate(r));

        expect(emitted).toHaveLength(5);
        expect(pending).toHaveLength(5);
        for (const table of TABLES) {
          expect(
            emitted.filter((e) => e.sql.includes(`\`${table}\``)),
          ).toHaveLength(1);
        }
        for (const e of emitted) {
          expect(e.sql).toMatch(/COUNT\(\*\)/);
          expect(e.sql).toMatch(/SUM\(EXISTS \(SELECT 1 FROM/);
          expect(e.sql).not.toMatch(/NOT EXISTS/);
        }

        const rows = [
          { total: '10', withAutofix: '4' },
          { total: 3, withAutofix: 3 },
          { total: '0', withAutofix: null },
          { total: '7', withAutofix: '0' },
          { total: '12', withAutofix: '5' },
        ];
        const byTable = TABLES.map((t) =>
          emitted.findIndex((e) => e.sql.includes(`\`${t}\``)),
        );
        byTable.forEach((index, i) => pending[index](rows[i]));

        await expect(counting).resolves.toEqual({
          sast: { withAutofix: 4, withoutAutofix: 6 },
          iac: { withAutofix: 3, withoutAutofix: 0 },
          cicd: { withAutofix: 0, withoutAutofix: 0 },
          secret: { withAutofix: 0, withoutAutofix: 7 },
          sca: { withAutofix: 5, withoutAutofix: 7 },
        });
      });

      it('counts SCA on v.projectId with the INNER JOIN kept and the package branch partition, and the others on v.projectId', async () => {
        await service.getAutofixCountByType('p1', 'main', ['main', '']);

        const all = emitted.map((e) => e.sql).join('\n');
        expect(all).not.toContain('`pkg`.`projectId`');
        for (const e of emitted) {
          expect(e.sql).toContain('`v`.`projectId` = ?');
          expect(e.params[0]).toBe('p1');
        }
        const [sca] = emitted.filter((e) =>
          e.sql.includes('`vulnerability_detections_sca`'),
        );
        expect(sca.sql).toMatch(
          /INNER JOIN `sca_detected_packages` `pkg` ON `pkg`.`id`\s*=\s*`v`.`scaDetectedPackageId`/,
        );
        expect(sca.sql).toContain('`pkg`.`branch` IN (?, ?)');
        expect(sca.sql).toContain('sar.hasFixAvailable = 1');
        expect(sca.params.slice(-2)).toEqual(['main', '']);
        const sast = emitted.find((e) =>
          e.sql.includes('`vulnerability_detections_sast`'),
        );
        expect(sast.sql).toContain('`v`.`branch` = ?');
        expect(sast.params.slice(-1)).toEqual(['main']);
      });

      it('still answers zeros when a count fails', async () => {
        answer = () => Promise.reject(new Error('Lock wait timeout'));
        const warn = jest.spyOn(console, 'warn').mockImplementation();

        await expect(
          service.getAutofixCountByType('p1', 'main', ['main', '']),
        ).resolves.toEqual({
          sast: { withAutofix: 0, withoutAutofix: 0 },
          iac: { withAutofix: 0, withoutAutofix: 0 },
          cicd: { withAutofix: 0, withoutAutofix: 0 },
          secret: { withAutofix: 0, withoutAutofix: 0 },
          sca: { withAutofix: 0, withoutAutofix: 0 },
        });
        warn.mockRestore();
      });
    });

    describe('getProjectOverview', () => {
      const TABLES: Array<[string, string]> = [
        ['SAST', 'vulnerability_detections_sast'],
        ['IAC', 'vulnerability_detections_iac'],
        ['SCA', 'vulnerability_detections_sca'],
        ['CONTAINER', 'vulnerability_detections_container'],
        ['CICD', 'vulnerability_detections_cicd'],
        ['SECRET', 'vulnerability_detections_secret'],
      ];
      const overview = (branches: string[] = []) =>
        service.getProjectOverview({ projectId: 'p1', branches } as any);
      const groupBys = () => emitted.filter((e) => e.kind === 'getRawMany');
      const unions = () => emitted.filter((e) => e.kind === 'query');

      // B6: 24 queries awaited one after the other (6 severity GROUP BYs, 6
      // state GROUP BYs, 6 COUNTs, 12 over-time series), then the score.
      it('runs at most 8 queries: one GROUP BY (severity, state) per table, one UNION ALL of the 12 series, the score row', async () => {
        await overview();

        expect(groupBys()).toHaveLength(6);
        expect(unions()).toHaveLength(1);
        expect(emitted).toHaveLength(7);
        expect(cyberRiskRepo.findByProjectId).toHaveBeenCalledTimes(1);
        for (const [, table] of TABLES) {
          const [one] = groupBys().filter((e) =>
            e.sql.includes(`\`${table}\``),
          );
          expect(one.sql).toMatch(
            /GROUP BY \(CASE .*\), `\w+`\.`currentState`/,
          );
        }
        expect(unions()[0].sql.match(/UNION ALL/g)).toHaveLength(11);
      });

      it('keeps at most 6 queries in flight (the pool has 20 connections)', async () => {
        const pending: Array<() => void> = [];
        let inFlight = 0;
        let peak = 0;
        const hold = (value: unknown) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          return new Promise((resolve) =>
            pending.push(() => {
              inFlight -= 1;
              resolve(value);
            }),
          );
        };
        answer = (e) => hold(e.kind === 'query' ? [] : []);
        cyberRiskRepo.findByProjectId.mockImplementation(() => hold(null));

        const running = overview();
        let issued = 0;
        for (let round = 0; round < 20 && pending.length; round += 1) {
          await new Promise((r) => setImmediate(r));
          issued =
            emitted.length + cyberRiskRepo.findByProjectId.mock.calls.length;
          expect(inFlight).toBeLessThanOrEqual(6);
          pending.shift()!();
        }
        await running;

        expect(issued).toBe(8);
        expect(peak).toBe(6);
      });

      it('derives the severity, state and analysis-type totals from the GROUP BY rows', async () => {
        const rowsByTable: Record<string, unknown[]> = {
          vulnerability_detections_sast: [
            {
              severity: 'high',
              state: 'to_verify',
              count: '3',
              activeCount: '3',
            },
            {
              severity: null,
              state: 'confirmed',
              count: '2',
              activeCount: '2',
            },
            {
              severity: 'low',
              state: 'resolved',
              count: '4',
              activeCount: '0',
            },
          ],
          vulnerability_detections_sca: [
            { severity: 'high', state: 'confirmed', count: 1, activeCount: 1 },
            {
              severity: 'critical',
              state: 'ignored',
              count: '6',
              activeCount: '0',
            },
          ],
        };
        answer = (e) =>
          Promise.resolve(
            e.kind === 'getRawMany'
              ? (Object.entries(rowsByTable).find(([table]) =>
                  e.sql.includes(`\`${table}\``),
                )?.[1] ?? [])
              : [],
          );

        const res = await overview();

        // Only active rows reach the severity bands; a NULL band is NONE.
        expect(res.totalBySeverity).toEqual([
          { severity: 'HIGH', count: 4 },
          { severity: 'NONE', count: 2 },
        ]);
        // Every state counts, active or not.
        expect(res.totalByState).toEqual([
          { state: 'to_verify', count: 3 },
          { state: 'confirmed', count: 3 },
          { state: 'resolved', count: 4 },
          { state: 'ignored', count: 6 },
        ]);
        expect(res.totalByAnalysisType).toEqual([
          { analysisType: 'SAST', count: 5 },
          { analysisType: 'IAC', count: 0 },
          { analysisType: 'SCA', count: 1 },
          { analysisType: 'CONTAINER', count: 0 },
          { analysisType: 'CICD', count: 0 },
          { analysisType: 'SECRET', count: 0 },
        ]);
        const sum = (rows: Array<{ count: number }>) =>
          rows.reduce((total, row) => total + row.count, 0);
        expect(sum(res.totalByAnalysisType)).toBe(sum(res.totalBySeverity));
      });

      // The severity and analysis-type totals count the active states
      // only. The GROUP BY reads every state (the state totals need them) and
      // marks the active rows with the same IN list the old WHERE used.
      it('marks the active rows with to_verify / confirmed only, and never filters with NOT IN', async () => {
        await overview();

        for (const e of groupBys()) {
          expect(e.sql).toMatch(
            /SUM\(CASE WHEN `\w+`\.`currentState` IN \(\?, \?\) THEN 1 ELSE 0 END\)/,
          );
          expect(e.params).toEqual(['to_verify', 'confirmed', 'p1']);
          const where = e.sql.split(' WHERE ')[1].split(' GROUP BY ')[0];
          expect(where).not.toMatch(/currentState/);
        }
        expect(emitted.map((e) => e.sql).join('\n')).not.toMatch(/NOT IN/);
      });

      // The trend is what was open at the end of each day: a
      // created series over every state, minus a closed series dated by
      // resolved_at / triaged_at (update date fallback).
      it('unions six created series over every state and six closed series dated by their closing', async () => {
        await overview();

        const parts = unions()[0].sql.split(' UNION ALL ');
        const created = parts.filter((p) => p.includes("'created' AS"));
        const closed = parts.filter((p) => p.includes("'closed' AS"));
        expect(created).toHaveLength(6);
        expect(closed).toHaveLength(6);
        for (const part of created) {
          expect(part).toMatch(/DATE_FORMAT\(`\w+`\.`createdAt`/);
          expect(part).not.toMatch(/currentState/);
        }
        for (const part of closed) {
          expect(part).toMatch(
            /COALESCE\(`\w+`\.`resolved_at`, `\w+`\.`triaged_at`, `\w+`\.`updat(e|ed)At`\)/,
          );
          expect(part).toMatch(/`currentState` IN \(\?, \?, \?\)/);
        }
        expect(unions()[0].params.filter((v) => v === 'resolved')).toHaveLength(
          6,
        );
      });

      it('builds the trend with the open-at-each-date accumulator from the tagged rows', async () => {
        const openSpy = jest.spyOn(overTimeUtil, 'accumulateOpenOverTime');
        const rows = [
          {
            action: 'created',
            date: '2026-07-01',
            severity: 'high',
            count: '2',
          },
          {
            action: 'closed',
            date: '2026-07-03',
            severity: 'high',
            count: '1',
          },
        ];
        answer = (e) => Promise.resolve(e.kind === 'query' ? rows : []);

        await overview();

        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(openSpy.mock.calls[0][0]).toEqual(rows);
        openSpy.mockRestore();
      });

      // only_full_group_by (on in production): every ORDER BY column must be in
      // the GROUP BY. The parts group by the env-derived band and carry no
      // ORDER BY (the accumulator sorts the dates itself).
      it('groups by the env-derived band and never orders by the raw currentSeverity column', async () => {
        await overview();

        const parts = [
          ...groupBys().map((e) => e.sql),
          ...unions()[0].sql.split(' UNION ALL '),
        ];
        expect(parts).toHaveLength(18);
        for (const part of parts) {
          expect(part).not.toMatch(/ORDER BY/);
          const groupBy = part.split(' GROUP BY ')[1];
          expect(groupBy).toContain('(CASE WHEN COALESCE(`');
        }
      });

      it('scopes every query to the requested branches', async () => {
        await overview(['main', ' feat ', '']);

        for (const e of groupBys()) {
          expect(e.sql).toContain('`branch` IN (?, ?)');
          expect(e.params.slice(-2)).toEqual(['main', 'feat']);
        }
        const parts = unions()[0].sql.split(' UNION ALL ');
        for (const part of parts) {
          expect(part).toContain('`branch` IN (?, ?)');
        }
      });
    });

    // B5, same predicate in the project-list pills and the organisation
    // totals: the SCA counts filter and group on the detection's own
    // projectId (and branch), the INNER JOIN on the package kept.
    describe('project-list and organisation SCA counts', () => {
      const scaQueries = () =>
        emitted.filter((e) => e.sql.includes('`vulnerability_detections_sca`'));

      it('getBatchVulnerabilitiesCount counts SCA on sca.projectId / sca.branch, with and without a reference branch', async () => {
        (service as any).scanServiceClient = {
          getBatchLastScans: jest.fn().mockReturnValue(of({ scans: [] })),
        };

        await service.getBatchVulnerabilitiesCount({
          projectIds: ['p-1', 'p-2'],
          referenceBranches: [{ projectId: 'p-2', referenceBranch: 'release' }],
        });

        // One query: each project is counted on the branches its CybeRisk is
        // scoped on, p-2 on its reference branch, p-1 on main/master.
        const sca = scaQueries();
        expect(sca).toHaveLength(1);
        const [e] = sca;
        expect(e.sql).toMatch(
          /INNER JOIN `sca_detected_packages` `pkg` ON `pkg`.`id`\s*=\s*`sca`.`scaDetectedPackageId`/,
        );
        expect(e.sql).not.toMatch(/`pkg`\.`(projectId|branch)`/);
        expect(e.sql).toContain('`sca`.`projectId` IN (?');
        expect(e.sql).toMatch(/GROUP BY `sca`\.`projectId`/);
        expect(e.sql).toMatch(
          /\(`sca`\.`projectId` IN \([^)]*\) AND `sca`\.`branch` IN \([^)]*\)\)/,
        );
        expect(e.params).toContain('release');
      });

      it('getTotalIssuesProjects counts SCA on v.projectId', async () => {
        await service.getTotalIssuesProjects(['p-1', 'p-2']);

        const [sca] = scaQueries();
        expect(sca.sql).toMatch(
          /INNER JOIN `sca_detected_packages` `pkg` ON `pkg`.`id`\s*=\s*`v`.`scaDetectedPackageId`/,
        );
        expect(sca.sql).toContain('`v`.`projectId` IN (?, ?)');
        expect(sca.sql).not.toContain('`pkg`.`projectId`');
      });
    });
  });
});
