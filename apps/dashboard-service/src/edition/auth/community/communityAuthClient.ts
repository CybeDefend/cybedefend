import { useEffect, useSyncExternalStore } from 'react';
import type { AuthClient, AuthState } from '../authClient';
import store from '@/server/store';
import { clearAccessToken, setAccessToken } from '@/server/store/authSlice';
import {
  markSessionBroken,
  registerForceSignIn,
  registerTokenProvider,
  resetCircuitBreaker,
  type TokenProviderOptions,
} from '@/server/api/tokenManager';
import { DEFAULT_LOCK_TIMEOUT_MS, withRefreshLock } from '@/server/auth/refreshLock';
import { readTokenTiming, refreshMarginSeconds } from '@/server/auth/jwtClaims';
import { login, logout, refresh, setAccessTokenSource } from './authApi';

/**
 * The Community Edition's session client.
 *
 * - The access token lives in memory only (Redux `auth.accessToken`), never
 *   in web storage. The HttpOnly `cd_refresh` cookie restores the session
 *   after a reload: at boot the client calls the refresh route once.
 * - Freshness never reads the browser's clock against the token's `exp`: a
 *   token is valid for its lifetime (the answer's `expiresIn`, else the
 *   token's `exp − iat`) counted on the monotonic clock from the moment it
 *   arrived. A browser clock minutes ahead or behind therefore neither loops
 *   the refresh nor lets a token expire unrefreshed.
 * - The refresh runs at lifetime − margin (`refreshMarginSeconds`, never
 *   sooner than 10 s), serialized across tabs by the Web Locks API. Inside the
 *   lock a tab first looks at the token it holds: a peer that refreshed has
 *   already broadcast its token, so the tab adopts it and asks nothing. More
 *   than 3 successful exchanges within a minute is treated as a transient
 *   failure (retried 15 s later): a server that hands out tokens already due
 *   cannot drive a refresh loop.
 * - Tabs share no token through storage: each successful refresh, sign-in or
 *   adoption is posted on `BroadcastChannel('cybedefend.community.auth')`
 *   (`{ type: 'token', accessToken, expiresIn }`), a sign-out as
 *   `{ type: 'signed-out' }`. A broadcast token of another user (`sub`)
 *   reloads the tab instead of being held under the previous user's state.
 * - Only a 401 on refresh ends a session. A lost race (`409 REFRESH_RACE`)
 *   waits for the winner's broadcast, then asks once more; a 429, 5xx,
 *   network failure, timeout or lock timeout is transient and retried 15 s
 *   later, the held token kept.
 * - A sign-out (local or a peer's) bumps the session generation: an exchange
 *   that started before it is discarded (no hold, no broadcast). The logout
 *   call runs under the refresh lock, so it never interleaves with a rotation.
 *
 * Nothing starts before the client is first used, so in the cloud, where the
 * closed client is active, this module opens no channel and schedules nothing.
 */

export const COMMUNITY_REFRESH_LOCK = 'cybedefend.community.refresh';
const CHANNEL_NAME = 'cybedefend.community.auth';
const TRANSIENT_RETRY_MS = 15_000;
const RACE_WAIT_MS = 2_000;
/** A refresh is never scheduled sooner than this. */
const MIN_REFRESH_DELAY_MS = 10_000;
/** At most this many successful exchanges within {@link REFRESH_BURST_WINDOW_MS}. */
const MAX_REFRESH_BURST = 3;
const REFRESH_BURST_WINDOW_MS = 60_000;
/** When a token's lifetime cannot be read, treat it as valid this long. */
const UNKNOWN_LIFETIME_MS = 60_000;
/** A peer's `sentAt` may be this far ahead of this tab's clock (same browser, same clock). */
const SENT_AT_TOLERANCE_MS = 5_000;

/** What `AuthState.error` holds when the boot could not reach the gateway: one value, so a render never sees a new error. */
const BOOT_FAILED = new Error('The session could not be restored');

/** How the client leaves the page; replaced in tests. */
export interface CommunityNavigation {
  assign(url: string): void;
  reload(): void;
}

