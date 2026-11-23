import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { IsNull, LessThan, Not } from 'typeorm';

import {
  IMPORT_RUNNING_MAX_MS,
  IMPORT_WAITING_FOR_FILE_MAX_MS,
  ImportScanWatchdog,
} from './import-scan.watchdog';
import { ScanStateStore } from '../core/scanStateStore';
import { ScanStateManager } from '../core/scanStateManager';
import { FileManagementService } from '../../file/file-management.service';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

/**
 * `ImportScanWatchdog` — the cron that retires stuck import scans.
 * An import still `waiting_for_file` 45 minutes after its creation, or
 * `running` for more than 2 hours, is moved to `failed` with 76
 * IMPORT_TIMEOUT by ONE conditional UPDATE: a won move publishes the status
 * change and deletes the import object (`import/<projectId>/<scanId>.sarif`),
 * never the scan archive. A lost move deletes nothing and counts nothing.
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

describe('ImportScanWatchdog', () => {
  let module: TestingModule;
  let watchdog: ImportScanWatchdog;
  let scanRepository: ReturnType<typeof repoMock>;
  let qb: ReturnType<typeof makeQb>;
  let realtimePublish: jest.Mock;
  let deleteImportObject: jest.SpyInstance;
  let deleteFile: jest.SpyInstance;
  let loggerError: jest.Mock;

  const NOW = new Date('2026-05-01T12:00:00.000Z');

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

  beforeEach(async () => {
    qb = makeQb();
    realtimePublish = jest.fn().mockResolvedValue(undefined);
    loggerError = jest.fn();

    const scanRepo = repoMock();
    scanRepo.createQueryBuilder.mockReturnValue(qb);

    const arClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({}),
    };
    const pmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({}),
    };
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        deleteImportObject: jest.fn().mockReturnValue(of({ success: true })),
        deleteFile: jest.fn().mockReturnValue(of({ success: true })),
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        ImportScanWatchdog,
        ScanStateStore,
        ScanStateManager,
        FileManagementService,
        {
          provide: SCAN_LIFECYCLE_HOOKS,
          useValue: { onScanClosed: jest.fn() },
        },
        { provide: getRepositoryToken(Scan), useValue: scanRepo },
        { provide: getRepositoryToken(Container), useValue: repoMock() },
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: arClient },
        { provide: 'POLICY_MANAGEMENT_SERVICE', useValue: pmClient },
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
        {
          provide: RealtimeEventPublisher,
          useValue: { publish: realtimePublish },
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: loggerError,
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    watchdog = module.get(ImportScanWatchdog);
    module.get(ScanStateManager).onModuleInit();
    const fileManagement = module.get(FileManagementService);
    fileManagement.onModuleInit();
    deleteImportObject = jest
      .spyOn(fileManagement, 'deleteImportObject')
      .mockResolvedValue(undefined);
    deleteFile = jest
      .spyOn(fileManagement, 'deleteFile')
      .mockResolvedValue({ success: true } as never);
    scanRepository = module.get(getRepositoryToken(Scan));
  });

  afterEach(async () => {
    await module.close();
  });

  it('fails an import still waiting for its file after 45 minutes with IMPORT_TIMEOUT', async () => {
    const scan = scanOf({
      createAt: new Date(
        NOW.getTime() - IMPORT_WAITING_FOR_FILE_MAX_MS - 60_000,
      ),
    });
    scanRepository.find.mockResolvedValueOnce([scan]).mockResolvedValueOnce([]);

    const won = await watchdog.expireStuckImports(NOW);

    expect(won).toBe(1);
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'failed',
        endTime: NOW,
        errorCode: 76,
        errorCategory: 'import',
        errorMessage: 'IMPORT_TIMEOUT',
      }),
    );
    // The won move publishes the waiting_for_file → failed change.
    expect(realtimePublish).toHaveBeenCalledTimes(1);
    const event = realtimePublish.mock.calls[0][0];
    expect(event.payload.scanStatusChanged).toMatchObject({
      scanId: 's1',
      previousState: 'waiting_for_file',
      currentState: 'failed',
      errorCode: 76,
      errorCategory: 'import',
      errorMessage: 'IMPORT_TIMEOUT',
    });
  });

  it('fails an import running for more than 2 hours, deletes its object and publishes the change', async () => {
    const scan = scanOf({
      state: 'running',
      startTime: new Date(NOW.getTime() - IMPORT_RUNNING_MAX_MS - 60_000),
    });
    scanRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([scan]);

    const won = await watchdog.expireStuckImports(NOW);

    expect(won).toBe(1);
    // The columns of the move hold the failure triplet.
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'failed',
        endTime: NOW,
        errorCode: 76,
        errorCategory: 'import',
        errorMessage: 'IMPORT_TIMEOUT',
      }),
    );
    expect(realtimePublish).toHaveBeenCalledTimes(1);
    expect(
      realtimePublish.mock.calls[0][0].payload.scanStatusChanged,
    ).toMatchObject({
      previousState: 'running',
      currentState: 'failed',
    });
    // The import object is deleted, never the scan archive.
    expect(deleteImportObject).toHaveBeenCalledTimes(1);
    expect(deleteImportObject).toHaveBeenCalledWith('p1', 'import/p1/s1.sarif');
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('deletes the SBOM of an sca import with its SARIF', async () => {
    const scan = scanOf({
      state: 'running',
      scanType: 'sca',
      metadata: { importSbom: true },
      startTime: new Date(NOW.getTime() - IMPORT_RUNNING_MAX_MS - 60_000),
    });
    scanRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([scan]);

    await watchdog.expireStuckImports(NOW);

    expect(deleteImportObject.mock.calls).toEqual([
      ['p1', 'import/p1/s1.sarif'],
      ['p1', 'import/p1/s1.sbom'],
    ]);
  });

  it('touches neither a code scan nor a recent import', async () => {
    scanRepository.find.mockResolvedValue([]);

    const won = await watchdog.expireStuckImports(NOW);

    expect(won).toBe(0);
    // The two lists: import scans only (importFormat IS NOT NULL), and only
    // the ones older than their deadline.
    expect(scanRepository.find).toHaveBeenNthCalledWith(1, {
      where: {
        state: 'waiting_for_file',
        importFormat: Not(IsNull()),
        createAt: LessThan(
          new Date(NOW.getTime() - IMPORT_WAITING_FOR_FILE_MAX_MS),
        ),
      },
    });
    expect(scanRepository.find).toHaveBeenNthCalledWith(2, {
      where: {
        state: 'running',
        importFormat: Not(IsNull()),
        startTime: LessThan(new Date(NOW.getTime() - IMPORT_RUNNING_MAX_MS)),
      },
    });
    // Nothing was read as stuck: no state move at all.
    expect(qb.update).not.toHaveBeenCalled();
    expect(deleteImportObject).not.toHaveBeenCalled();
  });

  it('counts only the moves it won', async () => {
    const waiting = scanOf({ id: 's-w' });
    const running = scanOf({
      id: 's-r',
      state: 'running',
      startTime: new Date(NOW.getTime() - IMPORT_RUNNING_MAX_MS - 60_000),
    });
    scanRepository.find
      .mockResolvedValueOnce([waiting])
      .mockResolvedValueOnce([running]);
    // The first move wins, the second loses the race (the row left its state).
    qb.execute
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });

    const won = await watchdog.expireStuckImports(NOW);

    expect(won).toBe(1);
    expect(qb.set).toHaveBeenCalledTimes(2);
    // Only the won move deletes its object and publishes.
    expect(deleteImportObject).toHaveBeenCalledTimes(1);
    expect(deleteImportObject).toHaveBeenCalledWith(
      'p1',
      'import/p1/s-w.sarif',
    );
    expect(realtimePublish).toHaveBeenCalledTimes(1);
  });

  it('handleCron catches and logs, never rejects', async () => {
    scanRepository.find.mockRejectedValue(new Error('database is down'));

    await expect(watchdog.handleCron()).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledTimes(1);
  });
});
