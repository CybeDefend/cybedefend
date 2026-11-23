import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { DataSource, In, Repository } from 'typeorm';

import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { ScanStateManager, ScanStateStore } from '../core';
import { ProjectAppsecMarker } from '../core/projectAppsecMarker';
import { FileManagementService } from '../../file/file-management.service';
import { ImportScanService } from './import-scan.service';
import { ImportScanWatchdog } from './import-scan.watchdog';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

/**
 * LIVE proof of the import-scan lifecycle on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`, default mysql): the import columns exist
 * after the dialect's migrations (the MySQL track + migrations-common, or the
 * PostgreSQL baseline + migrations-common), and `CompleteImportScan` and the
 * watchdog race on one row with exactly one terminal write winning on each
 * engine — the move is decided on the UPDATE's affected-row count.
 *
 * Skipped unless `SS_IMPORT_SCAN_MYSQL_LIVE=1` (the legacy flag pins mysql), so
 * `pnpm run test` stays hermetic. The throwaway database is created by
 * `createLiveDatabase` (`SS_IMPORT_SCAN_MYSQL_URL` / `SS_IMPORT_SCAN_PG_URL`),
 * its schema built by the service's real migrations on the selected engine,
 * and it is dropped at the end.
 *
 * How to run:
 *   SS_IMPORT_SCAN_MYSQL_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/import/import-scan.lifecycle.live.spec.ts
 *   SS_IMPORT_SCAN_MYSQL_LIVE=1 LIVE_DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/import/import-scan.lifecycle.live.spec.ts
 */
const describeLive = liveEnabled('SS_IMPORT_SCAN') ? describe : describe.skip;

const PROJECT = 'p-import-live';