let navigation: CommunityNavigation = {
  assign: (url) => window.location.assign(url),
  reload: () => window.location.reload(),
};

export function setCommunityNavigation(next: CommunityNavigation): void {
  navigation = next;
}

type ChannelMessage = { type: 'token'; accessToken: string; expiresIn: number; sentAt: number } | { type: 'signed-out' };

/**
 * The held token and when it arrived, on the monotonic clock and on the wall
 * clock. The monotonic clock pauses while the machine sleeps; the wall clock
 * does not, and a difference of two wall readings cancels a fixed skew.
 */
interface Anchor {
  token: string;
  arrivedAt: number;
  wallArrivedAt: number;
  lifetimeMs: number;
  marginMs: number;
}

let snapshot: AuthState = { isAuthenticated: false, loading: true, error: null, retry };
const listeners = new Set<() => void>();
let started = false;
let booted = false;
/** True once one exchange has been answered, whatever the answer. */
let settled = false;
let channel: BroadcastChannel | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<string | null> | null = null;
/** The largest minimum validity asked of the exchange in flight. */
let pendingMinValidity = 0;
/** A token the gateway refused: the exchange in flight does not answer it from memory. */
let pendingRefused: string | null = null;
/** Bumped by every sign-out: an exchange started under an older generation is discarded. */
let generation = 0;
let anchor: Anchor | null = null;
/** When each recent successful exchange happened, on both clocks (see elapsedMs). */
const recentRefreshes: Array<{ mono: number; wall: number }> = [];
const tokenWaiters = new Set<(token: string) => void>();

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function setSnapshot(next: Omit<AuthState, 'retry'>): void {
  if (
    snapshot.isAuthenticated === next.isAuthenticated &&
    snapshot.loading === next.loading &&
    snapshot.error === next.error
  ) {
    return;
  }
  snapshot = { ...next, retry };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): AuthState => snapshot;

function currentToken(): string | null {
  return store.getState().auth.accessToken;
}

/** The token's own lifetime (`exp − iat`, clock-free), or null. */
function claimedLifetimeS(token: string): number | null {
  const timing = readTokenTiming(token);
  if (!timing || timing.iat === null) return null;
  return timing.exp - timing.iat;
}

function marginMsOf(token: string): number {
  const timing = readTokenTiming(token);
  return timing ? refreshMarginSeconds(timing) * 1000 : 0;
}

/** The user a token names (`sub`), or null; read without verification, like the timing claims. */
function subjectOf(token: string): string | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    const sub = payload && typeof payload === 'object' ? (payload as { sub?: unknown }).sub : undefined;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

function anchorFor(token: string, expiresIn?: number): Anchor {
  const lifetimeS =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : claimedLifetimeS(token);
  return {
    token,
    arrivedAt: monotonicNow(),
    wallArrivedAt: Date.now(),
    lifetimeMs: lifetimeS !== null && lifetimeS > 0 ? lifetimeS * 1000 : UNKNOWN_LIFETIME_MS,
    marginMs: marginMsOf(token),
  };
}

/**
 * Time since the token arrived: the larger of the monotonic and the wall
 * elapsed times. A sleep (monotonic paused) or a forward jump of the wall
 * clock only makes the token look older, so it is refreshed early (bounded by
 * the burst cap); a wall clock set back falls back on the monotonic clock.
 */
function elapsedMs(held: Anchor): number {
  return Math.max(monotonicNow() - held.arrivedAt, Date.now() - held.wallArrivedAt);
}

/** Milliseconds the held token stays valid, counted from its arrival; 0 for a token held without an anchor. */
function remainingMs(token: string): number {
  if (!anchor || anchor.token !== token) return 0;
  return anchor.lifetimeMs - elapsedMs(anchor);
}

/** A token worth keeping: valid longer than its refresh margin and than `minValiditySeconds`. */
function isFresh(token: string, minValiditySeconds = 0): boolean {
  if (!anchor || anchor.token !== token) return false;
  return remainingMs(token) > Math.max(anchor.marginMs, minValiditySeconds * 1000);
}

