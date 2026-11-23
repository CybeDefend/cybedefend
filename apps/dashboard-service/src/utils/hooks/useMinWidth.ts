import { useCallback, useSyncExternalStore } from 'react';

const mediaQueryList = (query: string): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

/**
 * True while the viewport is at least `px` wide (`(min-width: Npx)`). Follows
 * resizes and rotation. Where the browser has no `matchMedia` (jsdom, SSR) it
 * reads false: the narrow view is the default, and the wide one is opted into
 * by a real browser only.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaQueryList(query);
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => mediaQueryList(query)?.matches ?? false, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
