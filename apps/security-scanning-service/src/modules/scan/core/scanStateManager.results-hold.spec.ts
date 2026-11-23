import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientGrpc } from '@nestjs/microservices';
import { Subject, of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

import { ScanStateManager } from './scanStateManager';
import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';
import { FileManagementService } from '../../file/file-management.service';
import { GitHistoryCursorService } from '../git-history/git-history-cursor.service';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';

type Row = Record<string, unknown> & { id: string };
type ContainerRow = {
  id: string;
  status: string;
  image: string;
  podName: string;
};

/**
 * One scan row and its containers behind the two repositories. Every
 * conditional UPDATE is recorded, and applied to the row only when its WHERE
 * holds, as the database would: that is what decides which of two racing
 * signals ends a scan.
 */
const fakeDatabase = () => {
  const db = {
    row: null as Row | null,
    containers: [] as ContainerRow[],
    updates: [] as {
      set: Record<string, unknown>;
      where: string[];
      affected: number;
    }[],
  };

  const holds = (condition: string, params: Record<string, unknown>) => {
    const row = db.row;
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
        throw new Error(`unexpected condition in the fake: ${condition}`);
    }
  };

  const updateBuilder = () => {
    const update = {
      set: {} as Record<string, unknown>,
      where: [] as string[],
      affected: 0,
    };
    const params: Record<string, unknown> = {};
    const qb: any = {};
    qb.update = jest.fn(() => qb);
    qb.set = jest.fn((set: Record<string, unknown>) => {
      update.set = set;
      return qb;
    });
    qb.where = qb.andWhere = jest.fn(
      (condition: string, p?: Record<string, unknown>) => {
        update.where.push(condition);
        Object.assign(params, p);
        return qb;
      },
    );
    qb.execute = jest.fn(async () => {
      const matched =
        db.row !== null &&
        update.where.every((condition) => holds(condition, params));
      if (matched) Object.assign(db.row, update.set);
      update.affected = matched ? 1 : 0;
      db.updates.push(update);
      return { affected: update.affected };
    });
    return qb;
  };

  const scanRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      db.row && db.row.id === where.id ? { ...db.row } : null,
    ),
    find: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(updateBuilder),
  };
  const containerRepo = {
    find: jest.fn(async () => db.containers.map((c) => ({ ...c }))),
  };

  return {
    db,
    scanRepo,
    containerRepo,
    /** The scan as a caller holds it: a copy of the row, its containers loaded. */
    load: () =>
      ({
        ...db.row,
        containers: db.containers.map((c) => ({ ...c })),
      }) as unknown as Scan,
    /** The UPDATEs that matched the row. */
    written: () => db.updates.filter((u) => u.affected === 1),
  };
};

const container = (
  id: string,
  status: string,
  image = `cybedefend-scanners/${id}`,
): ContainerRow => ({ id, status, image, podName: `pod-${id}` });

