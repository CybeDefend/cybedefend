import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  useThrottledRealtimeRefresh,
  IN_FLIGHT_MAX_WAIT_MS,
} from './useThrottledRealtimeRefresh';

describe('useThrottledRealtimeRefresh', () => {
  // Generic leading + trailing throttle used by every realtime hook that
  // listens to bursty SSE events (scan status, vuln batches, etc.). One
  // helper, one shape, one window — so a burst of 4 events on the issues
  // page is collapsed to at most 2 REST refetches per consumer hook (1
  // leading + 1 trailing) instead of 4.

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback immediately on the first call', () => {
    const cb = vi.fn();
    const { result } = renderHook(() =>
      useThrottledRealtimeRefresh(cb, 'p1'),
    );
    result.current();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('drops intermediate calls inside the window and fires one trailing call', () => {
    const cb = vi.fn();
    const { result } = renderHook(() =>
      useThrottledRealtimeRefresh(cb, 'p1'),
    );

    result.current();
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    result.current();
    result.current();
    result.current();
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('fires immediately again when a single call arrives more than the window after the last fire', () => {
    const cb = vi.fn();
    const { result } = renderHook(() =>
      useThrottledRealtimeRefresh(cb, 'p1'),
    );

    result.current();
    vi.advanceTimersByTime(6000);
    result.current();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not schedule a trailing call when no intermediate event arrives', () => {
    const cb = vi.fn();
    const { result } = renderHook(() =>
      useThrottledRealtimeRefresh(cb, 'p1'),
    );

    result.current();
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    // Single isolated event — no trailing call.
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback identity even when the trailing fire is scheduled', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useThrottledRealtimeRefresh(cb, 'p1'),
      { initialProps: { cb: cbA } },
    );

    result.current();
    vi.advanceTimersByTime(500);
    result.current(); // schedules trailing
    rerender({ cb: cbB }); // swap the callback identity

    vi.advanceTimersByTime(5000);
    // Trailing must invoke the latest registered callback, not the one
    // captured at scheduling time. Otherwise the page would silently
    // refetch through a stale closure after props change.
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending trailing call when resetKey changes', () => {
    const cb = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useThrottledRealtimeRefresh(cb, key),
      { initialProps: { key: 'p1' } },
    );

    result.current();
    vi.advanceTimersByTime(500);
    result.current(); // schedules trailing
    expect(cb).toHaveBeenCalledTimes(1);

    rerender({ key: 'p2' }); // resetKey change — must cancel pending trailing
    vi.advanceTimersByTime(10_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire a trailing callback after unmount', () => {
    const cb = vi.fn();
    const { result, unmount } = renderHook(() =>
      useThrottledRealtimeRefresh(cb, 'p1'),
    );

    result.current();
    vi.advanceTimersByTime(500);
    result.current();
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(10_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('supports a custom window via the third argument', () => {
    const cb = vi.fn();
    const { result } = renderHook(() =>
      useThrottledRealtimeRefresh(cb, 'p1', 2_000),
    );

    result.current();
    vi.advanceTimersByTime(500);
    result.current();
    vi.advanceTimersByTime(2_000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  // A window shorter than a slow request (GET /user/profile, the
  // org overview aggregate) let the trailing fire start a second request
  // while the first one was still running. With `waitForInFlight`, a fire
  // waits for the promise the previous one returned.
  describe('waitForInFlight', () => {
    /** A callback whose every call returns a promise the test settles. */
    const heldCallback = () => {
      const settlers: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
      const cb = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            settlers.push({ resolve, reject });
          }),
      );
      let running = 0;
      let maxRunning = 0;
      const tracked = vi.fn(() => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        return cb().finally(() => {
          running -= 1;
        });
      });
      return { tracked, settlers, maxRunning: () => maxRunning };
    };

    it('holds the trailing fire until the running call settles, then fires it once', async () => {
      const { tracked, settlers, maxRunning } = heldCallback();
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', 1_000, { waitForInFlight: true }),
      );

      result.current();
      result.current();
      result.current();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(tracked).toHaveBeenCalledTimes(1);

      settlers[0].resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(tracked).toHaveBeenCalledTimes(2);

      settlers[1].resolve();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(tracked).toHaveBeenCalledTimes(2);
      expect(maxRunning()).toBe(1);
    });

    it('still waits for the window when the call settled inside it', async () => {
      const { tracked, settlers } = heldCallback();
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', 1_000, { waitForInFlight: true }),
      );

      result.current();
      settlers[0].resolve();
      await vi.advanceTimersByTimeAsync(100);
      result.current();
      expect(tracked).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(900);
      expect(tracked).toHaveBeenCalledTimes(2);
    });

    it('is released by a call that fails', async () => {
      const { tracked, settlers } = heldCallback();
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', 1_000, { waitForInFlight: true }),
      );

      result.current();
      result.current();
      settlers[0].reject(new Error('boom'));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tracked).toHaveBeenCalledTimes(2);
    });

    it('does not fire for a new scope when the call of the old one settles', async () => {
      const { tracked, settlers } = heldCallback();
      const { result, rerender } = renderHook(
        ({ key }: { key: string }) =>
          useThrottledRealtimeRefresh(tracked, key, 1_000, { waitForInFlight: true }),
        { initialProps: { key: 'p1' } },
      );

      result.current();
      result.current();
      rerender({ key: 'p2' });
      settlers[0].resolve();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(tracked).toHaveBeenCalledTimes(1);
    });

    // gatewayAPI has no timeout, and a request held by a dead connection can
    // hang for minutes: an unbounded wait would swallow every
    // event until the scope changes.
    it('stops waiting for a call that never settles once the bound has passed', async () => {
      const { tracked } = heldCallback();
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', 1_000, { waitForInFlight: true }),
      );

      result.current();
      result.current();
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_MAX_WAIT_MS - 1);
      expect(tracked).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(tracked).toHaveBeenCalledTimes(2);
    });

    it('bounds the wait by the window when the window is longer', async () => {
      const { tracked } = heldCallback();
      const window = IN_FLIGHT_MAX_WAIT_MS * 2;
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', window, { waitForInFlight: true }),
      );

      result.current();
      result.current();
      await vi.advanceTimersByTimeAsync(window - 1);
      expect(tracked).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(tracked).toHaveBeenCalledTimes(2);
    });

    it('lets the late settlement of an abandoned call release nothing', async () => {
      const { tracked, settlers } = heldCallback();
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', 1_000, { waitForInFlight: true }),
      );

      result.current();
      result.current();
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_MAX_WAIT_MS);
      expect(tracked).toHaveBeenCalledTimes(2);

      // The first call finally answers while the second one still runs.
      result.current();
      settlers[0].resolve();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(tracked).toHaveBeenCalledTimes(2);

      settlers[1].resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(tracked).toHaveBeenCalledTimes(3);
    });

    it('drops the bound of the old scope', async () => {
      const { tracked } = heldCallback();
      const { result, rerender } = renderHook(
        ({ key }: { key: string }) =>
          useThrottledRealtimeRefresh(tracked, key, 1_000, { waitForInFlight: true }),
        { initialProps: { key: 'p1' } },
      );

      result.current();
      result.current();
      rerender({ key: 'p2' });
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_MAX_WAIT_MS * 2);
      expect(tracked).toHaveBeenCalledTimes(1);
    });

    it('does not wait for a promise unless asked to', async () => {
      const { tracked } = heldCallback();
      const { result } = renderHook(() =>
        useThrottledRealtimeRefresh(tracked, 'p1', 1_000),
      );

      result.current();
      result.current();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tracked).toHaveBeenCalledTimes(2);
    });
  });
});
