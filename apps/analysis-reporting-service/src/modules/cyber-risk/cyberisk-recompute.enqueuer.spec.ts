import { Queue } from 'bullmq';
import { CyberiskRecomputeEnqueuer } from './cyberisk-recompute.enqueuer';

describe('CyberiskRecomputeEnqueuer.enqueue', () => {
  let queue: jest.Mocked<Queue>;
  let enqueuer: CyberiskRecomputeEnqueuer;

  beforeEach(() => {
    queue = { add: jest.fn() } as unknown as jest.Mocked<Queue>;
    enqueuer = new CyberiskRecomputeEnqueuer(queue);
  });

  it('adds a job with deduplicated jobId per project', async () => {
    await enqueuer.enqueue('proj-1', 'scan_complete');
    expect(queue.add).toHaveBeenCalledWith(
      'recompute',
      { projectId: 'proj-1', trigger: 'scan_complete' },
      expect.objectContaining({ jobId: 'cyberisk-proj-1' }),
    );
  });

  it('debounces with a 5s delay so a burst of events on the same project coalesces', async () => {
    await enqueuer.enqueue('proj-2', 'vuln_update');
    const opts = queue.add.mock.calls[0][2];
    // 5s coalescing window: the per-project jobId dedup drops every event that
    // lands while this delayed job is pending, so the whole burst collapses into
    // a single recompute that reads the latest committed state.
    expect(opts?.delay).toBe(5000);
  });

  it('removes both completed and failed jobs so the stable jobId never freezes', async () => {
    await enqueuer.enqueue('proj-3', 'manual');
    const opts = queue.add.mock.calls[0][2];
    expect(opts?.removeOnComplete).toBe(true);
    // A retained failed job would hold the per-project jobId and dedup away
    // every future enqueue, freezing the project's score — so it must be removed.
    expect(opts?.removeOnFail).toBe(true);
  });

  it('retries a few times with exponential backoff on transient failures', async () => {
    await enqueuer.enqueue('proj-3b', 'scan_complete');
    const opts = queue.add.mock.calls[0][2];
    expect(opts?.attempts).toBe(3);
    expect(opts?.backoff).toEqual({ type: 'exponential', delay: 2000 });
  });

  it('swallows BullMQ duplicate-jobId errors silently', async () => {
    queue.add.mockRejectedValueOnce(
      Object.assign(new Error('Job with id cyberisk:proj-1 already exists'), {
        code: 'JOB_EXISTS',
      }),
    );
    await expect(
      enqueuer.enqueue('proj-1', 'scan_complete'),
    ).resolves.toBeUndefined();
  });

  it('swallows and logs unexpected errors instead of breaking the caller', async () => {
    const warnSpy = jest
      .spyOn((enqueuer as any).logger, 'warn')
      .mockImplementation(() => undefined);
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      enqueuer.enqueue('proj-1', 'scan_complete'),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('CyberiskRecomputeEnqueuer dirty-counter (lost-update guard)', () => {
  function makeEnqueuer(client: any) {
    const queue = {
      add: jest.fn(),
      client: Promise.resolve(client),
    } as unknown as Queue;
    return new CyberiskRecomputeEnqueuer(queue);
  }

  it('markDirty increments and (re)expires the per-project key', async () => {
    const client = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
    };
    await makeEnqueuer(client).markDirty('proj-1');
    expect(client.incr).toHaveBeenCalledWith('cyberisk:dirty:proj-1');
    expect(client.expire).toHaveBeenCalledWith('cyberisk:dirty:proj-1', 86400);
  });

  it('readDirty returns the numeric counter, or 0 when unset', async () => {
    const client = {
      incr: jest.fn(),
      expire: jest.fn(),
      get: jest.fn().mockResolvedValueOnce('3').mockResolvedValueOnce(null),
    };
    const enqueuer = makeEnqueuer(client);
    await expect(enqueuer.readDirty('proj-1')).resolves.toBe(3);
    await expect(enqueuer.readDirty('proj-1')).resolves.toBe(0);
  });

  it('enqueue marks the project dirty before adding the job', async () => {
    const client = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
    };
    const queue = {
      add: jest.fn(),
      client: Promise.resolve(client),
    } as unknown as Queue;
    const enqueuer = new CyberiskRecomputeEnqueuer(queue);
    await enqueuer.enqueue('proj-1', 'vuln_update');
    expect(client.incr).toHaveBeenCalledWith('cyberisk:dirty:proj-1');
    expect(queue.add).toHaveBeenCalled();
  });

  it('readDirty falls back to 0 when Redis is unreachable', async () => {
    const client = {
      incr: jest.fn(),
      expire: jest.fn(),
      get: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    await expect(makeEnqueuer(client).readDirty('proj-1')).resolves.toBe(0);
  });
});
