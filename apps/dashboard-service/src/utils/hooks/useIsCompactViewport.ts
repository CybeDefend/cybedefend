import { useSyncExternalStore } from 'react';

// Below Tailwind's `md` (768px, see tailwind.config.js): phones, and tablets
// held upright. Floating, JS-positioned UI (the tour bubble, centred dialogs)
// has no room to sit beside its target at these widths.
const COMPACT_QUERY = '(max-width: 767px)';

const getMediaQueryList = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_QUERY)
    : null;

const subscribe = (onChange: () => void) => {
  const mql = getMediaQueryList();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

const getSnapshot = () => getMediaQueryList()?.matches ?? false;

/**
 * True on a phone-sized viewport. Follows rotation and resizes. Environments
 * without `matchMedia` (jsdom, SSR) read as wide, so existing layouts are the
 * default and the compact one is strictly opt-in by the browser.
 */
export const useIsCompactViewport = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);
