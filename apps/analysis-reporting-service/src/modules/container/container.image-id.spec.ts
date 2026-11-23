// A container import names the image's id (Trivy's
// `run.properties.imageID`, else the image reference). ScanAddContainerResultRequest
// has no such field, so the id travels as an option of processContainerBatch.
// Without the option — every cloud caller — the image keeps imageId '' as before.
import { Test } from '@nestjs/testing';
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
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';

const IMAGE_ID =
  'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ContainerService image id', () => {
  let service: ContainerService;
  let imageRepo: MockType<any>;

  const request = (): any => ({
    projectId: 'p1',
    scanId: 's2',
    scannerName: 'trivy',
    startedAt: '',
    finishedAt: '',
    imageName: 'ghcr.io/example/api:2.0.1',
    os: { family: '', name: '', eosl: false },
    chunk: { index: 1, isLast: false },
    results: [],
  });

  beforeEach(async () => {
    imageRepo = createMockRepository();
    const module = await Test.createTestingModule({
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
    imageRepo.create!.mockImplementation((x) => ({ ...x }));
    imageRepo.save!.mockImplementation(async (x) => ({ id: 'img1', ...x }));
  });

  it('writes the given imageId on create and on update', async () => {
    imageRepo.findOne!.mockResolvedValue(null);
    await service.processContainerBatch(request(), { imageId: IMAGE_ID });
    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactName: 'ghcr.io/example/api:2.0.1',
        imageId: IMAGE_ID,
      }),
    );
    expect(imageRepo.save.mock.calls[0][0].imageId).toBe(IMAGE_ID);

    // an image already known (an earlier import, or a cloud scan with '')
    imageRepo.findOne!.mockResolvedValue({
      id: 'img1',
      projectId: 'p1',
      scanId: 's1',
      artifactName: 'ghcr.io/example/api:2.0.1',
      imageId: 'sha256:old',
      branch: '',
    });
    imageRepo.save!.mockClear();
    await service.processContainerBatch(request(), { imageId: IMAGE_ID });
    expect(imageRepo.save.mock.calls[0][0]).toMatchObject({
      id: 'img1',
      imageId: IMAGE_ID,
      scanId: 's2',
    });
  });

  it('keeps imageId empty without the option', async () => {
    imageRepo.findOne!.mockResolvedValue(null);
    await service.processContainerBatch(request());
    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ imageId: '' }),
    );

    // an existing image keeps whatever id it has
    imageRepo.findOne!.mockResolvedValue({
      id: 'img1',
      projectId: 'p1',
      scanId: 's1',
      artifactName: 'ghcr.io/example/api:2.0.1',
      imageId: 'sha256:kept',
      branch: '',
    });
    imageRepo.save!.mockClear();
    await service.processContainerBatch(request());
    expect(imageRepo.save.mock.calls[0][0].imageId).toBe('sha256:kept');

    // an empty option is no option
    imageRepo.save!.mockClear();
    await service.processContainerBatch(request(), { imageId: '' });
    expect(imageRepo.save.mock.calls[0][0].imageId).toBe('sha256:kept');
  });
});
