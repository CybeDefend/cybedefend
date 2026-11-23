/**
 * withRefreshLock — serialize the Logto refresh-token exchange across every
 * tab of this origin, with a bounded wait to be granted the lock.
 *
 * Why this exists
 * ---------------
 * Logto rotates the refresh token on every exchange (refresh-token rotation /
 * RTR). When two tabs refresh concurrently with the *same* refresh token, the
 * server consumes the first and rejects the second with `invalid_grant`. The
 * app treats `invalid_grant` as a permanent grant failure and bounces the user
 * to the login page — the "logged out out of nowhere" bug.
 *
 * Serializing the exchange so at most one tab refreshes at a time — combined
 * with the storage adapter always reading the freshest refresh token from
 * localStorage (see secureLogtoStorage.ts) — removes the race entirely: each
 * tab reads the latest rotated token inside the exclusive section.
 *
 * Why the wait is bounded
 * -----------------------
 * A tab holding this lock can stall (its exchange never settles / the tab is
 * frozen), and every other tab's `getAccessToken` would wait on it forever.
 * The caller's own timeout abandons the promise but the lock request stays
 * queued, so the retry queues behind it too, and the full-page loader would
 * end in "We couldn't sign you in". A lock request now
 * carries an AbortSignal: past `timeoutMs` the pending request is withdrawn
 * from the queue and the call rejects with `RefreshLockTimeoutError`, which
 * the client handles (see secureLogtoClient.ts). A callback that was already
 * GRANTED is never interrupted — the Web Locks API ignores the signal once
 * the lock is held, and we mirror that in the fallback.
 *
 * Primary mechanism: the Web Locks API (`navigator.locks`), a purpose-built
 * cross-tab mutex available in every modern browser in a secure context
 * (https / localhost). The dashboard always runs in a secure context, so this
 * is the real-world path.
 *
 * Fallback (old browsers, non-secure contexts, or test/SSR envs without the
 * API): an in-process promise-chain mutex. It guarantees serialization within
 * a single tab; cross-tab it degrades to the same narrow race window as the
 * identity SDK's own refresh. It never throws when the API is missing.
 */

const LOCK_PREFIX = 'cybedefend.logto.refresh';

/** Default budget to be GRANTED the lock. A granted callback is never cut. */
export const DEFAULT_LOCK_TIMEOUT_MS = 8_000;

export class RefreshLockTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`Refresh lock "${name}" was not granted within ${timeoutMs}ms`);
    this.name = 'RefreshLockTimeoutError';
  }
}

interface WebLocks {
  request: <R>(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<R>,
  ) => Promise<R>;
}

/** Resolve the Web Locks API when present and usable, otherwise null. */
function getWebLocks(): WebLocks | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const candidate = (navigator as unknown as { locks?: WebLocks }).locks;
  if (candidate && typeof candidate.request === 'function') {
    return candidate;
  }
  return null;
}

/**
 * Tail of the in-process mutex chain, keyed by lock name. In practice the app
 * uses a single Logto appId, so this map holds at most a handful of entries.
 */
const fallbackTails = new Map<string, Promise<void>>();

async function runWithFallbackMutex<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const previous = fallbackTails.get(name) ?? Promise.resolve();

  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });

  // The next caller waits until every prior holder AND us have finished.
  // `mine` only ever resolves (we release in `finally`), so the tail chain
  // never carries a rejection regardless of what `fn` does.
  fallbackTails.set(
    name,
    previous.then(() => mine),
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new RefreshLockTimeoutError(name, timeoutMs)),
      timeoutMs,
    );
  });

  try {
    // Only the wait to be granted is bounded; once `fn` starts it completes.
    await Promise.race([previous, timedOut]);
    if (timer) clearTimeout(timer);
    return await fn();
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
}

/**
 * Run `fn` (the refresh-token exchange) under a lock shared by all tabs of this
 * origin for the given Logto `appId`. The wait to be GRANTED the lock is
 * bounded by `opts.timeoutMs` (default {@link DEFAULT_LOCK_TIMEOUT_MS}); on
 * expiry the pending request is withdrawn and the call rejects with
 * {@link RefreshLockTimeoutError}. Once granted, `fn` always runs to
 * completion; its result or rejection is propagated and the lock is released
 * for the next caller.
 */
export async function withRefreshLock<T>(
  appId: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const name = `${LOCK_PREFIX}.${appId}`;
  const locks = getWebLocks();
  if (!locks) {
    return runWithFallbackMutex(name, fn, timeoutMs);
  }

  const controller = new AbortController();
  let granted = false;
  const timer = setTimeout(() => {
    if (!granted) controller.abort();
  }, timeoutMs);

  try {
    return await locks.request(name, { signal: controller.signal }, async () => {
      granted = true;
      return fn();
    });
  } catch (err) {
    if (!granted && controller.signal.aborted) {
      throw new RefreshLockTimeoutError(name, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
