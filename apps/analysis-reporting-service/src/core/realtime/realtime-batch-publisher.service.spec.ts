import { RealtimeBatchPublisher } from './realtime-batch-publisher.service';

describe('RealtimeBatchPublisher cache invalidation', () => {
  it('bumps the overview generation for the resolved org on fire()', async () => {
    const realtime = { publish: jest.fn().mockResolvedValue(undefined) } as any;
    const orgResolver = {
      resolveOrgId: jest.fn().mockResolvedValue('org-9'),
    } as any;
    const overviewCache = {
      bumpGeneration: jest.fn().mockResolvedValue(undefined),
    } as any;

    const pub = new RealtimeBatchPublisher(
      realtime,
      orgResolver,
      undefined,
      overviewCache,
    );

    await (pub as any).fire({
      scope: { projectId: 'p-1' },
      type: 'VULNERABILITY_BATCH_APPENDED',
    });

    expect(orgResolver.resolveOrgId).toHaveBeenCalledWith('p-1');
    expect(overviewCache.bumpGeneration).toHaveBeenCalledWith('org-9');
    expect(realtime.publish).toHaveBeenCalled();
  });

  it('does not throw when the cache is absent', async () => {
    const realtime = { publish: jest.fn().mockResolvedValue(undefined) } as any;
    const pub = new RealtimeBatchPublisher(realtime, null, undefined, null);
    await expect(
      (pub as any).fire({ scope: { organizationId: 'org-1' }, type: 'X' }),
    ).resolves.toBeUndefined();
  });

  it('still publishes when bumpGeneration rejects (best-effort)', async () => {
    const realtime = { publish: jest.fn().mockResolvedValue(undefined) } as any;
    const orgResolver = {
      resolveOrgId: jest.fn().mockResolvedValue('org-9'),
    } as any;
    const overviewCache = {
      bumpGeneration: jest.fn().mockRejectedValue(new Error('redis down')),
    } as any;

    const pub = new RealtimeBatchPublisher(
      realtime,
      orgResolver,
      undefined,
      overviewCache,
    );

    await (pub as any).fire({
      scope: { projectId: 'p-1' },
      type: 'VULNERABILITY_BATCH_APPENDED',
    });

    expect(overviewCache.bumpGeneration).toHaveBeenCalledWith('org-9');
    expect(realtime.publish).toHaveBeenCalled(); // publish NOT skipped by cache failure
  });
});