/** A token another tab sent: three segments and a positive lifetime (the browser's clock is not consulted). */
function isUsablePeerToken(token: unknown): token is string {
  if (typeof token !== 'string' || token.split('.').length !== 3) return false;
  const lifetime = claimedLifetimeS(token);
  return lifetime !== null && lifetime > 0;
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

function scheduleRefresh(held: Anchor): void {
  refreshTimer = clearTimer(refreshTimer);
  const delay = Math.max(MIN_REFRESH_DELAY_MS, held.lifetimeMs - elapsedMs(held) - held.marginMs);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshNow();
  }, delay);
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void refreshNow();
  }, TRANSIENT_RETRY_MS);
}

function post(message: ChannelMessage): void {
  try {
    channel?.postMessage(message);
  } catch {
    // A closed channel: the other tabs find out at their next refresh.
  }
}

/** Broadcast the held token with the time it has left and the moment it was sent (wall clock: one browser, one clock). */
function postToken(token: string): void {
  post({ type: 'token', accessToken: token, expiresIn: Math.max(0, remainingMs(token) / 1000), sentAt: Date.now() });
}

/** Hold `token` in this tab: store it, anchor and schedule its refresh, mark the session up. */
function hold(token: string, expiresIn?: number): void {
  anchor = anchorFor(token, expiresIn);
  if (currentToken() !== token) store.dispatch(setAccessToken(token));
  resetCircuitBreaker();
  retryTimer = clearTimer(retryTimer);
  scheduleRefresh(anchor);
  settled = true;
  setSnapshot({ isAuthenticated: true, loading: false, error: null });
  tokenWaiters.forEach((wake) => wake(token));
}

/** Drop this tab's session locally; a session that was held is reported broken (forced sign-in). */
function dropSession(reportBroken: boolean): void {
  generation += 1;
  const held = currentToken() !== null;
  anchor = null;
  refreshTimer = clearTimer(refreshTimer);
  retryTimer = clearTimer(retryTimer);
  if (held) store.dispatch(clearAccessToken());
  settled = true;
  setSnapshot({ isAuthenticated: false, loading: false, error: null });
  if (held && reportBroken) markSessionBroken();
}

/**
 * What a peer's token has left: its `expiresIn` (capped at the token's own
 * exp − iat) minus the time since `sentAt`. Null when `sentAt` is missing, not
 * a finite number or in the future (beyond a 5 s tolerance), or when nothing
 * is left: a frozen tab that receives the message late must not hold it.
 */
function peerTimeLeftSeconds(token: string, expiresIn: unknown, sentAt: unknown): number | null {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return null;
  const now = Date.now();
  if (sentAt > now + SENT_AT_TOLERANCE_MS) return null;
  const claimed = claimedLifetimeS(token);
  if (claimed === null || claimed <= 0) return null;
  const offered = typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn >= 0 ? Math.min(expiresIn, claimed) : claimed;
  const left = offered - Math.max(0, now - sentAt) / 1000;
  return left > 0 ? left : null;
}

/** Back from a sleep, a hidden tab or offline: refresh a token that is due, else reschedule from the real elapsed time. */
function recheck(): void {
  const token = currentToken();
  if (!token || !anchor || anchor.token !== token) return;
  if (isFresh(token)) scheduleRefresh(anchor);
  else void refreshNow();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') recheck();
}

function onChannelMessage(event: MessageEvent): void {
  const data: unknown = event.data;
  if (!data || typeof data !== 'object') return;
  const message = data as { type?: unknown; accessToken?: unknown; expiresIn?: unknown; sentAt?: unknown };
  if (message.type === 'token') {
    const token = message.accessToken;
    if (!isUsablePeerToken(token) || token === currentToken()) return;
    const leftS = peerTimeLeftSeconds(token, message.expiresIn, message.sentAt);
    if (leftS === null) return;
    const held = currentToken();
    if (held !== null && subjectOf(held) !== subjectOf(token)) {
      // Another user signed in elsewhere: this tab's profile and organisation are the previous user's.
      navigation.reload();
      return;
    }
    // Never trade a token for one that expires sooner.
    if (held !== null && remainingMs(held) >= leftS * 1000) return;
    hold(token, leftS);
  } else if (message.type === 'signed-out') {
    dropSession(true);
  }
}

