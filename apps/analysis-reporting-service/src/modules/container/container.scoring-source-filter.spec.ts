/**
 * Unit tests for scoring_source filter on getProjectContainerVulnerabilities.
 * Filter container detections by static vs. agent-produced scoring.
 */
import { of } from 'rxjs';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContainerService } from './container.service';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { VulnerabilityOsv } from '../../entities/osv';
import { ResultService } from '../result/result.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';

describe('ContainerService.getProjectContainerVulnerabilities – scoring_source filter', () => {
  let service: ContainerService;
  let detRepo: any;

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

  function stubGrpcClients(svc: ContainerService) {
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
    detRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: detRepo,
        },
        {
          provide: getRepositoryToken(HistoryItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityOsv),
          useValue: createMockRepository(),
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
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn() },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ContainerService);
    stubGrpcClients(service);
  });

  it('filters by scoringSource when scoringSource is "agent"', async () => {
    const qb = buildQbMock();
    detRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectContainerVulnerabilities({
      projectId: 'p1',
      scoringSource: 'agent',
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        'det.exploitabilitySource = :agentExploitabilitySource',
      ),
      expect.objectContaining({
        scoringSource: 'agent',
        agentExploitabilitySource: 'agent',
      }),
    );
  });

  it('does not filter by scoringSource when absent', async () => {
    const qb = buildQbMock();
    detRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectContainerVulnerabilities({
      projectId: 'p1',
    } as any);

    const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.includes('scoringSource'))).toBe(false);
  });
});
