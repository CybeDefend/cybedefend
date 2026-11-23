import { OrganizationStatisticsEnqueuer } from './organization-statistics.enqueuer';

function make() {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const enq = new OrganizationStatisticsEnqueuer(queue as any);
  return { enq, queue };
}

describe('OrganizationStatisticsEnqueuer', () => {
  it('adds a per-org drain job that is REMOVED on failure (no jobId freeze)', async () => {
    const { enq, queue } = make();

    await enq.enqueueDrain('org-1', 3000);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('drain');
    expect(data).toEqual({ organizationId: 'org-1' });
    expect(opts.jobId).toBe('org-stats-org-1');
    expect(opts.delay).toBe(3000);
    expect(opts.removeOnComplete).toBe(true);
    // The fix: a failed drain must not linger and dedup away every future
    // markDirty (which would freeze the org's KPI cards).
    expect(opts.removeOnFail).toBe(true);
  });

  it('swallows the duplicate-jobId error — that IS the dedup we want', async () => {
    const { enq, queue } = make();
    queue.add.mockRejectedValueOnce({ code: 'JOB_EXISTS' });
    await expect(enq.enqueueDrain('org-1', 3000)).resolves.toBeUndefined();
  });

  it('never throws on an unexpected queue error (best-effort)', async () => {
    const { enq, queue } = make();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(enq.enqueueDrain('org-1', 3000)).resolves.toBeUndefined();
  });
});
