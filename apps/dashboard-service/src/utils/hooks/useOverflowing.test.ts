import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useOverflowing } from './useOverflowing';

// A ResizeObserver whose callback the test fires by hand, recording what it watches.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve(target: Element) {
    this.observed = this.observed.filter((t) => t !== target);
  }
  disconnect() {
    this.disconnected = true;
    this.observed = [];
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** jsdom lays nothing out: both heights are 0 unless a test says otherwise. */
const sized = (element: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight });
};

const scroller = () => {
  const element = document.createElement('div');
  element.appendChild(document.createElement('nav'));
  document.body.appendChild(element);
  return element;
};

const refTo = (element: HTMLElement | null): RefObject<HTMLElement | null> => ({ current: element });

describe('useOverflowing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('reads false in jsdom, where nothing has a height', () => {
    const { result } = renderHook(() => useOverflowing(refTo(scroller())));
    expect(result.current).toBe(false);
  });

  it('reads false without an element', () => {
    const { result } = renderHook(() => useOverflowing(refTo(null)));
    expect(result.current).toBe(false);
  });

  describe('with a ResizeObserver', () => {
    beforeEach(() => {
      FakeResizeObserver.instances = [];
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    it('reads true on mount when the content is taller than the box', () => {
      const element = scroller();
      sized(element, { scrollHeight: 900, clientHeight: 600 });
      const { result } = renderHook(() => useOverflowing(refTo(element)));
      expect(result.current).toBe(true);
    });

    it('follows a resize of the box or of its content', () => {
      const element = scroller();
      sized(element, { scrollHeight: 600, clientHeight: 600 });
      const { result } = renderHook(() => useOverflowing(refTo(element)));
      expect(result.current).toBe(false);

      // The box and its content are both watched: a longer nav grows the child, not the box.
      const [observer] = FakeResizeObserver.instances;
      expect(observer.observed).toContain(element);
      expect(observer.observed).toContain(element.firstElementChild);

      sized(element, { scrollHeight: 720, clientHeight: 600 });
      act(() => observer.fire());
      expect(result.current).toBe(true);

      sized(element, { scrollHeight: 720, clientHeight: 720 });
      act(() => observer.fire());
      expect(result.current).toBe(false);
    });

    it('measures again when the box scrolls', () => {
      const element = scroller();
      sized(element, { scrollHeight: 600, clientHeight: 600 });
      const { result } = renderHook(() => useOverflowing(refTo(element)));

      sized(element, { scrollHeight: 800, clientHeight: 600 });
      act(() => {
        element.dispatchEvent(new Event('scroll'));
      });
      expect(result.current).toBe(true);
    });

    it('watches what replaces its content after mount, and measures at once', async () => {
      // The rail keeps its scroller mounted when the product changes: the nav of
      // the other product (or the entries a permission check adds) is a new
      // child the box never saw, whose growth does not resize the box itself.
      const element = scroller();
      sized(element, { scrollHeight: 600, clientHeight: 600 });
      // One ref for the whole life of the hook, as a component's `useRef` gives it.
      const ref = refTo(element);
      const { result } = renderHook(() => useOverflowing(ref));
      const [observer] = FakeResizeObserver.instances;
      const before = element.firstElementChild as Element;

      const next = document.createElement('nav');
      sized(element, { scrollHeight: 820, clientHeight: 600 });
      await act(async () => {
        element.replaceChild(next, before);
        // A MutationObserver answers on the next microtask.
        await Promise.resolve();
      });

      expect(result.current).toBe(true);
      expect(observer.observed).toContain(next);
      expect(observer.observed).not.toContain(before);

      // The new child is watched: when it shrinks, the box no longer overflows.
      sized(element, { scrollHeight: 600, clientHeight: 600 });
      act(() => observer.fire());
      expect(result.current).toBe(false);
    });

    it('stops watching once unmounted', () => {
      const element = scroller();
      sized(element, { scrollHeight: 600, clientHeight: 600 });
      const removed = vi.spyOn(element, 'removeEventListener');
      const { unmount } = renderHook(() => useOverflowing(refTo(element)));

      unmount();
      expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
      expect(removed).toHaveBeenCalledWith('scroll', expect.any(Function));
    });
  });

  it('still measures on scroll where the browser has no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const element = scroller();
    sized(element, { scrollHeight: 600, clientHeight: 600 });
    const { result } = renderHook(() => useOverflowing(refTo(element)));
    expect(result.current).toBe(false);

    sized(element, { scrollHeight: 650, clientHeight: 600 });
    act(() => {
      element.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });
});
