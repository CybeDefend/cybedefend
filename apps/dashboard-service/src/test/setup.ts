import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { resetSharedStores } from '@/server/hooks/sharedStoreRegistry';

// The dashboard's shared reads (rows, live sessions, overview, proposals, newest
// events, the rate gate) live at module level: every test starts from none.
afterEach(() => resetSharedStores());

// Node 25 and later define `localStorage` and `sessionStorage` on the global
// object themselves (`localStorage` is undefined without --localstorage-file),
// and the jsdom environment does not replace a global that already exists. The
// tests would then run against Node's storages, or none, instead of the
// browser's: a spy on `Storage.prototype` would see nothing. Put the jsdom
// window's own storages back, on every Node version.
const installJsdomStorages = (): boolean => {
  const jsdomWindow = (globalThis as { jsdom?: { window?: Record<string, unknown> } }).jsdom
    ?.window;
  if (!jsdomWindow) return false;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    let storage = jsdomWindow[name];
    if (!storage || globalThis[name] === storage) continue;
    // A getter and a setter, as the environment defines the globals it copies.
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      get: () => storage,
      set: (value: unknown) => {
        storage = value;
      },
    });
  }
  return true;
};

// Some tests import modules (e.g. i18n/index.ts) that read from localStorage
// at module-evaluation time. Without a jsdom window to take it from, we
// guarantee a minimal shim here.
const installLocalStorageShim = () => {
  const mem = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k: string) => void mem.delete(k),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: shim,
    });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        writable: true,
        value: shim,
      });
    }
  } catch {
    // ignore if Object.defineProperty is rejected
  }
};

installJsdomStorages();
if (
  typeof globalThis.localStorage === 'undefined' ||
  typeof (globalThis as any).localStorage?.getItem !== 'function'
) {
  installLocalStorageShim();
}

// jsdom does not implement IntersectionObserver. ChatSidebar's infinite scroll
// uses it to detect when the bottom sentinel becomes visible; tests just need
// a no-op constructor — they trigger the load explicitly.
if (typeof (globalThis as any).IntersectionObserver === 'undefined') {
  class IntersectionObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root: Element | null = null;
    rootMargin = '';
    thresholds: ReadonlyArray<number> = [];
  }
  (globalThis as any).IntersectionObserver = IntersectionObserverMock;
}


/**
 * jsdom ships no ResizeObserver. Components that measure their own container
 * construct one, so without this they throw on mount — and, worse, a component
 * whose measuring effect never ran would pass its tests while being broken in
 * the browser.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// The closed tree's own test setup (`src/ee/<area>/test-setup.ts`), loaded by
// a glob, not an import: a tree without `src/ee` (the Community Edition's
// export) matches nothing and loads nothing.
import.meta.glob('../ee/**/test-setup.ts', { eager: true });
