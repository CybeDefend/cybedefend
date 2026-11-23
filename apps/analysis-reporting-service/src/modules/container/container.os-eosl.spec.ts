// An image whose base OS is end-of-support-life (Trivy `EOSL`)
// reports 0 vulnerabilities because the distribution stopped publishing
// advisories, not because it is clean. The flag already travels from the
// scanner (`ContainerOS.eosl`); it must be persisted on the image and exposed
// on every image listing so the dashboard can raise a loud alert.
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
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
import { OS_END_OF_LIFE } from '../../edition/ports/os-end-of-life.port';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';

describe('ContainerService — OS end-of-support-life flag', () => {
  let service: ContainerService;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let detRepo: MockType<any>;

  const scanRequest = (eosl: boolean): any => ({
    projectId: 'p1',
    scanId: 's1',
    imageName: 'registry.example/acme/vault:v2.84.0',
    // A SUPPORTED release: the platform also derives the flag
    // from the end-of-support table, so an EOL release would be flagged
    // regardless of what the scanner said (covered by its own describe).
    os: { family: 'alpine', name: '3.24.1', eosl },
    chunk: { index: 0, isLast: false },
    results: [],
  });

  const image = (overrides: Record<string, unknown>) => ({
    id: 'img1',
    projectId: 'p1',
    artifactName: 'nginx:v1.0.0',
    osFamily: 'alpine',
    osName: '3.18.12',
    osEosl: false,
    branch: 'main',
    scanId: 's1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
    ...overrides,
  });

  /** `safeGrpcCall(lastValueFrom(...))`-compatible stub for the project client. */
  const projectObservable = () => {
    const obs: any = {
      pipe: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockImplementation((observer) => {
        observer?.next?.({ name: 'Test Project' });
        observer?.complete?.();
        return { unsubscribe: jest.fn() };
      }),
      forEach: (fn: (v: any) => void) => {
        fn({ name: 'Test Project' });
        return Promise.resolve();
      },
    };
    obs[Symbol.observable] = () => obs;
    return obs;
  };

  const emptyCountsQuery = () => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  });

  beforeEach(async () => {
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    detRepo = createMockRepository();

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
            addHistoryItem: jest.fn(),
            recalculatePriority: jest.fn().mockResolvedValue(null),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
          },
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
    imageRepo.save!.mockImplementation(async (x) => x);
    (service as any).projectServiceClient = {
      get: jest.fn().mockReturnValue(projectObservable()),
    };
  });

  describe('ingestion', () => {
    it('persists osEosl=true on a newly detected image when the scanner flags the OS', async () => {
      imageRepo.findOne!.mockResolvedValue(null);

      await service.addContainerScanResult(scanRequest(true));

      expect(imageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ osEosl: true }),
      );
    });

    it('persists osEosl=false when the OS is still supported', async () => {
      imageRepo.findOne!.mockResolvedValue(null);

      await service.addContainerScanResult(scanRequest(false));

      expect(imageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ osEosl: false }),
      );
    });

    it('refreshes osEosl on an already known image (rebuilt onto an EOL base)', async () => {
      const existing = image({ osEosl: false });
      imageRepo.findOne!.mockResolvedValue(existing);

      await service.addContainerScanResult(scanRequest(true));

      expect(imageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'img1', osEosl: true }),
      );
    });

    it('clears osEosl once the image is rebuilt onto a supported base', async () => {
      const existing = image({ osEosl: true });
      imageRepo.findOne!.mockResolvedValue(existing);

      await service.addContainerScanResult(scanRequest(false));

      expect(imageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'img1', osEosl: false }),
      );
    });
  });

  describe('listings', () => {
    it('exposes osEosl on each image of the flat listing', async () => {
      imageRepo.count!.mockResolvedValue(2);
      imageRepo.find!.mockResolvedValue([
        image({ id: 'img1', osEosl: true }),
        image({ id: 'img2', artifactName: 'nginx:v2', osEosl: false }),
      ]);
      detRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(emptyCountsQuery());

      const result = await service.getProjectContainerImages({
        projectId: 'p1',
      } as any);

      expect(result.images.map((i) => [i.id, i.osEosl])).toEqual([
        ['img1', true],
        ['img2', false],
      ]);
    });

    it('exposes osEosl per tag and flags the repository when any tag runs an EOL OS', async () => {
      const imagesQuery = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([
            image({ id: 'img1', artifactName: 'nginx:v1.0.0', osEosl: true }),
            image({ id: 'img2', artifactName: 'nginx:latest', osEosl: false }),
            image({ id: 'img3', artifactName: 'redis:7', osEosl: false }),
          ]),
      };
      imageRepo.createQueryBuilder = jest.fn().mockReturnValue(imagesQuery);
      detRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(emptyCountsQuery());

      const result = await service.getGroupedContainerImages({
        projectId: 'p1',
        page: 1,
        limit: 20,
      });

      const nginx = result.groupedImages.find(
        (g) => g.repositoryName === 'nginx',
      )!;
      const redis = result.groupedImages.find(
        (g) => g.repositoryName === 'redis',
      )!;
      expect(nginx.osEosl).toBe(true);
      expect(nginx.tags.map((t) => [t.tag, t.osEosl]).sort()).toEqual([
        ['latest', false],
        ['v1.0.0', true],
      ]);
      expect(redis.osEosl).toBe(false);
      expect(redis.tags[0].osEosl).toBe(false);
    });
  });
});

