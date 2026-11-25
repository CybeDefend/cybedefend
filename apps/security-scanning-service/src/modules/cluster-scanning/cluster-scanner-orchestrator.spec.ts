import { Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Repository } from 'typeorm';
import type {
  CreateScanRequest,
  ProjectScanSettings,
  StartScanRequest,
} from '@grpc/security-scanning/scan';
import type { Scan } from 'src/entities/scan.entity';
import type { OrganizationManager } from '../scan/core/organizationManager';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import type { ScanStateStore } from '../scan/core/scanStateStore';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import type { ClusterPodLauncher } from './cluster-pod-launcher';
import type { CommunityScannerCatalogue } from './scanner-catalogue';
import { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import { ClusterScanEnd } from './cluster-scan-end';
import type { FileManagementService } from '../file/file-management.service';
import { ClusterScanQueue } from './cluster-scan-queue';
import type { ClusterScanningState } from './cluster-scanning.state';

/**
 * The Community cluster engine's orchestrator. One
 * start function (launchScan) for both start paths; admission counts the
 * queue, the dequeue does not; a launch failure leaves the scan
 * failed with 83 CLUSTER_LAUNCH_FAILED, category cluster.
 */

const SCAN_ID = '11111111-1111-4111-8111-111111111111';

const config = (max = 2, perOrganization?: number): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    CYBEDEFEND_SCANNER_MAX_CONCURRENT: String(max),
    CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION:
      perOrganization === undefined ? '' : String(perOrganization),
    FRONTEND_URL: 'https://appsec.example.com',
  });

const newScan = (over: Partial<Scan> = {}): Scan =>
  ({
    id: SCAN_ID,
    projectId: 'p1',
    organizationId: 'o1',
    state: 'waiting_for_file',
    branch: undefined,
    ...over,
  }) as Scan;

const start = (over: Partial<StartScanRequest> = {}): StartScanRequest => ({
  scanId: SCAN_ID,
  projectId: 'p1',
  language: ['python'],
  totalLOC: 1200,
  totalSize: '3Mo',
  ...over,
});

const createRequest = (
  over: Partial<CreateScanRequest> = {},
): CreateScanRequest => ({
  scanId: SCAN_ID,
  projectId: 'p1',
  initializerUserId: 'u1',
  privateScan: false,
  vulnerabilityTypes: [],
  ...over,
});

const SETTINGS = {
  enabledScanTypes: ['sast'],
} as unknown as ProjectScanSettings;

