import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { DataSource, QueryDeepPartialEntity } from 'typeorm';
import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { ScanProgressUtils, ScanStateManager, ScanStateStore } from './core';

/**
 * LIVE proof of the scan-claim primitives on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`, default mysql): the conditional UPDATE of
 * `compareAndSetScanState` has exactly one winner under concurrency, removes
 * the queued scan's registry credentials in the same statement, the
 * `projectId` precondition scopes the move, `writeScanState` never rewrites a
 * cancelled scan, `finalizeResults` stamps a held scan's results final for
 * one of two concurrent signals, `closeOpenContainer` closes an open
 * container exactly once,
 * and the average-duration aggregation of `scanProgressUtils` returns the
 * same milliseconds on both engines.
 *
 * Skipped unless `SS_SCAN_CLAIM_LIVE=1` (the legacy `SS_SCAN_CLAIM_MYSQL_LIVE=1`
 * pins mysql), so `pnpm run test` stays hermetic. The throwaway database is
 * created by `createLiveDatabase`, its schema built by the service's real
 * migrations on the selected engine, and it is dropped at the end.
 *
 * How to run:
 *   SS_SCAN_CLAIM_LIVE=1 LIVE_DB_TYPE=postgres SS_SCAN_CLAIM_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --testPathPatterns=scan.claim.live --runInBand
 *   SS_SCAN_CLAIM_LIVE=1 LIVE_DB_TYPE=mysql SS_SCAN_CLAIM_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --testPathPatterns=scan.claim.live --runInBand
 */
const describeLive = liveEnabled('SS_SCAN_CLAIM') ? describe : describe.skip;

const PROJECT = 'p-claim';

