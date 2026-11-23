import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePrefersReducedMotion } from './usePrefersReducedMotion';

type Listener = (event: { matches: boolean }) => void;

// jsdom ships no matchMedia: a controllable stand-in for the browser's MediaQueryList.
const installMatchMedia = (initial: boolean) => {
  let matches = initial;
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  window.matchMedia = vi.fn((query: string) => {
    queries.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    } as unknown as MediaQueryList;
  });
  return {
    queries,
    listenerCount: () => listeners.size,
    set: (next: boolean) => {
      matches = next;
      listeners.forEach((l) => l({ matches: next }));
    },
  };
};

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    // @ts-expect-error restore jsdom's default (no matchMedia)
    delete window.matchMedia;
  });

  it('reads false where the browser has no matchMedia (jsdom, SSR)', () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('reads true when the system asks for reduced motion', () => {
    const media = installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    expect(media.queries).toContain('(prefers-reduced-motion: reduce)');
  });

  it('follows the setting when it changes, and stops listening once unmounted', () => {
    const media = installMatchMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('copes with an old MediaQueryList that only knows addListener', () => {
    const listeners = new Set<Listener>();
    window.matchMedia = vi.fn(
      () =>
        ({
          matches: true,
          addListener: (l: Listener) => listeners.add(l),
          removeListener: (l: Listener) => listeners.delete(l),
        }) as unknown as MediaQueryList,
    );
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
