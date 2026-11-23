// The Community Edition binds neither ADVISORY_MATCHER nor
// DETECTION_ENRICHERS (only ee supplies them): a scanner batch still stores
// its packages, and matches nothing.
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { ScaService } from './sca.service';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  createQueryBuilderMock,
  MockType,
} from '../../test-utils/typeorm-mock.util';

describe('ScaService without advisory tokens', () => {
  it('stores the packages and no detection when no matcher is bound', async () => {
    const scaDetectedRepo: MockType<any> = createMockRepository();
    const scaVulnRepo: MockType<any> = createMockRepository();
    const vulnHistoryRepo: MockType<any> = createMockRepository();
    const historyRepo: MockType<any> = createMockRepository();
    const packageUpsert = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      updateEntity: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        identifiers: [{ id: 'pkg-1' }],
        generatedMaps: [],
      }),
    };
    scaDetectedRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(packageUpsert);
    for (const repo of [scaVulnRepo, vulnHistoryRepo, historyRepo]) {
      repo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createQueryBuilderMock());
    }

    const module = await Test.createTestingModule({
      providers: [
        ScaService,
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: scaDetectedRepo,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: scaVulnRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: vulnHistoryRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: historyRepo },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: createMockRepository(),
        },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn().mockReturnValue(null) },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn().mockResolvedValue({}),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
            createIssuesForScan: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({
              get: jest.fn().mockReturnValue(of({ parsedBranches: [] })),
              getProjectBranches: jest
                .fn()
                .mockReturnValue(of({ branches: [] })),
            }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({
              updateScanState: jest.fn().mockReturnValue(of({})),
            }),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: getDataSourceToken(),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
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

    const service = module.get(ScaService);
    service.onModuleInit();
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.20',
      isDev: false,
      isTransitive: false,
    });
    scaVulnRepo.find!.mockResolvedValue([]);
    const handle = jest.spyOn(service as any, 'batchHandleVulnerabilities');

    const res = await service.processScaBatch({
      projectId: 'p1',
      scanId: 's1',
      packages: [
        {
          name: 'lodash',
          version: '4.17.20',
          isDev: false,
          isTransitive: false,
          file: 'package.json',
          ecosystem: 'npm',
          path: 'root',
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any);

    expect(res.message).toContain('processed successfully');
    expect(packageUpsert.execute).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
    expect(scaVulnRepo.save).not.toHaveBeenCalled();
  });
});
