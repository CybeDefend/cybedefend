import { of, type Observable } from 'rxjs';
import type { Scan } from '../../../entities/scan.entity';
import type { ScanStateManager } from './scanStateManager';

/**
 * One scan lifecycle contract for every scan engine: the Community cluster
 * engine and the cloud's run the same cases, each through a harness over its
 * own classes.
 *
 * A scan ends once its results are final, not when its last container
 * closes: until analysis-reporting says so (its NotifyScanEnded outcome, or
 * MarkScanResultsFinal), the scan stays `running` and keeps its archive.
 *
 * A spec helper, never imported by the service: it calls Jest's globals.
 */

export interface LifecycleHarness {
  /**
   * CreateScan then StartScan of a code scan with two mandatory scanners.
   * `atCapacity`: admission finds every slot taken, so the scan is queued.
   * `stallLaunch`: the scan is claimed `running` and its launch never ends,
   * so it stays `running` without a container.
   */
  createAndStart(opts?: {
    atCapacity?: boolean;
    stallLaunch?: boolean;
  }): Promise<string>;
  /** The engine's dequeue, launches included. */
  tick(): Promise<void>;
  /** The index-th container of the scan (creation order) reports its end, through ScanService.updateScan. */
  closeContainer(
    scanId: string,
    index: number,
    state: 'completed' | 'failed',
  ): Promise<void>;
  /** ScanService.cancelScan. */
  cancel(scanId: string): Promise<void>;
  /**
   * What analysis-reporting answers NotifyScanEnded from now on: `waiting`
   * while it still finalizes the results, any other outcome once they are
   * final.
   */
  answerScanEnded(outcome: string): void;
  /** The NotifyScanEnded calls made for the scan so far. */
  scanEndedNotices(scanId: string): number;
  /**
   * Resolves once every results finalization the engine started in the
   * background (NotifyScanEnded when the last container closed, then the end
   * of the scan when its results are final) has run to its end.
   */
  resultsSettled(): Promise<void>;
  /** analysis-reporting's MarkScanResultsFinal, through ScanService: its outcome. */
  markResultsFinal(scanId: string): Promise<string>;
  /** The engine's scan watchdog, as if it ran at `now`. */
  runWatchdog(now: Date): Promise<void>;
  state(scanId: string): Promise<string>;
  containers(scanId: string): Promise<number>;
  /** Every pod the engine created so far. */
  podsCreated(): number;
  archiveDeletions(scanId: string): number;
  /** The name of the start function each launch went through, in order. */
  startCalls(): string[];
  close?(): Promise<void>;
}

const MIN = 60_000;

/** A NotifyScanEnded outcome saying the scan's results are final. */
export const RESULTS_FINAL_OUTCOME = 'already_dispatched';
/** The NotifyScanEnded outcome saying they are not final yet. */
export const RESULTS_NOT_FINAL_OUTCOME = 'waiting';

/**
 * `describeFn`: `describe`, or `describe.skip` when the harness's database
 * is not available, so every case shows as skipped rather than hidden.
 */
