import {
  fetchEventSource,
  EventStreamContentType,
} from '@microsoft/fetch-event-source';

export type RealtimeEventType =
  | 'SCAN_STATUS_CHANGED' | 'AGENT_STEP_CHANGED' | 'SCAN_PIPELINE_CHANGED'
  | 'VULNERABILITY_BATCH_APPENDED' | 'VULNERABILITY_UPDATED'
  | 'PROJECT_STATE_CHANGED' | 'MEMBERSHIP_CHANGED' | 'POLICY_EVALUATION_COMPLETED'
  | 'ZERO_DAY_DETECTED' | 'STATS_AGGREGATE_CHANGED' | 'TRIAL_UPDATED'
  | 'SUBSCRIPTION_CHANGED' | 'USAGE_UPDATED' | 'VIBEDEFEND_USAGE_UPDATED'
  | 'REPORT_READY' | 'AGGREGATED_REPORT_READY'
  | 'ASYNC_TASK_PROGRESS' | 'ASYNC_TASK_COMPLETED'
  | 'connected' | 'heartbeat' | 'auth-refresh' | 'snapshot-required' | 'error';

export type Handlers = Partial<Record<RealtimeEventType, (env?: any) => void>>;
export type Opts = {
  /** Synchronous, already-known JWT. Used for the very first handshake. */
  tokenProvider: () => string | null;
  /**
   * Optional source of a *freshly minted* JWT, used only when a connection has
   * to be re-established. It matters because the gateway ends every stream at
   * the exact moment the token it was opened with expires: replaying the
   * cached token at that point earns a 401 and kills the stream for good.
   * Implementations should go through the identity SDK, which returns the
   * cached token while it is still valid and rotates it once it is not.
   */
  refreshToken?: () => Promise<string | null>;
};

interface Subscriber { handlers: Handlers }
interface Connection {
  url: string;
  subscribers: Set<Subscriber>;
  controller: AbortController;
  tokenProvider: () => string | null;
  refreshToken?: () => Promise<string | null>;
  lastEventId: string | null;
  failureCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** True while a request is in flight. A registered-but-dead entry is a bug. */
  live: boolean;
  /** Invalidates an async token fetch whose connection moved on meanwhile. */
  attempt: number;
  /** The degraded-stream warning is fanned out once, not on every retry. */
  warned: boolean;
  /** A 401 handshake already triggered one refresh-and-retry for this stream. */
  authRetried: boolean;
  /**
   * A handshake has succeeded at least once. The next successful one is a
   * reconnect: the gateway does not replay what was published in between
   * (Last-Event-ID is ignored), so subscribers get a `snapshot-required` to
   * refetch — a page that sat through a token expiry or a network blip used
   * to stay silently stale until the next unrelated event or a manual reload.
   */
  everOpened: boolean;
  /** Pending teardown of a connection whose last subscriber left (see CLOSE_GRACE_MS). */
  closeTimer: ReturnType<typeof setTimeout> | null;
}

// Retry policy. Tuned to keep the gateway out of rate-limit territory while
// still recovering quickly from transient blips.
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_JITTER = 0.3;
const MAX_CONSECUTIVE_FAILURES = 5;
// `Last-Event-ID` only reaches the gateway if its CORS preflight names the
// header. When it does not, the browser rejects the request before it leaves,
// `fetchEventSource` surfaces a bare `TypeError`, and every retry carrying the
// same header reproduces it exactly: the stream of a page would be dead for
// good after two reconnects. Past this many consecutive failures we stop sending the
// resume hint: a plain handshake is worth far more than a resume the gateway
// ignores anyway (it never replays — hence `snapshot-required`). It costs
// nothing when the cause was something else, and a single delivered frame
// re-learns an id.
const DROP_LAST_EVENT_ID_AFTER_FAILURES = 2;
// Past the fast-retry budget we slow down to one attempt per minute instead of
// abandoning the stream. Giving up used to be permanent: a network blip longer
// than the ~30s budget left the page silently stale until a manual reload.
const IDLE_RETRY_MS = 60_000;
// A reconnect must never hang on the identity SDK answering. Past this budget
// we go ahead with the token we already hold and let the handshake arbitrate.
const REFRESH_TOKEN_TIMEOUT_MS = 5_000;
/**
 * How long a connection outlives its last subscriber. Switching between two
 * pages on the same stream (the Results tabs of a project) unmounts the hooks
 * of one and mounts those of the next a few milliseconds later: tearing the
 * connection down in between cost one SSE handshake and one Permify check per
 * tab change. A subscriber that joins within the grace period
 * takes the connection over; nothing is delivered meanwhile, and the joining
 * page reads its data when it mounts.
 */