/** Where changePassword takes its bearer: a refreshed token when the held one is due. */
setAccessTokenSource(() => tokenFor());

/** The client's first use: open the channel and hand the token manager this client's token source. */
function ensureStarted(): void {
  if (started) return;
  started = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', onChannelMessage);
    } catch {
      channel = null;
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', recheck);
    window.addEventListener('online', recheck);
  }
  registerTokenProvider(async (_resource?: string, minValiditySeconds?: number, options?: TokenProviderOptions) => {
    const refused = options?.refusedToken;
    // The gateway refused the token this tab holds: exchange, whatever the local clocks say.
    const token =
      refused !== undefined && refused === currentToken()
        ? await refreshNow(minValiditySeconds ?? 0, refused)
        : await tokenFor(minValiditySeconds);
    return token ?? undefined;
  });
  registerForceSignIn(() => {
    void communityAuthClient.signIn(`${window.location.pathname}${window.location.search}`);
  });
}

/** Resolve with the next token this tab holds, newer than `previous`, or null after `ms`. */
function waitForPeerToken(previous: string | null, ms: number): Promise<string | null> {
  const now = currentToken();
  if (now && now !== previous && isFresh(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    const wake = (token: string) => {
      clearTimeout(timer);
      tokenWaiters.delete(wake);
      resolve(token);
    };
    const timer = setTimeout(() => {
      tokenWaiters.delete(wake);
      resolve(null);
    }, ms);
    tokenWaiters.add(wake);
  });
}

function transient(): string | null {
  scheduleRetry();
  settled = true;
  const held = currentToken();
  if (!held) setSnapshot({ isAuthenticated: false, loading: false, error: BOOT_FAILED });
  return held;
}

/** True when too many exchanges succeeded in the last minute. */
function refreshBurstReached(): boolean {
  const mono = monotonicNow();
  const wall = Date.now();
  // An entry expires on the larger of the two elapsed times: a sleep pauses the monotonic clock.
  const expired = (entry: { mono: number; wall: number }) =>
    Math.max(mono - entry.mono, wall - entry.wall) >= REFRESH_BURST_WINDOW_MS;
  while (recentRefreshes.length > 0 && expired(recentRefreshes[0])) recentRefreshes.shift();
  return recentRefreshes.length >= MAX_REFRESH_BURST;
}

function accept(token: string, expiresIn: number | undefined): string {
  recentRefreshes.push({ mono: monotonicNow(), wall: Date.now() });
  hold(token, expiresIn);
  postToken(token);
  return token;
}

async function exchange(startedIn: number): Promise<string | null> {
  if (generation !== startedIn) return null;
  const current = currentToken();
  // Another tab refreshed while this one waited for the lock: its broadcast is already held.
  if (current && current !== pendingRefused && isFresh(current, pendingMinValidity)) return current;
  if (refreshBurstReached()) return transient();

  const outcome = await refresh();
  // Signed out (here or in another tab) while the exchange was on the wire: drop the answer.
  if (generation !== startedIn) return null;
  switch (outcome.kind) {
    case 'ok':
      return accept(outcome.accessToken, outcome.expiresIn);
    case 'race': {
      // The other tab rotated the cookie first: take its token, never sign out.
      const peer = await waitForPeerToken(current, RACE_WAIT_MS);
      if (generation !== startedIn) return null;
      if (peer) return peer;
      const again = await refresh();
      if (generation !== startedIn) return null;
      if (again.kind === 'ok') return accept(again.accessToken, again.expiresIn);
      return transient();
    }
    case 'signed-out':
      dropSession(true);
      return null;
    default:
      return transient();
  }
}