describe('RealtimeBatchPublisher', () => {
  let realtime: { publish: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    realtime = { publish: jest.fn() };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const make = (delayMs = 1500, orgResolver: any = null) =>
    new RealtimeBatchPublisher(realtime as any, orgResolver, { delayMs });

  it('publishes a single event after the debounce window when only one call comes in', async () => {
    const pub = make(1500);
    pub.publishDebounced('p:s:sast', {
      type: 'VULNERABILITY_BATCH_APPENDED',
    } as any);

    expect(realtime.publish).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of calls on the same key into one trailing publish per window', async () => {
    const pub = make(1500);
    for (let i = 0; i < 4; i++) {
      pub.publishDebounced('p:s:sast', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        i,
      } as any);
      jest.advanceTimersByTime(300); // 4 calls within 1.2s, each <1.5s apart
    }
    expect(realtime.publish).not.toHaveBeenCalled(); // still inside the window
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(1);
    // Latest envelope wins
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'VULNERABILITY_BATCH_APPENDED', i: 3 }),
    );
  });

  it('keeps publishing during a continuous burst (trailing throttle, NOT a resetting debounce)', async () => {
    // Batches arriving less than the window apart: a resetting debounce
    // stays silent for the whole ingestion, so the issues list never filled in progressively.
    const pub = make(1500);
    for (let i = 0; i < 6; i++) {
      pub.publishDebounced('p:s:sast', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        i,
      } as any);
      jest.advanceTimersByTime(300); // calls at t=0,300,…,1500 — never 1.5s apart
    }
    await Promise.resolve();
    // The window armed at t=0 fired at t=1500 with the latest envelope then (i=4)
    expect(realtime.publish).toHaveBeenCalledTimes(1);
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'VULNERABILITY_BATCH_APPENDED', i: 4 }),
    );
    // The call at t=1500 armed a new window that fires at t=3000
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(2);
    expect(realtime.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'VULNERABILITY_BATCH_APPENDED', i: 5 }),
    );
  });

  describe('publishNow (post-finalization event)', () => {
    // A scanner's finalization (resolving old vulns, removeMissingLibs, AI-BOM
    // merge…) runs AFTER the last batch and takes seconds; the last throttled
    // event fires in the middle of it and nothing follows, so the dashboard's
    // final refetch shows pre-finalization data until a manual reload.

    it('publishes immediately, bypassing the window', async () => {
      const pub = make(1500);
      pub.publishNow('k', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        now: true,
      } as any);
      await Promise.resolve();
      expect(realtime.publish).toHaveBeenCalledTimes(1);
      expect(realtime.publish).toHaveBeenCalledWith(
        expect.objectContaining({ now: true }),
      );
    });

    it('cancels the pending throttled event for the same key (no stale duplicate after it)', async () => {
      const pub = make(1500);
      pub.publishDebounced('k', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        i: 1,
      } as any);
      jest.advanceTimersByTime(500);
      pub.publishNow('k', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        final: true,
      } as any);
      await Promise.resolve();
      expect(realtime.publish).toHaveBeenCalledTimes(1);
      expect(realtime.publish).toHaveBeenCalledWith(
        expect.objectContaining({ final: true }),
      );
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(realtime.publish).toHaveBeenCalledTimes(1);
    });

    it('leaves pending events of OTHER keys untouched', async () => {
      const pub = make(1500);
      pub.publishDebounced('other', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        k: 'other',
      } as any);
      pub.publishNow('k', {
        type: 'VULNERABILITY_BATCH_APPENDED',
        k: 'k',
      } as any);
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      expect(realtime.publish).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps debounce windows independent per key (parallel scans)', async () => {
    const pub = make(1500);
    pub.publishDebounced('p:s1:sast', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      s: 1,
    } as any);
    pub.publishDebounced('p:s2:sast', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      s: 2,
    } as any);

    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes again after a quiet period followed by a new call', async () => {
    const pub = make(1000);
    pub.publishDebounced('k', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      i: 1,
    } as any);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(1);

    pub.publishDebounced('k', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      i: 2,
    } as any);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(2);
  });

  it('flushAll() emits all pending events immediately (used on scan completion)', async () => {
    const pub = make(5000);
    pub.publishDebounced('a', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      k: 'a',
    } as any);
    pub.publishDebounced('b', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      k: 'b',
    } as any);

    expect(realtime.publish).not.toHaveBeenCalled();
    pub.flushAll();
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(2);
  });

  it('onModuleDestroy clears any pending timers without re-firing', async () => {
    const pub = make(1500);
    pub.publishDebounced('k', { type: 'VULNERABILITY_BATCH_APPENDED' } as any);
    pub.onModuleDestroy();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it('enriches scope with organizationId from the resolver before publishing', async () => {
    const orgResolver = { resolveOrgId: jest.fn().mockResolvedValue('org-1') };
    const pub = make(1500, orgResolver);
    pub.publishDebounced('k', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      scope: { projectId: 'p1' },
    } as any);
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    await Promise.resolve(); // resolver promise
    expect(orgResolver.resolveOrgId).toHaveBeenCalledWith('p1');
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          projectId: 'p1',
          organizationId: 'org-1',
        }),
      }),
    );
  });

  it('still publishes when the resolver returns null (no overview routing, but project routing still works)', async () => {
    const orgResolver = { resolveOrgId: jest.fn().mockResolvedValue(null) };
    const pub = make(1500, orgResolver);
    pub.publishDebounced('k', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      scope: { projectId: 'p1' },
    } as any);
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    await Promise.resolve();
    expect(realtime.publish).toHaveBeenCalledTimes(1);
    const env = realtime.publish.mock.calls[0][0];
    expect(env.scope.organizationId).toBeUndefined();
    expect(env.scope.projectId).toBe('p1');
  });

  it('skips the resolver when scope already has organizationId', async () => {
    const orgResolver = { resolveOrgId: jest.fn() };
    const pub = make(1500, orgResolver);
    pub.publishDebounced('k', {
      type: 'VULNERABILITY_BATCH_APPENDED',
      scope: { projectId: 'p1', organizationId: 'org-from-caller' },
    } as any);
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(orgResolver.resolveOrgId).not.toHaveBeenCalled();
  });
});