export const CLOSE_GRACE_MS = 3_000;

// Thrown from `onopen` for HTTP statuses where retrying cannot help (auth /
// permission / client error). Re-thrown from `onerror` so the underlying lib
// stops its internal retry loop.
class FatalStreamError extends Error {
  constructor(public readonly status: number) {
    super(`SSE handshake returned ${status}`);
  }
}

// Thrown from `onopen` on the FIRST 401 of a stream that has a refresher: the
// token we opened with is stale (expired while the stream was down, or already
// rotated by another tab). Refresh it and retry once; a second 401 is fatal.
class AuthRetryError extends Error {
  constructor() {
    super('SSE handshake returned 401 — refreshing the token and retrying once');
  }
}

// One shared SSE connection per URL. Hooks may legitimately subscribe to the
// same channel (e.g. grouped + detailed views of the same project's issues);
// without multiplexing, each subscriber would open its own connection — same
// data, more sockets, more gateway load.
const connections = new Map<string, Connection>();

/** Test-only: clear the module-level registry between tests. */
export function __resetConnectionsForTests(): void {
  for (const c of connections.values()) {
    c.controller.abort();
    if (c.retryTimer) clearTimeout(c.retryTimer);
    if (c.closeTimer) clearTimeout(c.closeTimer);
  }
  connections.clear();
}

/** End a connection for good: no request, no timer, out of the registry. */
const teardown = (conn: Connection) => {
  conn.live = false;
  if (conn.retryTimer) clearTimeout(conn.retryTimer);
  conn.retryTimer = null;
  if (conn.closeTimer) clearTimeout(conn.closeTimer);
  conn.closeTimer = null;
  conn.controller.abort();
  if (connections.get(conn.url) === conn) connections.delete(conn.url);
};

const fanOut = (conn: Connection, type: RealtimeEventType, env: any) => {
  for (const sub of conn.subscribers) sub.handlers[type]?.(env);
};

const dispatch = (conn: Connection, msg: { id: string; event: string; data: string }) => {
  if (msg.id) conn.lastEventId = msg.id;
  if (msg.event === 'auth-refresh') {
    // Waiting out its grace period with no subscriber: not worth a new handshake.
    if (conn.subscribers.size === 0) {
      teardown(conn);
      return;
    }
    conn.controller.abort();
    conn.controller = new AbortController();
    startConnection(conn);
    return;
  }
  if (msg.event === 'snapshot-required') {
    fanOut(conn, 'snapshot-required', { type: 'snapshot-required' });
    return;
  }
  if (!msg.data) return;
  try {
    const env = JSON.parse(msg.data);
    fanOut(conn, env.type as RealtimeEventType, env);
  } catch {
    /* ignore malformed events */
  }
};

const computeBackoffMs = (failures: number): number => {
  const expo = Math.min(
    MAX_BACKOFF_MS,
    INITIAL_BACKOFF_MS * 2 ** Math.max(0, failures - 1),
  );
  const jitter = expo * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(expo + jitter));
};

const isRetriableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

/**
 * Count one lost connection and schedule the next attempt. Never gives up: the
 * only terminal states are "no subscriber left" and a fatal handshake status.
 */
const scheduleReconnect = (conn: Connection) => {
  conn.live = false;
  conn.failureCount += 1;

  // Retrying has plainly stopped helping — drop the resume hint (see
  // DROP_LAST_EVENT_ID_AFTER_FAILURES) so the next attempt is a plain
  // handshake the browser will actually send.
  if (
    conn.lastEventId &&
    conn.failureCount >= DROP_LAST_EVENT_ID_AFTER_FAILURES
  ) {
    console.debug(
      `[realtimeStream] dropping stale Last-Event-ID after ${conn.failureCount} consecutive failures`,
    );
    conn.lastEventId = null;
  }

  if (conn.failureCount > MAX_CONSECUTIVE_FAILURES && !conn.warned) {
    conn.warned = true;
    fanOut(conn, 'error', { type: 'error', fatal: true, reason: 'max_retries' });
  }

  const delay =
    conn.failureCount > MAX_CONSECUTIVE_FAILURES
      ? IDLE_RETRY_MS
      : computeBackoffMs(conn.failureCount);

  conn.controller.abort();
  conn.controller = new AbortController();
  if (conn.retryTimer) clearTimeout(conn.retryTimer);
  conn.retryTimer = setTimeout(() => {
    conn.retryTimer = null;
    if (connections.get(conn.url) === conn) startConnection(conn, true);
  }, delay);
};

