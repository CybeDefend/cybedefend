/**
 * Unit tests for scoring_source filter across SAST/IAC/CICD/Secret list endpoints.
 * Filter detections by static vs. agent-produced scoring.
 */
import { of } from 'rxjs';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SastIacService } from './sast-iac.service';
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

describe('SastIacService – scoring_source filter', () => {
  let service: SastIacService;
  let sastRepoMock: any;
  let iacRepoMock: any;
  let cicdRepoMock: any;
  let secretRepoMock: any;

  function buildQbMock() {
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    return qb;
  }

  function stubGrpcClients(svc: SastIacService) {
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
    sastRepoMock = createMockRepository();
    iacRepoMock = createMockRepository();
    cicdRepoMock = createMockRepository();
    secretRepoMock = createMockRepository();

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
            getCountVulnerabilitiesCountByType: jest.fn().mockResolvedValue({
              sast: 0,
              iac: 0,
              sca: 0,
              secret: 0,
              container: 0,
              cicd: 0,
            }),
            getAutofixCountByType: jest.fn().mockResolvedValue({
              sast: 0,
              sca: 0,
            }),
          },
        },
        { provide: SastIacUtilsService, useValue: {} },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepoMock,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: iacRepoMock,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: cicdRepoMock,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: secretRepoMock,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SchedulerRegistry,
          useValue: { addInterval: jest.fn(), deleteInterval: jest.fn() },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanation: jest.fn().mockReturnValue(undefined) },
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
    stubGrpcClients(service);
  });

  describe('getProjectSastVulnerabilities', () => {
    it('filters by scoringSource when scoringSource is "agent"', async () => {
      const qb = buildQbMock();
      sastRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectSastVulnerabilities({
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
      sastRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectSastVulnerabilities({
        projectId: 'p1',
      } as any);

      const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c) => c.includes('scoringSource'))).toBe(false);
    });
  });

  describe('getProjectIacVulnerabilities', () => {
    it('filters by scoringSource when scoringSource is "static"', async () => {
      const qb = buildQbMock();
      iacRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectIacVulnerabilities({
        projectId: 'p1',
        scoringSource: 'static',
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining(
          'vulnDetection.exploitabilitySource <> :agentExploitabilitySource',
        ),
        expect.objectContaining({
          scoringSource: 'static',
          agentExploitabilitySource: 'agent',
        }),
      );
    });
  });

  describe('getProjectCicdVulnerabilities', () => {
    it('filters by scoringSource when scoringSource is "agent"', async () => {
      const qb = buildQbMock();
      cicdRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectCicdVulnerabilities({
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
  });

  describe('getProjectSecretVulnerabilities', () => {
    it('filters by scoringSource when scoringSource is "agent"', async () => {
      const qb = buildQbMock();
      secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectSecretVulnerabilities({
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
  });
});
