// The Community Edition binds neither CONTAINER_INVENTORY_MATCHER
// nor OS_END_OF_LIFE (only ee supplies them): a container batch stores the
// scanner's own findings, matches no package against an advisory mirror, and
// derives the end-of-support flag from the static table of os-eol.ts.
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { ContainerService } from './container.service';
import { isOsEndOfLife } from './os-eol';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { VulnerabilityOsv } from '../../entities/osv';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';

describe('ContainerService without advisory tokens', () => {
  let service: ContainerService;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let detRepo: MockType<any>;
  let osvRepo: MockType<any>;
  let savedDetections: any[];

  const ROW = {
    id: 'pkg-busybox',
    projectId: 'p1',
    packageName: 'busybox',
    packageVersion: '1.36.1-r7',
    target: 'alpine-target',
    class: 'os-pkgs',
  };

  const request = (os: any, vulnerabilities: any[] = []): any => ({
    projectId: 'p1',
    scanId: 's1',
    imageName: 'registry.example/app:1',
    os,
    chunk: { index: 0, isLast: false },
    results: [
      {
        target: 'alpine-target',
        class: 'os-pkgs',
        packages: [
          {
            name: 'busybox',
            version: '1.36.1-r7',
            srcName: 'busybox',
            srcVersion: '1.36.1-r7',
          },
        ],
        vulnerabilities,
      },
    ],
  });

  beforeEach(async () => {
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    detRepo = createMockRepository();
    osvRepo = createMockRepository();
    (osvRepo as any).findOneBy = jest
      .fn()
      .mockImplementation(async ({ id }) => ({ id }));
    savedDetections = [];

    const module = await Test.createTestingModule({
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
        { provide: getRepositoryToken(VulnerabilityOsv), useValue: osvRepo },
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
    imageRepo.findOne!.mockResolvedValue(null);
    imageRepo.save!.mockImplementation(async (x) => ({ id: 'img1', ...x }));
    pkgRepo.findOne!.mockResolvedValue(ROW);
    pkgRepo.find!.mockResolvedValue([ROW]);
    pkgRepo.save!.mockImplementation(async (x) => ({
      ...ROW,
      ...x,
      id: ROW.id,
    }));
    detRepo.findOne!.mockImplementation(
      async ({ where }) =>
        savedDetections.find(
          (d) =>
            d.projectId === where.projectId &&
            (where.vulnerability
              ? d.vulnerability?.id === where.vulnerability.id
              : true),
        ) ?? null,
    );
    detRepo.save!.mockImplementation(async (x) => {
      const row = { id: x.id ?? `det-${savedDetections.length + 1}`, ...x };
      savedDetections.push(row);
      return row;
    });
  });

  it('stores the scanner findings and matches nothing when no inventory matcher is bound', async () => {
    const res = await service.addContainerScanResult(
      request({ family: 'alpine', name: '3.18.12', eosl: false }, [
        {
          pkgName: 'busybox',
          installedVersion: '1.36.1-r7',
          target: 'alpine-target',
          vulnerabilityId: 'CVE-2026-14456',
          severity: 'high',
          fixedVersion: '1.36.1-r9',
        },
      ]),
    );

    expect(res.success).toBe(true);
    expect(savedDetections).toHaveLength(1);
    expect(savedDetections[0]).toMatchObject({
      vulnerabilityIdentifier: 'CVE-2026-14456',
      detectionSource: 'scanner',
    });
  });

  it('uses the static end-of-life table when no lookup is bound', async () => {
    // Alpine 3.10 ended long ago, 3.18 too by now: whatever the table says,
    // the image carries it when the scanner sends eosl=false.
    for (const name of ['3.10.9', '3.21.2']) {
      imageRepo.create!.mockClear();
      await service.addContainerScanResult(
        request({ family: 'alpine', name, eosl: false }),
      );
      expect(imageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          osEosl: isOsEndOfLife('alpine', name) === true,
        }),
      );
    }
    expect(isOsEndOfLife('alpine', '3.10.9')).toBe(true);
  });
});