function startExchange(minValiditySeconds: number, refused: string | null): Promise<string | null> {
  if (inflight) {
    pendingMinValidity = Math.max(pendingMinValidity, minValiditySeconds);
    if (refused !== null) pendingRefused = refused;
    return inflight;
  }
  pendingMinValidity = minValiditySeconds;
  pendingRefused = refused;
  const startedIn = generation;
  inflight = withRefreshLock(COMMUNITY_REFRESH_LOCK, () => exchange(startedIn), { timeoutMs: DEFAULT_LOCK_TIMEOUT_MS })
    .catch(() => (generation === startedIn ? transient() : null))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Refresh the session now (deduplicated in the tab, serialized across tabs),
 * unless the held token stays valid `minValiditySeconds` longer than its
 * refresh margin. Concurrent callers share one exchange, which checks the
 * largest minimum asked; a caller that joined too late for it gets a second
 * exchange.
 */
export function refreshNow(minValiditySeconds = 0, refusedToken: string | null = null): Promise<string | null> {
  ensureStarted();
  if (!inflight) return startExchange(minValiditySeconds, refusedToken);
  const shared = startExchange(minValiditySeconds, refusedToken);
  return shared.then((token) =>
    token === null || (token !== refusedToken && isFresh(token, minValiditySeconds))
      ? token
      : startExchange(minValiditySeconds, refusedToken),
  );
}

/** The held token when it is valid long enough, else a refresh; null once known signed out. */
async function tokenFor(minValiditySeconds = 0): Promise<string | null> {
  const token = currentToken();
  if (token && isFresh(token, minValiditySeconds)) return token;
  if (!token && settled && !inflight) return null;
  return refreshNow(minValiditySeconds);
}

function boot(): void {
  ensureStarted();
  if (booted) return;
  booted = true;
  void refreshNow();
}

function retry(): void {
  if (!snapshot.error) return;
  retryTimer = clearTimer(retryTimer);
  setSnapshot({ isAuthenticated: snapshot.isAuthenticated, loading: true, error: null });
  void refreshNow();
}

function useCommunityAuthState(): AuthState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    boot();
  }, []);
  return state;
}

/**
 * Hold a token a form obtained (setup, sign-up, invitation, password change)
 * and tell the other tabs. `expiresIn` is the answer's lifetime in seconds.
 */
export function adoptToken(accessToken: string, expiresIn?: number): void {
  ensureStarted();
  hold(accessToken, expiresIn);
  postToken(accessToken);
}

/** Sign in with an e-mail and a password; a refusal rejects with the API's error. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const answer = await login(email, password);
  adoptToken(answer.accessToken, answer.expiresIn);
}

/**
 * A path of this app, or null: no control character, space, DEL or
 * backslash, no encoded slash or backslash in the path, and it resolves to
 * this origin with a path that starts with a single `/`.
 */
function safeReturnTo(returnTo: string | undefined): string | null {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  for (let i = 0; i < returnTo.length; i += 1) {
    const code = returnTo.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return null;
  }
  const path = returnTo.split(/[?#]/, 1)[0];
  if (/%(2f|5c)/i.test(path)) return null;
  try {
    const url = new URL(returnTo, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) {
      return null;
    }
  } catch {
    return null;
  }
  return returnTo;
}

function forgetSession(): void {
  ensureStarted();
  dropSession(false);
  post({ type: 'signed-out' });
}

/** The logout call, under the refresh lock so it never interleaves with a rotation; a lock not granted still logs out. */
async function logoutUnderLock(): Promise<boolean> {
  try {
    return await withRefreshLock(COMMUNITY_REFRESH_LOCK, () => logout(), { timeoutMs: DEFAULT_LOCK_TIMEOUT_MS });
  } catch {
    return logout();
  }
}

export const communityAuthClient: AuthClient = {
  useAuthState: useCommunityAuthState,
  getAccessToken: () => tokenFor(),
  async signIn(returnTo?: string) {
    const target = safeReturnTo(returnTo);
    navigation.assign(target ? `/login?returnTo=${encodeURIComponent(target)}` : '/login');
  },
  async signOut() {
    forgetSession();
    const revoked = await logoutUnderLock();
    // The cookie may have survived a failed logout: the sign-in page says so.
    navigation.assign(revoked ? '/login' : '/login?signout=incomplete');
  },
  forgetSession,
};