describe('ContainerService — EOL derived by the platform (inventory mode)', () => {
  let service: ContainerService;
  let imageRepo: MockType<any>;

  beforeEach(async () => {
    imageRepo = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: imageRepo,
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: createMockRepository(),
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
            addHistoryItem: jest.fn(),
            recalculatePriority: jest.fn(),
            computeEnvironmentalForProject: jest.fn(),
          },
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
    imageRepo.findOne!.mockResolvedValue(null);
    imageRepo.save!.mockImplementation(async (x) => x);
  });

  const request = (family: string, name: string, eosl: boolean): any => ({
    projectId: 'p1',
    scanId: 's1',
    imageName: 'registry.example/app:1',
    os: { family, name, eosl },
    chunk: { index: 0, isLast: false },
    results: [],
  });

  it('flags an EOL base OS even when the scanner (inventory mode) sent eosl=false', async () => {
    await service.addContainerScanResult(request('alpine', '3.18.12', false));
    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ osEosl: true }),
    );
  });

  it('keeps a supported base OS clean', async () => {
    await service.addContainerScanResult(request('alpine', '3.24.1', false));
    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ osEosl: false }),
    );
  });

  it('still trusts the scanner flag for a release the table does not know', async () => {
    await service.addContainerScanResult(request('photonx', '4.0', true));
    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ osEosl: true }),
    );
  });
});

describe('ContainerService — live end-of-life lookup (endoflife.date)', () => {
  it('consults the EndOfLifeService when it is provided, before the static table', async () => {
    const imageRepo: MockType<any> = createMockRepository();
    const eol = { isOsEndOfLife: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: imageRepo,
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: createMockRepository(),
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
            addHistoryItem: jest.fn(),
            recalculatePriority: jest.fn(),
            computeEnvironmentalForProject: jest.fn(),
          },
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
        { provide: OS_END_OF_LIFE, useValue: eol },
      ],
    }).compile();
    const service = module.get(ContainerService);
    imageRepo.findOne!.mockResolvedValue(null);
    imageRepo.save!.mockImplementation(async (x) => x);

    // Alpine 3.24 is supported per the static table: only the live lookup
    // can flag it, which proves the live answer is the one consulted.
    await service.addContainerScanResult({
      projectId: 'p1',
      scanId: 's1',
      imageName: 'registry.example/app:1',
      os: { family: 'alpine', name: '3.24.1', eosl: false },
      chunk: { index: 0, isLast: false },
      results: [],
    } as any);

    expect(eol.isOsEndOfLife).toHaveBeenCalledWith('alpine', '3.24.1');
    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ osEosl: true }),
    );
  });
});
