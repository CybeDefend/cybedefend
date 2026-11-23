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

const config = (max = 2): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    CYBEDEFEND_SCANNER_MAX_CONCURRENT: String(max),
    FRONTEND_URL: 'https://appsec.example.com',
  });

const queued = (id: string): Scan => ({ id, state: 'queued' }) as Scan;

function harness(
  opts: {
    enabled?: boolean;
    running?: number;
    max?: number;
    rows?: Scan[];
    config?: ClusterScanningConfig | null;
  } = {},
) {
  const rows = opts.rows ?? [queued('a'), queued('b'), queued('c')];
  const scans = {
    find: jest.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
  };
  const organizationManager = {
    getSlotHoldingScansCount: jest.fn(async () => ({
      total: opts.running ?? 0,
      byOrganization: {},
    })),
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
    opts.config === undefined ? config(opts.max ?? 2) : opts.config,
  );
  return { queue, scans, organizationManager, orchestrator };
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
});