/**
 * Open (or re-open) the underlying request.
 *
 * `reconnect` marks an attempt that follows a lost connection. Those go through
 * `refreshToken` when the caller provided one, because the most common reason
 * for losing a stream is the gateway closing it at the expiry of the very token
 * we hold — replaying it would only earn a 401.
 */
const startConnection = (conn: Connection, reconnect = false) => {
  // A pending backoff is superseded by this attempt — letting it fire too
  // would open a second request for the same connection.
  if (conn.retryTimer) {
    clearTimeout(conn.retryTimer);
    conn.retryTimer = null;
  }

  const attempt = ++conn.attempt;
  const isCurrent = () =>
    connections.get(conn.url) === conn && conn.attempt === attempt;

  if (reconnect && conn.refreshToken) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A refresher that fails, yields nothing, or never answers must not sink
    // the stream — fall back to whatever token we already hold and let the
    // handshake arbitrate.
    const timeout = new Promise<string | null>((resolve) => {
      timer = setTimeout(() => resolve(null), REFRESH_TOKEN_TIMEOUT_MS);
    });
    void Promise.race([conn.refreshToken().catch(() => null), timeout]).then(
      (fresh) => {
        if (timer) clearTimeout(timer);
        if (isCurrent()) openConnection(conn, fresh || conn.tokenProvider());
      },
    );
    return;
  }

  openConnection(conn, conn.tokenProvider());
};

const openConnection = (conn: Connection, token: string | null) => {
  if (!token) {
    // Token momentarily unavailable (rotation in flight, bootstrap not done).
    // Returning here used to leave a registered, permanently dead connection
    // that no later subscriber could revive — retry instead.
    scheduleReconnect(conn);
    return;
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (conn.lastEventId) headers['Last-Event-ID'] = conn.lastEventId;

  conn.live = true;

  void fetchEventSource(conn.url, {
    headers,
    signal: conn.controller.signal,
    openWhenHidden: true,
    async onopen(response) {
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes(EventStreamContentType)) {
        conn.failureCount = 0;
        conn.warned = false;
        conn.authRetried = false;
        const isReconnect = conn.everOpened;
        conn.everOpened = true;
        if (isReconnect) {
          fanOut(conn, 'snapshot-required', { type: 'snapshot-required' });
        }
        return;
      }
      if (isRetriableStatus(response.status)) {
        throw new Error(`SSE retriable handshake error: ${response.status}`);
      }
      if (response.status === 401 && conn.refreshToken && !conn.authRetried) {
        throw new AuthRetryError();
      }
      // Auth (401), permission (403), not found (404), bad request (400/422)…
      // None of these get better by retrying with the same request.
      throw new FatalStreamError(response.status);
    },
    onmessage: (msg) => {
      conn.failureCount = 0;
      conn.warned = false;
      conn.authRetried = false;
      dispatch(conn, msg);
    },
    // The server ended the response body. The gateway does exactly that when
    // the JWT a stream was opened with expires (see RealtimeStreamFactory's
    // `disconnect$` timer), so this is a routine, expected event — not an
    // error. @microsoft/fetch-event-source treats a clean end-of-body as
    // success and never retries, which is why a page left open long enough
    // used to stop receiving heartbeats and events until a manual reload.
    onclose: () => {
      if (connections.get(conn.url) !== conn) {
        conn.live = false;
        return;
      }
      // Waiting out its grace period with no subscriber: nobody to reconnect for.
      if (conn.subscribers.size === 0) {
        teardown(conn);
        return;
      }
      scheduleReconnect(conn);
    },
    onerror: (err) => {
      // Subscribers all gone or this connection has been replaced — stop quietly.
      if (connections.get(conn.url) !== conn) {
        conn.live = false;
        throw err;
      }
      // Waiting out its grace period with no subscriber: nobody to reconnect for.
      if (conn.subscribers.size === 0) {
        teardown(conn);
        throw err;
      }

      // First 401 with a refresher at hand: mint a fresh token and reopen once.
      // `startConnection(conn, true)` goes through `refreshToken` (bounded by
      // REFRESH_TOKEN_TIMEOUT_MS); re-throw to break the lib's own retry.
      if (err instanceof AuthRetryError) {
        conn.authRetried = true;
        conn.live = false;
        conn.controller.abort();
        conn.controller = new AbortController();
        startConnection(conn, true);
        throw err;
      }

      // Fatal: notify subscribers, drop the connection from the registry, and
      // re-throw so the lib stops retrying. Callers (hooks) can re-open via a
      // fresh `openStream(...)` call once they have a new token / new context.
      if (err instanceof FatalStreamError) {
        fanOut(conn, 'error', {
          type: 'error',
          fatal: true,
          status: err.status,
        });
        teardown(conn);
        throw err;
      }

      // Schedule a delayed reconnect ourselves so the token is re-read on
      // every attempt; throw to break the lib's internal (immediate) retry.
      scheduleReconnect(conn);
      throw err;
    },
  }).catch(() => {
    /* abort + our own reconnect both surface here */
  });
};

