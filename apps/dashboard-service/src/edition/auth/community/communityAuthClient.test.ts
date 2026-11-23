import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthState } from '../authClient';

/**
 * The Community session client: the access token lives in memory
 * only, the `cd_refresh` cookie restores it after a reload, and the refresh is
 * serialized across tabs by the Web Locks API. A tab that loses the race
 * (`409 REFRESH_RACE`) adopts the token the other tab obtained, broadcast on
 * `BroadcastChannel('cybedefend.community.auth')`, and never signs out. Only a
 * 401 on refresh ends a session; a 429, 5xx, network or lock timeout is
 * transient.
 *
 * Each `loadTab()` is one browser tab: its own module graph (store, client,
 * token manager), sharing with the others only what tabs share, the Web Locks
 * queue and the broadcast channel.
 */

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ key: 'eu', label: '', appUrl: '', apiUrl: 'https://api.example.test', badges: [] }),
}));

vi.mock('@/edition/active', () => ({
  ACTIVE_EE_AUTH_CLIENT: null,
  ACTIVE_EXTENSIONS: { reducers: {}, responseInterceptors: [] },
}));

vi.mock('@/server/api/tokenManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/api/tokenManager')>();
  return {
    ...actual,
    markSessionBroken: vi.fn(),
    registerTokenProvider: vi.fn(),
    registerForceSignIn: vi.fn(),
    resetCircuitBreaker: vi.fn(),
  };
});

