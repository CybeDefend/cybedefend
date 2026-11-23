import { DelayedError } from 'bullmq';
import { OrganizationStatisticsQueueProcessor } from './org-statistics-queue.processor';

function make() {
  const service = {
    readTimings: jest.fn(),
    resolveProjectIds: jest.fn().mockResolvedValue([]),
    finishCompute: jest.fn().mockResolvedValue({ stillDirty: false }),
  };
  const resultService = { getMainStatistics: jest.fn() };
  const realtime = { publish: jest.fn().mockResolvedValue(undefined) };
  const processor = new OrganizationStatisticsQueueProcessor(
    service as any,
    resultService as any,
    realtime as any,
  );
  const job: any = {
    data: { organizationId: 'org-1' },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  };
  return { processor, service, resultService, realtime, job };
}

const T = 1_000_000;

describe('OrganizationStatisticsQueueProcessor', () => {
  it('skips a clean org (dirtySince=0) without computing', async () => {
    const { processor, service, resultService, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 100_000,
      dirtySince: 0,
      computedAt: T - 100_000,
    });

    await processor.process(job, 'tok');

    expect(resultService.getMainStatistics).not.toHaveBeenCalled();
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it('reschedules itself (moveToDelayed + DelayedError) while still in the trailing window', async () => {
    const { processor, service, resultService, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 1_000, // 1s ago → 2s of trailing left
      dirtySince: T - 1_000,
      computedAt: T - 60_000,
    });

    await expect(processor.process(job, 'tok')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(resultService.getMainStatistics).not.toHaveBeenCalled();
  });

  it('recomputes when quiet + floor passed, persisting the aggregated stats', async () => {
    const { processor, service, resultService, realtime, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 4_000, // quiet (>3s)
      dirtySince: T - 4_000,
      computedAt: T - 60_000, // floor passed
    });
    service.resolveProjectIds.mockResolvedValue(['p1', 'p2']);
    resultService.getMainStatistics.mockResolvedValue({
      criticalIssues: 9,
      highIssues: 1,
    });

    await processor.process(job, 'tok');

    expect(resultService.getMainStatistics).toHaveBeenCalledWith({
      projectIds: ['p1', 'p2'],
    });
    const persisted = service.finishCompute.mock.calls[0][1];
    expect(persisted.criticalIssues).toBe(9);
    expect(persisted.highIssues).toBe(1);
    expect(persisted.lowIssues).toBe(0); // zero-filled
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    // Closes the loop so the home cards refetch the fresh numbers.
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PROJECT_STATE_CHANGED',
        scope: { organizationId: 'org-1' },
      }),
    );
  });

  it('continues the cycle (moveToDelayed) when events landed mid-compute', async () => {
    const { processor, service, resultService, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 4_000,
      dirtySince: T - 4_000,
      computedAt: T - 60_000,
    });
    service.resolveProjectIds.mockResolvedValue(['p1']);
    resultService.getMainStatistics.mockResolvedValue({ criticalIssues: 1 });
    service.finishCompute.mockResolvedValue({ stillDirty: true });

    await expect(processor.process(job, 'tok')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('re-delays itself on a transient recompute failure (never fails terminally)', async () => {
    const { processor, service, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 4_000,
      dirtySince: T - 4_000,
      computedAt: T - 60_000,
    });
    service.resolveProjectIds.mockRejectedValue(new Error('db down'));

    // Must throw DelayedError (re-delayed), NOT the original 'db down' error —
    // a terminal failure would retain the per-org jobId and freeze the org's
    // cards by deduping away every future markDirty.
    await expect(processor.process(job, 'tok')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('re-delays when finishCompute fails mid-persist', async () => {
    const { processor, service, resultService, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 4_000,
      dirtySince: T - 4_000,
      computedAt: T - 60_000,
    });
    service.resolveProjectIds.mockResolvedValue(['p1']);
    resultService.getMainStatistics.mockResolvedValue({ criticalIssues: 1 });
    service.finishCompute.mockRejectedValue(new Error('write conflict'));

    await expect(processor.process(job, 'tok')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('skips the aggregation entirely for an org with no projects', async () => {
    const { processor, service, resultService, job } = make();
    service.readTimings.mockResolvedValue({
      now: T,
      lastEventAt: T - 4_000,
      dirtySince: T - 4_000,
      computedAt: T - 60_000,
    });
    service.resolveProjectIds.mockResolvedValue([]);

    await processor.process(job, 'tok');

    expect(resultService.getMainStatistics).not.toHaveBeenCalled();
    const persisted = service.finishCompute.mock.calls[0][1];
    expect(persisted.criticalIssues).toBe(0); // zero-filled, still persisted
  });
});
