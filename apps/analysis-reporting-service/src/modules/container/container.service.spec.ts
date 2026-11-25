import { GetProjectContainerVulnerabilitiesRequest } from '@grpc/analysis-reporting/result';
import * as fs from 'fs';
import * as path from 'path';
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
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { resolveEffectiveSeverity } from '../cvss/severity-from-cvss';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';
import {
  makeChainableQueryBuilder,
  makeProjectLookupHarness,
} from '../../test-utils/project-lookup.harness';

describe('ContainerService', () => {
  let service: ContainerService;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let detRepo: MockType<any>;
  let histRepo: MockType<any>;
  let osvRepo: MockType<any>;
  const resultService = {
    addHistoryItem: jest.fn(),
    recalculatePriority: jest
      .fn()
      .mockResolvedValue({ priority: 'normal', compositeScore: 0.5 }),
    computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
  } as any;
  const cvssCalculator = {
    computeCvss4Base: jest.fn().mockReturnValue({
      vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      baseScore: 9.3,
    }),
  };
  const cyberiskEnqueuer = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as any;
  const logger = createLoggerMock();

  beforeEach(async () => {
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    detRepo = createMockRepository();
    histRepo = createMockRepository();
    osvRepo = createMockRepository();
    // The advisory reads: no imported advisory, no catalogue row.
    (osvRepo as any).manager = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => makeChainableQueryBuilder()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: imageRepo,
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: pkgRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: detRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: histRepo },
        { provide: getRepositoryToken(VulnerabilityOsv), useValue: osvRepo },
        { provide: ResultService, useValue: resultService },
        { provide: CvssCalculatorService, useValue: cvssCalculator },
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
        { provide: Logger, useValue: logger },
        { provide: CyberiskRecomputeEnqueuer, useValue: cyberiskEnqueuer },
      ],
    }).compile();

    service = module.get(ContainerService);
    cyberiskEnqueuer.enqueue.mockClear();
    // sensible defaults for repos
    imageRepo.save!.mockImplementation(async (x) => x);
    // The vulnerability path resolves package rows through `find`; mirror
    // whatever each test mocked on `findOne` so existing fixtures still apply.
    pkgRepo.find!.mockImplementation(async (opts) => {
      const row = await pkgRepo.findOne!(opts);
      return row ? [row] : [];
    });
    pkgRepo.save!.mockImplementation(async (x) => x);
    detRepo.save!.mockImplementation(async (x) => x);
  });

  it('addContainerScanResult processes packages then vulnerabilities', async () => {
    // upsertImage path inside service will call imageRepo.findOne and save
    imageRepo.findOne!.mockResolvedValue(null);
    // service uses findOneBy for OSV lookup in findOrCreateOsvStub
    (osvRepo as any).findOneBy = jest.fn().mockResolvedValue({ id: 'OSV-1' });
    pkgRepo.findOne!.mockResolvedValue({
      id: 'pkg1',
      packageName: 'openssl',
      target: 'alpine',
    });

    const req = {
      projectId: 'p1',
      scanId: 's1',
      os: { family: 'alpine', name: '3.19' },
      chunk: { index: 0, isLast: false },
      results: [
        {
          target: 'alpine',
          class: 'os-pkgs',
          packages: [{ name: 'openssl', version: '3.0.0', target: 'alpine' }],
          vulnerabilities: [
            {
              pkgName: 'openssl',
              installedVersion: '3.0.0',
              target: 'alpine',
              vulnerabilityId: 'OSV-1',
              severity: 'high',
            },
          ],
        },
      ],
    } as any;

    const res = await service.addContainerScanResult(req);
    expect(res.success).toBe(true);
    expect(pkgRepo.save).toHaveBeenCalled();
    // Since pkg was found, vulnerability should be upserted
    expect(detRepo.save).toHaveBeenCalled();
  });

  it('persists environmental vector + score when project context exists for Container', async () => {
    imageRepo.findOne!.mockResolvedValue(null);
    (osvRepo as any).findOneBy = jest.fn().mockResolvedValue({ id: 'OSV-1' });
    pkgRepo.findOne!.mockResolvedValue({
      id: 'pkg1',
      packageName: 'openssl',
      target: 'alpine',
    });
    // New detection path
    detRepo.findOne!.mockResolvedValue(null);
    detRepo.create!.mockImplementation((e: any) => e);

    resultService.computeEnvironmentalForProject.mockResolvedValueOnce({
      fullVector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
      baseScore: 9.3,
      environmentalScore: 9.8,
    });

    const req = {
      projectId: 'p1',
      scanId: 's1',
      os: { family: 'alpine', name: '3.19' },
      chunk: { index: 0, isLast: false },
      results: [
        {
          target: 'alpine',
          class: 'os-pkgs',
          packages: [{ name: 'openssl', version: '3.0.0', target: 'alpine' }],
          vulnerabilities: [
            {
              pkgName: 'openssl',
              installedVersion: '3.0.0',
              target: 'alpine',
              vulnerabilityId: 'OSV-1',
              severity: 'critical',
            },
          ],
        },
      ],
    } as any;

    await service.addContainerScanResult(req);

    expect(resultService.computeEnvironmentalForProject).toHaveBeenCalledWith(
      'p1',
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    const detectionSaveCall = detRepo.save!.mock.calls.find(
      (call: any[]) => call[0] && 'cvss4BaseScore' in call[0],
    );
    expect(detectionSaveCall).toBeDefined();
    const saved = detectionSaveCall![0];
    expect(saved.cvss4EnvironmentalScore).toBe(9.8);
    expect(saved.cvss4EnvironmentalVector).toBe(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
    );
  });

  it('falls back to base score and null vector when no project context exists for Container', async () => {
    imageRepo.findOne!.mockResolvedValue(null);
    (osvRepo as any).findOneBy = jest.fn().mockResolvedValue({ id: 'OSV-1' });
    pkgRepo.findOne!.mockResolvedValue({
      id: 'pkg1',
      packageName: 'openssl',
      target: 'alpine',
    });
    detRepo.findOne!.mockResolvedValue(null);
    detRepo.create!.mockImplementation((e: any) => e);

    resultService.computeEnvironmentalForProject.mockResolvedValueOnce(null);

    const req = {
      projectId: 'p1',
      scanId: 's1',
      os: { family: 'alpine', name: '3.19' },
      chunk: { index: 0, isLast: false },
      results: [
        {
          target: 'alpine',
          class: 'os-pkgs',
          packages: [{ name: 'openssl', version: '3.0.0', target: 'alpine' }],
          vulnerabilities: [
            {
              pkgName: 'openssl',
              installedVersion: '3.0.0',
              target: 'alpine',
              vulnerabilityId: 'OSV-1',
              severity: 'critical',
            },
          ],
        },
      ],
    } as any;

    await service.addContainerScanResult(req);

    const detectionSaveCall = detRepo.save!.mock.calls.find(
      (call: any[]) => call[0] && 'cvss4BaseScore' in call[0],
    );
    expect(detectionSaveCall).toBeDefined();
    const saved = detectionSaveCall![0];
    // Falls back to base score and null vector
    expect(saved.cvss4EnvironmentalScore).toBe(9.3);
    expect(saved.cvss4EnvironmentalVector).toBeNull();
  });

  it('keeps the scanner label of a finding with no CVSS: its default vector skips the security context', async () => {
    resultService.computeEnvironmentalForProject.mockClear();
    detRepo.save!.mockClear();
    imageRepo.findOne!.mockResolvedValue(null);
    (osvRepo as any).findOneBy = jest.fn().mockResolvedValue({ id: 'OSV-1' });
    pkgRepo.findOne!.mockResolvedValue({
      id: 'pkg1',
      packageName: 'openssl',
      target: 'alpine',
    });
    detRepo.findOne!.mockResolvedValue(null);
    detRepo.create!.mockImplementation((e: any) => e);
    const real = new CvssCalculatorService();
    cvssCalculator.computeCvss4Base.mockImplementationOnce((input) =>
      real.computeCvss4Base(input),
    );
    resultService.computeEnvironmentalForProject.mockResolvedValueOnce({
      fullVector: 'CVSS:4.0/env',
      baseScore: 2.0,
      environmentalScore: 5.3,
    });

    await service.addContainerScanResult({
      projectId: 'p1',
      scanId: 's1',
      os: { family: 'alpine', name: '3.19' },
      chunk: { index: 0, isLast: false },
      results: [
        {
          target: 'alpine',
          class: 'os-pkgs',
          packages: [{ name: 'openssl', version: '3.0.0', target: 'alpine' }],
          vulnerabilities: [
            {
              pkgName: 'openssl',
              installedVersion: '3.0.0',
              target: 'alpine',
              vulnerabilityId: 'OSV-1',
              severity: 'low',
            },
          ],
        },
      ],
    } as any);

    expect(resultService.computeEnvironmentalForProject).not.toHaveBeenCalled();
    const saved = detRepo.save!.mock.calls.find(
      (call: any[]) => call[0] && 'cvss4BaseScore' in call[0],
    )![0];
    expect(saved.cvss4EnvironmentalScore).toBe(saved.cvss4BaseScore);
    expect(saved.cvss4EnvironmentalVector).toBeNull();
    expect(resolveEffectiveSeverity(saved)).toBe('low');
  });

  it('handleUpdateContainer updates status/priority/comments and cascades history', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'open',
      currentPriority: 'normal',
    } as any;
    detRepo.save!.mockResolvedValue(vuln);
    // Avoid diving into getContainerVulnerabilityById internals
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      status: 'closed',
      priority: 'urgent',
      comment: 'look',
    } as any);

    expect(detRepo.save).toHaveBeenCalled();
    // History items queued on parent and saved via cascade
    expect(vuln.historyItems.length).toBe(3);
    expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith('p1', 'vuln_update');
  });

  it('handleUpdateContainer resets exploitability when verdict is not_evaluated', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
      exploitabilityVerdict: 'proven',
      exploitabilityScore: 0.9,
      exploitabilitySource: 'manual',
      scoringSource: 'agent',
      priorityManualOverride: true,
    } as any;
    detRepo.save!.mockResolvedValue(vuln);
    histRepo.create!.mockImplementation((e: any) => e);
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      exploitabilityVerdict: 'not_evaluated',
    } as any);

    expect(vuln.exploitabilityVerdict).toBeNull();
    expect(vuln.exploitabilitySource).toBeNull();
    // scoring_source is NOT NULL, so the reset falls back to the
    // 'static' baseline rather than null (persisting null fails the save).
    expect(vuln.scoringSource).toBe('static');
    expect(vuln.priorityManualOverride).toBe(false);
    expect(
      vuln.historyItems.some((h: any) => h.type === 'exploitability_change'),
    ).toBe(true);
    expect(detRepo.save).toHaveBeenCalled();
  });

  // A verdict with no explicit source must default to 'manual'.
  it('handleUpdateContainer defaults exploitabilitySource to "manual" when not provided', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    detRepo.save!.mockResolvedValue(vuln);
    histRepo.create!.mockImplementation((e: any) => e);
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'u1',
      exploitabilityVerdict: 'not_exploitable',
      exploitabilitySource: '',
    } as any);

    expect(vuln.exploitabilitySource).toBe('manual');
  });

  // A human manual exploitability edit shifting the priority bucket
  // must attribute the recompute-derived priority_change to the human editor,
  // not to the 'system' sentinel (which falsely shows "Analyzed by Agent Cybe").
  it('handleUpdateContainer attributes the recompute-derived priority_change to the human editor', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    detRepo.save!.mockResolvedValue(vuln);
    histRepo.create!.mockImplementation((e: any) => e);
    (resultService as any).recalculatePriority = jest
      .fn()
      .mockResolvedValue({ priority: 'high', priorityScore: 80 });
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'human-15',
      exploitabilityVerdict: 'proven',
      exploitabilitySource: 'manual',
    } as any);

    const priorityItem = vuln.historyItems.find(
      (h: any) => h.type === 'priority_change',
    );
    expect(priorityItem).toBeDefined();
    expect(priorityItem.userId).toBe('human-15');
    expect(priorityItem.userId).not.toBe('system');
  });

  // Non-regression — autonomous agent (userId='system') keeps system
  // attribution so the banner still shows.
  it('handleUpdateContainer keeps the recompute-derived priority_change attributed to system for agent analysis', async () => {
    const vuln = {
      id: 'v1',
      historyItems: [],
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    detRepo.save!.mockResolvedValue(vuln);
    histRepo.create!.mockImplementation((e: any) => e);
    (resultService as any).recalculatePriority = jest
      .fn()
      .mockResolvedValue({ priority: 'high', priorityScore: 80 });
    jest
      .spyOn(service as any, 'getContainerVulnerabilityById')
      .mockResolvedValue({ projectId: 'p1', vulnerabilityId: 'v1' });

    await service.handleUpdateContainer(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      userId: 'system',
      exploitabilityVerdict: 'proven',
      exploitabilitySource: 'agent',
    } as any);

    const priorityItem = vuln.historyItems.find(
      (h: any) => h.type === 'priority_change',
    );
    expect(priorityItem).toBeDefined();
    expect(priorityItem.userId).toBe('system');
  });

  describe('getGroupedContainerImages', () => {
    beforeEach(() => {
      // Mock the projectServiceClient.get method to return an Observable-like structure
      // that works with safeGrpcCall (uses lastValueFrom)
      const mockObservable = {
        pipe: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockImplementation((observer) => {
          if (observer && typeof observer.next === 'function') {
            observer.next({ name: 'Test Project' });
            observer.complete();
          }
          return { unsubscribe: jest.fn() };
        }),
        toPromise: () => Promise.resolve({ name: 'Test Project' }),
        forEach: (fn: (v: any) => void) => {
          fn({ name: 'Test Project' });
          return Promise.resolve();
        },
        [Symbol.observable]: () => mockObservable,
      };
      (service as any).projectServiceClient = {
        get: jest.fn().mockReturnValue(mockObservable),
      };
    });

    it('should return empty response when no images exist', async () => {
      // Setup mocks for empty result
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const result = await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
      });

      expect(result.projectName).toBe('Test Project');
      expect(result.groupedImages).toEqual([]);
      expect(result.totalRepositories).toBe(0);
      expect(result.totalTags).toBe(0);
    });

    it('should group images by repository name correctly', async () => {
      const mockImages = [
        {
          id: 'img1',
          projectId: 'p1',
          artifactName: 'nginx:v1.0.0',
          osFamily: 'debian',
          osName: 'Debian 11',
          branch: 'main',
          scanId: 's1',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-15'),
        },
        {
          id: 'img2',
          projectId: 'p1',
          artifactName: 'nginx:latest',
          osFamily: 'debian',
          osName: 'Debian 11',
          branch: 'main',
          scanId: 's2',
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-20'),
        },
        {
          id: 'img3',
          projectId: 'p1',
          artifactName: 'redis:alpine',
          osFamily: 'alpine',
          osName: 'Alpine 3.19',
          branch: 'main',
          scanId: 's3',
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date('2024-01-10'),
        },
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockImages),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      // Mock vulnerability counts query
      const mockDetQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { imageId: 'img1', severity: 'critical', count: '2' },
          { imageId: 'img1', severity: 'high', count: '3' },
          { imageId: 'img2', severity: 'medium', count: '5' },
          { imageId: 'img3', severity: 'low', count: '1' },
        ]),
      };
      detRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockDetQueryBuilder);

      const result = await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
      });

      expect(result.totalRepositories).toBe(2); // nginx and redis
      expect(result.totalTags).toBe(3);
      expect(result.groupedImages).toHaveLength(2);

      // Find the nginx group
      const nginxGroup = result.groupedImages.find(
        (g) => g.repositoryName === 'nginx',
      );
      expect(nginxGroup).toBeDefined();
      expect(nginxGroup!.tagCount).toBe(2);
      expect(nginxGroup!.tags).toHaveLength(2);
      expect(nginxGroup!.tags.map((t) => t.tag).sort()).toEqual([
        'latest',
        'v1.0.0',
      ]);
      // Aggregated counts: critical=2, high=3, medium=5
      expect(nginxGroup!.aggregatedVulnCounts.critical).toBe(2);
      expect(nginxGroup!.aggregatedVulnCounts.high).toBe(3);
      expect(nginxGroup!.aggregatedVulnCounts.medium).toBe(5);

      // Find the redis group
      const redisGroup = result.groupedImages.find(
        (g) => g.repositoryName === 'redis',
      );
      expect(redisGroup).toBeDefined();
      expect(redisGroup!.tagCount).toBe(1);
      expect(redisGroup!.tags[0].tag).toBe('alpine');
    });

    it('should handle images without tags (default to latest)', async () => {
      const mockImages = [
        {
          id: 'img1',
          projectId: 'p1',
          artifactName: 'alpine', // No tag
          osFamily: 'alpine',
          osName: 'Alpine 3.19',
          branch: 'main',
          scanId: 's1',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-15'),
        },
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockImages),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const mockDetQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      detRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockDetQueryBuilder);

      const result = await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
      });

      expect(result.groupedImages[0].repositoryName).toBe('alpine');
      expect(result.groupedImages[0].tags[0].tag).toBe('latest');
    });

    it('should apply search filter correctly', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
        searchQuery: 'nginx',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'img.artifactName LIKE :searchQuery',
        { searchQuery: '%nginx%' },
      );
    });

    it('should apply branch filter correctly', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
        branch: 'develop',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'img.branch = :branch',
        { branch: 'develop' },
      );
    });

    it('should sort by tagCount correctly', async () => {
      const mockImages = [
        {
          id: 'img1',
          projectId: 'p1',
          artifactName: 'nginx:v1',
          osFamily: 'debian',
          osName: 'Debian',
          branch: 'main',
          scanId: 's1',
          createdAt: new Date(),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'img2',
          projectId: 'p1',
          artifactName: 'redis:v1',
          osFamily: 'alpine',
          osName: 'Alpine',
          branch: 'main',
          scanId: 's2',
          createdAt: new Date(),
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'img3',
          projectId: 'p1',
          artifactName: 'redis:v2',
          osFamily: 'alpine',
          osName: 'Alpine',
          branch: 'main',
          scanId: 's3',
          createdAt: new Date(),
          updatedAt: new Date('2024-01-03'),
        },
      ];

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockImages),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const mockDetQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      detRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockDetQueryBuilder);

      // Sort by tagCount DESC (redis has 2 tags, nginx has 1)
      const result = await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
        sort: 'tagCount',
        order: 'DESC',
      });

      expect(result.groupedImages[0].repositoryName).toBe('redis');
      expect(result.groupedImages[0].tagCount).toBe(2);
      expect(result.groupedImages[1].repositoryName).toBe('nginx');
      expect(result.groupedImages[1].tagCount).toBe(1);
    });

    it('should paginate results correctly', async () => {
      // Create 5 different repositories
      const mockImages = Array.from({ length: 5 }, (_, i) => ({
        id: `img${i}`,
        projectId: 'p1',
        artifactName: `repo${i}:latest`,
        osFamily: 'alpine',
        osName: 'Alpine',
        branch: 'main',
        scanId: `s${i}`,
        createdAt: new Date(),
        updatedAt: new Date(Date.now() - i * 86400000), // Different dates for sorting
      }));

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockImages),
      };
      imageRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      const mockDetQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      detRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockDetQueryBuilder);

      // Request page 2 with limit 2
      const result = await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 2,
        limit: 2,
      });

      expect(result.totalRepositories).toBe(5);
      expect(result.totalPages).toBe(3); // 5 repos / 2 per page = 3 pages
      expect(result.currentPage).toBe(2);
      expect(result.groupedImages).toHaveLength(2);
    });

    // An image scanned BY DIGEST carries no tag at all. Publishing a
    // fabricated 'latest' on its row makes the UI rebuild `repo:latest`, which
    // addresses a different (or non-existent) manifest, and turns two digests of
    // the same repository into two identical, indistinguishable rows.
    describe('images scanned by digest', () => {
      const DIGEST_A =
        'sha256:1f4d0d0d5a1e4b6c8f9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70';
      const DIGEST_B =
        'sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';

      const mockRepos = (images: unknown[]) => {
        const mockQueryBuilder = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(images),
        };
        imageRepo.createQueryBuilder = jest
          .fn()
          .mockReturnValue(mockQueryBuilder);

        const mockDetQueryBuilder = {
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        detRepo.createQueryBuilder = jest
          .fn()
          .mockReturnValue(mockDetQueryBuilder);
      };

      it('publishes the digest on the tag row instead of a fabricated latest', async () => {
        mockRepos([
          {
            id: 'img-digest',
            projectId: 'p1',
            artifactName: `rg.fr-par.scw.cloud/acme/frontend@${DIGEST_A}`,
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-15'),
          },
        ]);

        const result = await service.getGroupedContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        expect(result.groupedImages).toHaveLength(1);
        const group = result.groupedImages[0];
        expect(group.repositoryName).toBe('rg.fr-par.scw.cloud/acme/frontend');
        expect(group.tags).toHaveLength(1);
        expect(group.tags[0].digest).toBe(DIGEST_A);
        // No tag was ever pushed for this image: claiming 'latest' is a lie the
        // UI would turn back into a wrong `repo:latest` reference.
        expect(group.tags[0].tag).toBe('');
      });

      it('keeps two digests of the same repository distinguishable', async () => {
        mockRepos([
          {
            id: 'img-a',
            projectId: 'p1',
            artifactName: `rg.fr-par.scw.cloud/acme/frontend@${DIGEST_A}`,
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-15'),
          },
          {
            id: 'img-b',
            projectId: 'p1',
            artifactName: `rg.fr-par.scw.cloud/acme/frontend@${DIGEST_B}`,
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's2',
            createdAt: new Date('2024-01-02'),
            updatedAt: new Date('2024-01-20'),
          },
        ]);

        const result = await service.getGroupedContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        // Acceptance #9: both belong to the SAME repository group…
        expect(result.groupedImages).toHaveLength(1);
        const group = result.groupedImages[0];
        expect(group.tagCount).toBe(2);
        // …yet each row stays addressable on its own digest.
        expect(group.tags.map((t) => t.digest).sort()).toEqual(
          [DIGEST_A, DIGEST_B].sort(),
        );
        expect(new Set(group.tags.map((t) => t.digest)).size).toBe(2);
      });

      it('keeps the tag AND the digest when the artifact carries both', async () => {
        mockRepos([
          {
            id: 'img-both',
            projectId: 'p1',
            artifactName: `rg.fr-par.scw.cloud/acme/frontend:v1@${DIGEST_A}`,
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-15'),
          },
        ]);

        const result = await service.getGroupedContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        const tagRow = result.groupedImages[0].tags[0];
        expect(tagRow.tag).toBe('v1');
        expect(tagRow.digest).toBe(DIGEST_A);
      });

      // The user-visible half of the deprecated-shape bug: `repo:sha256:<hex>`
      // used to group under `repo:sha256`, so the by-digest scan showed up as a
      // phantom repository sitting next to the real one instead of joining its
      // sibling tags.
      it('groups a deprecated repo:sha256:<hex> image with its sibling tags', async () => {
        mockRepos([
          {
            id: 'img-tag',
            projectId: 'p1',
            artifactName: 'acme/frontend:v1',
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-15'),
          },
          {
            id: 'img-deprecated-digest',
            projectId: 'p1',
            artifactName: `acme/frontend:${DIGEST_A}`,
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's2',
            createdAt: new Date('2024-01-02'),
            updatedAt: new Date('2024-01-20'),
          },
        ]);

        const result = await service.getGroupedContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        // One repository, not a real one plus a `acme/frontend:sha256` ghost.
        expect(result.groupedImages).toHaveLength(1);
        expect(result.totalRepositories).toBe(1);
        const group = result.groupedImages[0];
        expect(group.repositoryName).toBe('acme/frontend');
        expect(group.tagCount).toBe(2);

        const digestRow = group.tags.find(
          (t) => t.id === 'img-deprecated-digest',
        );
        expect(digestRow!.digest).toBe(DIGEST_A);
        expect(digestRow!.tag).toBe('');
        const tagRow = group.tags.find((t) => t.id === 'img-tag');
        expect(tagRow!.tag).toBe('v1');
        expect(tagRow!.digest).toBe('');
      });

      it('still reports an empty digest for a plain tagged image', async () => {
        mockRepos([
          {
            id: 'img-tagged',
            projectId: 'p1',
            artifactName: 'nginx:1.25',
            osFamily: 'debian',
            osName: 'Debian 12',
            branch: 'main',
            scanId: 's1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-15'),
          },
        ]);

        const result = await service.getGroupedContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        const tagRow = result.groupedImages[0].tags[0];
        expect(tagRow.tag).toBe('1.25');
        expect(tagRow.digest).toBe('');
      });
    });
  });

  describe('extractRepositoryAndTag', () => {
    it('should extract tag from simple image name', () => {
      const result = (service as any).extractRepositoryAndTag('nginx:1.19.0');
      expect(result).toEqual({ repositoryName: 'nginx', tag: '1.19.0' });
    });

    it('should extract tag from registry URL', () => {
      const result = (service as any).extractRepositoryAndTag(
        'registry.gitlab.com/group/project:v2.0.0',
      );
      expect(result).toEqual({
        repositoryName: 'registry.gitlab.com/group/project',
        tag: 'v2.0.0',
      });
    });

    it('should default to latest when no tag present', () => {
      const result = (service as any).extractRepositoryAndTag('alpine');
      expect(result).toEqual({ repositoryName: 'alpine', tag: 'latest' });
    });

    it('should handle registry with port correctly', () => {
      const result = (service as any).extractRepositoryAndTag(
        'localhost:5000/myimage:v1',
      );
      expect(result).toEqual({
        repositoryName: 'localhost:5000/myimage',
        tag: 'v1',
      });
    });

    // The digest separator is '@', but the parser only guarded against
    // a registry port (a '/' after the ':'), so a by-digest reference lost its
    // last path segment into a bogus `...@sha256` repository. Grouping keys off
    // repositoryName, so such an image became a phantom repository that never
    // joined its sibling tags.
    const DIGEST =
      'sha256:1f4d0d0d5a1e4b6c8f9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70';

    it('should not swallow a digest into the repository name', () => {
      const result = (service as any).extractRepositoryAndTag(
        `rg.fr-par.scw.cloud/acme/frontend@${DIGEST}`,
      );
      expect(result.repositoryName).toBe('rg.fr-par.scw.cloud/acme/frontend');
      expect(result.digest).toBe(DIGEST);
      // The "always a non-empty tag" contract was withdrawn: a by-digest
      // reference has NO tag, and defaulting it to 'latest' is what made two
      // digests of one repository render as two identical rows. Callers label
      // the row with the digest when the tag is empty.
      expect(result.tag).toBe('');
    });

    it('should keep both the tag and the digest on repo:tag@digest', () => {
      const result = (service as any).extractRepositoryAndTag(
        `repo:v1@${DIGEST}`,
      );
      expect(result).toEqual({
        repositoryName: 'repo',
        tag: 'v1',
        digest: DIGEST,
      });
    });

    it('should treat a colon before the last slash as a port, not a tag', () => {
      const result = (service as any).extractRepositoryAndTag(
        'registry.io:5000/org/repo',
      );
      expect(result.repositoryName).toBe('registry.io:5000/org/repo');
      expect(result.tag).toBe('latest');
      expect(result.digest).toBeUndefined();
    });

    it('should parse a plain nginx:latest reference', () => {
      const result = (service as any).extractRepositoryAndTag('nginx:latest');
      expect(result).toEqual({ repositoryName: 'nginx', tag: 'latest' });
    });

    it('should parse a semver tag on a registry URL', () => {
      const result = (service as any).extractRepositoryAndTag(
        'registry.gitlab.com/group/project:v1.0.0',
      );
      expect(result).toEqual({
        repositoryName: 'registry.gitlab.com/group/project',
        tag: 'v1.0.0',
      });
    });

    // Second shape: the DEPRECATED `repo:sha256:<hex>` reference the
    // dashboard still emits when it uses the digest of an untagged image as if
    // it were a tag. There is no '@' to split on, so the naive parser keys off
    // the ':' INSIDE `sha256:<hex>` and produces `repo:sha256` — the very
    // phantom repository this ticket is about. The repair mirrors
    // external-integrations-service/src/core/utils/image-reference.utils.ts.
    describe('deprecated repo:sha256:<hex> shape', () => {
      it('should repair a deprecated digest into repository + digest', () => {
        const result = (service as any).extractRepositoryAndTag(
          `acme/frontend:${DIGEST}`,
        );
        expect(result.repositoryName).toBe('acme/frontend');
        expect(result.digest).toBe(DIGEST);
        // Addressed by digest, so there is no tag — same contract as the '@'
        // form: fabricating 'latest' would rebuild a different manifest.
        expect(result.tag).toBe('');
      });

      it('should keep a registry port intact while repairing', () => {
        const result = (service as any).extractRepositoryAndTag(
          `registry.io:5000/org/repo:${DIGEST}`,
        );
        expect(result.repositoryName).toBe('registry.io:5000/org/repo');
        expect(result.digest).toBe(DIGEST);
        expect(result.tag).toBe('');
      });

      // The repair is gated on the absence of '@' precisely so this legitimate
      // shape keeps its tag: here the ':' before the digest IS a tag separator.
      it('should not repair when an explicit @ digest is already present', () => {
        const result = (service as any).extractRepositoryAndTag(
          `repo:v1@${DIGEST}`,
        );
        expect(result.repositoryName).toBe('repo');
        expect(result.tag).toBe('v1');
        expect(result.digest).toBe(DIGEST);
      });

      // Only a full 64-hex sha256 is repaired. A shorter `:sha256:abc` suffix is
      // far more likely an (odd but real) tag than a digest, and silently moving
      // it into `digest` would lose information — so the reference is left
      // exactly as the historical grammar split it, byte for byte what
      // parseImageReference() returns for the same input.
      it('should leave a short :sha256:<hex> suffix alone instead of repairing it', () => {
        const result = (service as any).extractRepositoryAndTag(
          'repo:sha256:abc',
        );
        expect(result.digest).toBeUndefined();
        expect(`${result.repositoryName}:${result.tag}`).toBe(
          'repo:sha256:abc',
        );
      });

      it('should still default a bare nginx to the latest tag', () => {
        const result = (service as any).extractRepositoryAndTag('nginx');
        expect(result).toEqual({ repositoryName: 'nginx', tag: 'latest' });
      });
    });
  });

  describe('currentPriority ORDER BY CASE', () => {
    // H4: SAST/IaC include very_low in the priority_order CASE so rows with
    // very_low priority are ranked between low and the default bucket. The
    // Container listing query must do the same; otherwise very_low rows fall
    // into the ELSE bucket and sort alongside rows with unknown priorities.
    const serviceSource = fs.readFileSync(
      path.resolve(__dirname, 'container.service.ts'),
      'utf8',
    );

    it('maps critical_urgent/urgent/normal/low/very_low to 1..5 in the priority_order CASE', () => {
      expect(serviceSource).toMatch(
        /WHEN LOWER\(det\.currentPriority\) = 'critical_urgent' THEN 1/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(det\.currentPriority\) = 'urgent' THEN 2/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(det\.currentPriority\) = 'normal' THEN 3/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(det\.currentPriority\) = 'low' THEN 4/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(det\.currentPriority\) = 'very_low' THEN 5/,
      );
    });

    it('keeps the canonical priority order (very_low is WHEN 5, default is ELSE 6)', () => {
      const match = serviceSource.match(
        /CASE\s+WHEN LOWER\(det\.currentPriority\)[\s\S]*?END/,
      );
      expect(match).not.toBeNull();
      const caseBlock = match![0];
      const ordinals = Array.from(caseBlock.matchAll(/THEN (\d+)/g)).map((m) =>
        Number(m[1]),
      );
      expect(ordinals).toEqual([1, 2, 3, 4, 5]);
      expect(caseBlock).toMatch(/ELSE 6/);
    });
  });

  describe('getProjectContainerVulnerabilities (list payload)', () => {
    it('returns vulnerabilities with empty description / references', async () => {
      const detection = {
        id: 'det-1',
        projectId: 'p1',
        currentSeverity: 'critical',
        currentState: 'to_verify',
        currentPriority: 'critical_urgent',
        branch: 'main',
        scoringSource: 'static',
        historyItems: [],
        autofixRecords: [],
        vulnerabilityIdentifier: 'CVE-2024-1234',
        detectedPackage: {
          id: 'pkg-1',
          projectId: 'p1',
          packageName: 'openssl',
          packageVersion: '1.1.1',
        },
        detectedImage: { id: 'img-1', name: 'alpine', tag: '3.18' },
        vulnerability: {
          id: 'CVE-2024-1234',
          summary: 'Buffer overflow',
          details: 'X'.repeat(60_000),
          references: [{ id: 'r1', url: 'http://e.test', type: 'WEB' }],
        },
      };

      const fakeQb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([detection]),
        getManyAndCount: jest.fn().mockResolvedValue([[detection], 1]),
      };
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(fakeQb);

      (service as any).projectServiceClient = {
        get: () => of({ name: 't', parsedBranches: [] }),
      };
      (service as any).scanServiceClient = {
        getLastScanStatus: () =>
          of({ id: '', state: '', createAt: '', scanType: '' }),
      };
      (resultService as any).getCountVulnerabilitiesCountByType = jest
        .fn()
        .mockResolvedValue({
          sast: 0,
          iac: 0,
          sca: 0,
          container: 0,
          cicd: 0,
          secret: 0,
        });

      jest
        .spyOn(service as any, 'enrichDetectionsWithSeverities')
        .mockImplementation(async (d: any) => d);
      jest
        .spyOn(service as any, 'enrichDetectionsWithFixedVersions')
        .mockImplementation(async (d: any) => d);

      const out = await service.getProjectContainerVulnerabilities({
        projectId: 'p1',
        page: 1,
        limit: 10,
        sort: 'currentSeverity',
        order: 'DESC',
        severity: ['critical'],
        status: [],
        priority: [],
        searchQuery: '',
        classType: [],
        exploitabilityVerdict: [],
      } as any);

      expect(out.vulnerabilities).toHaveLength(1);
      expect(out.vulnerabilities[0].vuln.description).toBe('');
      expect(out.vulnerabilities[0].vuln.references).toEqual([]);
    });

    // The flat container list read its project
    // twice: directly for its name, and through getScoringBranches inside the
    // per-type counter. The counter now takes the partition from the list's
    // own Get.
    it('calls projectServiceClient.get once and hands the counter the partition derived from it', async () => {
      const fakeQb: any = {};
      for (const m of [
        'leftJoinAndSelect',
        'innerJoinAndSelect',
        'innerJoin',
        'andWhere',
        'addSelect',
        'orderBy',
        'addOrderBy',
        'where',
        'skip',
        'take',
      ]) {
        fakeQb[m] = jest.fn().mockReturnValue(fakeQb);
      }
      fakeQb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(fakeQb);

      const harness = makeProjectLookupHarness({
        name: 'p',
        referenceBranch: 'develop',
      });
      Object.assign(service as any, {
        projectServiceClient: harness.projectServiceClient,
        resultService: harness.resultService,
        scanServiceClient: {
          getLastScanStatus: () =>
            of({ id: '', state: '', createAt: '', scanType: '' }),
        },
      });
      jest
        .spyOn(service as any, 'enrichDetectionsWithSeverities')
        .mockImplementation(async (d: any) => d);
      jest
        .spyOn(service as any, 'enrichDetectionsWithFixedVersions')
        .mockImplementation(async (d: any) => d);

      const out = await service.getProjectContainerVulnerabilities({
        projectId: 'p1',
        page: 1,
        limit: 10,
        sort: 'currentSeverity',
        order: 'DESC',
        severity: [],
        status: [],
        priority: [],
        searchQuery: '',
        classType: [],
        exploitabilityVerdict: [],
      } as any);

      expect(out.projectName).toBe('p');
      expect(harness.get).toHaveBeenCalledTimes(1);
      expect(harness.getScoringBranches).not.toHaveBeenCalled();
      expect(harness.countByType).toHaveBeenCalledWith('p1', undefined, [
        'develop',
        '',
      ]);
    });
  });

  // An explicit page size is clamped, silently, at 500
  // (the dashboard asks for 10 to 100). 0 keeps today's behaviour.
  describe('page size bound', () => {
    const listQb = () => {
      const qb: Record<string, jest.Mock> = {};
      for (const m of [
        'leftJoinAndSelect',
        'innerJoinAndSelect',
        'innerJoin',
        'leftJoin',
        'andWhere',
        'where',
        'select',
        'addSelect',
        'orderBy',
        'addOrderBy',
        'groupBy',
        'skip',
        'take',
      ]) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      return qb;
    };

    beforeEach(() => {
      (service as any).projectServiceClient = {
        get: () => of({ name: 't', parsedBranches: [] }),
      };
      (service as any).scanServiceClient = {
        getLastScanStatus: () =>
          of({ id: '', state: '', createAt: '', scanType: '' }),
      };
      (resultService as any).getCountVulnerabilitiesCountByType = jest
        .fn()
        .mockResolvedValue({});
    });

    it.each([
      [100000, 500],
      [500, 500],
      [0, 0],
    ])('vulnerability list: limit=%d takes %d rows', async (limit, taken) => {
      const qb = listQb();
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectContainerVulnerabilities({
        projectId: 'p1',
        page: 1,
        limit,
        sort: 'createdAt',
        order: 'DESC',
      } as any);

      expect(qb.take).toHaveBeenCalledWith(taken);
    });

    it('package list: limit=100000 takes 500 rows', async () => {
      const qb = listQb();
      pkgRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectContainerPackages({
        projectId: 'p1',
        page: 1,
        limit: 100000,
      } as any);

      expect(qb.take).toHaveBeenCalledWith(500);
    });

    it('image list: limit=100000 takes 500 images', async () => {
      imageRepo.count!.mockResolvedValue(1);
      imageRepo.find!.mockResolvedValue([]);
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(listQb());

      await service.getProjectContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 100000,
      });

      expect(imageRepo.find!.mock.calls[0][0].take).toBe(500);
    });
  });

  // The MCP list asks for the page only — no project
  // Get, no last scan status, no per-type counters.
  describe('slim vulnerability list for the MCP surface', () => {
    const run = async (slim: boolean | undefined) => {
      const qb: Record<string, jest.Mock> = {};
      for (const m of [
        'leftJoinAndSelect',
        'innerJoinAndSelect',
        'innerJoin',
        'andWhere',
        'where',
        'addSelect',
        'orderBy',
        'addOrderBy',
        'skip',
        'take',
      ]) {
        qb[m] = jest.fn().mockReturnValue(qb);
      }
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);
      const projectGet = jest.fn(() => of({ name: 't', parsedBranches: [] }));
      const lastScan = jest.fn(() => of({ id: 's1' }));
      const loose = service as unknown as Record<string, unknown>;
      loose.projectServiceClient = { get: projectGet };
      loose.scanServiceClient = { getLastScanStatus: lastScan };
      const counts = jest.fn().mockResolvedValue({});
      (
        resultService as unknown as Record<string, unknown>
      ).getCountVulnerabilitiesCountByType = counts;
      const response = await service.getProjectContainerVulnerabilities({
        projectId: 'p1',
        page: 1,
        limit: 20,
        sort: 'createdAt',
        order: 'DESC',
        slim,
      } as GetProjectContainerVulnerabilitiesRequest);
      return { response, projectGet, lastScan, counts };
    };

    it('slim=true: no Get, no scan status, no counters', async () => {
      const { response, projectGet, lastScan, counts } = await run(true);

      expect(projectGet).not.toHaveBeenCalled();
      expect(lastScan).not.toHaveBeenCalled();
      expect(counts).not.toHaveBeenCalled();
      expect(response.total).toBe(0);
    });

    it('without slim the dashboard answer is unchanged', async () => {
      const { projectGet, lastScan, counts } = await run(undefined);

      expect(projectGet).toHaveBeenCalled();
      expect(lastScan).toHaveBeenCalled();
      expect(counts).toHaveBeenCalled();
    });
  });

  // The flat image list (default view of the Container tab).
  describe('getProjectContainerImages', () => {
    const image = (id: string) => ({
      id,
      projectId: 'p1',
      artifactName: `nginx:${id}`,
      osFamily: 'alpine',
      osName: '3.18',
      osEosl: false,
      branch: 'main',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });

    const countsQuery = (rows: unknown[]) => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    });

    beforeEach(() => {
      (service as any).projectServiceClient = {
        get: () => of({ name: 'Test Project' }),
      };
    });

    // effectiveSeveritySql() is NULL for a detection with no CVSS score and
    // no label: `count.severity.toLowerCase()` threw and the whole list
    // answered 500, shown as an empty
    // Container tab.
    it('counts an aggregate row with severity=null as unknown, without a TypeError', async () => {
      imageRepo.count!.mockResolvedValue(1);
      imageRepo.find!.mockResolvedValue([image('img1')]);
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(
        countsQuery([
          { imageId: 'img1', severity: null, count: '3' },
          { imageId: 'img1', severity: 'high', count: '2' },
          { imageId: 'img1', severity: 'none', count: '1' },
        ]),
      );

      const result = await service.getProjectContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
      });

      expect(result.images[0].vulnCounts).toEqual({
        critical: 0,
        high: 2,
        medium: 0,
        low: 0,
        unknown: 4,
      });
    });

    // Trivy publishes `UNKNOWN`, which effectiveSeveritySql() hands back as
    // 'unknown', next to the NULL and 'none' rows. MySQL does not order a
    // GROUP BY, so the tally must not depend on which row comes first: an
    // `unknown` row used to OVERWRITE what the NULL rows had added.
    const unknownRows = [
      { imageId: 'img1', severity: null, count: '3' },
      { imageId: 'img1', severity: 'unknown', count: '2' },
    ];

    it.each([
      ['NULL first', unknownRows],
      ['unknown first', [...unknownRows].reverse()],
    ])(
      'adds the NULL and unknown rows of an image whatever their order (%s)',
      async (_order, rows) => {
        imageRepo.count!.mockResolvedValue(1);
        imageRepo.find!.mockResolvedValue([image('img1')]);
        detRepo.createQueryBuilder = jest
          .fn()
          .mockReturnValue(countsQuery(rows));

        const result = await service.getProjectContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        expect(result.images[0].vulnCounts.unknown).toBe(5);
      },
    );

    it.each([
      ['NULL first', unknownRows],
      ['unknown first', [...unknownRows].reverse()],
    ])(
      'the grouped image view adds them the same way (%s)',
      async (_order, rows) => {
        imageRepo.createQueryBuilder = jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([image('img1')]),
        });
        detRepo.createQueryBuilder = jest
          .fn()
          .mockReturnValue(countsQuery(rows));

        const result = await service.getGroupedContainerImages({
          projectId: 'p1',
          page: 1,
          limit: 20,
        });

        expect(result.groupedImages[0].tags[0].vulnCounts.unknown).toBe(5);
        expect(result.groupedImages[0].aggregatedVulnCounts.unknown).toBe(5);
      },
    );

    it('page and limit at 0 → take 20, skip 0, a finite totalPages', async () => {
      imageRepo.count!.mockResolvedValue(45);
      imageRepo.find!.mockResolvedValue([image('img1')]);
      detRepo.createQueryBuilder = jest.fn().mockReturnValue(countsQuery([]));

      const result = await service.getProjectContainerImages({
        projectId: 'p1',
        page: 0,
        limit: 0,
      });

      expect(imageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.currentPage).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(3);
    });
  });
});
