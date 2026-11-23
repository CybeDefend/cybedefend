import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockTabVisibility } from '@/test/tabVisibility';
import {
  skipWhenHidden,
  useCatchUpWhenVisible,
  usePollingWhenVisible,
  type PollingWhenVisibleOptions,
} from './usePollingWhenVisible';

let tab: ReturnType<typeof mockTabVisibility>;

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const arrange = (intervalMs: number, options?: PollingWhenVisibleOptions) => {
  const callback = vi.fn();
  const view = renderHook(
    ({ cb, opts }: { cb: () => void; opts?: PollingWhenVisibleOptions }) =>
      usePollingWhenVisible(cb, intervalMs, opts),
    { initialProps: { cb: callback as () => void, opts: options } },
  );
  return { callback, ...view };
};

beforeEach(() => {
  vi.useFakeTimers();
  tab = mockTabVisibility();
});

afterEach(() => {
  vi.useRealTimers();
  tab.restore();
});

describe('usePollingWhenVisible', () => {
  it('calls back once per interval while the tab is visible', () => {
    const { callback } = arrange(10_000);
    expect(callback).not.toHaveBeenCalled();
    advance(10_000);
    expect(callback).toHaveBeenCalledTimes(1);
    advance(20_000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('calls back at once when asked to', () => {
    const { callback } = arrange(10_000, { immediate: true });
    expect(callback).toHaveBeenCalledTimes(1);
    advance(10_000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('calls nothing in a hidden tab, then once as soon as it is shown again', () => {
    const { callback } = arrange(10_000, { immediate: true });
    expect(callback).toHaveBeenCalledTimes(1);

    tab.hide();
    advance(60_000);
    expect(callback).toHaveBeenCalledTimes(1);

    tab.show();
    expect(callback).toHaveBeenCalledTimes(2);
    advance(10_000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('starts in a hidden tab without calling, even when asked to call at once', () => {
    tab.startHidden();
    const { callback } = arrange(10_000, { immediate: true });
    advance(60_000);
    expect(callback).not.toHaveBeenCalled();

    tab.show();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('never calls more than once per interval, however often the tab is switched', () => {
    const { callback } = arrange(10_000, { immediate: true });
    for (let i = 0; i < 5; i += 1) {
      advance(1_000);
      tab.hide();
      advance(500);
      tab.show();
    }
    // 7.5 s went by: still the first call only.
    expect(callback).toHaveBeenCalledTimes(1);
    advance(2_500);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('does nothing while disabled, and starts when enabled', () => {
    const { callback, rerender } = arrange(10_000, { enabled: false, immediate: true });
    advance(30_000);
    expect(callback).not.toHaveBeenCalled();

    rerender({ cb: callback, opts: { enabled: true, immediate: true } });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('restarts when its key changes', () => {
    const { callback, rerender } = arrange(10_000, { immediate: true, key: 'page-1' });
    advance(6_000);
    rerender({ cb: callback, opts: { immediate: true, key: 'page-2' } });
    expect(callback).toHaveBeenCalledTimes(2);
    // The interval runs from the restart, not from the first start.
    advance(6_000);
    expect(callback).toHaveBeenCalledTimes(2);
    advance(4_000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('calls the latest callback, and a new callback does not reset the timer', () => {
    const { callback, rerender } = arrange(10_000);
    advance(6_000);
    const next = vi.fn();
    rerender({ cb: next, opts: undefined });
    advance(4_000);
    expect(callback).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a callback that throws, without hiding the error', () => {
    const callback = vi.fn(() => {
      throw new Error('boom');
    });
    renderHook(() => usePollingWhenVisible(callback, 10_000));
    expect(() => advance(10_000)).toThrow('boom');
    expect(() => advance(10_000)).toThrow('boom');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('stops for good on unmount, the tab listener included', () => {
    const { callback, unmount } = arrange(10_000, { immediate: true });
    unmount();
    advance(30_000);
    tab.hide();
    tab.show();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('skipWhenHidden', () => {
  it('runs the tick in a visible tab and skips it in a hidden one', () => {
    const tick = vi.fn();
    const guarded = skipWhenHidden(tick);
    guarded();
    tab.startHidden();
    guarded();
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

// A hand-managed poll (skipWhenHidden) only
// catches up at its next tick; this hook reads at once on the tab's return
// when the last read is at least one interval old.
describe('useCatchUpWhenVisible', () => {
  const arrangeCatchUp = (enabled = true) => {
    const fetch = vi.fn();
    const view = renderHook(
      ({ on }: { on: boolean }) => useCatchUpWhenVisible(fetch, on, 10_000),
      { initialProps: { on: enabled } },
    );
    // The page reads on its own and notes each read.
    const read = () => {
      view.result.current();
      fetch();
    };
    return { fetch, read, ...view };
  };

  it('reads at once when the tab is shown again and the last read is one interval old', () => {
    const { fetch, read } = arrangeCatchUp();
    read();
    tab.hide();
    advance(10_000);
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not read on a quick switch, while the last read is recent', () => {
    const { fetch, read } = arrangeCatchUp();
    read();
    tab.hide();
    advance(4_000);
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('counts its own catch-up read as the last one', () => {
    const { fetch, read } = arrangeCatchUp();
    read();
    tab.hide();
    advance(30_000);
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(2);
    tab.hide();
    advance(2_000);
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reads at once on return when nothing was read yet', () => {
    const { fetch } = arrangeCatchUp();
    tab.hide();
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled, and nothing after unmount', () => {
    const { fetch, read, rerender, unmount } = arrangeCatchUp(false);
    read();
    tab.hide();
    advance(30_000);
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(1);

    rerender({ on: true });
    unmount();
    tab.hide();
    advance(30_000);
    tab.show();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
