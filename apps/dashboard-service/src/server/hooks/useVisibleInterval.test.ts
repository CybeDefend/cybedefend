import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useVisibleInterval } from './useVisibleInterval';

let visibility: DocumentVisibilityState = 'visible';

const turn = (next: DocumentVisibilityState) =>
  act(() => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  });

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useVisibleInterval', () => {
  it('ticks every interval while the tab is visible', () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, 1000));
    wait(3000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('never ticks while the tab is hidden', () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, 1000));
    turn('hidden');
    wait(10_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it('ticks once when the tab shows again, then every interval from there', () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, 1000));
    turn('hidden');
    wait(5000);
    turn('visible');
    expect(tick).toHaveBeenCalledTimes(1);
    wait(999);
    expect(tick).toHaveBeenCalledTimes(1);
    wait(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('mounted in a hidden tab, waits for it to show', () => {
    visibility = 'hidden';
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, 1000));
    wait(5000);
    expect(tick).not.toHaveBeenCalled();
    turn('visible');
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('does not tick again for a visibility event of a tab that never hid', () => {
    const tick = vi.fn();
    renderHook(() => useVisibleInterval(tick, 1000));
    turn('visible');
    expect(tick).not.toHaveBeenCalled();
  });

  it('calls the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ tick }) => useVisibleInterval(tick, 1000), {
      initialProps: { tick: first },
    });
    rerender({ tick: second });
    wait(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops everything on unmount', () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => useVisibleInterval(tick, 1000));
    unmount();
    wait(5000);
    turn('hidden');
    turn('visible');
    expect(tick).not.toHaveBeenCalled();
  });
});