describeLive('scan claims and conditional writes on a real database', () => {
  jest.setTimeout(180_000);

  let db: LiveDatabase;
  let dataSource: DataSource;
  let store: ScanStateStore;
  let manager: ScanStateManager;
  let progress: ScanProgressUtils;

  const scanRepo = () => dataSource.getRepository(Scan);
  const containerRepo = () => dataSource.getRepository(Container);

  const seedScan = (
    state: string,
    metadata: Record<string, unknown> | null = {},
  ) =>
    scanRepo().save({
      name: `claim-${randomUUID().slice(0, 8)}`,
      state,
      language: ['python'],
      projectId: PROJECT,
      organizationId: 'org-claim',
      scanType: 'container',
      metadata,
    });

  const seedContainer = (
    scanId: string,
    status: string,
    startedAt?: Date,
    finishedAt?: Date,
  ) =>
    containerRepo().save({
      podName: `pod-${randomUUID().slice(0, 8)}`,
      image: 'appsec-sast-scanner:latest',
      status,
      scanId,
      startedAt,
      finishedAt,
    });

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ss_scan_claim',
      envPrefix: 'SS_SCAN_CLAIM',
    });
    dataSource = db.dataSource;

    const module = await Test.createTestingModule({
      providers: [
        ScanStateStore,
        ScanStateManager,
        ScanProgressUtils,
        ...[Scan, Container, Scanner, SupportedLanguage].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    store = module.get(ScanStateStore);
    manager = module.get(ScanStateManager);
    progress = module.get(ScanProgressUtils);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('only one of two concurrent claims moves a queued scan', async () => {
    const scan = await seedScan('queued');

    const results = await Promise.all([
      store.compareAndSetScanState(
        { id: scan.id, projectId: PROJECT },
        ['queued'],
        'running',
      ),
      store.compareAndSetScanState(
        { id: scan.id, projectId: PROJECT },
        ['queued'],
        'running',
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await scanRepo().findOneByOrFail({ id: scan.id })).state).toBe(
      'running',
    );
    // The project scope is part of the WHERE: another project's claim of the
    // same scan matches nothing.
    expect(
      await store.compareAndSetScanState(
        { id: scan.id, projectId: 'p-other' },
        ['running'],
        'failed',
      ),
    ).toBe(false);
    expect((await scanRepo().findOneByOrFail({ id: scan.id })).state).toBe(
      'running',
    );
  });

  it('leaving the queue removes registryAuth from metadata and keeps the other keys', async () => {
    const scan = await seedScan('queued', {
      imageToScan: 'registry.example/app:1',
      registryAuth: { __encrypted: true, data: 'opaque' },
      other: 42,
    });

    const moved = await store.compareAndSetScanState(
      { id: scan.id, projectId: PROJECT },
      ['queued'],
      'running',
      { startTime: new Date() },
    );

    expect(moved).toBe(true);
    expect(
      (await scanRepo().findOneByOrFail({ id: scan.id })).metadata,
    ).toEqual({ imageToScan: 'registry.example/app:1', other: 42 });
  });

  it('a cancelled scan is never overwritten by writeScanState', async () => {
    const writeScanState = (
      manager as unknown as {
        writeScanState(
          scanId: string,
          changes: QueryDeepPartialEntity<Scan>,
        ): Promise<boolean>;
      }
    ).writeScanState.bind(manager);

    const cancelled = await seedScan('running');
    expect(
      await store.compareAndSetScanState(
        { id: cancelled.id },
        ['running'],
        'cancelled',
      ),
    ).toBe(true);
    expect(await writeScanState(cancelled.id, { state: 'completed' })).toBe(
      false,
    );
    expect((await scanRepo().findOneByOrFail({ id: cancelled.id })).state).toBe(
      'cancelled',
    );

    // The same write on a scan that is not cancelled goes through.
    const live = await seedScan('running');
    expect(await writeScanState(live.id, { state: 'completed' })).toBe(true);
    expect((await scanRepo().findOneByOrFail({ id: live.id })).state).toBe(
      'completed',
    );
  });

  it('of two concurrent signals, one finalizes the results of a held scan', async () => {
    const scan = await seedScan('running');
    await seedContainer(scan.id, 'completed');
    // The terminal write behind it is covered by the unit specs.
    const ended = jest
      .spyOn(manager, 'updateScanState')
      .mockResolvedValue(undefined);

    try {
      const outcomes = await Promise.all([
        manager.finalizeResults(scan.id),
        manager.finalizeResults(scan.id),
      ]);

      expect(outcomes.sort()).toEqual(['already_final', 'finalized']);
      expect(ended).toHaveBeenCalledTimes(1);
      expect(
        (await scanRepo().findOneByOrFail({ id: scan.id })).resultsFinalizedAt,
      ).toBeInstanceOf(Date);
    } finally {
      ended.mockRestore();
    }
  });

  it('a closed container is not closed twice', async () => {
    const scan = await seedScan('running');
    const container = await seedContainer(scan.id, 'running');

    expect(
      await store.closeOpenContainer(container.id, {
        status: 'completed',
        finishedAt: new Date(),
      }),
    ).toBe(true);
    expect(
      await store.closeOpenContainer(container.id, { status: 'failed' }),
    ).toBe(false);
    expect(
      (await containerRepo().findOneByOrFail({ id: container.id })).status,
    ).toBe('completed');
  });

  it('the average duration of the last containers is computed on both engines', async () => {
    const scan = await seedScan('completed');
    const started = new Date('2026-01-02T03:04:05.000Z');
    for (let i = 0; i < 3; i++) {
      await seedContainer(
        scan.id,
        'completed',
        started,
        new Date(started.getTime() + 60_000),
      );
    }

    const calculateAverageDurationsOptimized = (
      progress as unknown as {
        calculateAverageDurationsOptimized(
          scanIds: string[],
        ): Promise<Record<string, number>>;
      }
    ).calculateAverageDurationsOptimized.bind(progress);

    const avgDurations = await calculateAverageDurationsOptimized([scan.id]);
    // Three containers of 60 s: AVG(TIMESTAMPDIFF(SECOND, …) * 1000) = 60 000 ms
    // on both engines, whatever the host time zone.
    expect(Object.values(avgDurations)).toEqual([60_000]);
  });

  it('the progress high-water only rises, and a pod with a stale load answers the stored value', async () => {
    const scan = await seedScan('running');
    const ensure = (loaded: Scan, calculated: number) =>
      (
        progress as unknown as {
          ensureMonotonicProgress(s: Scan, c: number): Promise<number>;
        }
      ).ensureMonotonicProgress(loaded, calculated);
    const stored = async () =>
      (await scanRepo().findOneByOrFail({ id: scan.id })).progressHighWater;

    const staleLoad = await scanRepo().findOneByOrFail({ id: scan.id });
    expect(staleLoad.progressHighWater).toBe(0);

    expect(await ensure(staleLoad, 82)).toBe(82);
    expect(await stored()).toBe(82);
    // The UPDATE is conditional: a lower value writes nothing...
    expect(await ensure(staleLoad, 63)).toBe(82);
    expect(await stored()).toBe(82);
    // ...and a value that rises is stored.
    expect(await ensure(staleLoad, 90)).toBe(90);
    expect(await stored()).toBe(90);
  });
});
