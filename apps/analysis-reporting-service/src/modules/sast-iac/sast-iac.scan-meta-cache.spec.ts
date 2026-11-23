import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { ScanAddResultRequest } from '@grpc/analysis-reporting/result';
import { SastIacService } from './sast-iac.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ResultService } from '../result/result.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { DIFF_SCAN_SINK } from '../../edition/ports/diff-scan-sink.port';
import { ScanMetaCache } from '../scan-queue/scan-meta-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { ScanQueueModule } from '../scan-queue/scan-queue.module';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

/**
 * Every SAST/IaC batch called GetScan for its branch and its
 * diff flag, about one GetScan per batch. The
 * scan's fixed metadata is now read once per scan through ScanMetaCache, and
 * the fail-safe holds: no cached value and no scan record, no
 * ingestion.
 */
describe('SastIacService — scan metadata read once per scan', () => {
  let service: SastIacService;
  let getScan: jest.Mock;
  let redisStore: Map<string, string>;
  let utils: Record<string, jest.Mock>;
  let diff: { ingestBatch: jest.Mock; upsertSummary: jest.Mock };

  const batch = (over: Partial<ScanAddResultRequest> = {}) =>
    ({
      scanId: 'scan-1',
      projectId: 'p1',
      scannerName: 'checkov',
      vulnerabilityType: 'iac',
      vulnerabilities: [],
      isLastRequest: false,
      ...over,
    }) as ScanAddResultRequest;

  beforeEach(async () => {
    redisStore = new Map();
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    const cache = new ScanMetaCache({
      getRedisClient: jest.fn(async () => redis),
    } as unknown as ScanQueueService);

    utils = {
      resolveCatalogRules: jest.fn().mockResolvedValue(new Map()),
      getExistingVulnerabilities: jest.fn().mockResolvedValue({
        existingSastVulns: [],
        existingIacVulns: [],
        existingCicdVulns: [],
        existingVulnsMap: new Map(),
      }),
      findExistingDetections: jest.fn().mockResolvedValue({
        existingSastVulns: [{ id: 'sast-1' }],
        existingIacVulns: [],
        existingCicdVulns: [],
      }),
      loadCurrentScanSightings: jest
        .fn()
        .mockResolvedValue({ ids: new Set(), detections: [] }),
      processVulnerability: jest.fn().mockResolvedValue(undefined),
      finalizeOldScanVulnerabilities: jest.fn().mockResolvedValue(undefined),
    };
    diff = {
      ingestBatch: jest.fn().mockResolvedValue(undefined),
      upsertSummary: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: ResultService, useValue: {} },
        { provide: SastIacUtilsService, useValue: utils },
        { provide: CvssExplainerService, useValue: {} },
        ...[
          SastVulnerabilityDetections,
          IacVulnerabilityDetections,
          CicdVulnerabilityDetections,
          SecretVulnerabilityDetections,
          ScaVulnerabilityDetections,
          AutoFixRecord,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: createMockRepository(),
        })),
        { provide: Logger, useValue: createLoggerMock() },
        { provide: SecurityContextCacheService, useValue: {} },
        { provide: DIFF_SCAN_SINK, useValue: diff },
        { provide: ScanMetaCache, useValue: cache },
      ],
    }).compile();

    service = module.get(SastIacService);
    getScan = jest.fn().mockReturnValue(
      of({
        branch: 'main',
        isDiffScan: false,
        scanType: 'iac',
        containers: [{ id: 'c1', state: 'running' }],
      }),
    );
    (service as unknown as { scanServiceClient: unknown }).scanServiceClient = {
      getScan,
    };
  });

  it('reads the scan record once for two batches and the finalization', async () => {
    await service.processSastIacBatch(batch());
    await service.processSastIacBatch(batch());
    await service.finalizeScan('p1', 'scan-1', 'checkov');

    expect(getScan).toHaveBeenCalledTimes(1);
    // Both batches and the finalization still got the branch.
    for (const call of utils.getExistingVulnerabilities.mock.calls) {
      expect(call[3]).toBe('main');
    }
    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledWith(
      [{ id: 'sast-1' }],
      [],
      'p1',
      'scan-1',
      'main',
      expect.anything(),
    );
  });

  it('never stores the scan containers', async () => {
    await service.processSastIacBatch(batch());

    const values = [...redisStore.values()];
    expect(values).toHaveLength(1);
    expect(values[0]).not.toContain('containers');
    expect(JSON.parse(values[0])).toMatchObject({
      branch: 'main',
      isDiffScan: false,
    });
  });

  it('defers the batch (UNAVAILABLE) when nothing is cached and GetScan fails, and caches nothing', async () => {
    getScan.mockReturnValueOnce(
      throwError(() => new Error('14 UNAVAILABLE: no healthy upstream')),
    );

    const failure = service.processSastIacBatch(batch());

    await expect(failure).rejects.toBeInstanceOf(RpcException);
    await expect(failure).rejects.toMatchObject({
      error: { code: status.UNAVAILABLE },
    });
    expect(utils.getExistingVulnerabilities).not.toHaveBeenCalled();
    expect(redisStore.size).toBe(0);

    // The retry reads the scan record again, and only then caches it.
    await service.processSastIacBatch(batch());
    expect(getScan).toHaveBeenCalledTimes(2);
    expect(redisStore.size).toBe(1);
  });

  it('defers the batch when GetScan answers no record, and caches nothing', async () => {
    getScan.mockReturnValueOnce(of(null));

    await expect(service.processSastIacBatch(batch())).rejects.toMatchObject({
      error: { code: status.UNAVAILABLE },
    });
    expect(redisStore.size).toBe(0);
  });

  it('skips the finalization when nothing is cached and GetScan fails', async () => {
    getScan.mockReturnValueOnce(throwError(() => new Error('14 UNAVAILABLE')));

    await service.finalizeScan('p1', 'scan-1', 'checkov');

    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
    expect(redisStore.size).toBe(0);
  });

  it('routes every batch of a diff scan to the diff store from the cached flag', async () => {
    getScan.mockReturnValue(of({ branch: 'feat/x', isDiffScan: true }));

    await service.processSastIacBatch(batch());
    await service.processSastIacBatch(batch());

    expect(getScan).toHaveBeenCalledTimes(1);
    expect(diff.ingestBatch).toHaveBeenCalledTimes(2);
    expect(utils.getExistingVulnerabilities).not.toHaveBeenCalled();
  });

  it('keeps the diff-scan summary fields (scan type, launcher) through the cache', async () => {
    getScan.mockReturnValue(
      of({
        branch: 'feat/x',
        isDiffScan: true,
        scanType: 'sast,secret',
        initializerUserId: 'u1',
        codingAgent: 'cursor',
      }),
    );

    await service.processSastIacBatch(batch());
    await service.finalizeScan('p1', 'scan-1', 'opengrep');

    expect(getScan).toHaveBeenCalledTimes(1);
    expect(diff.upsertSummary).toHaveBeenCalledWith(
      'scan-1',
      'p1',
      'feat/x',
      'sast,secret',
      { initializerUserId: 'u1', codingAgent: 'cursor' },
    );
  });
});

/**
 * ScanMetaCache is an OPTIONAL dependency of SastIacService, so the many
 * unit-test modules keep compiling; a runtime that forgets to provide it
 * silently calls GetScan on every batch again. Pin the wiring.
 */
describe('ScanMetaCache wiring', () => {
  it('SastIacService asks Nest for ScanMetaCache, by class', () => {
    expect(Reflect.getMetadata('design:paramtypes', SastIacService)).toContain(
      ScanMetaCache,
    );
  });

  it('the @Global ScanQueueModule provides and exports it', () => {
    expect(Reflect.getMetadata('providers', ScanQueueModule)).toContain(
      ScanMetaCache,
    );
    expect(Reflect.getMetadata('exports', ScanQueueModule)).toContain(
      ScanMetaCache,
    );
  });
});