/** Lets the hold run to its end: it is fire-and-forget. */
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// A scan whose containers are all closed is not over until analysis-reporting
// has finalized the results its scanners sent: those are ingested
// asynchronously, so a client reading the results right after `completed` got
// a part of them. The scan stays `running` until NotifyScanEnded (or a later
// signal) says its results are final, then ends through the usual terminal
// write and clean-up.
describe('ScanStateManager — a scan is held until its results are final', () => {
  let module: TestingModule;
  let manager: ScanStateManager;
  let fake: ReturnType<typeof fakeDatabase>;
  let notifyScanEnded: jest.Mock;
  let createIssuesForScan: jest.Mock;
  let triggerEvaluation: jest.Mock;
  let onScanClosed: jest.Mock;
  let realtimePublish: jest.Mock;
  let applyFinalizedScan: jest.Mock;
  let deleteFile: jest.Mock;
  let logger: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };

  const answer = (message: string) => of({ success: true, message });
  const statusEvents = () =>
    realtimePublish.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === 'SCAN_STATUS_CHANGED')
      .map((event) => event.payload.scanStatusChanged);
  const wroteTerminalState = () =>
    fake
      .written()
      .some(
        (u) =>
          u.set.state === 'completed' ||
          u.set.state === 'completed_degraded' ||
          u.set.endTime !== undefined,
      );

  beforeEach(async () => {
    fake = fakeDatabase();
    fake.db.row = {
      id: 's1',
      organizationId: 'o1',
      projectId: 'p1',
      state: 'running',
      scanType: 'sast,sca',
      isDiffScan: false,
      isGraphOnly: false,
      importFormat: null,
      resultsFinalizedAt: null,
      errorCode: null,
      errorCategory: null,
      errorMessage: null,
    };
    fake.db.containers = [
      container('sast', 'completed'),
      container('sca', 'completed'),
    ];
    notifyScanEnded = jest.fn(() => answer('waiting'));
    createIssuesForScan = jest.fn(() => of({ success: true }));
    triggerEvaluation = jest.fn(() => of({ evaluationId: 'e1' }));
    onScanClosed = jest.fn();
    applyFinalizedScan = jest.fn().mockResolvedValue(undefined);
    realtimePublish = jest.fn().mockResolvedValue(undefined);
    deleteFile = jest.fn().mockResolvedValue({});
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const arClient: Partial<ClientGrpc> = {
      getService: jest
        .fn()
        .mockReturnValue({ notifyScanEnded, createIssuesForScan }),
    };
    const policyClient: Partial<ClientGrpc> = {
      getService: jest.fn().mockReturnValue({ triggerEvaluation }),
    };

    module = await Test.createTestingModule({
      providers: [
        ScanStateManager,
        { provide: getRepositoryToken(Scan), useValue: fake.scanRepo },
        {
          provide: getRepositoryToken(Container),
          useValue: fake.containerRepo,
        },
        { provide: FileManagementService, useValue: { deleteFile } },
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: arClient },
        { provide: 'POLICY_MANAGEMENT_SERVICE', useValue: policyClient },
        {
          provide: RealtimeEventPublisher,
          useValue: { publish: realtimePublish },
        },
        { provide: Logger, useValue: logger },
        { provide: SCAN_LIFECYCLE_HOOKS, useValue: { onScanClosed } },
        {
          provide: GitHistoryCursorService,
          useValue: { applyFinalizedScan },
        },
      ],
    }).compile();

    manager = module.get(ScanStateManager);
    manager.onModuleInit();
  });

  afterEach(async () => {
    await settle();
    await module.close();
  });

  it('holds a code scan in running when its last container closes and NotifyScanEnded answers waiting', async () => {
    const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');
    const scan = fake.load();

    const ended = await manager.recordScanState(scan);
    await settle();

    expect(ended).toBe(false);
    expect(scan.state).toBe('running');
    expect(scan.endTime).toBeUndefined();
    // Nothing changed on the row: the hold still asks analysis-reporting.
    expect(fake.written()).toHaveLength(0);
    expect(wroteTerminalState()).toBe(false);
    expect(fake.db.row.state).toBe('running');
    expect(notifyScanEnded).toHaveBeenCalledTimes(1);
    expect(notifyScanEnded).toHaveBeenCalledWith({
      scanId: 's1',
      projectId: 'p1',
    });
    expect(onScanClosed).not.toHaveBeenCalled();
    expect(handleCompleted).not.toHaveBeenCalled();
    expect(triggerEvaluation).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(statusEvents()).toHaveLength(0);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[ResultsHold] Scan s1 held: every container closed, waiting for analysis-reporting to finalize its results',
      ),
    );
  });

  it('goes terminal at once when NotifyScanEnded answers already_dispatched', async () => {
    notifyScanEnded.mockReturnValue(answer('already_dispatched'));
    const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');

    await manager.updateScanState(fake.load());
    await settle();

    const finalization = fake
      .written()
      .find((u) => u.set.resultsFinalizedAt !== undefined);
    expect(finalization.set).toEqual({ resultsFinalizedAt: expect.any(Date) });
    expect(finalization.where).toEqual([
      'id = :id',
      'state = :running',
      'resultsFinalizedAt IS NULL',
    ]);
    expect(fake.db.row.resultsFinalizedAt).toBeInstanceOf(Date);
    expect(fake.db.row.state).toBe('completed');
    expect(fake.db.row.endTime).toBeInstanceOf(Date);
    expect(handleCompleted).toHaveBeenCalledTimes(1);
    expect(triggerEvaluation).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith('s1');
    // Told once, at the hold: the terminal clean-up does not tell it again.
    expect(notifyScanEnded).toHaveBeenCalledTimes(1);
    expect(createIssuesForScan).not.toHaveBeenCalled();
    expect(onScanClosed).toHaveBeenCalledTimes(1);
    expect(statusEvents()).toEqual([
      expect.objectContaining({
        previousState: 'running',
        currentState: 'completed',
      }),
    ]);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[ResultsHold] Scan s1 results final (finalized)',
      ),
    );
  });

  it('keeps the error triplet of a completed_degraded scan while held', async () => {
    Object.assign(fake.db.row, {
      errorCode: 503,
      errorCategory: 'PARTIAL_FAILURE',
      errorMessage: 'One mandatory scanner failed',
    });
    fake.db.containers = [
      container('sast', 'failed'),
      container('sca', 'completed'),
    ];
    const scan = fake.load();

    await manager.recordScanState(scan);
    await settle();

    expect(scan.state).toBe('running');
    expect(scan.errorCode).toBe(503);
    expect(scan.errorCategory).toBe('PARTIAL_FAILURE');
    expect(scan.errorMessage).toBe('One mandatory scanner failed');
    expect(fake.written()).toHaveLength(0);

    // And after: the terminal write keeps it, and publishes it.
    await expect(manager.finalizeResults('s1')).resolves.toBe('finalized');

    expect(fake.db.row).toEqual(
      expect.objectContaining({
        state: 'completed_degraded',
        errorCode: 503,
        errorCategory: 'PARTIAL_FAILURE',
        errorMessage: 'One mandatory scanner failed',
      }),
    );
    expect(statusEvents()).toEqual([
      expect.objectContaining({
        currentState: 'completed_degraded',
        errorCode: 503,
        errorCategory: 'PARTIAL_FAILURE',
        errorMessage: 'One mandatory scanner failed',
      }),
    ]);
  });

  it('holds a scan a watchdog wrote failed: the last scanner moves it failed to running, keeps the failed reason, then goes terminal', async () => {
    Object.assign(fake.db.row, {
      state: 'failed',
      errorCode: 62,
      errorCategory: 'watchdog',
      errorMessage: 'Scan stalled',
    });
    fake.db.containers = [
      container('sast', 'failed'),
      container('sca', 'completed'),
    ];
    const scan = fake.load();

    const ended = await manager.recordScanState(scan);
    await settle();

    expect(ended).toBe(false);
    expect(fake.db.row).toEqual(
      expect.objectContaining({
        state: 'running',
        errorCode: 62,
        errorCategory: 'watchdog',
        errorMessage: 'Scan stalled',
      }),
    );
    expect(fake.db.row.endTime).toBeUndefined();
    expect(fake.written()).toHaveLength(1);
    expect(fake.written()[0].set).toEqual({ state: 'running' });
    expect(statusEvents()).toEqual([
      expect.objectContaining({
        previousState: 'failed',
        currentState: 'running',
      }),
    ]);
    expect(notifyScanEnded).toHaveBeenCalledTimes(1);

    await expect(manager.finalizeResults('s1')).resolves.toBe('finalized');

    expect(fake.db.row).toEqual(
      expect.objectContaining({
        state: 'completed_degraded',
        errorCode: 62,
        errorCategory: 'watchdog',
        errorMessage: 'Scan stalled',
      }),
    );
  });

  it('starts no ask when the running write is refused (scan cancelled meanwhile)', async () => {
    fake.db.row.state = 'failed';
    fake.db.containers = [
      container('sast', 'failed'),
      container('sca', 'completed'),
    ];
    const scan = fake.load();
    fake.db.row.state = 'cancelled';

    const ended = await manager.recordScanState(scan);
    await settle();

    expect(ended).toBe(false);
    expect(fake.written()).toHaveLength(0);
    expect(notifyScanEnded).not.toHaveBeenCalled();
    expect(statusEvents()).toHaveLength(0);
  });

  it('an agent closing last ends the scan at once', async () => {
    fake.db.containers = [
      container('sast', 'completed'),
      container('sca', 'completed'),
      container('agent', 'parsing_completed', 'agent-service'),
    ];
    const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');

    await manager.updateScanState(fake.load());
    await settle();

    // The scanners' results may be final already: the agent still runs.
    expect(fake.db.row.state).toBe('running');
    expect(notifyScanEnded).not.toHaveBeenCalled();
    expect(handleCompleted).not.toHaveBeenCalled();

    fake.db.containers[2].status = 'completed';
    notifyScanEnded.mockReturnValue(answer('dispatched'));
    await manager.updateScanState(fake.load());
    await settle();

    expect(notifyScanEnded).toHaveBeenCalledTimes(1);
    expect(fake.db.row.state).toBe('completed');
    expect(fake.db.row.resultsFinalizedAt).toBeInstanceOf(Date);
    expect(handleCompleted).toHaveBeenCalledTimes(1);
  });

  it('holds a diff scan and calls NotifyScanEnded for it', async () => {
    fake.db.row.isDiffScan = true;
    const told = new Subject<{ success: boolean; message: string }>();
    notifyScanEnded.mockReturnValue(told);

    await manager.updateScanState(fake.load());
    await settle();

    expect(notifyScanEnded).toHaveBeenCalledWith({
      scanId: 's1',
      projectId: 'p1',
    });
    expect(fake.db.row.state).toBe('running');
    expect(onScanClosed).not.toHaveBeenCalled();

    told.next({ success: true, message: 'diff_scan' });
    told.complete();
    await settle();

    expect(fake.db.row.state).toBe('completed');
    expect(onScanClosed).toHaveBeenCalledTimes(1);
    expect(onScanClosed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', isDiffScan: true }),
      'completed',
      'containers',
    );
    expect(notifyScanEnded).toHaveBeenCalledTimes(1);
  });

  it('finalizeResults returns containers_open while a container runs', async () => {
    fake.db.containers = [
      container('sast', 'completed'),
      container('sca', 'running'),
    ];
    const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');

    await expect(manager.finalizeResults('s1')).resolves.toBe(
      'containers_open',
    );

    expect(fake.scanRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(fake.db.row.resultsFinalizedAt).toBeNull();
    expect(fake.db.row.state).toBe('running');
    expect(handleCompleted).not.toHaveBeenCalled();
  });

  it('resultsTimedOut degrades a completed scan', async () => {
    const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');

    await expect(
      manager.finalizeResults('s1', { resultsTimedOut: true }),
    ).resolves.toBe('finalized');

    expect(fake.db.row).toEqual(
      expect.objectContaining({
        state: 'completed_degraded',
        errorCategory: 'results_processing',
        errorMessage:
          'Results processing did not finish in time; results may be incomplete',
        resultsFinalizedAt: expect.any(Date),
        endTime: expect.any(Date),
      }),
    );
    expect(statusEvents()).toEqual([
      expect.objectContaining({
        currentState: 'completed_degraded',
        errorCategory: 'results_processing',
        errorMessage:
          'Results processing did not finish in time; results may be incomplete',
      }),
    ]);
    expect(handleCompleted).toHaveBeenCalledTimes(1);
  });

  it('resultsTimedOut keeps the reason of a scan already degraded by a scanner', async () => {
    Object.assign(fake.db.row, {
      errorCode: 503,
      errorCategory: 'PARTIAL_FAILURE',
      errorMessage: 'One mandatory scanner failed',
    });
    fake.db.containers = [
      container('sast', 'failed'),
      container('sca', 'completed'),
    ];

    await manager.finalizeResults('s1', { resultsTimedOut: true });

    expect(fake.db.row).toEqual(
      expect.objectContaining({
        state: 'completed_degraded',
        errorCode: 503,
        errorCategory: 'PARTIAL_FAILURE',
        errorMessage: 'One mandatory scanner failed',
      }),
    );
  });

  describe('finalizeResults', () => {
    it('lets one of two racing signals end the scan', async () => {
      const handleCompleted = jest.spyOn(manager, 'handleCompletedScan');

      const outcomes = await Promise.all([
        manager.finalizeResults('s1'),
        manager.finalizeResults('s1'),
      ]);

      expect(outcomes.sort()).toEqual(['already_final', 'finalized']);
      expect(handleCompleted).toHaveBeenCalledTimes(1);
      expect(onScanClosed).toHaveBeenCalledTimes(1);
      expect(statusEvents()).toHaveLength(1);
    });

    it('ends the scan it finalized even when its reload does not show it final', async () => {
      notifyScanEnded.mockReturnValue(answer('dispatched'));
      const read = fake.scanRepo.findOne.getMockImplementation();
      fake.scanRepo.findOne.mockImplementation(async (query) => {
        const row = await read(query);
        return row && { ...row, resultsFinalizedAt: null };
      });

      await manager.recordScanState(fake.load());
      await settle();

      expect(fake.db.row.state).toBe('completed');
      expect(notifyScanEnded).toHaveBeenCalledTimes(1);
    });

    it('answers already_final, and does nothing, for a scan finalized before', async () => {
      await manager.finalizeResults('s1');
      const writes = fake.db.updates.length;

      await expect(manager.finalizeResults('s1')).resolves.toBe(
        'already_final',
      );
      expect(fake.db.updates).toHaveLength(writes);
    });

    it.each(['completed', 'failed', 'cancelled', 'queued'])(
      'answers not_running for a %s scan and writes nothing',
      async (state) => {
        fake.db.row.state = state;

        await expect(manager.finalizeResults('s1')).resolves.toBe(
          'not_running',
        );
        expect(fake.scanRepo.createQueryBuilder).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['cancelled', 'not_running'],
      ['failed', 'not_running'],
    ])(
      'answers not_running when the scan moves to %s between the read and the UPDATE',
      async (state, expected) => {
        fake.containerRepo.find.mockImplementationOnce(async () => {
          fake.db.row.state = state;
          return fake.db.containers.map((c) => ({ ...c }));
        });

        await expect(manager.finalizeResults('s1')).resolves.toBe(expected);
        expect(fake.written()).toHaveLength(0);
      },
    );

    it('answers already_final when another signal finalized it between the read and the UPDATE', async () => {
      fake.containerRepo.find.mockImplementationOnce(async () => {
        fake.db.row.resultsFinalizedAt = new Date();
        return fake.db.containers.map((c) => ({ ...c }));
      });

      await expect(manager.finalizeResults('s1')).resolves.toBe(
        'already_final',
      );
    });

    it('answers not_found when the scan is deleted between the read and the UPDATE', async () => {
      fake.containerRepo.find.mockImplementationOnce(async () => {
        const rows = fake.db.containers.map((c) => ({ ...c }));
        fake.db.row = null;
        return rows;
      });

      await expect(manager.finalizeResults('s1')).resolves.toBe('not_found');
    });

    it('answers not_found for a scan that does not exist', async () => {
      await expect(manager.finalizeResults('nope')).resolves.toBe('not_found');
      expect(fake.scanRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('the git history cursor', () => {
    it('results-final hands the scan to the cursor service once', async () => {
      await expect(manager.finalizeResults('s1')).resolves.toBe('finalized');
      await expect(manager.finalizeResults('s1')).resolves.toBe(
        'already_final',
      );
      expect(applyFinalizedScan).toHaveBeenCalledTimes(1);
      expect(applyFinalizedScan).toHaveBeenCalledWith('s1');
    });

    it('a scan finalized by the results timeout never moves the cursor', async () => {
      await manager.finalizeResults('s1', { resultsTimedOut: true });
      expect(applyFinalizedScan).not.toHaveBeenCalled();
    });

    it('a cursor failure is logged and never changes the scan state', async () => {
      applyFinalizedScan.mockRejectedValue(new Error('deadlock twice'));
      await expect(manager.finalizeResults('s1')).resolves.toBe('finalized');
      expect(fake.db.row.state).toBe('completed');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('deadlock twice'),
      );
    });

    it('a scan that ends failed counts its history pass as failed, once', async () => {
      fake.db.containers = [
        container('gitleaks', 'failed'),
        container('sast', 'failed'),
      ];

      await manager.updateScanState(fake.load());
      await manager.updateScanState(fake.load());
      await settle();

      expect(fake.db.row.state).toBe('failed');
      // Not held: a failed scan has no results to wait for.
      expect(fake.db.row.resultsFinalizedAt).toBeNull();
      expect(applyFinalizedScan).toHaveBeenCalledTimes(1);
      expect(applyFinalizedScan).toHaveBeenCalledWith('s1', {
        scanFailed: true,
      });
    });

    it('a cancelled scan never counts a history pass', async () => {
      fake.db.row.state = 'cancelled';
      fake.db.containers = [container('gitleaks', 'failed')];

      await manager.updateScanState(fake.load());
      await settle();

      expect(applyFinalizedScan).not.toHaveBeenCalled();
    });

    it('a cursor failure on a failed scan is logged and never changes its state', async () => {
      applyFinalizedScan.mockRejectedValue(new Error('deadlock twice'));
      fake.db.containers = [container('gitleaks', 'failed')];

      await manager.updateScanState(fake.load());
      await settle();

      expect(fake.db.row.state).toBe('failed');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('deadlock twice'),
      );
    });

    it('a scan whose Gitleaks pod died during the history pass reaches finalizeResults, not the results timeout, and hands the scan to the cursor', async () => {
      // The other scanners completed: the scan is held, analysis-reporting
      // leaves the failed secret container out of its count and answers that
      // the end is dispatched. The cursor then reads a secret container that
      // did not complete, which counts as a failed pass.
      fake.db.containers = [
        container('gitleaks', 'failed'),
        container('sast', 'completed'),
      ];
      notifyScanEnded.mockReturnValue(answer('dispatched'));

      await manager.updateScanState(fake.load());
      await settle();

      expect(fake.db.row.resultsFinalizedAt).toBeInstanceOf(Date);
      expect(fake.db.row.state).toBe('completed_degraded');
      expect(fake.db.row.errorCategory).not.toBe('results_processing');
      expect(applyFinalizedScan).toHaveBeenCalledTimes(1);
      expect(applyFinalizedScan).toHaveBeenCalledWith('s1');
    });
  });

  describe('askResultsFinal', () => {
    const serviceError = (code: status, details: string) =>
      throwError(() =>
        Object.assign(new Error(`${code} ${details}`), { code, details }),
      );

    it('is false while analysis-reporting answers waiting, true on any other outcome', async () => {
      await expect(manager.askResultsFinal(fake.load(), 'once')).resolves.toBe(
        false,
      );
      notifyScanEnded.mockReturnValue(answer('deferred'));
      await expect(manager.askResultsFinal(fake.load(), 'once')).resolves.toBe(
        true,
      );
    });

    it('once: makes a single attempt and answers false when it fails', async () => {
      notifyScanEnded.mockReturnValue(
        serviceError(status.UNAVAILABLE, 'connection refused'),
      );

      await expect(manager.askResultsFinal(fake.load(), 'once')).resolves.toBe(
        false,
      );
      expect(notifyScanEnded).toHaveBeenCalledTimes(1);
      // Asked again later: a transient failure is not an error yet.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[ScanEnded] Could not tell'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('falls back to CreateIssuesForScan when analysis-reporting predates NotifyScanEnded, and answers true', async () => {
      notifyScanEnded.mockReturnValue(
        serviceError(
          status.UNIMPLEMENTED,
          'The server does not implement the method',
        ),
      );

      await expect(manager.askResultsFinal(fake.load(), 'once')).resolves.toBe(
        true,
      );
      expect(createIssuesForScan).toHaveBeenCalledWith({
        projectId: 'p1',
        scanId: 's1',
        organizationId: 'o1',
      });
    });

    describe('with retries', () => {
      beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      it('answers false, never rejects, once its retries are exhausted: the scan stays held', async () => {
        notifyScanEnded.mockImplementation(() =>
          serviceError(status.UNAVAILABLE, 'connection refused'),
        );

        const asked = manager.askResultsFinal(fake.load(), 'retry');
        await jest.advanceTimersByTimeAsync(60_000);

        await expect(asked).resolves.toBe(false);
        expect(notifyScanEnded).toHaveBeenCalledTimes(4);
      });

      it('leaves a scan held when analysis-reporting cannot be told', async () => {
        notifyScanEnded.mockImplementation(() =>
          serviceError(status.UNAVAILABLE, 'connection refused'),
        );

        await manager.recordScanState(fake.load());
        await jest.advanceTimersByTimeAsync(60_000);

        expect(notifyScanEnded).toHaveBeenCalledTimes(4);
        expect(fake.db.row.state).toBe('running');
        expect(fake.db.row.resultsFinalizedAt).toBeNull();
      });
    });
  });

  it('never leaves an unhandled rejection when the finalization fails', async () => {
    notifyScanEnded.mockReturnValue(answer('dispatched'));
    fake.scanRepo.findOne.mockRejectedValue(new Error('connection lost'));
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      await manager.recordScanState(fake.load());
      await settle();
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[ResultsHold] Scan s1'),
    );
    expect(fake.db.row.state).toBe('running');
  });

  // A scan that reached its terminal state before results were held (an
  // older row, `resultsFinalizedAt` null) is never moved back to `running`
  // by a late recompute.
  it('never moves a scan already completed back to running', async () => {
    fake.db.row.state = 'completed';
    const scan = fake.load();

    await manager.recordScanState(scan);
    await settle();

    expect(scan.state).toBe('completed');
    expect(fake.db.row.state).toBe('completed');
    expect(
      statusEvents().some((event) => event.currentState === 'running'),
    ).toBe(false);
  });

  it('does not hold a scan whose containers all failed: it has no result to wait for', async () => {
    fake.db.containers = [
      container('sast', 'failed'),
      container('sca', 'failed'),
    ];
    const scan = fake.load();

    await expect(manager.recordScanState(scan)).resolves.toBe(true);
    expect(fake.db.row.state).toBe('failed');
    // Not held: the clean-up still tells analysis-reporting.
    await manager.handleCompletedScan(scan);
    await settle();
    expect(notifyScanEnded).toHaveBeenCalledTimes(1);
  });
});
