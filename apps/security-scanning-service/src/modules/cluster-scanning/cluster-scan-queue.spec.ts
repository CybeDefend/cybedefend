import { Logger } from '@nestjs/common';

// The metadata key @Cron() writes its options under. @nestjs/schedule does not
// export it and its package exports refuse a deep import.
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
import type { Repository } from 'typeorm';
import type { Scan } from 'src/entities/scan.entity';
import type { OrganizationManager } from '../scan/core/organizationManager';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import type { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import type { ClusterScanningState } from './cluster-scanning.state';
import { ClusterScanQueue } from './cluster-scan-queue';

/**
 * The 15 s dequeue. Free slots = MAX_CONCURRENT −
 * running (the queue does not count itself), oldest first, through the
 * orchestrator's launchScan — the function the direct start calls.
 */

const config = (max = 2, perOrganization?: number): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    CYBEDEFEND_SCANNER_MAX_CONCURRENT: String(max),
    CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION:
      perOrganization === undefined ? '' : String(perOrganization),
    FRONTEND_URL: 'https://appsec.example.com',
  });

const queued = (id: string, organizationId = 'o1', at = 0): Scan =>
  ({
    id,
    state: 'queued',
    organizationId,
    createAt: new Date(Date.UTC(2026, 0, 1) + at * 1000),
  }) as Scan;

function harness(
  opts: {
    enabled?: boolean;
    running?: number;
    byOrganization?: Record<string, number>;
    max?: number;
    perOrganization?: number;
    rows?: Scan[];
    config?: ClusterScanningConfig | null;
  } = {},
) {
  const rows = opts.rows ?? [queued('a'), queued('b'), queued('c')];
  const scans = {
    find: jest.fn(
      async ({
        where,
        take,
      }: {
        where: { organizationId?: unknown };
        take: number;
      }) =>
        rows
          .filter((r) =>
            typeof where.organizationId === 'string'
              ? r.organizationId === where.organizationId
              : !r.organizationId,
          )
          .sort((x, y) => x.createAt.getTime() - y.createAt.getTime())
          .slice(0, take),
    ),
    // The waiting organizations, their queued count and oldest scan: one query.
    createQueryBuilder: jest.fn(() => {
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        groupBy: () => qb,
        getRawMany: jest.fn(async () => {
          const groups = new Map<
            string | null,
            { waiting: number; oldest: Date }
          >();
          for (const r of rows) {
            const key = r.organizationId ?? null;
            const g = groups.get(key);
            if (!g) groups.set(key, { waiting: 1, oldest: r.createAt });
            else {
              g.waiting++;
              if (r.createAt < g.oldest) g.oldest = r.createAt;
            }
          }
          // as the drivers answer: the count as a string
          return [...groups].map(([organizationId, g]) => ({
            organizationId,
            waiting: String(g.waiting),
            oldest: g.oldest,
          }));
        }),
      };
      return qb;
    }),
  };
  const organizationManager = {
    getSlotHoldingScansCount: jest.fn(async () => ({
      total: opts.running ?? 0,
      byOrganization: opts.byOrganization ?? {},
    })),
    // The organization's stored limit is not this engine's: never read.
    getOrganizationConcurrentScanLimit: jest.fn(async () => {
      throw new Error('the stored limit must not be read');
    }),
  };
  const orchestrator = {
    launchScan: jest.fn<Promise<string>, [Scan]>(async () => 'launched'),
  };
  const state = { enabled: opts.enabled ?? true };
  const queue = new ClusterScanQueue(
    scans as unknown as Repository<Scan>,
    organizationManager as unknown as OrganizationManager,
    orchestrator as unknown as ClusterScannerOrchestrator,
    state as unknown as ClusterScanningState,
    opts.config === undefined
      ? config(opts.max ?? 2, opts.perOrganization)
      : opts.config,
  );
  const launchedIds = () =>
    orchestrator.launchScan.mock.calls.map((c) => c[0].id);
  return { queue, scans, organizationManager, orchestrator, launchedIds };
}

