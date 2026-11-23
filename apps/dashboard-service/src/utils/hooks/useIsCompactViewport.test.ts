import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsCompactViewport } from './useIsCompactViewport';

type Listener = (event: { matches: boolean }) => void;

// A controllable stand-in for the browser's MediaQueryList: jsdom ships no
// matchMedia at all, so there is no real implementation to exercise here.
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

describe('useIsCompactViewport', () => {
  afterEach(() => {
    // @ts-expect-error restore jsdom's default (no matchMedia)
    delete window.matchMedia;
  });

  it('reports a wide viewport when the browser has no matchMedia', () => {
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(false);
  });

  it('reports a compact viewport below the md breakpoint', () => {
    const media = installMatchMedia(true);
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(true);
    expect(media.queries).toContain('(max-width: 767px)');
  });

  it('follows the viewport when it crosses the breakpoint (rotation, resize)', () => {
    const media = installMatchMedia(true);
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(true);

    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const media = installMatchMedia(true);
    const { unmount } = renderHook(() => useIsCompactViewport());
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
