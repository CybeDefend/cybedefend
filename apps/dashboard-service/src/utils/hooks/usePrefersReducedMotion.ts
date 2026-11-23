import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const getMediaQueryList = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;

const subscribe = (onChange: () => void) => {
  const mql = getMediaQueryList();
  if (!mql) return () => {};
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  // Safari before 14 only knows the deprecated pair.
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
};

const getSnapshot = () => getMediaQueryList()?.matches ?? false;

/**
 * True when the system asks for reduced motion. Follows the setting live.
 * Environments without `matchMedia` (jsdom, SSR) read false, so motion stays
 * the default and is turned off by the browser, never by the environment.
 */
export const usePrefersReducedMotion = (): boolean => useSyncExternalStore(subscribe, getSnapshot, () => false);

export default usePrefersReducedMotion;