describe('ClusterScanQueue', () => {
  beforeEach(() => {
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('ticks every 15 seconds', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      ClusterScanQueue.prototype.tick,
    ) as { cronTime: string };
    expect(options.cronTime).toBe('*/15 * * * * *');
  });

  it('starts the oldest queued scans up to the free slots through launchScan', async () => {
    const h = harness({ running: 1, max: 3 });
    await h.queue.tick();
    expect(h.scans.find).toHaveBeenCalledWith({
      where: expect.objectContaining({
        state: 'queued',
        isDiffScan: false,
        isGraphOnly: false,
      }),
      order: { createAt: 'ASC' },
      take: 2,
    });
    expect(h.orchestrator.launchScan.mock.calls.map((c) => c[0].id)).toEqual([
      'a',
      'b',
    ]);
    // the running count is the platform's, and the queue is not counted
    expect(
      h.organizationManager.getSlotHoldingScansCount,
    ).toHaveBeenCalledWith();
  });

  it('no free slot: reads no queued scan', async () => {
    const h = harness({ running: 2, max: 2 });
    await h.queue.tick();
    expect(h.scans.find).not.toHaveBeenCalled();
    expect(h.orchestrator.launchScan).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', async () => {
    const h = harness({ enabled: false });
    await h.queue.tick();
    expect(
      h.organizationManager.getSlotHoldingScansCount,
    ).not.toHaveBeenCalled();
    expect(h.scans.find).not.toHaveBeenCalled();
    expect(h.orchestrator.launchScan).not.toHaveBeenCalled();
  });

  it('does nothing without a configuration', async () => {
    const h = harness({ config: null });
    await h.queue.tick();
    expect(h.scans.find).not.toHaveBeenCalled();
  });

  it('a failing launch does not stop the tick', async () => {
    const h = harness({ max: 3 });
    h.orchestrator.launchScan.mockRejectedValueOnce(new Error('cancelled'));
    await expect(h.queue.tick()).resolves.toBeUndefined();
    expect(h.orchestrator.launchScan).toHaveBeenCalledTimes(3);
  });

  it('never rejects, even when the count fails', async () => {
    const h = harness();
    h.organizationManager.getSlotHoldingScansCount.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(h.queue.tick()).resolves.toBeUndefined();
  });

  it('ticks never overlap', async () => {
    const h = harness({ max: 1 });
    let finish: () => void = () => undefined;
    h.orchestrator.launchScan.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('launched');
        }),
    );
    const first = h.queue.tick();
    await new Promise((r) => setImmediate(r));
    await h.queue.tick();
    expect(h.orchestrator.launchScan).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it('counts capacity again before each launch: never more than the free slots', async () => {
    const h = harness({ running: 0, max: 2 });
    // the direct start takes a slot while the tick launches the first one
    h.organizationManager.getSlotHoldingScansCount
      .mockResolvedValueOnce({ total: 0, byOrganization: {} })
      .mockResolvedValueOnce({ total: 2, byOrganization: {} });
    await h.queue.tick();
    expect(h.orchestrator.launchScan.mock.calls.map((c) => c[0].id)).toEqual([
      'a',
    ]);
  });

  it('a tick that is re-entered does nothing', async () => {
    const h = harness({ max: 1 });
    let finish: () => void = () => undefined;
    h.orchestrator.launchScan.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('launched');
        }),
    );
    const first = h.queue.tick();
    await new Promise((r) => setImmediate(r));
    const reads =
      h.organizationManager.getSlotHoldingScansCount.mock.calls.length;
    await h.queue.tick();
    expect(
      h.organizationManager.getSlotHoldingScansCount,
    ).toHaveBeenCalledTimes(reads);
    expect(h.scans.find).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  describe('per-organization limit and rotation', () => {
    it('never starts more of an organization than its limit leaves free', async () => {
      const h = harness({
        max: 5,
        perOrganization: 2,
        running: 1,
        byOrganization: { o1: 1 },
        rows: [
          queued('a', 'o1', 1),
          queued('b', 'o1', 2),
          queued('c', 'o1', 3),
        ],
      });
      await h.queue.tick();
      expect(h.launchedIds()).toEqual(['a']);
      // the dequeue counts the running scans only: the queue drains
      expect(h.scans.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: 'o1' }),
          take: 1,
        }),
      );
    });

    it('unset, the limit is the instance maximum: one organization fills every slot', async () => {
      const h = harness({ max: 3 });
      await h.queue.tick();
      expect(h.launchedIds()).toEqual(['a', 'b', 'c']);
      expect(
        h.organizationManager.getOrganizationConcurrentScanLimit,
      ).not.toHaveBeenCalled();
    });

    it('an organization at its limit is skipped; the others are not', async () => {
      const h = harness({
        max: 5,
        perOrganization: 1,
        running: 1,
        byOrganization: { o1: 1 },
        rows: [
          queued('a', 'o1', 1),
          queued('b', 'o1', 2),
          queued('x', 'o2', 9),
        ],
      });
      await h.queue.tick();
      expect(h.launchedIds()).toEqual(['x']);
    });

    it('rotates between organizations: an older backlog does not take every slot', async () => {
      const h = harness({
        max: 4,
        rows: [
          queued('a1', 'o1', 1),
          queued('a2', 'o1', 2),
          queued('a3', 'o1', 3),
          queued('a4', 'o1', 4),
          queued('b1', 'o2', 10),
          queued('c1', 'o3', 20),
        ],
      });
      await h.queue.tick();
      expect(h.launchedIds()).toEqual(['a1', 'b1', 'c1', 'a2']);
    });

    it('the organization with the fewest running scans goes first', async () => {
      const h = harness({
        max: 3,
        running: 2,
        byOrganization: { o1: 2 },
        rows: [queued('a', 'o1', 1), queued('b', 'o2', 50)],
      });
      await h.queue.tick();
      expect(h.launchedIds()).toEqual(['b']);
    });

    it('reads the queue in one grouped query, then only the organizations it picks', async () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        queued(`s${i}`, `org-${i}`, i),
      );
      const h = harness({ max: 2, rows });
      await h.queue.tick();
      expect(h.scans.createQueryBuilder).toHaveBeenCalledTimes(1);
      // two free slots: two organizations read, not forty
      expect(h.scans.find).toHaveBeenCalledTimes(2);
      expect(h.launchedIds()).toEqual(['s0', 's1']);
    });

    it.each([0, -1, Number.NaN])(
      'a per-organization value of %p never parks a scan: the limit is at least one',
      async (value) => {
        const base = config(2);
        const h = harness({
          config: { ...base, maxConcurrentPerOrganization: value },
          rows: [queued('a')],
        });
        await h.queue.tick();
        expect(h.launchedIds()).toEqual(['a']);
      },
    );

    it('a scan without an organization is bound by the platform capacity only', async () => {
      const orphan = { ...queued('n'), organizationId: undefined } as Scan;
      const h = harness({ max: 2, perOrganization: 1, rows: [orphan] });
      await h.queue.tick();
      expect(h.launchedIds()).toEqual(['n']);
    });
  });
});
