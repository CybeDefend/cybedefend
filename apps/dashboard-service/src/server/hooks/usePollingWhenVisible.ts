import { useCallback, useEffect, useRef } from 'react';

/** True while the page is in a background tab (or a minimised window). */
export const isTabHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

/**
 * Wraps the tick of an existing `setInterval` so it does nothing while the tab
 * is hidden: the interval keeps running. Pair it with `useCatchUpWhenVisible`
 * so the read happens as soon as the tab is shown again, not at the next tick.
 * For pollers whose timer is managed by hand (the results pages' scan
 * fallback); a new poller should use `usePollingWhenVisible`, which does both.
 */
export function skipWhenHidden(tick: () => unknown): () => void {
  return () => {
    if (isTabHidden()) return;
    void tick();
  };
}

export interface PollingWhenVisibleOptions {
  /** `false` stops the poll: no timer, no listener. Defaults to `true`. */
  enabled?: boolean;
  /**
   * Call back as soon as the poll starts (or restarts on `key`). Defaults to
   * `false`: the caller has just loaded on its own, which counts as the first call.
   */
  immediate?: boolean;
  /** A new value restarts the poll, as a new page of a list does. */
  key?: string;
}

/**
 * Calls `callback` every `intervalMs`, only while the tab is visible
 * (no polling in a hidden tab).
 *
 * - A hidden tab runs no timer at all.
 * - When the tab is shown again and a call is overdue, it runs at once, then
 *   every `intervalMs` from there; when the last call is recent, the next one
 *   waits for its turn. Switching tabs back and forth therefore never calls
 *   more than once per interval.
 * - The latest `callback` is the one called; a new identity never resets the
 *   timer. Errors are the callback's own business: catch them inside it.
 */
export function usePollingWhenVisible(
  callback: () => unknown,
  intervalMs: number,
  { enabled = true, immediate = false, key = '' }: PollingWhenVisibleOptions = {},
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastCallAt = immediate ? Number.NEGATIVE_INFINITY : Date.now();

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const schedule = () => {
      clear();
      if (isTabHidden()) return;
      const wait = lastCallAt + intervalMs - Date.now();
      if (wait > 0) {
        timer = setTimeout(tick, wait);
        return;
      }
      tick();
    };
    function tick() {
      timer = null;
      if (isTabHidden()) return;
      lastCallAt = Date.now();
      try {
        void callbackRef.current();
      } finally {
        // A callback that throws must not end the poll.
        schedule();
      }
    }
    const onVisibilityChange = () => (isTabHidden() ? clear() : schedule());

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, immediate, intervalMs, key]);
}

export default usePollingWhenVisible;

/**
 * Catch-up half of `skipWhenHidden`: when the tab is shown again and the last
 * read is at least `intervalMs` old, read at once instead of waiting for the
 * next tick of a hand-managed interval. A quick switch away and back, with a
 * recent read, reads nothing.
 *
 * Returns `noteCall`: call it at every read the poller makes on its own
 * (first fetch, interval tick, realtime refetch), so "the last read" is known.
 * The catch-up read counts as one too.
 */
export function useCatchUpWhenVisible(
  fetch: () => unknown,
  enabled: boolean,
  intervalMs: number,
): () => void {
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const lastCallAtRef = useRef(Number.NEGATIVE_INFINITY);

  const noteCall = useCallback(() => {
    lastCallAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisibilityChange = () => {
      if (isTabHidden()) return;
      if (Date.now() - lastCallAtRef.current < intervalMs) return;
      lastCallAtRef.current = Date.now();
      void fetchRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, intervalMs]);

  return noteCall;
}
