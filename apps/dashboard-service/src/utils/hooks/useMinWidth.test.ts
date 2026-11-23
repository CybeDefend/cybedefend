import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMinWidth } from './useMinWidth';

type Listener = (event: { matches: boolean }) => void;

// jsdom ships no matchMedia: a controllable MediaQueryList per query, keyed by
// the query string, so two widths can be watched side by side.
const installMatchMedia = (matchesFor: (query: string) => boolean) => {
  const state = new Map<string, { matches: boolean; listeners: Set<Listener> }>();
  const entry = (query: string) => {
    let found = state.get(query);
    if (!found) {
      found = { matches: matchesFor(query), listeners: new Set() };
      state.set(query, found);
    }
    return found;
  };
  window.matchMedia = vi.fn((query: string) => {
    const e = entry(query);
    return {
      get matches() {
        return e.matches;
      },
      media: query,
      addEventListener: (_: string, l: Listener) => e.listeners.add(l),
      removeEventListener: (_: string, l: Listener) => e.listeners.delete(l),
    } as unknown as MediaQueryList;
  });
  return {
    queries: () => [...state.keys()],
    listenerCount: (query: string) => state.get(query)?.listeners.size ?? 0,
    set: (query: string, next: boolean) => {
      const e = entry(query);
      e.matches = next;
      e.listeners.forEach((l) => l({ matches: next }));
    },
  };
};

describe('useMinWidth', () => {
  afterEach(() => {
    // @ts-expect-error restore jsdom's default (no matchMedia)
    delete window.matchMedia;
  });

  it('reads false where the browser has no matchMedia (jsdom, SSR): the narrow view is the default', () => {
    const { result } = renderHook(() => useMinWidth(976));
    expect(result.current).toBe(false);
  });

  it('asks the min-width query of the width it is given', () => {
    const media = installMatchMedia(() => true);
    const { result } = renderHook(() => useMinWidth(976));
    expect(result.current).toBe(true);
    expect(media.queries()).toEqual(['(min-width: 976px)']);
  });

  it('reads false below the width', () => {
    installMatchMedia(() => false);
    const { result } = renderHook(() => useMinWidth(976));
    expect(result.current).toBe(false);
  });

  it('follows the viewport when it crosses the width (resize, rotation)', () => {
    const media = installMatchMedia(() => true);
    const { result } = renderHook(() => useMinWidth(976));

    act(() => media.set('(min-width: 976px)', false));
    expect(result.current).toBe(false);

    act(() => media.set('(min-width: 976px)', true));
    expect(result.current).toBe(true);
  });

  it('watches the new width, and stops watching the old one, when the width changes', () => {
    const media = installMatchMedia((query) => query === '(min-width: 640px)');
    const { result, rerender } = renderHook(({ px }) => useMinWidth(px), { initialProps: { px: 976 } });
    expect(result.current).toBe(false);
    expect(media.listenerCount('(min-width: 976px)')).toBe(1);

    rerender({ px: 640 });
    expect(result.current).toBe(true);
    expect(media.listenerCount('(min-width: 976px)')).toBe(0);
    expect(media.listenerCount('(min-width: 640px)')).toBe(1);
  });

  it('stops listening once unmounted', () => {
    const media = installMatchMedia(() => true);
    const { unmount } = renderHook(() => useMinWidth(976));
    expect(media.listenerCount('(min-width: 976px)')).toBe(1);

    unmount();
    expect(media.listenerCount('(min-width: 976px)')).toBe(0);
  });
});
