import { useEffect, useRef } from 'react';

const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Calls `tick` every `intervalMs` while the tab is visible, never while it is
 * hidden, and once at the moment it shows again (what changed meanwhile is
 * read at once), then every `intervalMs` from there. Always the latest
 * `tick`. A hidden tab is asked nothing: the 300 requests a minute of a user
 * are shared with their coding agents.
 */
export function useVisibleInterval(tick: () => void, intervalMs: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => latest.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (hidden()) {
        stop();
      } else if (timer === null) {
        latest.current();
        start();
      }
    };
    if (!hidden()) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
