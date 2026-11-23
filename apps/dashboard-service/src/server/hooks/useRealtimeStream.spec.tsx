import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';

const { fetchEventSourceMock, getAccessTokenForFetchMock } = vi.hoisted(() => ({
  fetchEventSourceMock: vi.fn(),
  getAccessTokenForFetchMock: vi.fn(),
}));

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: fetchEventSourceMock,
}));

vi.mock('@/server/api/tokenManager', () => ({
  getAccessTokenForFetch: getAccessTokenForFetchMock,
}));

import { useRealtimeStream } from './useRealtimeStream';
import { __resetConnectionsForTests, CLOSE_GRACE_MS } from '../services/realtimeStream';

const lastCall = () => {
  const call = fetchEventSourceMock.mock.calls.at(-1);
  if (!call) throw new Error('fetchEventSource was not called');
  return { url: call[0] as string, options: call[1] as any };
};

const makeStore = (token: string | null = 'jwt') => configureStore({
  reducer: {
    auth: createSlice({
      name: 'auth',
      initialState: { accessToken: token },
      reducers: { set: (s, a: { payload: string | null }) => { s.accessToken = a.payload; } },
    }).reducer,
  },
});

const wrapper = (store: any) => ({ children }: { children: React.ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

beforeEach(() => {
  __resetConnectionsForTests();
  fetchEventSourceMock.mockReset();
  fetchEventSourceMock.mockImplementation(() => new Promise(() => {}));
  getAccessTokenForFetchMock.mockReset();
  getAccessTokenForFetchMock.mockResolvedValue(null);
});

describe('useRealtimeStream', () => {
  it('opens stream on mount with Authorization Bearer header from redux', () => {
    const store = makeStore('jwt-abc');
    renderHook(
      () => useRealtimeStream('https://api/v1/realtime/orgs/o/projects/stream', {}),
      { wrapper: wrapper(store) },
    );
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
    const { url, options } = lastCall();
    expect(url).toBe('https://api/v1/realtime/orgs/o/projects/stream');
    expect(options.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('does NOT open stream when url is null (page not active)', () => {
    const store = makeStore('jwt');
    renderHook(() => useRealtimeStream(null, {}), { wrapper: wrapper(store) });
    expect(fetchEventSourceMock).not.toHaveBeenCalled();
  });

  it('aborts the stream once the grace period after unmount has passed', () => {
    vi.useFakeTimers();
    try {
      const store = makeStore('jwt');
      const { unmount } = renderHook(
        () => useRealtimeStream('https://api/x', {}),
        { wrapper: wrapper(store) },
      );
      const { options } = lastCall();
      expect(options.signal.aborted).toBe(false);
      unmount();
      vi.advanceTimersByTime(CLOSE_GRACE_MS);
      expect(options.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT re-open a second connection when the JWT rotates in redux', () => {
    // Reproduces the duplicate-request bug: when the access token changed,
    // the effect re-ran and tore down the connection, while the server-driven
    // auth-refresh handler in openStream also reconnected — two requests for
    // the same renewal.
    const store = makeStore('jwt-A');
    renderHook(
      () => useRealtimeStream('https://api/x', {}),
      { wrapper: wrapper(store) },
    );
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);

    act(() => {
      store.dispatch({ type: 'auth/set', payload: 'jwt-B' });
    });

    // Rotation alone must not duplicate. The auth-refresh SSE event is the
    // single canonical reconnect trigger.
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
  });

  it('reconnect on auth-refresh uses the LATEST redux token (not the one captured on first render)', () => {
    const store = makeStore('jwt-A');
    renderHook(
      () => useRealtimeStream('https://api/x', {}),
      { wrapper: wrapper(store) },
    );
    const first = lastCall();
    expect(first.options.headers.Authorization).toBe('Bearer jwt-A');

    act(() => {
      store.dispatch({ type: 'auth/set', payload: 'jwt-B' });
    });

    // Server tells us to refresh — the next outbound request must pick up the
    // current redux value, not 'jwt-A' captured at first render.
    first.options.onmessage({ event: 'auth-refresh', id: '', data: '' });
    expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
    expect(lastCall().options.headers.Authorization).toBe('Bearer jwt-B');
  });

  it('aborts the connection when the user logs out (token cleared)', () => {
    const store = makeStore('jwt-A');
    renderHook(
      () => useRealtimeStream('https://api/x', {}),
      { wrapper: wrapper(store) },
    );
    const { options } = lastCall();
    expect(options.signal.aborted).toBe(false);

    act(() => {
      store.dispatch({ type: 'auth/set', payload: null });
    });

    expect(options.signal.aborted).toBe(true);
  });

  it('reconnects with a freshly minted JWT after the server closes the stream', async () => {
    // The gateway ends every SSE response when the JWT it was opened with
    // expires. The redux snapshot is stale at that exact moment (@logto/client
    // only rotates a token once it has fully expired), so the reconnect must
    // ask the token manager for a new one instead of replaying the dead token.
    vi.useFakeTimers();
    try {
      getAccessTokenForFetchMock.mockResolvedValue('jwt-fresh');
      const store = makeStore('jwt-expired');
      renderHook(
        () => useRealtimeStream('https://api/x', {}),
        { wrapper: wrapper(store) },
      );
      expect(lastCall().options.headers.Authorization).toBe('Bearer jwt-expired');

      lastCall().options.onclose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(getAccessTokenForFetchMock).toHaveBeenCalled();
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(lastCall().options.headers.Authorization).toBe('Bearer jwt-fresh');
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes typed event to current handler ref (uses latest closure)', () => {
    const store = makeStore('jwt');
    let count = 0;
    const Comp = () => {
      const onScan = vi.fn(() => count++);
      useRealtimeStream('https://api/x', { SCAN_STATUS_CHANGED: onScan });
      return null;
    };
    renderHook(() => Comp(), { wrapper: wrapper(store) });
    const { options } = lastCall();
    options.onmessage({
      event: '',
      id: '',
      data: JSON.stringify({ type: 'SCAN_STATUS_CHANGED', payload: {} }),
    });
    expect(count).toBe(1);
  });
});
