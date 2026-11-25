import { LessThan } from 'typeorm';
import {
  failLostQueuedReports,
  isQueueJobPending,
  STALE_REPORT_ERROR,
} from './stale-report-sweep';
import { REPORT_STALE_AFTER_MS } from './report-quota.service';

/**
 * The stale sweep settles queued reports whose job was lost, so they stop
 * showing as generating. A report whose job still waits behind a backlog,
 * or renders, is left alone: it still ends ready.
 */
describe('failLostQueuedReports', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  const repoWith = (rows: { id: string }[]) => ({
    find: jest.fn().mockResolvedValue(rows),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  });

  it('fails the old queued rows whose job is gone, and only those', async () => {
    const repo = repoWith([{ id: 'lost' }, { id: 'waiting' }]);
    const pending = jest.fn(async (id: string) => id === 'waiting');

    const failed = await failLostQueuedReports(repo as never, pending, {
      now,
    });

    expect(failed).toBe(1);
    const where = repo.find.mock.calls[0][0].where;
    expect(where.status).toBe('queued');
    expect(where.createdAt).toEqual(
      LessThan(new Date(now.getTime() - REPORT_STALE_AFTER_MS)),
    );
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'lost', status: 'queued' },
      { status: 'failed', error: STALE_REPORT_ERROR },
    );
  });

  it('keeps a row when its job cannot be looked up (never fails a live report)', async () => {
    const repo = repoWith([{ id: 'r1' }]);
    const pending = jest.fn().mockRejectedValue(new Error('redis down'));

    await expect(
      failLostQueuedReports(repo as never, pending, { now }),
    ).resolves.toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('isQueueJobPending', () => {
  const queueWith = (state: string | null) => ({
    getJob: jest
      .fn()
      .mockResolvedValue(
        state === null ? undefined : { getState: async () => state },
      ),
  });

  it.each(['waiting', 'prioritized', 'active', 'delayed', 'waiting-children'])(
    'a job %s is pending',
    async (state) => {
      await expect(
        isQueueJobPending(queueWith(state) as never, 'report-1'),
      ).resolves.toBe(true);
    },
  );

  it.each(['completed', 'failed', 'unknown'])(
    'a job %s is not pending',
    async (state) => {
      await expect(
        isQueueJobPending(queueWith(state) as never, 'report-1'),
      ).resolves.toBe(false);
    },
  );

  it('no job is not pending', async () => {
    await expect(
      isQueueJobPending(queueWith(null) as never, 'report-1'),
    ).resolves.toBe(false);
  });
});
