/**
 * Tests for withRefreshLock — cross-tab serialization of the Logto
 * refresh-token exchange (Option C, robust fix for the refresh-token
 * rotation race that logged users out with `invalid_grant`).
 *
 * Two execution paths are covered:
 *   - Web Locks API path (navigator.locks present): the helper must delegate
 *     to navigator.locks.request with a per-appId lock name, an abort signal
 *     that withdraws the request when the grant budget elapses, and return
 *     the callback's result. The browser guarantees cross-tab exclusion.
 *   - Fallback path (navigator.locks absent — old browsers / non-secure
 *     contexts / jsdom): the helper must still serialize concurrent calls
 *     within the process so the exchange never overlaps, must release the
 *     lock even when the callback throws, and must bound the wait too.
 *
 * The bound exists because a lock held by a stalled/frozen tab would park
 * every other tab's auth bootstrap forever.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRefreshLock, RefreshLockTimeoutError } from './refreshLock';

const setLocks = (value: unknown): void => {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    writable: true,
    value,
  });
};

const clearLocks = (): void => {
  // Restore the jsdom default (no Web Locks API).
  if ('locks' in globalThis.navigator) {
    delete (globalThis.navigator as unknown as { locks?: unknown }).locks;
  }
};

afterEach(() => {
  clearLocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('withRefreshLock — Web Locks API path', () => {
  it('delegates to navigator.locks.request with a per-appId lock name and an abort signal', async () => {
    const request = vi.fn(
      async (
        _name: string,
        _opts: { signal: AbortSignal },
        cb: () => Promise<unknown>,
      ) => cb(),
    );
    setLocks({ request });

    const result = await withRefreshLock('app-42', async () => 'FRESH_TOKEN');

    expect(result).toBe('FRESH_TOKEN');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      'cybedefend.logto.refresh.app-42',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
  });

  it('uses distinct lock names per appId so different apps do not contend', async () => {
    const seen: string[] = [];
    const request = vi.fn(
      async (name: string, _opts: unknown, cb: () => Promise<unknown>) => {
        seen.push(name);
        return cb();
      },
    );
    setLocks({ request });

    await withRefreshLock('app-a', async () => 1);
    await withRefreshLock('app-b', async () => 2);

    expect(seen).toEqual([
      'cybedefend.logto.refresh.app-a',
      'cybedefend.logto.refresh.app-b',
    ]);
  });

  it('rejects with RefreshLockTimeoutError when the lock is not granted within the budget', async () => {
    vi.useFakeTimers();
    // A holder in another tab never releases: the request stays pending
    // until our signal aborts it (Web Locks reject with an AbortError then).
    const request = vi.fn(
      (_name: string, opts: { signal: AbortSignal }, _cb: () => Promise<unknown>) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    setLocks({ request });

    const pending = withRefreshLock('app-42', async () => 'never', { timeoutMs: 8_000 });
    const outcome = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(outcome).resolves.toBeInstanceOf(RefreshLockTimeoutError);
  });

  it('does not turn a granted callback into a timeout when the budget elapses mid-exchange', async () => {
    vi.useFakeTimers();
    // Granted immediately; the exchange itself is slow. The signal is ignored
    // once granted (Web Locks semantics) — the result must still come back.
    const request = vi.fn(
      async (
        _name: string,
        _opts: { signal: AbortSignal },
        cb: () => Promise<unknown>,
      ) => cb(),
    );
    setLocks({ request });

    const pending = withRefreshLock(
      'app-42',
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve('slow-but-fine'), 9_000)),
      { timeoutMs: 8_000 },
    );
    await vi.advanceTimersByTimeAsync(9_000);

    await expect(pending).resolves.toBe('slow-but-fine');
  });
});

describe('withRefreshLock — fallback path (no Web Locks API)', () => {
  it('serializes concurrent refreshes for the same appId (no overlap)', async () => {
    clearLocks();
    const events: string[] = [];
    const make = (id: string, delayMs: number) => async () => {
      events.push(`enter-${id}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`exit-${id}`);
      return id;
    };

    const [a, b] = await Promise.all([
      withRefreshLock('shared', make('A', 30)),
      withRefreshLock('shared', make('B', 5)),
    ]);

    expect(a).toBe('A');
    expect(b).toBe('B');
    // B must not start until A has fully finished — strict mutual exclusion.
    expect(events).toEqual(['enter-A', 'exit-A', 'enter-B', 'exit-B']);
  });

  it('tracks at most one exchange in flight at a time', async () => {
    clearLocks();
    let active = 0;
    let maxActive = 0;
    const exchange = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return 'ok';
    };

    await Promise.all([
      withRefreshLock('one', exchange),
      withRefreshLock('one', exchange),
      withRefreshLock('one', exchange),
    ]);

    expect(maxActive).toBe(1);
  });

  it('releases the lock for the next caller even when the callback throws', async () => {
    clearLocks();

    await expect(
      withRefreshLock('recover', async () => {
        throw new Error('exchange failed');
      }),
    ).rejects.toThrow('exchange failed');

    // The lock must have been released despite the rejection.
    const next = await withRefreshLock('recover', async () => 'recovered');
    expect(next).toBe('recovered');
  });

  it('does not serialize across different appIds', async () => {
    clearLocks();
    const events: string[] = [];
    const make = (id: string, delayMs: number) => async () => {
      events.push(`enter-${id}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`exit-${id}`);
      return id;
    };

    await Promise.all([
      withRefreshLock('left', make('L', 20)),
      withRefreshLock('right', make('R', 5)),
    ]);

    // Independent locks → R should slip in while L is still running.
    expect(events).toEqual(['enter-L', 'enter-R', 'exit-R', 'exit-L']);
  });

  it('bounds the wait for a stuck in-process holder too', async () => {
    clearLocks();
    vi.useFakeTimers();
    const stuck = withRefreshLock('stuck', () => new Promise<string>(() => { /* never */ }));
    void stuck.catch(() => undefined);
    const waiter = withRefreshLock('stuck', async () => 'me', { timeoutMs: 8_000 });
    const outcome = waiter.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(outcome).resolves.toBeInstanceOf(RefreshLockTimeoutError);
  });
});