/**
 * Open a server-sent-events stream, sending the JWT in the Authorization header
 * (never in the URL). Multiple subscribers on the same URL share one underlying
 * connection; each receives events independently. The connection is torn down
 * CLOSE_GRACE_MS after the last subscriber closes, unless one joins meanwhile.
 *
 * Errors are surfaced to subscribers via the `error` handler when they are
 * either fatal (auth/permission/client errors) or when the retry budget is
 * exhausted. Transient failures — including the server closing the stream at
 * token expiry — are retried with exponential backoff + jitter, then at a
 * reduced rate. Only a fatal handshake status or the last subscriber closing
 * ends a connection for good.
 */
export function openStream(url: string, handlers: Handlers, opts: Opts): { close: () => void } {
  const subscriber: Subscriber = { handlers };

  let conn = connections.get(url);
  if (!conn) {
    if (!opts.tokenProvider()) {
      // Not authenticated yet — caller will retry when token becomes available.
      return { close: () => { /* nothing to close */ } };
    }
    conn = {
      url,
      subscribers: new Set(),
      controller: new AbortController(),
      tokenProvider: opts.tokenProvider,
      refreshToken: opts.refreshToken,
      lastEventId: null,
      failureCount: 0,
      retryTimer: null,
      live: false,
      attempt: 0,
      warned: false,
      authRetried: false,
      everOpened: false,
      closeTimer: null,
    };
    connections.set(url, conn);
    conn.subscribers.add(subscriber);
    startConnection(conn);
  } else {
    // A connection waiting out its grace period is taken over, not reopened.
    if (conn.closeTimer) {
      clearTimeout(conn.closeTimer);
      conn.closeTimer = null;
    }
    // The newest subscriber's token sources are the ones still fed: those of a
    // hook that has unmounted keep returning the token it last rendered with.
    conn.tokenProvider = opts.tokenProvider;
    if (opts.refreshToken) conn.refreshToken = opts.refreshToken;
    conn.subscribers.add(subscriber);
    // The cached entry may be waiting out a backoff after the server closed it
    // or after a failed attempt. A brand-new subscriber is fresh user intent
    // (a page or drawer that just mounted), so bring the stream back up now
    // instead of silently handing it a connection that delivers nothing.
    if (!conn.live) startConnection(conn, true);
  }

  return {
    close: () => {
      const c = connections.get(url);
      if (!c) return;
      c.subscribers.delete(subscriber);
      if (c.subscribers.size > 0) return;
      // Left because the user signed out (its token is gone): nothing may stay
      // connected on that session, not even for the grace period.
      if (!opts.tokenProvider()) {
        teardown(c);
        return;
      }
      if (!c.closeTimer) {
        c.closeTimer = setTimeout(() => {
          c.closeTimer = null;
          if (c.subscribers.size === 0) teardown(c);
        }, CLOSE_GRACE_MS);
      }
    },
  };
}
