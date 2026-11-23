import { IsNull, LessThan, Repository } from 'typeorm';
import { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import type { Logger } from 'nestjs-pino';
import type { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

import { ScanResultsFinalizationSweeper } from './scan-results-finalization.sweeper';
import { ScanStateManager } from './scanStateManager';
import type { Scan } from '../../../entities/scan.entity';
import type { Container } from '../../../entities/container.entity';
import type { FileManagementService } from '../../file/file-management.service';
import type { ScanLifecycleHooks } from 'src/edition/ports/scan-lifecycle-hooks.port';

// The metadata key @Cron() writes its options under. @nestjs/schedule does not
// export it and its package exports refuse a deep import.
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

/**
 * A scan whose containers are all closed stays `running` until
 * analysis-reporting says its results are final. The sweeper is the signal
 * that never gets lost: every 30 s it asks again for the scans held for more
 * than SCAN_RESULTS_RECHECK_AFTER_MS, ends past SCAN_RESULTS_FINALIZATION_MAX_MS
 * the ones whose results never became final (completed_degraded), and writes
 * the terminal state a finalized scan is still missing.
 */

const NOW = new Date('2026-11-13T11:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const ENV_KEYS = [
  'SCAN_RESULTS_RECHECK_AFTER_MS',
  'SCAN_RESULTS_FINALIZATION_MAX_MS',
] as const;

/** A held scan as the sweeper loads it: its last container closed `heldMs` ago. */
const heldScan = (id: string, heldMs: number, over: object = {}): Scan =>
  ({
    id,
    projectId: 'p1',
    organizationId: 'o1',
    updatedAt: ago(heldMs + MINUTE),
    containers: [
      {
        id: `${id}-sast`,
        status: 'completed',
        finishedAt: ago(heldMs + MINUTE),
      },
      {
        id: `${id}-sca`,
        status: 'completed_degraded',
        finishedAt: ago(heldMs),
      },
    ],
    ...over,
  }) as unknown as Scan;

type FindOptions = {
  where: Record<string, unknown>;
  relations?: unknown;
  select?: unknown;
};

/** Whether a find asks for the held scans (results not final yet). */
const asksHeld = (opts: FindOptions) =>
  (opts.where.resultsFinalizedAt as { type?: string })?.type === 'isNull';

function harness({
  held = [] as Scan[],
  finalized = [] as Scan[],
}: { held?: Scan[]; finalized?: Scan[] } = {}) {
  const scanRepository = {
    find: jest.fn(async (opts: FindOptions) =>
      asksHeld(opts) ? held : finalized,
    ),
  };
  const stateManager = {
    askResultsFinal: jest.fn().mockResolvedValue(true),
    finalizeResults: jest.fn().mockResolvedValue('finalized'),
    updateScanState: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const sweeper = new ScanResultsFinalizationSweeper(
    scanRepository as unknown as Repository<Scan>,
    stateManager as unknown as ScanStateManager,
    logger as unknown as Logger,
  );
  return { sweeper, scanRepository, stateManager, logger };
}

describe('ScanResultsFinalizationSweeper', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  it('sweeps every 30 seconds', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      ScanResultsFinalizationSweeper.prototype.sweep,
    ) as { cronTime: string };
    expect(options.cronTime).toBe('*/30 * * * * *');
  });

  it('reads the held scans with one query: the filters in the WHERE, the containers through the relation', async () => {
    const h = harness();

    await h.sweeper.sweep();

    const heldQuery = h.scanRepository.find.mock.calls
      .map(([opts]) => opts)
      .filter(asksHeld);
    expect(heldQuery).toHaveLength(1);
    expect(heldQuery[0]).toEqual({
      where: {
        state: 'running',
        resultsFinalizedAt: IsNull(),
        isGraphOnly: false,
        importFormat: IsNull(),
      },
      relations: { containers: true },
      select: {
        id: true,
        projectId: true,
        organizationId: true,
        updatedAt: true,
        containers: { id: true, status: true, finishedAt: true },
      },
    });
  });

  it('does nothing for a scan held for less than 20 s', async () => {
    const h = harness({ held: [heldScan('s1', 19 * SECOND)] });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
    expect(h.stateManager.finalizeResults).not.toHaveBeenCalled();
  });

  it('asks once after 20 s, and ends the scan when its results are final', async () => {
    const scan = heldScan('s1', 20 * SECOND);
    const h = harness({ held: [scan] });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).toHaveBeenCalledTimes(1);
    expect(h.stateManager.askResultsFinal).toHaveBeenCalledWith(scan, 'once');
    expect(h.stateManager.finalizeResults).toHaveBeenCalledTimes(1);
    expect(h.stateManager.finalizeResults.mock.calls[0]).toEqual(['s1']);
  });

  it('leaves the scan held while its results are not final', async () => {
    const h = harness({ held: [heldScan('s1', 5 * MINUTE)] });
    h.stateManager.askResultsFinal.mockResolvedValue(false);

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).toHaveBeenCalledTimes(1);
    expect(h.stateManager.finalizeResults).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('still asks at exactly 90 minutes', async () => {
    const h = harness({ held: [heldScan('s1', 90 * MINUTE)] });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).toHaveBeenCalledTimes(1);
    expect(h.stateManager.finalizeResults.mock.calls[0]).toEqual(['s1']);
  });

  it('past 90 minutes ends the scan as timed out without asking, with one warning', async () => {
    const heldMs = 90 * MINUTE + 1;
    const h = harness({ held: [heldScan('s1', heldMs)] });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
    expect(h.stateManager.finalizeResults).toHaveBeenCalledTimes(1);
    expect(h.stateManager.finalizeResults).toHaveBeenCalledWith('s1', {
      resultsTimedOut: true,
    });
    const warnings = h.logger.warn.mock.calls.map(([line]) => line);
    expect(warnings).toEqual([
      `SCAN_RESULTS_NOT_FINALIZED scan=s1 heldMs=${heldMs}`,
    ]);
  });

  it('counts the hold from the last container that closed', async () => {
    const scan = heldScan('s1', 10 * SECOND, {
      containers: [
        { id: 'c1', status: 'completed', finishedAt: ago(3 * 3_600_000) },
        { id: 'c2', status: 'failed', finishedAt: ago(10 * SECOND) },
      ],
    });
    const h = harness({ held: [scan] });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
    expect(h.stateManager.finalizeResults).not.toHaveBeenCalled();
  });

  it('counts the hold from the last update of the scan when no container has an end time', async () => {
    const scan = heldScan('s1', 0, {
      updatedAt: ago(2 * 3_600_000),
      containers: [
        { id: 'c1', status: 'completed', finishedAt: null },
        { id: 'c2', status: 'completed', finishedAt: null },
      ],
    });
    const h = harness({ held: [scan] });

    await h.sweeper.sweep();

    expect(h.stateManager.finalizeResults).toHaveBeenCalledWith('s1', {
      resultsTimedOut: true,
    });
  });

  it('ignores a running scan with a container still open, the agent waiting for its analysis included', async () => {
    const h = harness({
      held: [
        heldScan('s1', 2 * 3_600_000, {
          containers: [
            { id: 'c1', status: 'completed', finishedAt: ago(2 * 3_600_000) },
            { id: 'c2', status: 'running', finishedAt: null },
          ],
        }),
        heldScan('s2', 2 * 3_600_000, {
          containers: [
            { id: 'c3', status: 'completed', finishedAt: ago(2 * 3_600_000) },
            { id: 'c4', status: 'parsing_completed', finishedAt: null },
          ],
        }),
      ],
    });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
    expect(h.stateManager.finalizeResults).not.toHaveBeenCalled();
  });

  it('ignores a running scan with no container: its pods are still being launched', async () => {
    const h = harness({
      held: [heldScan('s1', 2 * 3_600_000, { containers: [] })],
    });

    await h.sweeper.sweep();

    expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
    expect(h.stateManager.finalizeResults).not.toHaveBeenCalled();
  });

  it('one scan that throws does not stop the others', async () => {
    const h = harness({
      held: [
        heldScan('s1', MINUTE),
        heldScan('s2', MINUTE),
        heldScan('s3', 2 * 3_600_000),
        heldScan('s4', 2 * 3_600_000),
      ],
    });
    h.stateManager.askResultsFinal.mockImplementation(async (scan: Scan) => {
      if (scan.id === 's1') throw new Error('ask exploded');
      return true;
    });
    h.stateManager.finalizeResults.mockImplementation(async (id: string) => {
      if (id === 's3') throw new Error('finalize exploded');
      return 'finalized';
    });

    await expect(h.sweeper.sweep()).resolves.toBeUndefined();

    const finalized = h.stateManager.finalizeResults.mock.calls.map(
      ([id]) => id,
    );
    expect(finalized).toEqual(['s2', 's3', 's4']);
    const errors = h.logger.error.mock.calls.map(([line]) => String(line));
    expect(
      errors.some((l) => l.includes('s1') && l.includes('ask exploded')),
    ).toBe(true);
    expect(
      errors.some((l) => l.includes('s3') && l.includes('finalize exploded')),
    ).toBe(true);
  });

  it('never rejects when the query fails', async () => {
    const h = harness();
    h.scanRepository.find.mockRejectedValue(new Error('db down'));

    await expect(h.sweeper.sweep()).resolves.toBeUndefined();

    expect(h.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
    );
  });

  it('does nothing when the previous sweep is still running', async () => {
    const h = harness({ held: [heldScan('s1', MINUTE)] });
    let release: () => void;
    h.stateManager.askResultsFinal.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(false);
        }),
    );

    const first = h.sweeper.sweep();
    await new Promise((resolve) => setImmediate(resolve));
    const queriesOfFirst = h.scanRepository.find.mock.calls.length;
    await h.sweeper.sweep();
    release();
    await first;

    expect(h.scanRepository.find).toHaveBeenCalledTimes(queriesOfFirst);
    expect(h.stateManager.askResultsFinal).toHaveBeenCalledTimes(1);
  });

  describe('its delays come from the environment', () => {
    it('reads SCAN_RESULTS_RECHECK_AFTER_MS and SCAN_RESULTS_FINALIZATION_MAX_MS once, at construction', async () => {
      process.env.SCAN_RESULTS_RECHECK_AFTER_MS = '5000';
      process.env.SCAN_RESULTS_FINALIZATION_MAX_MS = '60000';
      const h = harness({
        held: [heldScan('s1', 6 * SECOND), heldScan('s2', 61 * SECOND)],
      });
      delete process.env.SCAN_RESULTS_RECHECK_AFTER_MS;
      delete process.env.SCAN_RESULTS_FINALIZATION_MAX_MS;

      await h.sweeper.sweep();

      expect(h.stateManager.askResultsFinal).toHaveBeenCalledTimes(1);
      expect(h.stateManager.finalizeResults).toHaveBeenCalledWith('s1');
      expect(h.stateManager.finalizeResults).toHaveBeenCalledWith('s2', {
        resultsTimedOut: true,
      });
    });

    it.each(['', 'soon', '0', '-5'])(
      'keeps the defaults for %p: a typo never turns the ceiling off',
      async (value) => {
        process.env.SCAN_RESULTS_RECHECK_AFTER_MS = value;
        process.env.SCAN_RESULTS_FINALIZATION_MAX_MS = value;
        const h = harness({
          held: [heldScan('s1', 19 * SECOND), heldScan('s2', 91 * MINUTE)],
        });

        await h.sweeper.sweep();

        expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
        expect(h.stateManager.finalizeResults.mock.calls).toEqual([
          ['s2', { resultsTimedOut: true }],
        ]);
      },
    );
  });

  // The finalize UPDATE stamped resultsFinalizedAt, then the terminal write
  // failed: the scan is final but still `running`, and no results signal
  // will come for it again.
  describe('a scan whose results are final but which is still running', () => {
    const finalizedScan = (over: object = {}): Scan =>
      ({
        id: 'f1',
        projectId: 'p1',
        organizationId: 'o1',
        state: 'running',
        resultsFinalizedAt: ago(5 * MINUTE),
        containers: [
          { id: 'c1', status: 'completed', image: 'scanlink-sast' },
          { id: 'c2', status: 'completed', image: 'scanlink-sca' },
        ],
        ...over,
      }) as unknown as Scan;

    it('is read with its containers, once its finalization is older than the recheck delay', async () => {
      const h = harness();

      await h.sweeper.sweep();

      const finalizedQuery = h.scanRepository.find.mock.calls
        .map(([opts]) => opts)
        .filter((opts) => !asksHeld(opts));
      expect(finalizedQuery).toEqual([
        {
          where: {
            state: 'running',
            resultsFinalizedAt: LessThan(ago(20 * SECOND)),
            isGraphOnly: false,
            importFormat: IsNull(),
          },
          relations: { containers: true },
        },
      ]);
    });

    it('gets its terminal state written through updateScanState, without asking anything', async () => {
      const scan = finalizedScan();
      const h = harness({ finalized: [scan] });

      await h.sweeper.sweep();

      expect(h.stateManager.updateScanState).toHaveBeenCalledTimes(1);
      expect(h.stateManager.updateScanState).toHaveBeenCalledWith(scan);
      expect(h.stateManager.askResultsFinal).not.toHaveBeenCalled();
      expect(h.stateManager.finalizeResults).not.toHaveBeenCalled();
    });

    it('is left alone while a container is open: the last close ends it', async () => {
      const h = harness({
        finalized: [
          finalizedScan({
            containers: [
              { id: 'c1', status: 'completed', image: 'scanlink-sast' },
              { id: 'a1', status: 'running', image: 'agent-service' },
            ],
          }),
        ],
      });

      await h.sweeper.sweep();

      expect(h.stateManager.updateScanState).not.toHaveBeenCalled();
    });

    it('one that throws does not stop the others', async () => {
      const broken = finalizedScan({ id: 'f1' });
      const healthy = finalizedScan({ id: 'f2' });
      const h = harness({ finalized: [broken, healthy] });
      h.stateManager.updateScanState.mockRejectedValueOnce(new Error('boom'));

      await expect(h.sweeper.sweep()).resolves.toBeUndefined();

      expect(h.stateManager.updateScanState).toHaveBeenCalledWith(healthy);
      expect(h.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('f1'),
      );
    });
  });

  // analysis-reporting never answers for the whole hold: the scan must still
  // end, degraded and saying why, and never stay `running`.
  describe('with analysis-reporting unreachable for the whole hold', () => {
    it('ends the scan completed_degraded with results_processing once the ceiling is passed', async () => {
      const closedAt = ago(0);
      const row: Record<string, unknown> = {
        id: 's1',
        projectId: 'p1',
        organizationId: 'o1',
        state: 'running',
        scanType: 'sast,sca',
        isDiffScan: false,
        isGraphOnly: false,
        importFormat: null,
        resultsFinalizedAt: null,
        errorCode: null,
        errorCategory: null,
        errorMessage: null,
        updatedAt: closedAt,
      };
      const containers = [
        {
          id: 'c1',
          status: 'completed',
          image: 'scanlink-sast',
          podName: 'pod-c1',
          finishedAt: closedAt,
        },
        {
          id: 'c2',
          status: 'completed',
          image: 'scanlink-sca',
          podName: 'pod-c2',
          finishedAt: closedAt,
        },
      ];
      const loaded = () =>
        ({
          ...row,
          containers: containers.map((c) => ({ ...c })),
        }) as unknown as Scan;

      const holds = (condition: string, params: Record<string, unknown>) => {
        switch (condition) {
          case 'id = :id':
            return row.id === params.id;
          case 'state <> :cancelled':
            return row.state !== params.cancelled;
          case 'state = :running':
            return row.state === params.running;
          case 'resultsFinalizedAt IS NULL':
            return row.resultsFinalizedAt == null;
          default:
            throw new Error(`unexpected condition: ${condition}`);
        }
      };
      const updateBuilder = () => {
        let set: Record<string, unknown> = {};
        const where: [string, Record<string, unknown>][] = [];
        const qb: Record<string, jest.Mock> = {};
        qb.update = jest.fn(() => qb);
        qb.set = jest.fn((s: Record<string, unknown>) => {
          set = s;
          return qb;
        });
        qb.where = qb.andWhere = jest.fn(
          (condition: string, params: Record<string, unknown> = {}) => {
            where.push([condition, params]);
            return qb;
          },
        );
        qb.execute = jest.fn(async () => {
          const params = Object.assign({}, ...where.map(([, p]) => p));
          const matched = where.every(([c]) => holds(c, params));
          if (matched) Object.assign(row, set);
          return { affected: matched ? 1 : 0 };
        });
        return qb;
      };
      const scanRepository = {
        find: jest.fn(async (opts: FindOptions) => {
          if (row.state !== 'running') return [];
          const final = row.resultsFinalizedAt != null;
          return asksHeld(opts) !== final ? [loaded()] : [];
        }),
        findOne: jest.fn(async () => ({ ...row })),
        createQueryBuilder: jest.fn(updateBuilder),
      };
      const containerRepository = {
        find: jest.fn(async () => containers.map((c) => ({ ...c }))),
      };
      const notifyScanEnded = jest.fn(() =>
        throwError(() => ({
          code: status.UNAVAILABLE,
          details: 'connect ECONNREFUSED',
        })),
      );
      const arClient = {
        getService: jest.fn().mockReturnValue({ notifyScanEnded }),
      } as unknown as ClientGrpc;
      const pmClient = {
        getService: jest.fn().mockReturnValue({
          triggerEvaluation: jest.fn(() => of({ evaluationId: 'e1' })),
        }),
      } as unknown as ClientGrpc;
      const logger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
      const onScanClosed = jest.fn();
      const manager = new ScanStateManager(
        scanRepository as unknown as Repository<Scan>,
        containerRepository as unknown as Repository<Container>,
        arClient,
        pmClient,
        {
          deleteFile: jest.fn().mockResolvedValue({}),
        } as unknown as FileManagementService,
        {
          publish: jest.fn().mockResolvedValue(undefined),
        } as unknown as RealtimeEventPublisher,
        logger as unknown as Logger,
        { onScanClosed } as unknown as ScanLifecycleHooks,
      );
      manager.onModuleInit();
      const sweeper = new ScanResultsFinalizationSweeper(
        scanRepository as unknown as Repository<Scan>,
        manager,
        logger as unknown as Logger,
      );
      const now = jest.spyOn(Date, 'now');

      // Every tick of the hold: analysis-reporting cannot be told.
      for (const heldMs of [30 * SECOND, 30 * MINUTE, 89 * MINUTE]) {
        now.mockReturnValue(closedAt.getTime() + heldMs);
        await sweeper.sweep();
        expect(row.state).toBe('running');
        expect(row.resultsFinalizedAt).toBeNull();
      }
      expect(notifyScanEnded).toHaveBeenCalledTimes(3);

      // Past the ceiling: ended without asking again.
      now.mockReturnValue(closedAt.getTime() + 91 * MINUTE);
      await sweeper.sweep();

      expect(notifyScanEnded).toHaveBeenCalledTimes(3);
      expect(row).toEqual(
        expect.objectContaining({
          state: 'completed_degraded',
          errorCategory: 'results_processing',
          errorMessage:
            'Results processing did not finish in time; results may be incomplete',
          resultsFinalizedAt: expect.any(Date),
          endTime: expect.any(Date),
        }),
      );
      expect(onScanClosed).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        `SCAN_RESULTS_NOT_FINALIZED scan=s1 heldMs=${91 * MINUTE}`,
      );

      // The next tick finds nothing left to do.
      await sweeper.sweep();
      expect(onScanClosed).toHaveBeenCalledTimes(1);
    });
  });
});