describeLive('import scan lifecycle on a real database', () => {
  // SARIF import is a Community Edition feature: StartScan refuses an import
  // scan elsewhere. The edition is switched once the database exists, since
  // the Community Edition refuses to open MySQL and this spec also proves the
  // import columns on the MySQL track.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  afterAll(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let dataSource: DataSource;
  let module: TestingModule;
  let importScans: ImportScanService;
  let watchdog: ImportScanWatchdog;
  let importResults: jest.Mock;

  const scanRepo = (): Repository<Scan> => dataSource.getRepository(Scan);

  const seedImportScan = (overrides: Partial<Scan> = {}): Promise<Scan> =>
    scanRepo().save({
      name: `imp-${randomUUID().slice(0, 8)}`,
      state: 'running',
      language: ['python'],
      projectId: PROJECT,
      organizationId: 'org-import-live',
      scanType: 'sast',
      branch: 'main',
      importFormat: 'sarif',
      importTool: null,
      startTime: new Date(Date.now() - 3 * 3_600_000),
      ...overrides,
    });

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ss_import_scan',
      envPrefix: 'SS_IMPORT_SCAN',
    });
    dataSource = db.dataSource;
    process.env.CYBEDEFEND_EDITION = 'community';

    importResults = jest.fn().mockReturnValue(of({ accepted: true }));
    const arClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        importResults,
        notifyScanEnded: jest.fn().mockReturnValue(of({ message: 'ok' })),
      }),
    };
    const gmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        markProjectAppsec: jest
          .fn()
          .mockReturnValue(of({ appsec: true, limitReached: false })),
      }),
    };
    const pmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        triggerEvaluation: jest.fn().mockReturnValue(of({ evaluationId: '' })),
      }),
    };
    const fmClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({
        deleteImportObject: jest.fn().mockReturnValue(of({ success: true })),
        deleteFile: jest.fn().mockReturnValue(of({ success: true })),
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        ImportScanService,
        ImportScanWatchdog,
        ScanStateStore,
        ScanStateManager,
        ProjectAppsecMarker,
        FileManagementService,
        {
          provide: ENTITLEMENTS_PORT,
          useValue: {
            isWritable: jest
              .fn()
              .mockResolvedValue({ writable: true, trial: false }),
            hasFeature: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: SCAN_LIFECYCLE_HOOKS,
          useValue: { onScanClosed: jest.fn() },
        },
        ...[Scan, Container, Scanner, SupportedLanguage].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        { provide: RealtimeEventPublisher, useValue: { publish: jest.fn() } },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: arClient },
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: gmClient },
        { provide: 'POLICY_MANAGEMENT_SERVICE', useValue: pmClient },
        { provide: 'FILE_MANAGEMENT_SERVICE', useValue: fmClient },
      ],
    }).compile();

    importScans = module.get(ImportScanService);
    importScans.onModuleInit();
    watchdog = module.get(ImportScanWatchdog);
    module.get(ScanStateManager).onModuleInit();
    module.get(FileManagementService).onModuleInit();
  });

  afterAll(async () => {
    await module?.close();
    await db?.drop();
  });

  it('has the import columns after the dialect migrations', async () => {
    const queryRunner = dataSource.createQueryRunner();
    try {
      expect(await queryRunner.hasColumn('scan', 'importFormat')).toBe(true);
      expect(await queryRunner.hasColumn('scan', 'importTool')).toBe(true);
    } finally {
      await queryRunner.release();
    }
  });

  // A CI/CD import looks up the scanners of its type to weigh its progress:
  // the scanner type enum must accept `cicd` on both engines.
  it('looks up the scanners of a cicd scan after the dialect migrations', async () => {
    const scanners = dataSource.getRepository(Scanner);
    await expect(
      scanners.find({
        where: { enabled: true, scannerType: In(['cicd', 'sast']) },
        select: ['name', 'imageName', 'scannerType'],
      }),
    ).resolves.toEqual(expect.any(Array));
    const saved = await scanners.save({
      name: `cicd-${randomUUID().slice(0, 8)}`,
      imageName: 'cicd-scanner',
      enabled: false,
      scannerType: 'cicd',
    });
    try {
      await expect(
        scanners.count({ where: { scannerType: 'cicd', id: saved.id } }),
      ).resolves.toBe(1);
    } finally {
      await scanners.delete({ id: saved.id });
    }
  });

  it('lets exactly one of CompleteImportScan and the watchdog end a running import', async () => {
    for (let round = 0; round < 20; round++) {
      const scan = await seedImportScan();

      const [completion, won] = await Promise.all([
        importScans
          .complete({
            scanId: scan.id,
            status: 'completed',
            errorCode: '',
            findingsCount: 5,
            toolName: 'semgrep',
          })
          .then(
            (response) => ({ ok: true as const, response }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        watchdog.expireStuckImports(),
      ]);

      const row = await scanRepo().findOneByOrFail({ id: scan.id });
      expect(['completed', 'failed']).toContain(row.state);
      if (row.state === 'completed') {
        // CompleteImportScan won: the watchdog's move lost, the completion
        // answered success, and no failure code was written.
        expect(completion.ok).toBe(true);
        expect(won).toBe(0);
        expect(row.errorCode).toBeNull();
        expect(row.importTool).toBe('semgrep');
      } else {
        // The watchdog won: the row holds the timeout triplet, the completion
        // was refused, and exactly one move was won.
        expect(row.state).toBe('failed');
        expect(row.errorCode).toBe(76);
        expect(row.errorCategory).toBe('import');
        expect(row.errorMessage).toBe('IMPORT_TIMEOUT');
        expect(completion.ok).toBe(false);
        expect(won).toBe(1);
      }
    }
  });

  it('answers a repeated completion with success and changes nothing', async () => {
    const scan = await seedImportScan();

    const first = await importScans.complete({
      scanId: scan.id,
      status: 'completed',
      errorCode: '',
      findingsCount: 9,
      toolName: 'semgrep',
    });
    expect(first.success).toBe(true);

    const before = await scanRepo().findOneByOrFail({ id: scan.id });
    const second = await importScans.complete({
      scanId: scan.id,
      status: 'completed',
      errorCode: '',
      findingsCount: 9,
      toolName: 'semgrep',
    });

    expect(second.success).toBe(true);
    expect(second.message).toMatch(/already completed/);
    const after = await scanRepo().findOneByOrFail({ id: scan.id });
    expect(after).toEqual(before);
  });

  it('moves an import from waiting_for_file to running exactly once under two concurrent StartScan', async () => {
    const scan = await seedImportScan({
      state: 'waiting_for_file',
      startTime: null,
    });
    const loaded1 = await scanRepo().findOneByOrFail({ id: scan.id });
    const loaded2 = await scanRepo().findOneByOrFail({ id: scan.id });
    importResults.mockClear();

    const results = await Promise.allSettled([
      importScans.start(loaded1, {
        scanId: scan.id,
        projectId: PROJECT,
        language: [],
      }),
      importScans.start(loaded2, {
        scanId: scan.id,
        projectId: PROJECT,
        language: [],
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    // Only the winner reached analysis-reporting ImportResults.
    expect(importResults).toHaveBeenCalledTimes(1);
    const row = await scanRepo().findOneByOrFail({ id: scan.id });
    expect(row.state).toBe('running');
    expect(row.startTime).not.toBeNull();
  });
});
