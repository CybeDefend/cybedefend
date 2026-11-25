import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Observable, of, throwError } from 'rxjs';

import { ImportScanService } from './import-scan.service';
import { HandledScanStartError } from '../core/handled-scan-start-error';
import { ScanStateStore } from '../core/scanStateStore';
import { ScanStateManager } from '../core/scanStateManager';
import { ProjectAppsecMarker } from '../core/projectAppsecMarker';
import { FileManagementService } from '../../file/file-management.service';
import { CompleteImportScanRequest } from '@grpc/security-scanning/scan';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ScanResultsService } from '../cluster-results/scan-results.service';

/**
 * `ImportScanService.start` — an import scan starts without a pod,
 * a scan quota or an agent row: the row is claimed waiting_for_file →
 * running, and the stored file is handed to analysis-reporting
 * `ImportResults` with the key `import/<projectId>/<scanId>.sarif`.
 */

const repoMock = () => ({
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(async (entity: unknown) => entity),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  create: jest.fn((x: unknown) => x),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
});

/** The chainable query builder the state store's conditional UPDATEs use. */
const makeQb = () => {
  const qb = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  qb.update.mockReturnValue(qb);
  qb.set.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  return qb;
};

describe('ImportScanService', () => {
  let module: TestingModule;
  let importScans: ImportScanService;
  let scanRepository: ReturnType<typeof repoMock>;
  let containerRepository: ReturnType<typeof repoMock>;
  let qb: ReturnType<typeof makeQb>;
  let importResults: jest.Mock;
  let deleteImportObjectRpc: jest.Mock;
  let deleteFileRpc: jest.Mock;
  let realtimePublish: jest.Mock;
  let entitlements: { isWritable: jest.Mock; hasFeature: jest.Mock };
  let loggerWarn: jest.Mock;
  let loggerLog: jest.Mock;
  let closeContainer: jest.Mock;

  const scanOf = (overrides: Partial<Scan> = {}): Scan =>
    ({
      id: 's1',
      projectId: 'p1',
      organizationId: 'org-1',
      state: 'waiting_for_file',
      scanType: 'sast',
      branch: 'main',
      importFormat: 'sarif',
      importTool: null,
      ...overrides,
    }) as unknown as Scan;

  // SARIF import is a Community Edition feature: every case here runs
  // there. The refusal elsewhere is tested by the closed edition.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  beforeEach(async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    qb = makeQb();
    importResults = jest.fn().mockReturnValue(of({ accepted: true }));
    deleteImportObjectRpc = jest.fn().mockReturnValue(of({ success: true }));
    deleteFileRpc = jest.fn().mockReturnValue(of({ success: true }));
    realtimePublish = jest.fn().mockResolvedValue(undefined);
    entitlements = {
      isWritable: jest.fn().mockResolvedValue({ writable: true, trial: false }),
      hasFeature: jest.fn().mockResolvedValue(true),
    };
    loggerWarn = jest.fn();
    loggerLog = jest.fn();
    closeContainer = jest
      .fn()
      .mockResolvedValue({ success: true, message: 'Container completed' });

    const scanRepo = repoMock();
    scanRepo.createQueryBuilder.mockReturnValue(qb);

    const arClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ importResults }),
    };
    const gmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        markProjectAppsec: jest
          .fn()
          .mockReturnValue(of({ appsec: true, limitReached: false })),
      }),
    };
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        deleteImportObject: deleteImportObjectRpc,
        deleteFile: deleteFileRpc,
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        ImportScanService,
        ScanStateStore,
        ScanStateManager,
        ProjectAppsecMarker,
        FileManagementService,
        { provide: ENTITLEMENTS_PORT, useValue: entitlements },
        {
          provide: SCAN_LIFECYCLE_HOOKS,
          useValue: { onScanClosed: jest.fn() },
        },
        { provide: getRepositoryToken(Scan), useValue: scanRepo },
        { provide: getRepositoryToken(Container), useValue: repoMock() },
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: arClient },
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: gmClient },
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
        {
          provide: 'POLICY_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
        {
          provide: RealtimeEventPublisher,
          useValue: { publish: realtimePublish },
        },
        { provide: ScanResultsService, useValue: { closeContainer } },
        {
          provide: Logger,
          useValue: {
            log: loggerLog,
            warn: loggerWarn,
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    importScans = module.get(ImportScanService);
    importScans.onModuleInit();
    module.get(ScanStateManager).onModuleInit();
    module.get(FileManagementService).onModuleInit();
    scanRepository = module.get(getRepositoryToken(Scan));
    containerRepository = module.get(getRepositoryToken(Container));
  });

  afterEach(async () => {
    await module.close();
  });

  describe('isImportRequest', () => {
    it('is true only when importFormat is set and non-empty', () => {
      expect(
        importScans.isImportRequest({ importFormat: 'sarif' } as never),
      ).toBe(true);
      expect(importScans.isImportRequest({} as never)).toBe(false);
      expect(importScans.isImportRequest({ importFormat: '' } as never)).toBe(
        false,
      );
    });
  });

  it('starts an import without a pod, a scan quota or an agent row, and hands it to analysis-reporting', async () => {
    const scan = scanOf();

    const result = await importScans.start(scan, {
      scanId: 's1',
      projectId: 'p1',
      language: [],
    });

    expect(entitlements.isWritable).toHaveBeenCalledWith('org-1');
    expect(importResults).toHaveBeenCalledTimes(1);
    const arg = importResults.mock.calls[0][0];
    expect(arg).toEqual({
      scanId: 's1',
      projectId: 'p1',
      organizationId: 'org-1',
      branch: 'main',
      vulnerabilityType: 'sast',
      format: 'sarif',
      fileKey: 'import/p1/s1.sarif',
    });
    expect(arg).not.toHaveProperty('image');
    expect(realtimePublish).toHaveBeenCalledTimes(1);
    expect(
      realtimePublish.mock.calls[0][0].payload.scanStatusChanged.currentState,
    ).toBe('running');
    expect(containerRepository.save).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      scanId: 's1',
      message: 'Import started.',
      detectedLanguages: [],
    });
  });

  it('hands the SBOM key of an sca import that stored one', async () => {
    await importScans.start(
      scanOf({ scanType: 'sca', metadata: { importSbom: true } }),
      { scanId: 's1', projectId: 'p1', language: [] },
    );
    expect(importResults.mock.calls[0][0]).toEqual({
      scanId: 's1',
      projectId: 'p1',
      organizationId: 'org-1',
      branch: 'main',
      vulnerabilityType: 'sca',
      format: 'sarif',
      fileKey: 'import/p1/s1.sarif',
      sbomFileKey: 'import/p1/s1.sbom',
    });
  });

  it('deletes the SBOM with the SARIF when analysis-reporting does not accept the import', async () => {
    importResults.mockReturnValue(of({ accepted: false }));
    await importScans
      .start(scanOf({ scanType: 'sca', metadata: { importSbom: true } }), {
        scanId: 's1',
        projectId: 'p1',
        language: [],
      })
      .catch(() => undefined);
    expect(deleteImportObjectRpc.mock.calls.map(([req]) => req)).toEqual([
      { projectId: 'p1', objectKey: 'import/p1/s1.sarif' },
      { projectId: 'p1', objectKey: 'import/p1/s1.sbom' },
    ]);
  });

  it('refuses WRITES_BLOCKED when the organisation cannot write, before any move', async () => {
    entitlements.isWritable.mockResolvedValueOnce({
      writable: false,
      trial: false,
    });

    const error = await importScans
      .start(scanOf(), { scanId: 's1', projectId: 'p1', language: [] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toMatchObject({
      code: status.PERMISSION_DENIED,
      message: 'WRITES_BLOCKED',
    });
    expect(scanRepository.update).not.toHaveBeenCalled();
    expect(qb.execute).not.toHaveBeenCalled();
    expect(importResults).not.toHaveBeenCalled();
  });

  it.each([
    [
      'not accepted',
      () => importResults.mockReturnValue(of({ accepted: false })),
    ],
    [
      'downstream UNAVAILABLE',
      () =>
        importResults.mockReturnValue(
          throwError(() => ({ code: status.UNAVAILABLE })),
        ),
    ],
  ])(
    'fails the scan IMPORT_UNAVAILABLE (75, import) when analysis-reporting %s',
    async (_label, arrange) => {
      arrange();

      const error = await importScans
        .start(scanOf(), { scanId: 's1', projectId: 'p1', language: [] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HandledScanStartError);
      expect((error as RpcException).getError()).toMatchObject({
        code: status.UNAVAILABLE,
        message: 'IMPORT_UNAVAILABLE',
      });
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          errorCode: 75,
          errorCategory: 'import',
          errorMessage: 'IMPORT_UNAVAILABLE',
        }),
      );
      expect(deleteImportObjectRpc).toHaveBeenCalledWith({
        projectId: 'p1',
        objectKey: 'import/p1/s1.sarif',
      });
      expect(deleteFileRpc).not.toHaveBeenCalled();
    },
  );

  it('answers RESOURCE_EXHAUSTED IMPORT_QUEUE_FULL when the organization has too many imports waiting', async () => {
    importResults.mockReturnValue(
      throwError(() => ({
        code: status.RESOURCE_EXHAUSTED,
        details: 'IMPORT_QUEUE_FULL: too many imports are waiting',
      })),
    );

    const error = await importScans
      .start(scanOf(), { scanId: 's1', projectId: 'p1', language: [] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HandledScanStartError);
    expect((error as RpcException).getError()).toMatchObject({
      code: status.RESOURCE_EXHAUSTED,
      message: 'IMPORT_QUEUE_FULL',
    });
    // The import scan ends failed and its file is removed, as for any
    // refused import: the caller sends it again later.
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'failed' }),
    );
    expect(deleteImportObjectRpc).toHaveBeenCalled();
  });

  it('fails the scan IMPORT_UNAVAILABLE when the ImportResults call never answers within 15 s', async () => {
    jest.useFakeTimers();
    try {
      importResults.mockReturnValue(new Observable(() => {}));

      const settled = importScans
        .start(scanOf(), { scanId: 's1', projectId: 'p1', language: [] })
        .catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(15_000);
      const error = await settled;

      expect(error).toBeInstanceOf(HandledScanStartError);
      expect((error as RpcException).getError()).toMatchObject({
        code: status.UNAVAILABLE,
        message: 'IMPORT_UNAVAILABLE',
      });
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          errorCode: 75,
          errorCategory: 'import',
          errorMessage: 'IMPORT_UNAVAILABLE',
        }),
      );
      expect(deleteImportObjectRpc).toHaveBeenCalledWith({
        projectId: 'p1',
        objectKey: 'import/p1/s1.sarif',
      });
      expect(deleteFileRpc).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses a second StartScan of a running import without touching it', async () => {
    const error = await importScans
      .start(scanOf({ state: 'running' }), {
        scanId: 's1',
        projectId: 'p1',
        language: [],
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HandledScanStartError);
    expect((error as RpcException).getError()).toMatchObject({
      code: status.FAILED_PRECONDITION,
      message: 'Scan s1 cannot be started in state: running',
    });
    expect(qb.execute).not.toHaveBeenCalled();
    expect(importResults).not.toHaveBeenCalled();
  });

  /**
   * `CompleteImportScan` — analysis-reporting's end-of-import
   * signal moves the running import to completed|failed with one conditional
   * UPDATE; a won move publishes SCAN_STATUS_CHANGED, deletes the import
   * object and, when completed, runs the scan-end clean-up.
   */
  describe('complete', () => {
    const completeRequest = (
      overrides: Record<string, unknown> = {},
    ): CompleteImportScanRequest =>
      ({
        scanId: 's1',
        status: 'completed',
        errorCode: '',
        findingsCount: 0,
        toolName: '',
        ...overrides,
      }) as CompleteImportScanRequest;

    let handleCompleted: jest.SpyInstance;

    beforeEach(() => {
      handleCompleted = jest
        .spyOn(module.get(ScanStateManager), 'handleCompletedScan')
        .mockResolvedValue(undefined);
    });

    it('completes a running import: state, findings count, tool list, event, scan end, object deleted', async () => {
      const scan = scanOf({
        state: 'running',
        metadata: { source: 'cli' },
      });
      scanRepository.findOne.mockResolvedValue(scan);

      const response = await importScans.complete(
        completeRequest({
          status: 'completed',
          findingsCount: 42.7,
          toolName: 'semgrep,CodeQL',
        }),
      );

      expect(response).toEqual({
        success: true,
        message: 'Import scan completed',
      });
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'completed',
          endTime: expect.any(Date),
          metadata: { source: 'cli', importFindingsCount: 42 },
          importTool: 'semgrep,codeql',
          errorCode: null,
          errorCategory: null,
          errorMessage: null,
        }),
      );
      expect(handleCompleted).toHaveBeenCalledTimes(1);
      expect(handleCompleted).toHaveBeenCalledWith(scan);
      expect(realtimePublish).toHaveBeenCalledTimes(1);
      expect(
        realtimePublish.mock.calls[0][0].payload.scanStatusChanged,
      ).toEqual({
        scanId: 's1',
        previousState: 'running',
        currentState: 'completed',
      });
      expect(deleteImportObjectRpc).toHaveBeenCalledTimes(1);
      expect(deleteImportObjectRpc).toHaveBeenCalledWith({
        projectId: 'p1',
        objectKey: 'import/p1/s1.sarif',
      });
      expect(deleteFileRpc).not.toHaveBeenCalled();
      expect(loggerLog).toHaveBeenCalledWith(
        'IMPORT_SCAN_COMPLETED scan=s1 status=completed code=- findings=42',
      );
    });

    it('deletes the SBOM with the SARIF when the import ends', async () => {
      scanRepository.findOne.mockResolvedValue(
        scanOf({
          state: 'running',
          scanType: 'sca',
          metadata: { importSbom: true },
        }),
      );
      await importScans.complete(
        completeRequest({ status: 'failed', errorCode: 'IMPORT_INVALID_SBOM' }),
      );
      expect(deleteImportObjectRpc.mock.calls.map(([req]) => req)).toEqual([
        { projectId: 'p1', objectKey: 'import/p1/s1.sarif' },
        { projectId: 'p1', objectKey: 'import/p1/s1.sbom' },
      ]);
      // 79: any other IMPORT_ code, the code itself in errorMessage
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          errorCode: 79,
          errorCategory: 'import',
          errorMessage: 'IMPORT_INVALID_SBOM',
        }),
      );
    });

    // A Community cluster container's end of import
    // closes that container (ScanResultsService), never the import scan.
    it('a completion with containerId never completes the import scan path', async () => {
      const request = completeRequest({
        containerId: '22222222-2222-4222-8222-222222222222',
        status: 'completed',
        findingsCount: 3,
      });
      await expect(importScans.complete(request)).resolves.toEqual({
        success: true,
        message: 'Container completed',
      });
      expect(closeContainer).toHaveBeenCalledWith(request);
      expect(scanRepository.findOne).not.toHaveBeenCalled();
      expect(qb.set).not.toHaveBeenCalled();
      expect(handleCompleted).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).not.toHaveBeenCalled();
      expect(realtimePublish).not.toHaveBeenCalled();
    });

    // ScanResultsService lives in the Community-only ClusterScanningModule.
    // The closed edition has none, so a request
    // naming a container is refused before any read or write.
    it('without the cluster engine, a containerId is INVALID_ARGUMENT and nothing is written', async () => {
      const cloud = new ImportScanService(
        scanRepository as never,
        module.get(ScanStateStore),
        module.get(ScanStateManager),
        module.get(ProjectAppsecMarker),
        module.get(FileManagementService),
        entitlements as never,
        module.get('ANALYSIS_REPORTING_SERVICE'),
        module.get(Logger),
        undefined,
      );
      cloud.onModuleInit();
      const e = await cloud
        .complete(
          completeRequest({
            containerId: '22222222-2222-4222-8222-222222222222',
            status: 'completed',
          }),
        )
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RpcException);
      expect((e as RpcException).getError()).toMatchObject({
        code: status.INVALID_ARGUMENT,
      });
      expect(closeContainer).not.toHaveBeenCalled();
      expect(scanRepository.findOne).not.toHaveBeenCalled();
      expect(qb.set).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).not.toHaveBeenCalled();
      expect(realtimePublish).not.toHaveBeenCalled();
    });

    it('an empty containerId is the import scan path, unchanged', async () => {
      scanRepository.findOne.mockResolvedValue(scanOf({ state: 'running' }));
      await importScans.complete(completeRequest({ containerId: '' }));
      expect(closeContainer).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).toHaveBeenCalledWith({
        projectId: 'p1',
        objectKey: 'import/p1/s1.sarif',
      });
    });

    it('keeps the tool stored at creation when the scan already has one', async () => {
      scanRepository.findOne.mockResolvedValue(
        scanOf({ state: 'running', importTool: 'trivy' }),
      );

      await importScans.complete(
        completeRequest({ status: 'completed', toolName: 'semgrep' }),
      );

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ importTool: 'trivy' }),
      );
    });

    it('fails a running import with its stable code and deletes its object', async () => {
      scanRepository.findOne.mockResolvedValue(scanOf({ state: 'running' }));

      const response = await importScans.complete(
        completeRequest({
          status: 'failed',
          errorCode: 'IMPORT_TOO_MANY_RUNS',
          findingsCount: 0,
        }),
      );

      expect(response).toEqual({
        success: true,
        message: 'Import scan failed',
      });
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          endTime: expect.any(Date),
          metadata: { importFindingsCount: 0 },
          errorCode: 73,
          errorCategory: 'import',
          errorMessage: 'IMPORT_TOO_MANY_RUNS',
        }),
      );
      expect(handleCompleted).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).toHaveBeenCalledTimes(1);
      expect(deleteImportObjectRpc).toHaveBeenCalledWith({
        projectId: 'p1',
        objectKey: 'import/p1/s1.sarif',
      });
      expect(deleteFileRpc).not.toHaveBeenCalled();
      expect(realtimePublish).toHaveBeenCalledTimes(1);
      expect(
        realtimePublish.mock.calls[0][0].payload.scanStatusChanged,
      ).toMatchObject({
        previousState: 'running',
        currentState: 'failed',
        errorCode: 73,
      });
      expect(loggerLog).toHaveBeenCalledWith(
        'IMPORT_SCAN_COMPLETED scan=s1 status=failed code=IMPORT_TOO_MANY_RUNS findings=0',
      );
    });

    it.each([
      ['IMPORT_INTERNAL_ERROR', 77],
      ['IMPORT_UNSUPPORTED_RESULT', 78],
      ['IMPORT_SOMETHING_ELSE', 79],
    ])('stores %s as error code %i', async (code, numeric) => {
      scanRepository.findOne.mockResolvedValue(scanOf({ state: 'running' }));

      await importScans.complete(
        completeRequest({ status: 'failed', errorCode: code }),
      );

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failed',
          errorCode: numeric,
          errorCategory: 'import',
          errorMessage: code,
        }),
      );
      expect(handleCompleted).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).toHaveBeenCalledWith({
        projectId: 'p1',
        objectKey: 'import/p1/s1.sarif',
      });
    });

    it('answers success again, and does nothing, when the same completion is repeated', async () => {
      scanRepository.findOne.mockResolvedValueOnce(
        scanOf({ state: 'running' }),
      );

      const first = await importScans.complete(
        completeRequest({ status: 'completed', findingsCount: 3 }),
      );
      expect(first).toEqual({
        success: true,
        message: 'Import scan completed',
      });
      expect(realtimePublish).toHaveBeenCalledTimes(1);
      expect(deleteImportObjectRpc).toHaveBeenCalledTimes(1);
      expect(handleCompleted).toHaveBeenCalledTimes(1);

      // analysis-reporting retries: the conditional move loses, the row
      // reads completed.
      qb.execute.mockResolvedValue({ affected: 0 });
      scanRepository.findOne.mockResolvedValue(scanOf({ state: 'completed' }));

      const second = await importScans.complete(
        completeRequest({ status: 'completed', findingsCount: 3 }),
      );

      expect(second).toEqual({
        success: true,
        message: 'Import scan already completed',
      });
      expect(realtimePublish).toHaveBeenCalledTimes(1);
      expect(deleteImportObjectRpc).toHaveBeenCalledTimes(1);
      expect(handleCompleted).toHaveBeenCalledTimes(1);
    });

    it('refuses to complete an import the watchdog already failed', async () => {
      qb.execute.mockResolvedValue({ affected: 0 });
      scanRepository.findOne.mockResolvedValue(scanOf({ state: 'failed' }));

      const error = await importScans
        .complete(completeRequest({ status: 'completed' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toMatchObject({
        code: status.FAILED_PRECONDITION,
        message: 'Import scan cannot be completed in state: failed',
      });
      expect(realtimePublish).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).not.toHaveBeenCalled();
      expect(handleCompleted).not.toHaveBeenCalled();
    });

    it('refuses an unknown scan with NOT_FOUND', async () => {
      scanRepository.findOne.mockResolvedValue(null);

      const error = await importScans
        .complete(completeRequest({ status: 'completed' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toMatchObject({
        code: status.NOT_FOUND,
      });
      expect(qb.execute).not.toHaveBeenCalled();
    });

    it('refuses a scan that is not an import scan', async () => {
      scanRepository.findOne.mockResolvedValue(
        scanOf({ state: 'running', importFormat: null }),
      );

      const error = await importScans
        .complete(completeRequest({ status: 'completed' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toMatchObject({
        code: status.FAILED_PRECONDITION,
        message: 'NOT_AN_IMPORT_SCAN',
      });
      expect(qb.execute).not.toHaveBeenCalled();
      expect(deleteImportObjectRpc).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty scanId', completeRequest({ scanId: '' })],
      ['an unknown status', completeRequest({ status: 'queued' })],
      [
        'a failed status without a code',
        completeRequest({ status: 'failed', errorCode: '' }),
      ],
      [
        'a malformed failure code',
        completeRequest({ status: 'failed', errorCode: 'not-a-code' }),
      ],
    ])(
      'refuses %s with INVALID_ARGUMENT, writing nothing',
      async (_label, request) => {
        const error = await importScans
          .complete(request)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RpcException);
        expect((error as RpcException).getError()).toMatchObject({
          code: status.INVALID_ARGUMENT,
        });
        expect(scanRepository.findOne).not.toHaveBeenCalled();
        expect(qb.execute).not.toHaveBeenCalled();
        expect(deleteImportObjectRpc).not.toHaveBeenCalled();
      },
    );

    it('names the refusal of a bad status or code', async () => {
      const badStatus = await importScans
        .complete(completeRequest({ status: 'queued' }))
        .catch((e: unknown) => e);
      expect((badStatus as RpcException).getError()).toMatchObject({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_STATUS_INVALID',
      });

      const badCode = await importScans
        .complete(completeRequest({ status: 'failed', errorCode: 'nope' }))
        .catch((e: unknown) => e);
      expect((badCode as RpcException).getError()).toMatchObject({
        code: status.INVALID_ARGUMENT,
        message: 'IMPORT_ERROR_CODE_INVALID',
      });
    });

    it('answers success even when the scan-end clean-up fails', async () => {
      scanRepository.findOne.mockResolvedValue(scanOf({ state: 'running' }));
      handleCompleted.mockRejectedValue(new Error('policy service down'));

      const response = await importScans.complete(
        completeRequest({ status: 'completed', findingsCount: 1 }),
      );

      expect(response).toEqual({
        success: true,
        message: 'Import scan completed',
      });
      expect(handleCompleted).toHaveBeenCalledTimes(1);
      expect(deleteImportObjectRpc).toHaveBeenCalledTimes(1);
      expect(realtimePublish).toHaveBeenCalledTimes(1);
    });
  });
});
