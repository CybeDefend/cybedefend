/**
 * Unit tests for the `language` (multi-value) and `sourcePath` (contains)
 * filters across the SAST / IAC / CICD / Secret list endpoints. The
 * language facet is now embedded in the list responses (the dedicated
 * `getProjectVulnerabilityLanguages` endpoint was removed).
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

describe('SastIacService – language & sourcePath filters', () => {
  let service: SastIacService;
  let sastRepoMock: any;
  let iacRepoMock: any;
  let cicdRepoMock: any;
  let secretRepoMock: any;

  function buildQbMock() {
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
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

  const listMethods: Array<{
    name: string;
    call: (req: any) => Promise<any>;
    repo: () => any;
  }> = [
    {
      name: 'getProjectSastVulnerabilities',
      call: (req) => service.getProjectSastVulnerabilities(req),
      repo: () => sastRepoMock,
    },
    {
      name: 'getProjectIacVulnerabilities',
      call: (req) => service.getProjectIacVulnerabilities(req),
      repo: () => iacRepoMock,
    },
    {
      name: 'getProjectCicdVulnerabilities',
      call: (req) => service.getProjectCicdVulnerabilities(req),
      repo: () => cicdRepoMock,
    },
    {
      name: 'getProjectSecretVulnerabilities',
      call: (req) => service.getProjectSecretVulnerabilities(req),
      repo: () => secretRepoMock,
    },
  ];

  describe.each(listMethods)('$name', ({ call, repo }) => {
    it('filters by language with an IN clause when languages are provided', async () => {
      const qb = buildQbMock();
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      await call({ projectId: 'p1', language: ['python', 'java'] });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('vulnDetection.language IN (:...languages)'),
        expect.objectContaining({ languages: ['python', 'java'] }),
      );
    });

    it('does not filter by language when the array is empty or absent', async () => {
      const qb = buildQbMock();
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      await call({ projectId: 'p1', language: [] });

      const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c) => c.includes('.language IN'))).toBe(false);
    });

    it('filters by sourcePath with a contains LIKE (parameterised)', async () => {
      const qb = buildQbMock();
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      await call({ projectId: 'p1', sourcePath: 'src/auth' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('vulnDetection.path LIKE :sourcePath'),
        expect.objectContaining({ sourcePath: '%src/auth%' }),
      );
    });

    it('does not filter by sourcePath when absent', async () => {
      const qb = buildQbMock();
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      await call({ projectId: 'p1' });

      const calls: string[] = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c) => c.includes('.path LIKE'))).toBe(false);
    });

    it('Search matches the vulnerability name OR the source path', async () => {
      const qb = buildQbMock();
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      await call({ projectId: 'p1', searchQuery: 'auth' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringMatching(
          /vulnerability\.name LIKE :searchTerm OR vulnDetection\.path LIKE :searchTerm/,
        ),
        expect.objectContaining({ searchTerm: '%auth%' }),
      );
    });

    it('Embeds the distinct languages facet in the list response', async () => {
      const qb = buildQbMock();
      qb.getRawMany.mockResolvedValue([
        { language: 'go' },
        { language: 'ruby' },
      ]);
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      const res = await call({ projectId: 'p1' });

      expect(res.languages).toEqual(['go', 'ruby']);
    });

    it('A languages-facet failure degrades to [] instead of failing the whole list', async () => {
      const qb = buildQbMock();
      qb.getRawMany.mockRejectedValue(new Error('db down'));
      repo().createQueryBuilder = jest.fn().mockReturnValue(qb);

      const res = await call({ projectId: 'p1' });

      expect(res.languages).toEqual([]);
    });
  });
});
