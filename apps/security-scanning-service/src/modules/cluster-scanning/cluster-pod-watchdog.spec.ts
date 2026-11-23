import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { V1Pod } from '@kubernetes/client-node';
import type { Repository } from 'typeorm';
import type { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';
import type { ScanService } from '../scan/scan.service';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import type { ScanStateStore } from '../scan/core/scanStateStore';
import type { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';
import type { ScanResultsService } from '../scan/cluster-results/scan-results.service';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import type { ClusterScanningState } from './cluster-scanning.state';
import type { CommunityKubeClient } from './kube-client';
import {
  ClusterPodWatchdog,
  IMAGE_PULL_GRACE_MS,
  IMPORT_BACKSTOP_MS,
  podFailureCode,
} from './cluster-pod-watchdog';
import { ClusterScanEnd } from './cluster-scan-end';
import type { FileManagementService } from '../file/file-management.service';

/**
 * The Community cluster watchdog. Every minute, in
 * the cron process. A container whose token is spent is left to its import;
 * a disabled engine fails nothing early; no configuration: nothing at all.
 * The sweep deletes Secrets by name, never lists them, and keeps a closed
 * container's pod with keepPods.
 */

const MIN = 60_000;
const T0 = new Date('2026-11-04T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SCAN = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const PHASE_MS = 7_200_000;

const configOf = (env: NodeJS.ProcessEnv = {}): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    FRONTEND_URL: 'https://appsec.example.com',
    ...env,
  });

const container = (over: Partial<Container> = {}): Container =>
  ({
    id: C1,
    scanId: SCAN,
    podName: `cd-scan-opengrep-${C1}`,
    image: 'cybedefend-scanners/opengrep:1.0.0',
    status: 'starting',
    startedAt: T0,
    createdAt: T0,
    ...over,
  }) as Container;

const runningScan = (containers: Container[], over: Partial<Scan> = {}): Scan =>
  ({
    id: SCAN,
    projectId: 'p1',
    organizationId: 'o1',
    state: 'running',
    startTime: T0,
    createAt: T0,
    importFormat: null,
    isGraphOnly: false,
    isDiffScan: false,
    containers,
    ...over,
  }) as Scan;

const pod = (
  phase: string,
  extra: {
    exitCode?: number;
    waiting?: string;
    reason?: string;
    terminatedReason?: string;
    startTime?: Date;
  } = {},
): V1Pod =>
  ({
    metadata: { name: `cd-scan-opengrep-${C1}` },
    status: {
      phase,
      reason: extra.reason,
      ...(extra.startTime ? { startTime: extra.startTime } : {}),
      containerStatuses: [
        {
          name: 'scanner',
          state: {
            ...(extra.waiting ? { waiting: { reason: extra.waiting } } : {}),
            ...(extra.exitCode !== undefined || extra.terminatedReason
              ? {
                  terminated: {
                    exitCode: extra.exitCode ?? 137,
                    reason: extra.terminatedReason,
                  },
                }
              : {}),
          },
        },
      ],
    },
  }) as unknown as V1Pod;

interface Opts {
  enabled?: boolean;
  config?: ClusterScanningConfig | null;
  scans?: Scan[];
  stuck?: { queued?: Scan[]; waiting?: Scan[]; running?: Scan[] };
  pod?: V1Pod | null;
  spent?: string[];
  /** When each spent token was claimed (default T0). */
  spentAt?: Record<string, Date>;
  managedPods?: V1Pod[];
  rows?: Container[];
  closedRecently?: Container[];
  openOfEnded?: Container[];
}

function harness(opts: Opts = {}) {
  const scans = opts.scans ?? [];
  const stuck = opts.stuck ?? {};
  const scanRepo = {
    find: jest.fn(
      async (q: { where: { state: string }; relations?: string[] }) => {
        const state = q.where.state;
        if (q.relations) return scans.filter((s) => s.state === state);
        if (state === 'queued') return stuck.queued ?? [];
        if (state === 'waiting_for_file') return stuck.waiting ?? [];
        return [];
      },
    ),
  };
  const runningNoContainer = stuck.running ?? [];
  scanRepo.find.mockImplementation(async (q) => {
    const state = q.where.state;
    if (q.relations) {
      return [...scans, ...runningNoContainer].filter((s) => s.state === state);
    }
    if (state === 'queued') return stuck.queued ?? [];
    if (state === 'waiting_for_file') return stuck.waiting ?? [];
    return [];
  });
  const rows = opts.rows ?? [];
  const containerRepo = {
    find: jest.fn(async (q: { relations?: string[] }) =>
      q.relations ? (opts.openOfEnded ?? []) : (opts.closedRecently ?? []),
    ),
    findOne: jest.fn(
      async ({ where: { id } }: { where: { id: string } }) =>
        rows.find((r) => r.id === id) ?? null,
    ),
  };
  const moves: Array<{
    id: string;
    from: string[];
    to: string;
    columns: Record<string, unknown>;
  }> = [];
  const store = {
    closeOpenContainer: jest.fn(async () => true),
    moveScanState: jest.fn(
      async (
        scan: Scan,
        from: string[],
        to: string,
        columns: Record<string, unknown>,
      ) => {
        moves.push({ id: scan.id, from, to, columns });
        Object.assign(scan, columns, { state: to });
        return true;
      },
    ),
  };
  const stateManager = {
    publishStatusChanged: jest.fn(),
    handleCompletedScan: jest.fn(async () => undefined),
  };
  const files = {
    deleteFile: jest.fn<Promise<{ success: boolean }>, [string]>(async () => ({
      success: true,
    })),
  };
  const spent = new Set(opts.spent ?? []);
  const tokens = {
    spentContainers: jest.fn(
      async (ids: string[]) => new Set(ids.filter((id) => spent.has(id))),
    ),
    spentAt: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids
            .filter((id) => spent.has(id))
            .map((id) => [id, opts.spentAt?.[id] ?? T0] as [string, Date]),
        ),
    ),
  };
  const results = { closeContainer: jest.fn(async () => ({ success: true })) };
  const scanService = { updateScan: jest.fn(async () => ({ success: true })) };
  const kube = {
    reviewAccess: jest.fn(),
    createSecret: jest.fn(),
    deleteSecret: jest.fn(async () => undefined),
    createPod: jest.fn(),
    readPod: jest.fn(async () =>
      opts.pod === undefined ? pod('Running') : opts.pod,
    ),
    listManagedPods: jest.fn(async () => opts.managedPods ?? []),
    deletePod: jest.fn(async () => undefined),
  };
  const state = { enabled: opts.enabled ?? true };
  const configService = {
    get: (key: string) =>
      key === 'SCAN_SCANNER_PHASE_MAX_MS' ? String(PHASE_MS) : undefined,
  } as unknown as ConfigService;
  const watchdog = new ClusterPodWatchdog(
    scanRepo as unknown as Repository<Scan>,
    containerRepo as unknown as Repository<Container>,
    store as unknown as ScanStateStore,
    new ClusterScanEnd(
      store as unknown as ScanStateStore,
      stateManager as unknown as ScanStateManager,
      files as unknown as FileManagementService,
    ),
    tokens as unknown as ScanUploadTokens,
    results as unknown as ScanResultsService,
    scanService as unknown as ScanService,
    state as unknown as ClusterScanningState,
    kube as unknown as CommunityKubeClient,
    opts.config === undefined ? configOf() : opts.config,
    configService,
  );
  const failedWith = (): string[] =>
    results.closeContainer.mock.calls.map(
      (c) => (c as unknown as [{ errorCode: string }])[0].errorCode,
    );
  return {
    watchdog,
    scanRepo,
    containerRepo,
    store,
    moves,
    tokens,
    results,
    scanService,
    stateManager,
    files,
    kube,
    failedWith,
  };
}