/** A JWT the server issued at `issuedAtMs` (its own clock), valid `lifetimeS` seconds. */
function jwtAt(issuedAtMs: number, lifetimeS: number, salt = ''): string {
  const now = Math.floor(issuedAtMs / 1000);
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'ES256' })}.${b64({ iat: now, exp: now + lifetimeS, sub: `u${salt}` })}.sig${salt}`;
}

/** A JWT that expires `lifetimeS` seconds from now (iat = now). */
function jwt(lifetimeS: number, salt = ''): string {
  return jwtAt(Date.now(), lifetimeS, salt);
}

const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] as const };

// ── the HTTP side: one adapter for every tab ────────────────────────────
type Reply = { status: number; data?: unknown } | 'network';
const sent: InternalAxiosRequestConfig[] = [];
let replyFor: (config: InternalAxiosRequestConfig) => Reply | Promise<Reply> = () => 'network';

function toResponse(config: InternalAxiosRequestConfig, reply: Reply): Promise<AxiosResponse> {
  if (reply === 'network') return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
  const response: AxiosResponse = { data: reply.data ?? '', status: reply.status, statusText: '', headers: {}, config, request: {} };
  if (reply.status >= 200 && reply.status < 300) return Promise.resolve(response);
  return Promise.reject(new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response));
}

const adapter: AxiosAdapter = async (config) => {
  sent.push(config);
  return toResponse(config, await replyFor(config));
};

const refreshCalls = () => sent.filter((c) => c.url?.endsWith('/auth/refresh')).length;
const mockRefresh = (status: number, data?: unknown) => {
  replyFor = () => ({ status, data });
};
const mockRefreshNetworkError = () => {
  replyFor = () => 'network';
};
const lastRequest = () => sent[sent.length - 1];

// ── what tabs share: Web Locks and BroadcastChannel ─────────────────────
const lockTails = new Map<string, Promise<void>>();
const fakeLocks = {
  request<R>(name: string, _opts: { signal: AbortSignal }, cb: () => Promise<R>): Promise<R> {
    const previous = lockTails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockTails.set(name, previous.then(() => mine));
    return previous.then(async () => {
      try {
        return await cb();
      } finally {
        release();
      }
    });
  },
};

class FakeBroadcastChannel {
  static open: FakeBroadcastChannel[] = [];
  private listeners: Array<(ev: MessageEvent) => void> = [];
  closed = false;
  constructor(readonly name: string) {
    FakeBroadcastChannel.open.push(this);
  }
  addEventListener(_type: 'message', fn: (ev: MessageEvent) => void) {
    this.listeners.push(fn);
  }
  removeEventListener(_type: 'message', fn: (ev: MessageEvent) => void) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  postMessage(data: unknown) {
    const copy: unknown = JSON.parse(JSON.stringify(data));
    posted.push(copy);
    for (const other of FakeBroadcastChannel.open) {
      if (other !== this && other.name === this.name && !other.closed) other.deliver(copy);
    }
  }
  deliver(data: unknown) {
    for (const l of this.listeners) l({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

/** Every message any tab posted, in order. */
const posted: unknown[] = [];

/** What another tab posts on the channel. */
function peerBroadcasts(message: unknown) {
  const peer = new FakeBroadcastChannel('cybedefend.community.auth');
  peer.postMessage(message);
  peer.close();
}

// ── one tab ─────────────────────────────────────────────────────────────
async function loadTab() {
  vi.resetModules();
  const axios = (await import('axios')).default;
  axios.defaults.adapter = adapter;
  const client = await import('./communityAuthClient');
  const nav = { assign: vi.fn<(url: string) => void>(), reload: vi.fn<() => void>() };
  client.setCommunityNavigation(nav);
  const tokenManager = await import('@/server/api/tokenManager');
  const { default: store } = await import('@/server/store');
  const dispatched: string[] = [];
  const realDispatch = store.dispatch;
  vi.spyOn(store, 'dispatch').mockImplementation(((action: { type: string }) => {
    dispatched.push(action.type);
    return realDispatch(action);
  }) as typeof store.dispatch);
  return { ...client, tokenManager, store, dispatched, nav };
}

/** Mount useAuthState once and wait for the boot to settle. */
async function bootState(tab?: Awaited<ReturnType<typeof loadTab>>): Promise<AuthState> {
  const t = tab ?? (await loadTab());
  const { result } = renderHook(() => t.communityAuthClient.useAuthState());
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current;
}

// Every tab of every test shares this jsdom's document and window: the page
// listeners a tab installs are removed after its test, as closing it would.
const pageListeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
const originalAdd = { document: document.addEventListener, window: window.addEventListener };
function trackListeners(target: Document | Window, original: typeof document.addEventListener) {
  target.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (['visibilitychange', 'pageshow', 'online'].includes(type)) pageListeners.push([this, type, listener]);
    return original.call(this, type, listener, options);
  } as typeof document.addEventListener;
}

beforeEach(() => {
  trackListeners(document, originalAdd.document);
  trackListeners(window, originalAdd.window as typeof document.addEventListener);
  vi.clearAllMocks();
  sent.length = 0;
  lockTails.clear();
  FakeBroadcastChannel.open = [];
  posted.length = 0;
  replyFor = () => 'network';
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, writable: true, value: fakeLocks });
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  for (const [target, type, listener] of pageListeners.splice(0)) target.removeEventListener(type, listener);
  document.addEventListener = originalAdd.document;
  window.addEventListener = originalAdd.window;
  delete (globalThis.navigator as unknown as { locks?: unknown }).locks;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('communityAuthClient', () => {
  it('restores a session from the refresh cookie at boot', async () => {
    mockRefresh(200, { accessToken: jwt(900), tokenType: 'Bearer', expiresIn: 900 });
    expect(await bootState()).toMatchObject({ isAuthenticated: true, loading: false, error: null });
    expect(refreshCalls()).toBe(1);
  });

  it('a 401 at boot is signed out, not an error', async () => {
    mockRefresh(401, { code: 'REFRESH_INVALID' });
    const tab = await loadTab();
    expect(await bootState(tab)).toMatchObject({ isAuthenticated: false, loading: false, error: null });
    // No session was held: nothing to break, no forced sign-in (the setup and reset pages stay reachable).
    expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
    await expect(tab.communityAuthClient.getAccessToken()).resolves.toBeNull();
    expect(refreshCalls()).toBe(1);
  });

  it('a 401 on a held session clears the token and marks the session broken', async () => {
    const tab = await loadTab();
    tab.adoptToken(jwt(20));
    mockRefresh(401, { code: 'REFRESH_INVALID' });
    await expect(tab.refreshNow()).resolves.toBeNull();
    expect(tab.dispatched).toContain('auth/clearAccessToken');
    expect(tab.store.getState().auth.accessToken).toBeNull();
    expect(tab.tokenManager.markSessionBroken).toHaveBeenCalledTimes(1);
  });

  it('a REFRESH_RACE answer keeps the session', async () => {
    const token = jwt(900, 'peer');
    replyFor = (config) => {
      if (config.url?.endsWith('/auth/refresh')) {
        // The other tab's rotation lands right after ours lost the race.
        setTimeout(() => peerBroadcasts({ type: 'token', accessToken: token, expiresIn: 900, sentAt: Date.now() }), 10);
        return { status: 409, data: { code: 'REFRESH_RACE' } };
      }
      return 'network';
    };
    const tab = await loadTab();
    expect(await tab.communityAuthClient.getAccessToken()).toBe(token);
    expect(tab.dispatched).not.toContain('auth/clearAccessToken');
    expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
    expect(refreshCalls()).toBe(1);
  });

  it('a REFRESH_RACE with no broadcast asks once more and never signs out', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const token = jwt(900, 'second');
    let calls = 0;
    replyFor = () => (++calls === 1 ? { status: 409, data: { code: 'REFRESH_RACE' } } : { status: 200, data: { accessToken: token } });
    const tab = await loadTab();
    const pending = tab.refreshNow();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe(token);
    expect(calls).toBe(2);
    expect(tab.dispatched).not.toContain('auth/clearAccessToken');
  });

  it('only one tab exchanges at a time', async () => {
    mockRefresh(200, { accessToken: jwt(900) });
    const tabA = await loadTab();
    const tabB = await loadTab();
    const [a, b] = await Promise.all([tabA.refreshNow(), tabB.refreshNow()]);
    expect(refreshCalls()).toBe(1);
    expect(a).toBe(b);
    expect(tabB.store.getState().auth.accessToken).toBe(a);
  });

  it('concurrent calls in one tab share one exchange', async () => {
    mockRefresh(200, { accessToken: jwt(900) });
    const tab = await loadTab();
    await Promise.all([tab.refreshNow(), tab.refreshNow(), tab.communityAuthClient.getAccessToken()]);
    expect(refreshCalls()).toBe(1);
  });

  it('schedules the next refresh at exp minus the margin', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
    const first = jwt(900);
    const { computeRefreshDelayMs } = await import('@/server/auth/jwtClaims');
    const delay = computeRefreshDelayMs(first, Date.now())!;
    expect(delay).toBe((900 - 90) * 1000);
    let calls = 0;
    replyFor = () => ({ status: 200, data: { accessToken: calls++ === 0 ? first : jwt(900, 'next') } });
    const tab = await loadTab();
    await tab.refreshNow();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
  });

  it('a transient failure never signs out', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const tab = await loadTab();
    // 20 s left, under the 30 s margin: a refresh is due.
    const held = jwt(20);
    tab.adoptToken(held);
    mockRefreshNetworkError();
    await expect(tab.refreshNow()).resolves.toBe(held);
    for (const status of [429, 500, 503, 403]) {
      mockRefresh(status);
      await expect(tab.refreshNow()).resolves.toBe(held);
    }
    expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
    expect(tab.dispatched).not.toContain('auth/clearAccessToken');
    expect(tab.store.getState().auth.accessToken).toBe(held);
    // …and it tries again 15 s later.
    const before = refreshCalls();
    mockRefresh(200, { accessToken: jwt(900, 'back') });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshCalls()).toBe(before + 1);
  });

  it('a transient failure at boot shows a retryable error, never a signed-out session', async () => {
    mockRefreshNetworkError();
    const tab = await loadTab();
    const { result } = renderHook(() => tab.communityAuthClient.useAuthState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
    mockRefresh(200, { accessToken: jwt(900) });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('a lock that is never granted is transient', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      writable: true,
      value: {
        request: (_n: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      },
    });
    const tab = await loadTab();
    const held = jwt(20);
    tab.adoptToken(held);
    const pending = tab.refreshNow();
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toBe(held);
    expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
  });

  it('never writes a token to web storage', async () => {
    const token = jwt(900);
    mockRefresh(200, { accessToken: token });
    const tab = await loadTab();
    await bootState(tab);
    await tab.signInWithPassword('a@b.c', 'x'.repeat(12));
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(token);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('sends credentials on every /auth call', async () => {
    mockRefresh(200, { accessToken: jwt(900) });
    const tab = await loadTab();
    await tab.signInWithPassword('a@b.c', 'x'.repeat(12));
    expect(lastRequest().url).toBe('https://api.example.test/auth/login');
    expect(lastRequest().withCredentials).toBe(true);
    await tab.refreshNow();
    await tab.communityAuthClient.signOut().catch(() => undefined);
    expect(sent.every((c) => c.withCredentials === true)).toBe(true);
  });

  it('a sign-in is broadcast to the other tabs, which adopt the token', async () => {
    const token = jwt(900, 'login');
    replyFor = (config) =>
      config.url?.endsWith('/auth/login') ? { status: 200, data: { accessToken: token } } : { status: 401, data: { code: 'REFRESH_INVALID' } };
    const tabA = await loadTab();
    const tabB = await loadTab();
    // Tab B is open on the sign-in page: its boot found no session.
    expect(await bootState(tabB)).toMatchObject({ isAuthenticated: false });
    await tabA.signInWithPassword('a@b.c', 'x'.repeat(12));
    expect(tabB.store.getState().auth.accessToken).toBe(token);
    await expect(tabB.communityAuthClient.getAccessToken()).resolves.toBe(token);
    expect(refreshCalls()).toBe(1);
  });

  it('a malformed broadcast token is ignored', async () => {
    const tab = await loadTab();
    tab.communityAuthClient.forgetSession?.();
    peerBroadcasts({ type: 'token', accessToken: 'not-a-jwt', expiresIn: 900, sentAt: Date.now() });
    // exp − iat < 0: no lifetime.
    peerBroadcasts({ type: 'token', accessToken: jwt(-10), expiresIn: 900, sentAt: Date.now() });
    peerBroadcasts({ type: 'token', accessToken: 42, expiresIn: 900, sentAt: Date.now() });
    peerBroadcasts('token');
    expect(tab.store.getState().auth.accessToken).toBeNull();
  });

  it('forgetSession drops the token and tells the other tabs', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();
    // The same user in both tabs (a broadcast of another user reloads the tab instead).
    tabB.adoptToken(jwtAt(Date.now() - 5_000, 900, 'a'), 600);
    tabA.adoptToken(jwt(900, 'a'));
    expect(tabB.store.getState().auth.accessToken).toBe(jwt(900, 'a'));
    tabA.communityAuthClient.forgetSession?.();
    expect(tabA.store.getState().auth.accessToken).toBeNull();
    expect(tabB.store.getState().auth.accessToken).toBeNull();
    expect(tabB.tokenManager.markSessionBroken).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it('registers its token source with the token manager at boot', async () => {
    mockRefresh(200, { accessToken: jwt(900) });
    const tab = await loadTab();
    await bootState(tab);
    expect(tab.tokenManager.registerTokenProvider).toHaveBeenCalledTimes(1);
    expect(tab.tokenManager.registerForceSignIn).toHaveBeenCalledTimes(1);
    const provider = vi.mocked(tab.tokenManager.registerTokenProvider).mock.calls[0][0];
    await expect(provider()).resolves.toBe(tab.store.getState().auth.accessToken);
  });

  // ── security checks ───────────────────────────────────────────────────
  describe('a browser clock that is wrong', () => {
    for (const [label, skewMs] of [['20 min ahead', 20 * 60_000], ['20 min behind', -20 * 60_000]] as const) {
      it(`${label}: one refresh, the next at lifetime minus the margin, not a loop`, async () => {
        vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
        let calls = 0;
        // The server's clock is the browser's minus the skew.
        replyFor = () => ({ status: 200, data: { accessToken: jwtAt(Date.now() - skewMs, 900, String(calls++)), expiresIn: 900 } });
        const tab = await loadTab();
        await tab.refreshNow();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(810_000 - 60_000 - 1);
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toBe(2);
        expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
      });
    }

    it('tokens that are stale on arrival are refreshed at most 3 times a minute', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake] });
      let calls = 0;
      // A 20 s lifetime is under the 30 s margin: every answer is due again at once.
      replyFor = () => ({ status: 200, data: { accessToken: jwt(20, String(calls++)), expiresIn: 20 } });
      const tab = await loadTab();
      await tab.refreshNow();
      await vi.advanceTimersByTimeAsync(59_000);
      expect(calls).toBe(3);
      expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
      expect(tab.store.getState().auth.accessToken).not.toBeNull();
    });
  });

  describe('a sign-out while a refresh is in flight', () => {
    function holdRefresh() {
      const state: { answer: ((r: Reply) => void) | null } = { answer: null };
      replyFor = (config) =>
        config.url?.endsWith('/auth/refresh')
          ? new Promise<Reply>((resolve) => {
              state.answer = resolve;
            })
          : { status: 204 };
      return state;
    }

    it('from another tab: the answer is discarded in both tabs, nothing is broadcast', async () => {
      const held = holdRefresh();
      const tabA = await loadTab();
      const tabB = await loadTab();
      tabA.communityAuthClient.forgetSession?.();
      tabB.adoptToken(jwt(20, 'x'));
      expect(tabA.store.getState().auth.accessToken).toBe(jwt(20, 'x'));
      posted.length = 0;
      const pending = tabB.refreshNow();
      await vi.waitFor(() => expect(held.answer).not.toBeNull());
      const signingOut = tabA.communityAuthClient.signOut();
      held.answer!({ status: 200, data: { accessToken: jwt(900, 'x') } });
      await pending;
      await signingOut;
      expect(tabA.store.getState().auth.accessToken).toBeNull();
      expect(tabB.store.getState().auth.accessToken).toBeNull();
      expect(posted.filter((m) => (m as { type?: string }).type === 'token')).toHaveLength(0);
      // The logout ran under the lock: after the rotation, with the rotated cookie.
      const urls = sent.map((c) => c.url);
      expect(urls.indexOf('https://api.example.test/auth/logout')).toBeGreaterThan(urls.indexOf('https://api.example.test/auth/refresh'));
    });

    it('in the same tab: the answer is discarded, nothing is broadcast', async () => {
      const held = holdRefresh();
      const tab = await loadTab();
      tab.adoptToken(jwt(20, 'x'));
      posted.length = 0;
      const pending = tab.refreshNow();
      await vi.waitFor(() => expect(held.answer).not.toBeNull());
      const signingOut = tab.communityAuthClient.signOut();
      held.answer!({ status: 200, data: { accessToken: jwt(900, 'x') } });
      await expect(pending).resolves.toBeNull();
      await signingOut;
      expect(tab.store.getState().auth.accessToken).toBeNull();
      expect(posted).toEqual([{ type: 'signed-out' }]);
      const { result } = renderHook(() => tab.communityAuthClient.useAuthState());
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('a minimum validity', () => {
    it('a token valid less long than asked is refreshed, concurrent callers share one exchange', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake] });
      const tab = await loadTab();
      const held = jwt(900, 'h');
      tab.adoptToken(held);
      await vi.advanceTimersByTimeAsync(400_000);
      const next = jwt(900, 'n');
      mockRefresh(200, { accessToken: next, expiresIn: 900 });
      const provider = vi.mocked(tab.tokenManager.registerTokenProvider).mock.calls[0][0];
      await expect(provider(undefined, 300)).resolves.toBe(held);
      expect(refreshCalls()).toBe(0);
      const [a, b] = await Promise.all([tab.refreshNow(), tab.refreshNow(600)]);
      expect(refreshCalls()).toBe(1);
      expect(a).toBe(next);
      expect(b).toBe(next);
    });

    it('getAccessToken through the token manager honours the minimum', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake] });
      const tab = await loadTab();
      tab.adoptToken(jwt(900, 'h'));
      await vi.advanceTimersByTimeAsync(400_000);
      const next = jwt(900, 'n');
      mockRefresh(200, { accessToken: next, expiresIn: 900 });
      const provider = vi.mocked(tab.tokenManager.registerTokenProvider).mock.calls[0][0];
      await expect(provider(undefined, 600)).resolves.toBe(next);
      expect(refreshCalls()).toBe(1);
    });
  });

  describe('a broadcast token of another user', () => {
    it('reloads the page instead of holding it', async () => {
      const tab = await loadTab();
      tab.adoptToken(jwt(900, 'b'));
      peerBroadcasts({ type: 'token', accessToken: jwt(900, 'c'), expiresIn: 900, sentAt: Date.now() });
      expect(tab.nav.reload).toHaveBeenCalledTimes(1);
      expect(tab.store.getState().auth.accessToken).toBe(jwt(900, 'b'));
    });

    it('a tab holding no token adopts it', async () => {
      const tab = await loadTab();
      tab.communityAuthClient.forgetSession?.();
      peerBroadcasts({ type: 'token', accessToken: jwt(900, 'c'), expiresIn: 900, sentAt: Date.now() });
      expect(tab.nav.reload).not.toHaveBeenCalled();
      expect(tab.store.getState().auth.accessToken).toBe(jwt(900, 'c'));
    });
  });

  describe('signOut', () => {
    it('a logout that succeeded goes to /login', async () => {
      replyFor = () => ({ status: 204 });
      const tabA = await loadTab();
      const tabB = await loadTab();
      tabB.communityAuthClient.forgetSession?.();
      tabA.adoptToken(jwt(900));
      await tabA.communityAuthClient.signOut();
      expect(tabA.nav.assign).toHaveBeenCalledWith('/login');
      expect(tabA.store.getState().auth.accessToken).toBeNull();
      expect(tabB.store.getState().auth.accessToken).toBeNull();
    });

    it('a logout that failed still drops the session and says so on /login', async () => {
      replyFor = () => 'network';
      const tabA = await loadTab();
      const tabB = await loadTab();
      tabB.communityAuthClient.forgetSession?.();
      tabA.adoptToken(jwt(900));
      await tabA.communityAuthClient.signOut();
      expect(tabA.nav.assign).toHaveBeenCalledWith('/login?signout=incomplete');
      expect(tabA.store.getState().auth.accessToken).toBeNull();
      expect(tabB.store.getState().auth.accessToken).toBeNull();
      expect(posted).toContainEqual({ type: 'signed-out' });
    });
  });

  describe('signIn returnTo', () => {
    const refused = [
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '/ /evil.com',
      '/\u007f/evil.com',
      '%2F%2Fevil.com',
      '/%2F%2Fevil.com',
      '/%2f%2fevil.com',
      '/%5C%5Cevil.com',
      'javascript:alert(1)',
      'https://evil.com',
      '',
    ];
    for (const returnTo of refused) {
      it(`refuses ${JSON.stringify(returnTo)}`, async () => {
        const tab = await loadTab();
        await tab.communityAuthClient.signIn(returnTo);
        expect(tab.nav.assign).toHaveBeenCalledWith('/login');
      });
    }

    it('keeps a path of the app', async () => {
      const tab = await loadTab();
      await tab.communityAuthClient.signIn('/project/abc?x=1#y');
      expect(tab.nav.assign).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent('/project/abc?x=1#y')}`);
    });
  });

  it('changePassword refreshes an expired held token before the request', async () => {
    const next = jwt(900, 'n');
    replyFor = (config) =>
      config.url?.endsWith('/auth/refresh')
        ? { status: 200, data: { accessToken: next, expiresIn: 900 } }
        : { status: 200, data: { accessToken: jwt(900, 'p'), tokenType: 'Bearer', expiresIn: 900 } };
    const tab = await loadTab();
    tab.adoptToken(jwt(20));
    const { changePassword } = await import('./authApi');
    await changePassword('old-password-1', 'new-password-12');
    const urls = sent.map((c) => c.url);
    expect(urls).toEqual(['https://api.example.test/auth/refresh', 'https://api.example.test/auth/password/change']);
    expect(sent[1].headers.Authorization).toBe(`Bearer ${next}`);
  });

  // ── clock jumps ───────────────────────────────────────────────────────
  describe('a sleep or a wall-clock jump (performance.now paused)', () => {
    function setVisibility(state: DocumentVisibilityState) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    }

    afterEach(() => {
      delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    });

    it('3 h of wall time with the monotonic clock still: the next getAccessToken refreshes', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
      const tab = await loadTab();
      tab.adoptToken(jwt(900, 'h'), 900);
      vi.setSystemTime(Date.now() + 3 * 3600_000);
      const next = jwt(900, 'n');
      mockRefresh(200, { accessToken: next, expiresIn: 900 });
      await expect(tab.communityAuthClient.getAccessToken()).resolves.toBe(next);
      expect(refreshCalls()).toBe(1);
    });

    it('a wall clock set back falls back on the monotonic clock: no refresh', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
      const tab = await loadTab();
      const held = jwt(900, 'h');
      tab.adoptToken(held, 900);
      vi.setSystemTime(Date.now() - 3 * 3600_000);
      await expect(tab.communityAuthClient.getAccessToken()).resolves.toBe(held);
      expect(refreshCalls()).toBe(0);
    });

    for (const [label, fire] of [
      ['visibilitychange to visible', () => document.dispatchEvent(new Event('visibilitychange'))],
      ['pageshow', () => window.dispatchEvent(new Event('pageshow'))],
      ['online', () => window.dispatchEvent(new Event('online'))],
    ] as const) {
      it(`${label} after such a jump refreshes`, async () => {
        vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
        setVisibility('visible');
        const tab = await loadTab();
        tab.adoptToken(jwt(900, 'h'), 900);
        vi.setSystemTime(Date.now() + 3 * 3600_000);
        mockRefresh(200, { accessToken: jwt(900, 'n'), expiresIn: 900 });
        fire();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshCalls()).toBe(1);
      });
    }

    it('a visibilitychange to hidden does nothing', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
      setVisibility('hidden');
      const tab = await loadTab();
      tab.adoptToken(jwt(900, 'h'), 900);
      vi.setSystemTime(Date.now() + 3 * 3600_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshCalls()).toBe(0);
    });

    it('installs no listener before the client is used (the cloud never starts it)', async () => {
      const onDocument = vi.spyOn(document, 'addEventListener');
      const onWindow = vi.spyOn(window, 'addEventListener');
      const tab = await loadTab();
      const names = () => [...onDocument.mock.calls, ...onWindow.mock.calls].map(([name]) => name);
      expect(names()).not.toContain('visibilitychange');
      expect(names()).not.toContain('pageshow');
      expect(names()).not.toContain('online');
      tab.communityAuthClient.forgetSession?.();
      expect(names()).toEqual(expect.arrayContaining(['visibilitychange', 'pageshow', 'online']));
    });
  });

  describe('a 401 on a token held as fresh', () => {
    it('the refused token is exchanged once, not handed back', async () => {
      const tab = await loadTab();
      const held = jwt(900, 'h');
      tab.adoptToken(held, 900);
      const next = jwt(900, 'n');
      mockRefresh(200, { accessToken: next, expiresIn: 900 });
      const provider = vi.mocked(tab.tokenManager.registerTokenProvider).mock.calls[0][0];
      await expect(provider(undefined, undefined, { refusedToken: held })).resolves.toBe(next);
      expect(refreshCalls()).toBe(1);
      // A token other than the held one was refused: the held one is answered from memory.
      await expect(provider(undefined, undefined, { refusedToken: 'other' })).resolves.toBe(next);
      expect(refreshCalls()).toBe(1);
    });

    it('the burst cap bounds a 401 loop', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake] });
      const tab = await loadTab();
      tab.adoptToken(jwt(900, 'h'), 900);
      let calls = 0;
      replyFor = () => ({ status: 200, data: { accessToken: jwt(900, `n${calls++}`), expiresIn: 900 } });
      const provider = vi.mocked(tab.tokenManager.registerTokenProvider).mock.calls[0][0];
      for (let i = 0; i < 6; i += 1) {
        await provider(undefined, undefined, { refusedToken: tab.store.getState().auth.accessToken ?? '' });
      }
      expect(calls).toBe(3);
      expect(tab.tokenManager.markSessionBroken).not.toHaveBeenCalled();
    });
  });

  describe('a late or stale broadcast', () => {
    it('a token that expired before it was delivered is ignored', async () => {
      const tab = await loadTab();
      tab.communityAuthClient.forgetSession?.();
      const now = Date.now();
      // iat = now − 1000 s, exp = now − 100 s, sent when it was obtained.
      peerBroadcasts({ type: 'token', accessToken: jwtAt(now - 1000_000, 900, 'c'), expiresIn: 900, sentAt: now - 1000_000 });
      expect(tab.store.getState().auth.accessToken).toBeNull();
    });

    it('a message sent 1 h ago with expiresIn 880 is ignored', async () => {
      const tab = await loadTab();
      tab.communityAuthClient.forgetSession?.();
      peerBroadcasts({ type: 'token', accessToken: jwt(900, 'c'), expiresIn: 880, sentAt: Date.now() - 3600_000 });
      expect(tab.store.getState().auth.accessToken).toBeNull();
    });

    it('a message without a usable sentAt is ignored', async () => {
      const tab = await loadTab();
      tab.communityAuthClient.forgetSession?.();
      for (const sentAt of [undefined, 'now', Number.NaN, Date.now() + 60_000]) {
        peerBroadcasts({ type: 'token', accessToken: jwt(900, 'c'), expiresIn: 900, sentAt });
      }
      expect(tab.store.getState().auth.accessToken).toBeNull();
    });

    it('the time already spent is taken off, and exp − iat caps expiresIn', async () => {
      vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
      const tab = await loadTab();
      tab.communityAuthClient.forgetSession?.();
      const token = jwt(900, 'c');
      // Sent 800 s ago, claiming far more than the token's own 900 s: 100 s are left, under the 90 s margin + 10 s.
      peerBroadcasts({ type: 'token', accessToken: token, expiresIn: 5000, sentAt: Date.now() - 800_000 });
      expect(tab.store.getState().auth.accessToken).toBe(token);
      mockRefresh(200, { accessToken: jwt(900, 'n'), expiresIn: 900 });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(refreshCalls()).toBe(1);
    });

    it('a peer token with less time left does not replace the held one; one with more does', async () => {
      const tab = await loadTab();
      const held = jwt(900, 'h');
      tab.adoptToken(held, 600);
      peerBroadcasts({ type: 'token', accessToken: jwtAt(Date.now() - 1000, 900, 'h'), expiresIn: 300, sentAt: Date.now() });
      expect(tab.store.getState().auth.accessToken).toBe(held);
      const fresher = jwtAt(Date.now() - 2000, 900, 'h');
      peerBroadcasts({ type: 'token', accessToken: fresher, expiresIn: 890, sentAt: Date.now() });
      expect(tab.store.getState().auth.accessToken).toBe(fresher);
    });

    it('every token message carries sentAt', async () => {
      const tab = await loadTab();
      const before = Date.now();
      tab.adoptToken(jwt(900), 900);
      const message = posted.find((m) => (m as { type?: string }).type === 'token') as { sentAt?: number; expiresIn?: number };
      expect(message.sentAt).toBeGreaterThanOrEqual(before);
      expect(message.sentAt).toBeLessThanOrEqual(Date.now());
      expect(message.expiresIn).toBeGreaterThan(899);
    });
  });

  it('the burst window also expires on the wall clock: after a sleep the first due refresh exchanges', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake], now: new Date('2026-11-03T10:00:00.000Z') });
    let calls = 0;
    replyFor = () => ({ status: 200, data: { accessToken: jwt(900, `n${calls++}`), expiresIn: 900 } });
    const tab = await loadTab();
    tab.adoptToken(jwt(900, 'h'), 900);
    const provider = vi.mocked(tab.tokenManager.registerTokenProvider).mock.calls[0][0];
    for (let i = 0; i < 3; i += 1) {
      await provider(undefined, undefined, { refusedToken: tab.store.getState().auth.accessToken ?? '' });
    }
    expect(calls).toBe(3);
    // The lid closes: 3 h of wall time, the monotonic clock paused.
    vi.setSystemTime(Date.now() + 3 * 3600_000);
    await tab.communityAuthClient.getAccessToken();
    expect(calls).toBe(4);
  });
});
