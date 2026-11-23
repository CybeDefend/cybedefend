import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * The theme as the document shows it: the `dark` class of `<html>`.
 *
 * `useTheme` keeps its own copy of the theme in each component that calls it,
 * so two switches on one screen (the rail footer and the account menu) drift
 * apart: after one of them changed the theme, the other one's first click
 * « switched » to the theme already shown. This hook has no copy. It reads the
 * class, hears every change of it (a `themeChange` event, or the class itself
 * moving), and writes exactly what `useTheme` writes, so the rest of the app
 * notices nothing.
 */
const EVENT = 'themeChange';

const isDark = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener(EVENT, onChange);
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(onChange)
      : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => {
    window.removeEventListener(EVENT, onChange);
    observer?.disconnect();
  };
};

export interface DocumentTheme {
  isDark: boolean;
  toggle: () => void;
}

export function useDocumentTheme(): DocumentTheme {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  const toggle = useCallback(() => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // Not remembered for the next visit; shown all the same.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { isDark: dark, toggle };
}

/**
 * Puts the remembered theme (`localStorage.theme`) on `<html>`.
 *
 * Nothing else does it at boot: in AppSec the rail calls `useTheme`, whose
 * mount effect applies it, but the closed product space has no rail, so without this a
 * viewer who chose dark landed on a light page. Returns the applied value;
 * when storage cannot be read the class is left as it is.
 */
export function applyStoredTheme(): boolean {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    return isDark();
  }
  const dark = saved === 'dark';
  if (dark !== isDark()) {
    document.documentElement.classList.toggle('dark', dark);
    window.dispatchEvent(new Event(EVENT));
  }
  return dark;
}

/** Applies the remembered theme once, before the first paint of the caller. */
export function useStoredTheme(): void {
  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);
}