export function describeScanLifecycleContract(
  engine: string,
  make: () => Promise<LifecycleHarness>,
  describeFn: jest.Describe = describe,
): void {
  describeFn(`the scan lifecycle contract: ${engine}`, () => {
    jest.setTimeout(120_000);
    let h: LifecycleHarness;

    beforeAll(async () => {
      h = await make();
    });

    beforeEach(() => {
      h?.answerScanEnded(RESULTS_FINAL_OUTCOME);
    });

    afterEach(async () => {
      // Nothing a case started in the background runs into the next one.
      await h?.resultsSettled();
    });

    afterAll(async () => {
      await h?.close?.();
    });

    it('waiting_for_file → queued → running → completed', async () => {
      const id = await h.createAndStart({ atCapacity: true });
      expect(await h.state(id)).toBe('queued');
      expect(await h.containers(id)).toBe(0);
      await h.tick();
      expect(await h.state(id)).toBe('running');
      expect(await h.containers(id)).toBe(2);
      await h.closeContainer(id, 0, 'completed');
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('completed');
    });

    it('both start paths go through one function', async () => {
      const before = h.startCalls().length;
      const direct = await h.createAndStart();
      expect(await h.state(direct)).toBe('running');
      const queued = await h.createAndStart({ atCapacity: true });
      await h.tick();
      expect(await h.state(queued)).toBe('running');
      const calls = h.startCalls().slice(before);
      expect(calls).toHaveLength(2);
      expect(new Set(calls).size).toBe(1);
      for (const id of [direct, queued]) {
        await h.closeContainer(id, 0, 'completed');
        await h.closeContainer(id, 1, 'completed');
      }
      await h.resultsSettled();
      expect(await h.state(direct)).toBe('completed');
      expect(await h.state(queued)).toBe('completed');
    });

    it('cancel while queued: cancelled, no pod', async () => {
      const pods = h.podsCreated();
      const id = await h.createAndStart({ atCapacity: true });
      await h.cancel(id);
      expect(await h.state(id)).toBe('cancelled');
      await h.tick();
      expect(await h.state(id)).toBe('cancelled');
      expect(await h.containers(id)).toBe(0);
      expect(h.podsCreated()).toBe(pods);
    });

    it('the archive is deleted once, at the end', async () => {
      const id = await h.createAndStart();
      await h.closeContainer(id, 0, 'completed');
      await h.resultsSettled();
      expect(h.archiveDeletions(id)).toBe(0);
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('completed');
      expect(h.archiveDeletions(id)).toBe(1);
      // a late report changes nothing
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(h.archiveDeletions(id)).toBe(1);
    });

    it('never running without a container past 5 min', async () => {
      const id = await h.createAndStart({ stallLaunch: true });
      expect(await h.state(id)).toBe('running');
      expect(await h.containers(id)).toBe(0);
      await h.runWatchdog(new Date(Date.now() + 6 * MIN));
      expect(await h.state(id)).not.toBe('running');
    });

    it('the scan ends once its last container closed and its results are final', async () => {
      const id = await h.createAndStart();
      await h.closeContainer(id, 0, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('running');
      // analysis-reporting is asked only once every container is closed
      expect(h.scanEndedNotices(id)).toBe(0);
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('completed');
      // asked once, when the last container closed; not again at the end
      expect(h.scanEndedNotices(id)).toBe(1);
    });

    it('a failed mandatory container with a completed one: completed_degraded', async () => {
      const id = await h.createAndStart();
      await h.closeContainer(id, 0, 'failed');
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('completed_degraded');
    });

    it('results not final when the last container closes: running, archive kept, until MarkScanResultsFinal ends it once', async () => {
      h.answerScanEnded(RESULTS_NOT_FINAL_OUTCOME);
      const id = await h.createAndStart();
      await h.closeContainer(id, 0, 'completed');
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(h.scanEndedNotices(id)).toBe(1);
      expect(await h.state(id)).toBe('running');
      expect(h.archiveDeletions(id)).toBe(0);
      // a late report does not end it either
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('running');
      expect(h.archiveDeletions(id)).toBe(0);

      expect(await h.markResultsFinal(id)).toBe('finalized');
      expect(await h.state(id)).toBe('completed');
      expect(h.archiveDeletions(id)).toBe(1);
      // a second signal changes nothing, and analysis-reporting is not asked again
      expect(await h.markResultsFinal(id)).toBe('already_final');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('completed');
      expect(h.archiveDeletions(id)).toBe(1);
      expect(h.scanEndedNotices(id)).toBe(1);
    });

    it('a held scan with a failed mandatory container ends completed_degraded once its results are final', async () => {
      h.answerScanEnded(RESULTS_NOT_FINAL_OUTCOME);
      const id = await h.createAndStart();
      await h.closeContainer(id, 0, 'failed');
      await h.closeContainer(id, 1, 'completed');
      await h.resultsSettled();
      expect(await h.state(id)).toBe('running');
      expect(h.archiveDeletions(id)).toBe(0);

      expect(await h.markResultsFinal(id)).toBe('finalized');
      expect(await h.state(id)).toBe('completed_degraded');
      expect(h.archiveDeletions(id)).toBe(1);
    });
  });
}

/**
 * Tracks the results finalizations the state manager starts in the
 * background: when a scan's last container closes, it asks analysis-reporting
 * whether the results are final and, when they are, ends the scan (terminal
 * state, archive deletion), without the caller waiting for it. `settled()`
 * awaits every one of them, those started meanwhile included, so a case reads
 * the scan once that work is done rather than after a guessed delay.
 *
 * It wraps the manager's background method itself: a rename of that method
 * fails here, at the spy, rather than leaving the cases to race.
 */
export function trackResultsFinalization(manager: ScanStateManager): {
  settled(): Promise<void>;
} {
  const background = manager as unknown as {
    awaitResultsFinal(scan: Scan): Promise<void>;
  };
  const run = background.awaitResultsFinal.bind(manager) as (
    scan: Scan,
  ) => Promise<void>;
  const inFlight = new Set<Promise<void>>();
  jest
    .spyOn(background, 'awaitResultsFinal')
    .mockImplementation((scan: Scan) => {
      const work: Promise<void> = run(scan).finally(() =>
        inFlight.delete(work),
      );
      inFlight.add(work);
      return work;
    });
  return {
    async settled() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}

/** The organisation every contract scan belongs to. */
export const LIFECYCLE_ORG = '0c0c0c0c-0000-4000-8000-000000000001';

/**
 * The peers a lifecycle harness stands in for, recording what the contract
 * reads (archive deletions, NotifyScanEnded calls): file-management,
 * global-management (one project with IaC and secrets on, an organisation
 * limit of 50), analysis-reporting (its NotifyScanEnded outcome set by
 * `answerScanEnded`, final by default), policy-management, the realtime
 * publisher, a Logger, the ConfigService.
 */
export function lifecycleFakes() {
  const deletions = new Map<string, number>();
  const files = {
    deleteFile: async (scanId: string) => {
      deletions.set(scanId, (deletions.get(scanId) ?? 0) + 1);
      return { success: true };
    },
    getDownloadUrl: async () => 'https://storage.example/archive.zip',
    getExternalDownloadUrl: async () => 'https://storage.example/archive.zip',
    deleteImportObject: async () => undefined,
  };
  const project = {
    organizationId: LIFECYCLE_ORG,
    iacEnabled: true,
    secretEnabled: true,
    iacSeverities: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    secretSeverities: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    parsedBranches: [],
  };
  const organization = {
    organizationId: LIFECYCLE_ORG,
    concurrentScanLimit: 50,
  };
  const grpc = (service: Record<string, () => Observable<unknown>>) => ({
    getService: () => service,
  });
  const gm = {
    getService: (name: string) =>
      name === 'ProjectService'
        ? {
            get: () => of(project),
            update: () => of({}),
            markProjectAppsec: () => of({ appsec: true, limitReached: false }),
          }
        : {
            get: () => of(organization),
            markProjectAppsec: () => of({ appsec: true, limitReached: false }),
          },
  };
  let scanEndedOutcome = RESULTS_FINAL_OUTCOME;
  const scanEndedNotices = new Map<string, number>();
  const ar = {
    getService: () => ({
      notifyScanEnded: ({ scanId }: { scanId: string }) => {
        scanEndedNotices.set(scanId, (scanEndedNotices.get(scanId) ?? 0) + 1);
        return of({ success: true, message: scanEndedOutcome });
      },
      notifyScanComplete: () => of({ message: 'ok' }),
      importResults: () => of({ accepted: true }),
    }),
  };
  const pm = grpc({ triggerEvaluation: () => of({ evaluationId: '' }) });
  const quiet = () => undefined;
  const logger = {
    log: quiet,
    warn: quiet,
    error: quiet,
    debug: quiet,
    verbose: quiet,
  };
  const env: Record<string, string> = {};
  const config = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  };
  return {
    files,
    gm,
    ar,
    pm,
    realtime: { publish: async () => undefined },
    logger,
    config,
    env,
    archiveDeletions: (scanId: string) => deletions.get(scanId) ?? 0,
    answerScanEnded: (outcome: string) => {
      scanEndedOutcome = outcome;
    },
    scanEndedNotices: (scanId: string) => scanEndedNotices.get(scanId) ?? 0,
  };
}
