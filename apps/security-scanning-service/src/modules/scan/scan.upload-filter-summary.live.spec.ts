import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { SCANNER_ORCHESTRATOR_PORT } from 'src/edition/ports/scanner-orchestrator.port';
import { ScanProgressUtils } from './core';
import { ScanService } from './scan.service';

/**
 * LIVE spec against a REAL database on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`, default mysql): the migrations add
 * `scan.uploadFilterSummary`, StartScan stores what the upload filter left
 * out, bounded, and GetScan returns it; a scan recorded without one returns
 * none.
 *
 * Skipped unless `SS_UPLOAD_FILTER_SUMMARY_LIVE=1`. It creates a throwaway
 * database with the service's real migrations and drops it at the end.
 *
 *   SS_UPLOAD_FILTER_SUMMARY_LIVE=1 LIVE_DB_TYPE=postgres SS_UPLOAD_FILTER_SUMMARY_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --testPathPatterns=upload-filter-summary.live --runInBand
 *   SS_UPLOAD_FILTER_SUMMARY_LIVE=1 LIVE_DB_TYPE=mysql SS_UPLOAD_FILTER_SUMMARY_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --testPathPatterns=upload-filter-summary.live --runInBand
 */
const describeLive = liveEnabled('SS_UPLOAD_FILTER_SUMMARY')
  ? describe
  : describe.skip;

describeLive('scan.uploadFilterSummary on a real database', () => {
  jest.setTimeout(180_000);

  let db: LiveDatabase;
  let dataSource: DataSource;
  let service: ScanService;
  // The orchestrator saves the scan it is handed, as the real ones do.
  const orchestratorStart = jest.fn(async (scan: Scan) => {
    scan.state = 'queued';
    await dataSource.getRepository(Scan).save(scan);
    return { success: true, message: 'queued' };
  });

  const SUMMARY = {
    scannerConfiguration: 1,
    excludedPath: 5,
    excludedType: 2,
    unsafeName: 0,
    gitMetadata: 0,
    excludedFolders: [
      { name: 'build', count: 3 },
      { name: 'web/dist', count: 1 },
    ],
  };

  const newScan = () =>
    dataSource.getRepository(Scan).save({
      name: 'upload',
      state: 'waiting_for_file',
      language: [],
      projectId: 'p-live',
      organizationId: 'org-live',
    });

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ss_upload_filter_summary',
      envPrefix: 'SS_UPLOAD_FILTER_SUMMARY',
    });
    dataSource = db.dataSource;

    const module = await Test.createTestingModule({
      providers: [
        ScanService,
        {
          provide: getRepositoryToken(Scan),
          useValue: dataSource.getRepository(Scan),
        },
        {
          provide: SCANNER_ORCHESTRATOR_PORT,
          useValue: { startScan: orchestratorStart },
        },
        {
          provide: ScanProgressUtils,
          useValue: { calculateScanProgress: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback?: string) => fallback },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    })
      // StartScan and GetScan read and write the scan table only.
      .useMocker(() => ({ getService: jest.fn(() => ({})) }))
      .compile();
    service = module.get(ScanService);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('the migrations add a nullable uploadFilterSummary column to scan', async () => {
    const runner = dataSource.createQueryRunner();
    try {
      const table = await runner.getTable('scan');
      const column = table?.findColumnByName('uploadFilterSummary');
      expect(column).toBeDefined();
      expect(column?.isNullable).toBe(true);
      expect(column?.type).toBe(db.dialect === 'postgres' ? 'jsonb' : 'json');
    } finally {
      await runner.release();
    }
  });

  it('stores the summary at the start and returns it, after the scan is saved again', async () => {
    const scan = await newScan();
    await service.startScan({
      scanId: scan.id,
      projectId: 'p-live',
      language: [],
      uploadFilterSummary: SUMMARY,
    });
    expect(orchestratorStart).toHaveBeenCalled();

    const response = await service.getScan({
      scanId: scan.id,
      projectId: 'p-live',
    });
    expect(response.state).toBe('queued');
    expect(response.uploadFilterSummary).toEqual(SUMMARY);
  });

  it('stores an oversized summary cut to its bounds', async () => {
    const scan = await newScan();
    const excludedFolders = Array.from({ length: 60 }, (_, i) => ({
      name: `${'é'.repeat(250)}/${i}`,
      count: i + 1,
    }));
    await service.startScan({
      scanId: scan.id,
      projectId: 'p-live',
      language: [],
      uploadFilterSummary: { ...SUMMARY, excludedFolders },
    });

    const { uploadFilterSummary } = await service.getScan({
      scanId: scan.id,
      projectId: 'p-live',
    });
    expect(uploadFilterSummary?.excludedFolders).toHaveLength(20);
    expect(uploadFilterSummary?.excludedFolders[0].count).toBe(60);
    for (const folder of uploadFilterSummary?.excludedFolders ?? []) {
      expect([...folder.name]).toHaveLength(200);
    }
  });

  it('starts the scan and stores a folder name holding a NUL and a right-to-left override, without them', async () => {
    const scan = await newScan();
    await service.startScan({
      scanId: scan.id,
      projectId: 'p-live',
      language: [],
      uploadFilterSummary: {
        ...SUMMARY,
        excludedFolders: [
          { name: 'a\u0000b/build', count: 2 },
          { name: '‮evil/dist', count: 1 },
        ],
      },
    });

    const response = await service.getScan({
      scanId: scan.id,
      projectId: 'p-live',
    });
    expect(response.state).toBe('queued');
    expect(response.uploadFilterSummary?.excludedFolders).toEqual([
      { name: 'ab/build', count: 2 },
      { name: 'evil/dist', count: 1 },
    ]);
  });

  it('a copy of the scan loaded before the start and saved after it keeps the summary', async () => {
    const scan = await newScan();
    const repository = dataSource.getRepository(Scan);
    const stale = await repository.findOneByOrFail({ id: scan.id });
    expect(stale.uploadFilterSummary).toBeNull();

    await service.startScan({
      scanId: scan.id,
      projectId: 'p-live',
      language: [],
      uploadFilterSummary: SUMMARY,
    });
    stale.errorMessage = 'written by another path';
    await repository.save(stale);

    const row = await repository.findOneByOrFail({ id: scan.id });
    expect(row.errorMessage).toBe('written by another path');
    expect(row.uploadFilterSummary).toEqual(SUMMARY);
  });

  it('a scan recorded without a summary returns none', async () => {
    const scan = await newScan();
    const response = await service.getScan({
      scanId: scan.id,
      projectId: 'p-live',
    });
    expect(response).not.toHaveProperty('uploadFilterSummary');
    const row = await dataSource
      .getRepository(Scan)
      .findOneByOrFail({ id: scan.id });
    expect(row.uploadFilterSummary).toBeNull();
  });
});