describe('ClusterPodWatchdog', () => {
  beforeEach(() => {
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  const withPod = (p: V1Pod | null, c = container()) =>
    harness({ scans: [runningScan([c])], pod: p });

  it('Running: a starting container becomes running', async () => {
    const h = withPod(pod('Running'));
    await h.watchdog.tick(at(MIN));
    expect(h.scanService.updateScan).toHaveBeenCalledWith({
      scanId: SCAN,
      podName: `cd-scan-opengrep-${C1}`,
      state: 'running',
    });
    expect(h.results.closeContainer).not.toHaveBeenCalled();
  });

  it('Running: a running container is left alone', async () => {
    const h = withPod(pod('Running'), container({ status: 'running' }));
    await h.watchdog.tick(at(MIN));
    expect(h.scanService.updateScan).not.toHaveBeenCalled();
    expect(h.results.closeContainer).not.toHaveBeenCalled();
  });

  it('Pending for more than 10 min: 81, never before', async () => {
    const h = withPod(pod('Pending'));
    await h.watchdog.tick(at(9 * MIN));
    expect(h.results.closeContainer).not.toHaveBeenCalled();
    await h.watchdog.tick(at(11 * MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_UNSCHEDULABLE']);
  });

  it.each(['ImagePullBackOff', 'ErrImagePull'])(
    'waiting %s: 63 only once pulling for 3 min, never on the first sight',
    async (w) => {
      const h = withPod(pod('Pending', { waiting: w, startTime: T0 }));
      await h.watchdog.tick(at(MIN));
      await h.watchdog.tick(at(2 * MIN));
      expect(h.results.closeContainer).not.toHaveBeenCalled();
      expect(IMAGE_PULL_GRACE_MS).toBe(3 * MIN);
      await h.watchdog.tick(at(3 * MIN + 1));
      expect(h.failedWith()).toEqual(['CLUSTER_IMAGE_PULL_FAILED']);
    },
  );

  it('a pull failure is 63 within the 10 min Pending budget, even if the pull started late', async () => {
    const h = withPod(
      pod('Pending', { waiting: 'ErrImagePull', startTime: at(9 * MIN) }),
    );
    await h.watchdog.tick(at(9 * MIN + 30_000));
    expect(h.results.closeContainer).not.toHaveBeenCalled();
    await h.watchdog.tick(at(10 * MIN + 1));
    expect(h.failedWith()).toEqual(['CLUSTER_IMAGE_PULL_FAILED']);
  });

  it('Succeeded with the token unspent: 80', async () => {
    const h = withPod(pod('Succeeded', { exitCode: 0 }));
    await h.watchdog.tick(at(MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_NO_RESULTS']);
    expect(h.results.closeContainer).toHaveBeenCalledWith({
      scanId: SCAN,
      containerId: C1,
      status: 'failed',
      errorCode: 'CLUSTER_NO_RESULTS',
      findingsCount: 0,
      toolName: '',
    });
  });

  it.each([
    [2, 'CLUSTER_TOOL_FAILED'],
    [3, 'CLUSTER_RESULTS_REFUSED'],
    [4, 'CLUSTER_IMAGE_INCOMPATIBLE'],
    [5, 'CLUSTER_IMAGE_INCOMPATIBLE'],
    [6, 'CLUSTER_ARCHIVE_FETCH_FAILED'],
  ])('Failed with runner exit %i: %s', async (exitCode, name) => {
    const h = withPod(pod('Failed', { exitCode }));
    await h.watchdog.tick(at(MIN));
    expect(h.failedWith()).toEqual([name]);
  });

  // Runner exit 6: the pod could not fetch the archive from this instance's
  // storage. Its own cluster code, never the Git provider's 66.
  it('Failed with runner exit 6: 88, the storage fetch', () => {
    expect(podFailureCode(pod('Failed', { exitCode: 6 }), MIN)).toBe(88);
  });

  it('Failed OOMKilled: 61; any other exit: 60', async () => {
    const oom = withPod(
      pod('Failed', { exitCode: 137, terminatedReason: 'OOMKilled' }),
    );
    await oom.watchdog.tick(at(MIN));
    expect(oom.failedWith()).toEqual(['CLUSTER_OUT_OF_MEMORY']);
    const other = withPod(pod('Failed', { exitCode: 1 }));
    await other.watchdog.tick(at(MIN));
    expect(other.failedWith()).toEqual(['CLUSTER_INFRA_ERROR']);
  });

  it('gone with the token unspent: 87', async () => {
    const h = withPod(null);
    await h.watchdog.tick(at(MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_POD_LOST']);
  });

  it('open past the pod start + scannerPhaseMaxMs: 82 and the pod is deleted, keepPods or not', async () => {
    const h = harness({
      scans: [runningScan([container({ status: 'running' })])],
      pod: pod('Running', { startTime: T0 }),
      config: configOf({ CYBEDEFEND_SCANNER_KEEP_PODS: 'true' }),
    });
    await h.watchdog.tick(at(PHASE_MS - MIN));
    expect(h.results.closeContainer).not.toHaveBeenCalled();
    await h.watchdog.tick(at(PHASE_MS + MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_DEADLINE']);
    expect(h.kube.deletePod).toHaveBeenCalledWith(`cd-scan-opengrep-${C1}`);
    expect(h.kube.deleteSecret).toHaveBeenCalledWith(
      `cd-scan-opengrep-${C1}-run`,
    );
  });

  it('a pod that waited 9 min in Pending is not failed 82 at startedAt + phase', async () => {
    const h = harness({
      scans: [runningScan([container({ status: 'running' })])],
      pod: pod('Running', { startTime: at(9 * MIN) }),
    });
    await h.watchdog.tick(at(PHASE_MS + MIN));
    expect(h.results.closeContainer).not.toHaveBeenCalled();
    expect(h.kube.deletePod).not.toHaveBeenCalled();
    await h.watchdog.tick(at(9 * MIN + PHASE_MS + MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_DEADLINE']);
  });

  it('a pod without a start time: 82 only past startedAt + the 10 min Pending budget + phase, never on the row alone', async () => {
    const h = harness({
      scans: [runningScan([container({ status: 'running' })])],
      pod: pod('Pending'),
    });
    await h.watchdog.tick(at(PHASE_MS + MIN));
    // Pending past 10 min is 81 on its own: the deadline never fired first
    expect(h.failedWith()).not.toContain('CLUSTER_DEADLINE');
    const unread = harness({
      scans: [runningScan([container({ status: 'running' })])],
    });
    unread.kube.readPod.mockRejectedValue(new Error('read failed status=500'));
    await unread.watchdog.tick(at(PHASE_MS + 9 * MIN));
    expect(unread.results.closeContainer).not.toHaveBeenCalled();
    // past the budget, decided before the pod read
    await unread.watchdog.tick(at(PHASE_MS + 11 * MIN));
    expect(unread.failedWith()).toEqual(['CLUSTER_DEADLINE']);
    expect(unread.kube.readPod).toHaveBeenCalledTimes(1);
  });

  it('a spent token past the phase deadline is not failed before its 30 min backstop', async () => {
    const usedAt = at(PHASE_MS - 5 * MIN);
    const h = harness({
      scans: [runningScan([container({ status: 'running' })])],
      spent: [C1],
      spentAt: { [C1]: usedAt },
      pod: pod('Succeeded', { exitCode: 0, startTime: T0 }),
    });
    for (const t of [
      PHASE_MS + MIN,
      PHASE_MS + 15 * MIN,
      PHASE_MS + 24 * MIN,
    ]) {
      await h.watchdog.tick(at(t));
    }
    expect(h.results.closeContainer).not.toHaveBeenCalled();
    expect(h.kube.readPod).not.toHaveBeenCalled();
    expect(h.kube.deletePod).not.toHaveBeenCalled();
    expect(IMPORT_BACKSTOP_MS).toBe(30 * MIN);
    await h.watchdog.tick(
      new Date(usedAt.getTime() + IMPORT_BACKSTOP_MS + MIN),
    );
    expect(h.failedWith()).toEqual(['IMPORT_UNAVAILABLE']);
  });

  it('a pod past its activeDeadlineSeconds (DeadlineExceeded): 82', async () => {
    const h = withPod(pod('Failed', { reason: 'DeadlineExceeded' }));
    await h.watchdog.tick(at(MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_DEADLINE']);
  });

  it('leaves a spent-token container to its import', async () => {
    const h = harness({
      scans: [runningScan([container({ status: 'running' })])],
      spent: [C1],
      pod: pod('Succeeded', { exitCode: 0 }),
    });
    for (let i = 1; i <= 15; i++) await h.watchdog.tick(at(i * MIN));
    h.kube.readPod.mockResolvedValue(null);
    for (let i = 16; i <= 30; i++) await h.watchdog.tick(at(i * MIN));
    expect(h.results.closeContainer).not.toHaveBeenCalled();
  });

  it('a token spent between the read and the failure is left to its import', async () => {
    const h = withPod(pod('Succeeded', { exitCode: 0 }));
    // the batch read (spentAt) found it unspent; the re-read finds it spent
    h.tokens.spentContainers.mockResolvedValueOnce(new Set([C1]));
    await h.watchdog.tick(at(MIN));
    expect(h.results.closeContainer).not.toHaveBeenCalled();
  });

  it('only the catalogue containers of a running code scan are read', async () => {
    const h = harness({
      scans: [
        runningScan([
          container({ image: 'cybedefend/agent:1', podName: 'agent' }),
        ]),
      ],
    });
    await h.watchdog.tick(at(MIN));
    expect(h.kube.readPod).not.toHaveBeenCalled();
  });

  it('one failing container does not stop the others, and the tick never rejects', async () => {
    const c2 = container({
      id: '33333333-3333-4333-8333-333333333333',
      podName: 'cd-scan-gitleaks-3',
      image: 'cybedefend-scanners/gitleaks:1.0.0',
    });
    const h = harness({ scans: [runningScan([container(), c2])] });
    h.kube.readPod
      .mockRejectedValueOnce(new Error('read failed status=500'))
      .mockResolvedValueOnce(null);
    await expect(h.watchdog.tick(at(MIN))).resolves.toBeUndefined();
    expect(h.failedWith()).toEqual(['CLUSTER_POD_LOST']);
    h.scanRepo.find.mockRejectedValue(new Error('db down'));
    await expect(h.watchdog.tick(at(2 * MIN))).resolves.toBeUndefined();
  });

  describe('scan deadlines', () => {
    it('queued past 6 h: failed 65; running with no container past 5 min: failed 83; waiting_for_file past 45 min: failed 98', async () => {
      const queued = runningScan([], {
        id: 'q',
        state: 'queued',
        createAt: at(-6 * 60 * MIN - MIN),
      });
      const waiting = runningScan([], {
        id: 'w',
        state: 'waiting_for_file',
        createAt: at(-46 * MIN),
      });
      const empty = runningScan([], { id: 'r', startTime: at(-6 * MIN) });
      const h = harness({
        stuck: { queued: [queued], waiting: [waiting], running: [empty] },
      });
      await h.watchdog.tick(T0);
      const byId = Object.fromEntries(h.moves.map((m) => [m.id, m]));
      expect(byId.q).toMatchObject({
        from: ['queued'],
        to: 'failed',
        columns: { errorCode: 65 },
      });
      // the archive never arrived: its own code, never a bare failure
      expect(byId.w).toMatchObject({
        from: ['waiting_for_file'],
        to: 'failed',
        columns: { errorCode: 98, errorCategory: 'archive' },
      });
      expect(byId.r).toMatchObject({
        from: ['running'],
        to: 'failed',
        columns: { errorCode: 83, errorCategory: 'cluster' },
      });
      // as the cloud's checkExpiredScan: the archive goes, and no scan end
      // (no notifyScanEnded, no policy evaluation) for a scan that ran nothing
      expect(h.files.deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual([
        'q',
        'r',
        'w',
      ]);
      expect(h.stateManager.handleCompletedScan).not.toHaveBeenCalled();
    });

    it('reads only code scans past their deadline', async () => {
      const h = harness();
      await h.watchdog.tick(T0);
      for (const [q] of h.scanRepo.find.mock.calls as unknown as Array<
        [{ where: Record<string, unknown> }]
      >) {
        expect(q.where).toMatchObject({
          isGraphOnly: false,
          isDiffScan: false,
        });
        expect(q.where.importFormat).toBeDefined();
      }
    });

    it('a running scan younger than 5 min, or with a container, is untouched', async () => {
      const young = runningScan([], { id: 'y', startTime: at(-4 * MIN) });
      const h = harness({ stuck: { running: [young] } });
      await h.watchdog.tick(T0);
      expect(h.moves).toEqual([]);
    });

    it('an import scan running 10 min with no container is untouched', async () => {
      // the query filters importFormat IS NULL: an import is never returned
      const h = harness();
      await h.watchdog.tick(at(10 * MIN));
      const runningQuery = (
        h.scanRepo.find.mock.calls as unknown as Array<
          [{ where: { state: string; importFormat: unknown } }]
        >
      ).find(([q]) => q.where.state === 'running');
      expect(runningQuery[0].where.importFormat).toMatchObject({
        _type: 'isNull',
      });
      expect(h.moves).toEqual([]);
    });

    it('a disabled engine fails nothing early', async () => {
      const fiveH59 = runningScan([], {
        id: 'q',
        state: 'queued',
        createAt: at(-(6 * 60 - 1) * MIN),
      });
      const h = harness({ enabled: false, stuck: { queued: [fiveH59] } });
      await h.watchdog.tick(T0);
      expect(h.moves).toEqual([]);
      const sixH01 = runningScan([], {
        id: 'q',
        state: 'queued',
        createAt: at(-(6 * 60 + 1) * MIN),
      });
      const h2 = harness({
        enabled: false,
        stuck: { queued: [sixH01] },
        scans: [runningScan([container()])],
      });
      await h2.watchdog.tick(T0);
      expect(h2.moves.map((m) => [m.id, m.columns.errorCode])).toEqual([
        ['q', 65],
      ]);
      // no Kubernetes call while disabled
      for (const fn of Object.values(h2.kube))
        expect(fn).not.toHaveBeenCalled();
      expect(h2.results.closeContainer).not.toHaveBeenCalled();
    });

    it('no config: no scan deadline, no Kubernetes call', async () => {
      const old = runningScan([], {
        id: 'q',
        state: 'queued',
        createAt: at(-24 * 60 * MIN),
      });
      const h = harness({
        config: null,
        stuck: { queued: [old], running: [runningScan([], { id: 'r' })] },
      });
      await h.watchdog.tick(at(10 * MIN));
      expect(h.moves).toEqual([]);
      // only the running scans' open containers are read
      for (const [q] of h.scanRepo.find.mock.calls as unknown as Array<
        [{ where: { state: string } }]
      >) {
        expect(q.where.state).toBe('running');
      }
      expect(h.results.closeContainer).not.toHaveBeenCalled();
    });

    it.each([
      ['disabled', { enabled: false }],
      ['config removed', { enabled: false, config: null }],
    ])(
      '%s: 82 and the import backstop still apply to open catalogue containers, from the database only',
      async (_label, over) => {
        const c2 = container({
          id: '33333333-3333-4333-8333-333333333333',
          podName: 'cd-scan-gitleaks-3',
          image: 'cybedefend-scanners/gitleaks:1.0.0',
          status: 'running',
        });
        const h = harness({
          ...over,
          scans: [runningScan([container({ status: 'running' }), c2])],
          spent: [c2.id],
          spentAt: { [c2.id]: at(PHASE_MS) },
        });
        // past startedAt + the Pending budget + phase, and past the backstop
        await h.watchdog.tick(at(PHASE_MS + IMPORT_BACKSTOP_MS + MIN));
        expect(h.failedWith().sort()).toEqual([
          'CLUSTER_DEADLINE',
          'IMPORT_UNAVAILABLE',
        ]);
        // no Kubernetes call: no pod read, no delete
        for (const fn of Object.values(h.kube))
          expect(fn).not.toHaveBeenCalled();
      },
    );

    it('disabled: nothing before those deadlines', async () => {
      const h = harness({
        enabled: false,
        scans: [runningScan([container({ status: 'running' })])],
      });
      await h.watchdog.tick(at(PHASE_MS + 9 * MIN));
      expect(h.results.closeContainer).not.toHaveBeenCalled();
    });
  });

  describe('orphans', () => {
    // sha256 of https://appsec.example.com, first 16 hex (Important 2)
    const INSTANCE = '38e84067f54dd556';
    const managed = (
      id: string,
      ageMs: number,
      instance: string | null = INSTANCE,
    ): V1Pod =>
      ({
        metadata: {
          name: `cd-scan-opengrep-${id}`,
          creationTimestamp: at(-ageMs),
          labels: {
            'app.kubernetes.io/managed-by': 'cybedefend',
            'cybedefend.io/container-id': id,
            ...(instance === null
              ? {}
              : { 'cybedefend.io/instance': instance }),
          },
        },
        status: { phase: 'Succeeded' },
      }) as unknown as V1Pod;

    it("another instance's pod, or one without the instance label, survives the sweep", async () => {
      const h = harness({
        managedPods: [
          managed('foreign', 60 * MIN, 'ffffffffffffffff'),
          managed('unlabelled', 60 * MIN, null),
          managed('mine', 60 * MIN),
        ],
      });
      await h.watchdog.tick(T0);
      expect(h.kube.deletePod.mock.calls).toEqual([['cd-scan-opengrep-mine']]);
      expect(h.kube.deleteSecret.mock.calls).toEqual([
        ['cd-scan-opengrep-mine-run'],
      ]);
      // the row of another instance's container is never even read
      expect(h.containerRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('deletes an orphan pod and its Secret after 10 minutes, never a younger one', async () => {
      const h = harness({
        managedPods: [managed('old', 11 * MIN), managed('young', 9 * MIN)],
      });
      await h.watchdog.tick(T0);
      expect(h.kube.deletePod.mock.calls).toEqual([['cd-scan-opengrep-old']]);
      expect(h.kube.deleteSecret.mock.calls).toEqual([
        ['cd-scan-opengrep-old-run'],
      ]);
    });

    it("deletes a closed container's pod and Secret; keeps an open one's", async () => {
      const h = harness({
        managedPods: [managed('closed', 20 * MIN), managed('open', 20 * MIN)],
        rows: [
          container({ id: 'closed', status: 'completed' }),
          container({ id: 'open', status: 'running' }),
        ],
      });
      await h.watchdog.tick(T0);
      expect(h.kube.deletePod.mock.calls).toEqual([
        ['cd-scan-opengrep-closed'],
      ]);
    });

    it("keepPods: a closed container's pod survives the sweep, a missing row's does not", async () => {
      const h = harness({
        config: configOf({ CYBEDEFEND_SCANNER_KEEP_PODS: 'true' }),
        managedPods: [managed('closed', 20 * MIN), managed('gone', 20 * MIN)],
        rows: [container({ id: 'closed', status: 'failed' })],
      });
      await h.watchdog.tick(T0);
      expect(h.kube.deletePod.mock.calls).toEqual([['cd-scan-opengrep-gone']]);
    });

    it('deletes the Secret of a recently closed container by name, once, never by listing', async () => {
      const closed = container({
        id: 'c9',
        podName: 'cd-scan-zizmor-c9',
        image: 'cybedefend-scanners/zizmor:1.0.0',
        status: 'completed',
        finishedAt: at(-15 * MIN),
      });
      const h = harness({ closedRecently: [closed] });
      await h.watchdog.tick(T0);
      await h.watchdog.tick(at(MIN));
      expect(h.kube.deleteSecret.mock.calls).toEqual([
        ['cd-scan-zizmor-c9-run'],
      ]);
      expect(Object.keys(h.kube)).not.toContain('listSecrets');
    });
  });

  it('82: a refused pod delete still closes the container on that tick', async () => {
    const h = harness({
      scans: [runningScan([container({ status: 'running' })])],
      pod: pod('Running', { startTime: T0 }),
    });
    h.kube.deletePod.mockRejectedValueOnce(
      new Error('deletePod failed status=500'),
    );
    await h.watchdog.tick(at(PHASE_MS + MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_DEADLINE']);
  });

  it('an open row of a scan no longer running, older than 10 min: pod and Secret deleted, row closed', async () => {
    const leaked = (id: string, ageMs: number, state: string) =>
      ({
        ...container({ id, podName: `cd-scan-opengrep-${id}` }),
        createdAt: at(-ageMs),
        scan: { id: SCAN, state } as Scan,
      }) as Container;
    const h = harness({
      openOfEnded: [
        leaked('old', 11 * MIN, 'failed'),
        leaked('running-scan', 11 * MIN, 'running'),
      ],
    });
    await h.watchdog.tick(T0);
    expect(h.kube.deletePod.mock.calls).toEqual([['cd-scan-opengrep-old']]);
    expect(h.kube.deleteSecret.mock.calls).toEqual([
      ['cd-scan-opengrep-old-run'],
    ]);
    expect(h.store.closeOpenContainer).toHaveBeenCalledWith('old', {
      status: 'failed',
      finishedAt: T0,
      outcomeReason: 'CLUSTER_LAUNCH_FAILED',
    });
    expect(h.store.closeOpenContainer).toHaveBeenCalledTimes(1);
    // the query bounds the age to 10 min, open rows only
    const [q] = h.containerRepo.find.mock.calls.find(
      ([x]) => (x as { relations?: string[] }).relations,
    ) as unknown as [{ where: { createdAt: { _value: Date } } }];
    expect(q.where.createdAt._value).toEqual(at(-10 * MIN));
  });

  it('keepPods does not keep a pod past its deadline: a refused delete at 82, then the next tick deletes the pod and its Secret', async () => {
    const podName = `cd-scan-opengrep-${C1}`;
    const h = harness({
      config: configOf({ CYBEDEFEND_SCANNER_KEEP_PODS: 'true' }),
      scans: [runningScan([container({ status: 'running' })])],
      pod: pod('Running', { startTime: T0 }),
      rows: [
        container({
          status: 'failed',
          outcomeReason: 'CLUSTER_DEADLINE',
        }),
      ],
      managedPods: [
        {
          metadata: {
            name: podName,
            creationTimestamp: T0,
            labels: {
              'cybedefend.io/container-id': C1,
              'cybedefend.io/instance': '38e84067f54dd556',
            },
          },
          status: { phase: 'Running' },
        } as unknown as V1Pod,
      ],
    });
    h.kube.deletePod.mockRejectedValueOnce(
      new Error('deletePod failed status=500'),
    );
    await h.watchdog.tick(at(PHASE_MS + MIN));
    expect(h.failedWith()).toEqual(['CLUSTER_DEADLINE']);
    h.kube.deletePod.mockClear();
    h.kube.deleteSecret.mockClear();
    // the next tick: the container row is closed (CLUSTER_DEADLINE)
    h.scanRepo.find.mockResolvedValue([]);
    await h.watchdog.tick(at(PHASE_MS + 2 * MIN));
    expect(h.kube.deletePod.mock.calls).toEqual([[podName]]);
    expect(h.kube.deleteSecret.mock.calls).toEqual([[`${podName}-run`]]);
  });

  it('keepPods still keeps a pod closed with any other outcome', async () => {
    const h = harness({
      config: configOf({ CYBEDEFEND_SCANNER_KEEP_PODS: 'true' }),
      rows: [
        container({ status: 'failed', outcomeReason: 'CLUSTER_TOOL_FAILED' }),
      ],
      managedPods: [
        {
          metadata: {
            name: 'p',
            creationTimestamp: at(-20 * MIN),
            labels: { 'cybedefend.io/container-id': C1 },
          },
        } as unknown as V1Pod,
      ],
    });
    await h.watchdog.tick(T0);
    expect(h.kube.deletePod).not.toHaveBeenCalled();
  });
});
