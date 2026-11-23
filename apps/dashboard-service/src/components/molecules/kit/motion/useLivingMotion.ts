import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { usePrefersReducedMotion } from '@/utils/hooks/usePrefersReducedMotion';

/** Where the viewer's Calm choice is kept, per browser. */
export const MOTION_STORAGE_KEY = 'vibedefend.motion';
const CALM = 'calm';

/**
 * The choice when storage refused to keep it (private window, blocked site
 * data, quota): it then lives for this visit only. `null` while storage works.
 */
let unsaved: boolean | null = null;
const listeners = new Set<() => void>();

const readPersisted = (): boolean => {
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(MOTION_STORAGE_KEY) === CALM;
  } catch {
    return false;
  }
};

const notify = () => listeners.forEach((listener) => listener());

const onStorage = (event: StorageEvent) => {
  // `key` is null when another tab cleared the whole storage.
  if (event.key === null || event.key === MOTION_STORAGE_KEY) notify();
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
};

const persist = (calm: boolean) => {
  try {
    if (calm) window.localStorage.setItem(MOTION_STORAGE_KEY, CALM);
    else window.localStorage.removeItem(MOTION_STORAGE_KEY);
    unsaved = null;
  } catch {
    unsaved = calm;
  }
  notify();
};

export interface LivingMotion {
  /** True when every continuous animation must become a static encoding (dashes, rings). */
  calm: boolean;
  /** The viewer's Calm choice, remembered in this browser. Reduced motion stays calm whatever it is. */
  setCalm: (calm: boolean) => void;
  /** True when the calm comes from the system, which the viewer cannot override here. */
  reducedMotion: boolean;
}

/**
 * Whether a zinc-kit space may move: not when the system asks for reduced
 * motion, nor when the viewer chose Calm (`localStorage['vibedefend.motion']`).
 *
 * It also writes `data-calm` on `<html>`, which `index.css` reads to stop the
 * CSS-only animations (`motion-safe:animate-breathe`) that no component can
 * reach once rendered. Every consumer shares one store, so a toggle in one
 * place calms every dot, strip and canvas at once, in this tab and the others.
 */
export function useLivingMotion(): LivingMotion {
  const reducedMotion = usePrefersReducedMotion();
  const persisted = useSyncExternalStore(subscribe, readPersisted, () => false);
  const calm = reducedMotion || persisted;

  useEffect(() => {
    document.documentElement.setAttribute('data-calm', calm ? 'true' : 'false');
  }, [calm]);

  const setCalm = useCallback((next: boolean) => persist(next), []);

  return { calm, setCalm, reducedMotion };
}

export default useLivingMotion;