function harness(
  opts: {
    running?: number;
    queued?: number;
    max?: number;
    /** CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION; unset when not given. */
    perOrganization?: number;
    /** The organization's slot-holding running scans outside this harness. */
    orgRunning?: number;
  } = {},
) {
  // The scans this harness claimed: what the post-claim recount sees.
  const tracked: Scan[] = [];
  let containersExist = false;
  const stepBackWhere: Array<Record<string, unknown>> = [];
  const stepBackQuery = () => {
    let id = '';
    const qb = {
      update: () => qb,
      set: () => qb,
      where: (_sql: string, params: { id: string }) => {
        id = params.id;
        return qb;
      },
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        stepBackWhere.push({ sql, ...params });
        return qb;
      },
      execute: jest.fn(async () => {
        const scan = tracked.find((t) => t.id === id);
        if (!scan || scan.state !== 'running' || containersExist) {
          return { affected: 0 };
        }
        scan.state = 'queued';
        return { affected: 1 };
      }),
    };
    return qb;
  };
  const scans = {
    save: jest.fn(async (s: Scan) => s),
    count: jest.fn(async () => opts.queued ?? 0),
    find: jest.fn(async () => tracked.filter((t) => t.state === 'queued')),
    // With an alias: the dequeue's list of the organizations that wait.
    createQueryBuilder: jest.fn((alias?: string) => {
      if (!alias) return stepBackQuery();
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        groupBy: () => qb,
        getRawMany: async () => {
          const waiting = tracked.filter((t) => t.state === 'queued');
          return [...new Set(waiting.map((t) => t.organizationId))].map(
            (organizationId) => ({
              organizationId,
              waiting: String(
                waiting.filter((t) => t.organizationId === organizationId)
                  .length,
              ),
              oldest: new Date(0),
            }),
          );
        },
      };
      return qb;
    }),
    manager: {
      getRepository: () => ({
        createQueryBuilder: () => {
          const sub = {
            select: () => sub,
            where: () => sub,
            getQuery: () => 'SELECT 1 FROM container c WHERE c.scanId = :id',
          };
          return sub;
        },
      }),
    },
  };
  const moves: Array<{
    from: readonly string[];
    to: string;
    columns: unknown;
  }> = [];
  const store = {
    claimScanStart: jest.fn(
      async (scan: Scan, to: string, columns: Record<string, unknown>) => {
        Object.assign(scan, columns, { state: to });
        if (!tracked.includes(scan)) tracked.push(scan);
      },
    ),
    moveScanState: jest.fn(
      async (
        scan: Scan,
        from: readonly string[],
        to: string,
        columns: Record<string, unknown>,
      ) => {
        moves.push({ from, to, columns });
        if (!from.includes(scan.state)) return false;
        Object.assign(scan, columns, { state: to });
        return true;
      },
    ),
  };
  const stateManager = {
    publishStatusChanged: jest.fn(),
    handleCompletedScan: jest.fn(async () => undefined),
  };
  const organizationManager = {
    getProjectInformation: jest.fn(async () => SETTINGS),
    getSlotHoldingScansCount: jest.fn(async () => ({
      total:
        (opts.running ?? 0) +
        tracked.filter((t) => t.state === 'running').length,
      byOrganization: {
        o1:
          (opts.orgRunning ?? 0) +
          tracked.filter((t) => t.state === 'running').length,
      } as Record<string, number>,
    })),
    // The organization's stored limit is not this engine's: never read.
    getOrganizationConcurrentScanLimit: jest.fn(async () => {
      throw new Error('the stored limit must not be read');
    }),
    // The organization's slot-holding running scans plus its queued ones,
    // against its limit (OrganizationManager.shouldQueueScan's rule).
    shouldQueueScan: jest.fn<Promise<boolean>, [string, number]>(
      async (_id, limit) =>
        (opts.orgRunning ?? 0) +
          tracked.filter((t) => ['running', 'queued'].includes(t.state))
            .length >=
        limit,
    ),
  };
  const launcher = { launch: jest.fn(async () => 1) };
  const files = { deleteFile: jest.fn(async () => ({ success: true })) };
  const catalogue = { seed: jest.fn(async () => undefined) };
  const orchestrator = new ClusterScannerOrchestrator(
    scans as unknown as Repository<Scan>,
    store as unknown as ScanStateStore,
    stateManager as unknown as ScanStateManager,
    organizationManager as unknown as OrganizationManager,
    launcher as unknown as ClusterPodLauncher,
    catalogue as unknown as CommunityScannerCatalogue,
    new ClusterScanEnd(
      store as unknown as ScanStateStore,
      stateManager as unknown as ScanStateManager,
      files as unknown as FileManagementService,
    ),
    config(opts.max ?? 2, opts.perOrganization),
  );
  return {
    orchestrator,
    scans,
    store,
    moves,
    stateManager,
    organizationManager,
    launcher,
    catalogue,
    files,
    tracked,
    stepBackWhere,
    setContainersExist: (v: boolean) => {
      containersExist = v;
    },
  };
}

