/**
 * Unit tests for getProjectSecretVulnerabilities filter logic.
 * Focuses on the two new optional filters added in Task 1.6:
 *   - commitSha  → LIKE prefix match
 *   - source     → equality match ("head" | "history")
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
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { Logger } from 'nestjs-pino';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

describe('SastIacService.getProjectSecretVulnerabilities – commitSha/source filters', () => {
  let service: SastIacService;

  let secretRepoMock: any;

  /** Builds a minimal chainable QueryBuilder mock */
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

  /** Stubs the downstream gRPC calls used after the DB query (must return RxJS Observables) */
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
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
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

  it('applies commitSha prefix filter when commitSha is provided', async () => {
    const qb = buildQbMock();
    secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectSecretVulnerabilities({
      projectId: 'p1',
      commitSha: 'abc123',
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'vulnDetection.commitSha LIKE :commitShaPrefix',
      { commitShaPrefix: 'abc123%' },
    );
  });

  it('applies source equality filter when source is "head"', async () => {
    const qb = buildQbMock();
    secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectSecretVulnerabilities({
      projectId: 'p1',
      source: 'head',
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('vulnDetection.source = :source', {
      source: 'head',
    });
  });

  it('applies source equality filter when source is "history"', async () => {
    const qb = buildQbMock();
    secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectSecretVulnerabilities({
      projectId: 'p1',
      source: 'history',
    } as any);

    expect(qb.andWhere).toHaveBeenCalledWith('vulnDetection.source = :source', {
      source: 'history',
    });
  });

  it('does not add commitSha filter when commitSha is absent', async () => {
    const qb = buildQbMock();
    secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectSecretVulnerabilities({
      projectId: 'p1',
    } as any);

    const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.includes('commitSha'))).toBe(false);
  });

  it('does not add source filter when source is absent', async () => {
    const qb = buildQbMock();
    secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectSecretVulnerabilities({
      projectId: 'p1',
    } as any);

    const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.includes('source'))).toBe(false);
  });

  it('ignores an invalid source value (not "head" or "history")', async () => {
    const qb = buildQbMock();
    secretRepoMock.createQueryBuilder = jest.fn().mockReturnValue(qb);

    await service.getProjectSecretVulnerabilities({
      projectId: 'p1',
      source: 'unknown_value',
    } as any);

    const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c) => c.includes('source'))).toBe(false);
  });
});