const refusalOf = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('ClusterScannerOrchestrator', () => {
  beforeEach(() => {
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('refuses a container, a diff and a graph-only scan before any write', () => {
    const h = harness();
    for (const request of [
      createRequest({ scanType: 'container' }),
      createRequest({ isDiffScan: true }),
      createRequest({ graphOnly: true }),
    ]) {
      const error = refusalOf(() =>
        h.orchestrator.assertScanSupported(request),
      );
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'SCANNERS_NOT_AVAILABLE',
      });
    }
    expect(h.scans.save).not.toHaveBeenCalled();
    // a code scan is supported
    expect(() =>
      h.orchestrator.assertScanSupported(createRequest()),
    ).not.toThrow();
  });

  // Every scanner of the project off: no pod would run, so the scan is
  // refused before its upload instead of completing with no scanner.
  describe('assertProjectScannable', () => {
    const rejection = async (p: Promise<unknown>) => {
      const error: unknown = await p.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RpcException);
      return (error as RpcException).getError();
    };

    it.each([[[]], [['aibom']], [['container']]])(
      'refuses a project whose enabled scan types %j have no scanner here',
      async (enabledScanTypes) => {
        const h = harness();
        h.organizationManager.getProjectInformation.mockResolvedValue({
          enabledScanTypes,
        } as unknown as ProjectScanSettings);
        await expect(
          rejection(h.orchestrator.assertProjectScannable('p1')),
        ).resolves.toEqual({
          code: status.FAILED_PRECONDITION,
          message: 'NO_SCANNER_ENABLED',
        });
        expect(
          h.organizationManager.getProjectInformation,
        ).toHaveBeenCalledWith('p1');
      },
    );

    it.each([['sast'], ['iac'], ['sca'], ['secret']])(
      'accepts a project with %s on',
      async (type) => {
        const h = harness();
        h.organizationManager.getProjectInformation.mockResolvedValue({
          enabledScanTypes: [type],
        } as unknown as ProjectScanSettings);
        await expect(
          h.orchestrator.assertProjectScannable('p1'),
        ).resolves.toBeUndefined();
      },
    );

    it('leaves a container check to the container rules, without reading the project', async () => {
      const h = harness();
      await expect(
        h.orchestrator.assertProjectScannable('p1', 'container'),
      ).resolves.toBeUndefined();
      expect(
        h.organizationManager.getProjectInformation,
      ).not.toHaveBeenCalled();
    });
  });

  it('saves a new scan as is', async () => {
    const h = harness();
    const s = newScan();
    await h.orchestrator.saveNewScan(s);
    expect(h.scans.save).toHaveBeenCalledWith(s);
  });

  it('below capacity: claims running and launches', async () => {
    const h = harness({ running: 1, max: 2 });
    const s = newScan();
    const answer = await h.orchestrator.startScan(s, start());
    expect(answer).toMatchObject({ success: true, scanId: SCAN_ID });
    expect(h.store.claimScanStart).toHaveBeenCalledTimes(1);
    expect(h.store.claimScanStart).toHaveBeenCalledWith(
      s,
      'running',
      expect.objectContaining({
        startTime: expect.any(Date),
        branch: 'main',
        language: ['python'],
        totalLOC: 1200,
        totalSize: '3Mo',
      }),
    );
    expect(h.catalogue.seed).toHaveBeenCalledTimes(1);
    expect(h.launcher.launch).toHaveBeenCalledWith(s, SETTINGS);
    // the seed comes before the first launch
    expect(h.catalogue.seed.mock.invocationCallOrder[0]).toBeLessThan(
      h.launcher.launch.mock.invocationCallOrder[0],
    );
  });

  it('at capacity: claims queued, launches nothing', async () => {
    const h = harness({ running: 2, max: 2 });
    const s = newScan({ branch: 'develop' });
    const answer = await h.orchestrator.startScan(s, start());
    expect(answer.success).toBe(true);
    expect(h.store.claimScanStart).toHaveBeenCalledTimes(1);
    expect(h.store.claimScanStart).toHaveBeenCalledWith(s, 'queued', {
      branch: 'develop',
      language: ['python'],
      totalLOC: 1200,
      totalSize: '3Mo',
    });
    expect(h.launcher.launch).not.toHaveBeenCalled();
    expect(h.organizationManager.getProjectInformation).not.toHaveBeenCalled();
  });

  it('admission counts queued scans, the tick does not', async () => {
    // 1 running + 1 queued = 2 = MAX: a new scan waits behind the queue
    const h = harness({ running: 1, queued: 1, max: 2 });
    await h.orchestrator.startScan(newScan(), start());
    expect(h.store.claimScanStart).toHaveBeenCalledWith(
      expect.anything(),
      'queued',
      expect.anything(),
    );
    expect(h.scans.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        state: 'queued',
        isDiffScan: false,
        isGraphOnly: false,
      }),
    });
    // the platform total, not one organisation's
    expect(
      h.organizationManager.getSlotHoldingScansCount,
    ).toHaveBeenCalledWith();
    // launchScan (the dequeue's path) never reads the queue
    h.scans.count.mockClear();
    await h.orchestrator.launchScan(newScan({ state: 'queued' }));
    expect(h.scans.count).not.toHaveBeenCalled();
  });

  it('a scan without a branch is stored on main', async () => {
    const h = harness();
    const s = newScan();
    await h.orchestrator.startScan(s, start({ branch: undefined }));
    expect(s.branch).toBe('main');
    const h2 = harness();
    const s2 = newScan();
    await h2.orchestrator.startScan(s2, start({ branch: 'feature/x' }));
    expect(s2.branch).toBe('feature/x');
  });

  it('a launch failure leaves the scan failed with 83', async () => {
    const h = harness();
    h.launcher.launch.mockRejectedValueOnce(
      new RpcException({
        code: status.INTERNAL,
        message: 'CLUSTER_LAUNCH_FAILED',
      }),
    );
    const s = newScan();
    const answer = await h.orchestrator.startScan(s, start());
    expect(answer).toMatchObject({
      success: false,
      message: 'CLUSTER_LAUNCH_FAILED',
    });
    expect(h.moves).toContainEqual({
      from: ['running'],
      to: 'failed',
      columns: expect.objectContaining({
        errorCode: 83,
        errorCategory: 'cluster',
        endTime: expect.any(Date),
      }),
    });
    expect(s.state).toBe('failed');
    expect(s.errorCode).toBe(83);
    expect(h.stateManager.publishStatusChanged).toHaveBeenLastCalledWith(
      s,
      'running',
    );
    // the scan's end (a refused launch keeps handleCompletedScan)
    expect(h.stateManager.handleCompletedScan).toHaveBeenCalledTimes(1);
    expect(h.files.deleteFile).not.toHaveBeenCalled();
  });

  it('a scan cancelled before its claim is not launched', async () => {
    const h = harness();
    h.store.claimScanStart.mockRejectedValueOnce(
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `Scan ${SCAN_ID} is cancelled and cannot be started`,
      }),
    );
    await expect(
      h.orchestrator.launchScan(newScan({ state: 'queued' })),
    ).rejects.toBeInstanceOf(RpcException);
    expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it('a project that cannot be read moves nothing', async () => {
    const h = harness();
    h.organizationManager.getProjectInformation.mockRejectedValueOnce(
      new Error('unavailable'),
    );
    await expect(
      h.orchestrator.launchScan(newScan({ state: 'queued' })),
    ).rejects.toThrow();
    expect(h.store.claimScanStart).not.toHaveBeenCalled();
    expect(h.launcher.launch).not.toHaveBeenCalled();
  });

  it('seeds the catalogue once per process, and again after a failed seed', async () => {
    const h = harness();
    h.catalogue.seed.mockRejectedValueOnce(new Error('db down'));
    await expect(
      h.orchestrator.launchScan(newScan({ state: 'queued' })),
    ).rejects.toThrow('db down');
    expect(h.store.claimScanStart).not.toHaveBeenCalled();
    await h.orchestrator.launchScan(newScan({ state: 'queued' }));
    await h.orchestrator.launchScan(newScan({ state: 'queued' }));
    expect(h.catalogue.seed).toHaveBeenCalledTimes(2);
    expect(h.launcher.launch).toHaveBeenCalledTimes(2);
  });

  describe('MAX_CONCURRENT across processes', () => {
    it('over capacity after the claim: steps back to queued, launches nothing', async () => {
      const h = harness({ running: 1, max: 2 });
      // the admission read 1; another process claims a slot before the recount
      h.organizationManager.getSlotHoldingScansCount
        .mockResolvedValueOnce({ total: 1, byOrganization: {} })
        .mockResolvedValueOnce({ total: 3, byOrganization: {} });
      const s = newScan();
      const answer = await h.orchestrator.startScan(s, start());
      expect(answer).toMatchObject({
        success: true,
        message: 'Scan queued due to concurrent scan limits',
      });
      expect(s.state).toBe('queued');
      expect(h.launcher.launch).not.toHaveBeenCalled();
      // only while running with no container
      expect(h.stepBackWhere).toContainEqual(
        expect.objectContaining({ running: 'running' }),
      );
      expect(h.stepBackWhere).toContainEqual(
        expect.objectContaining({
          sql: expect.stringMatching(/^NOT EXISTS \(/),
        }),
      );
    });

    it('a scan whose container rows exist is never stepped back', async () => {
      const h = harness({ max: 1 });
      h.organizationManager.getSlotHoldingScansCount
        .mockResolvedValueOnce({ total: 0, byOrganization: {} })
        .mockResolvedValueOnce({ total: 2, byOrganization: {} });
      h.setContainersExist(true);
      await expect(
        h.orchestrator.launchScan(newScan({ state: 'queued' })),
      ).resolves.toBe('launched');
      expect(h.launcher.launch).toHaveBeenCalledTimes(1);
    });

    it('two concurrent startScan at max − 1: never two running, and the tick then leaves exactly one running', async () => {
      const h = harness({ running: 1, max: 2 });
      const a = newScan({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = newScan({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      await Promise.all([
        h.orchestrator.startScan(a, start()),
        h.orchestrator.startScan(b, start()),
      ]);
      const running = () => [a, b].filter((x) => x.state === 'running').length;
      expect(running()).toBeLessThanOrEqual(1);
      expect([a, b].every((x) => ['running', 'queued'].includes(x.state))).toBe(
        true,
      );
      const queue = new ClusterScanQueue(
        h.scans as unknown as Repository<Scan>,
        h.organizationManager as unknown as OrganizationManager,
        h.orchestrator,
        { enabled: true } as unknown as ClusterScanningState,
        config(2),
      );
      await queue.tick();
      expect(running()).toBe(1);
      expect([a, b].filter((x) => x.state === 'queued')).toHaveLength(1);
    });
  });

  describe('the per-organization limit (an instance setting)', () => {
    it('admission: an organization at its limit is queued, not refused, even with platform capacity left', async () => {
      const h = harness({
        max: 10,
        perOrganization: 1,
        orgRunning: 1,
        running: 1,
      });
      const s = newScan();
      const answer = await h.orchestrator.startScan(s, start());
      expect(answer).toMatchObject({
        success: true,
        message: 'Scan queued due to concurrent scan limits',
      });
      expect(s.state).toBe('queued');
      expect(h.launcher.launch).not.toHaveBeenCalled();
      expect(h.organizationManager.shouldQueueScan).toHaveBeenCalledWith(
        'o1',
        1,
      );
    });

    it('admission: below its limit the scan starts', async () => {
      const h = harness({
        max: 10,
        perOrganization: 2,
        orgRunning: 1,
        running: 1,
      });
      const s = newScan();
      await h.orchestrator.startScan(s, start());
      expect(s.state).toBe('running');
      expect(h.launcher.launch).toHaveBeenCalledTimes(1);
    });

    it('unset, the limit is the instance maximum: one organization keeps the whole capacity', async () => {
      const h = harness({ max: 4, orgRunning: 3, running: 3 });
      const s = newScan();
      await h.orchestrator.startScan(s, start());
      expect(h.organizationManager.shouldQueueScan).toHaveBeenCalledWith(
        'o1',
        4,
      );
      expect(s.state).toBe('running');
      // the organization's stored limit is not read by this engine
      expect(
        h.organizationManager.getOrganizationConcurrentScanLimit,
      ).not.toHaveBeenCalled();
    });

    it('over the organization limit after the claim: steps back to queued', async () => {
      const h = harness({ max: 10, perOrganization: 1 });
      // another process started a scan of the same organization meanwhile
      h.organizationManager.getSlotHoldingScansCount.mockResolvedValueOnce({
        total: 2,
        byOrganization: { o1: 2 },
      });
      const s = newScan({ state: 'queued' });
      await expect(h.orchestrator.launchScan(s)).resolves.toBe('requeued');
      expect(s.state).toBe('queued');
      expect(h.launcher.launch).not.toHaveBeenCalled();
    });

    it('two concurrent starts of one organization with a limit of 1: never two running', async () => {
      const h = harness({ max: 10, perOrganization: 1 });
      const a = newScan({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = newScan({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      // both admissions read an empty organization
      h.organizationManager.shouldQueueScan.mockResolvedValue(false);
      await Promise.all([
        h.orchestrator.startScan(a, start()),
        h.orchestrator.startScan(b, start()),
      ]);
      expect(
        [a, b].filter((x) => x.state === 'running').length,
      ).toBeLessThanOrEqual(1);
      expect(h.launcher.launch.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });
});
