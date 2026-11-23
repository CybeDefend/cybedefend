import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedCallback } from './useDebouncedCallback';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useDebouncedCallback', () => {
  it('calls the underlying fn only once when invoked rapidly within the window', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 500));
    act(() => { result.current(); result.current(); result.current(); });
    expect(fn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls the fn again after the window elapses', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 500));
    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses the latest fn closure on flush', () => {
    let value = 0;
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedCallback(() => { value = v; }, 200),
      { initialProps: { v: 1 } },
    );
    act(() => { result.current(); });
    rerender({ v: 42 });
    act(() => { vi.advanceTimersByTime(200); });
    expect(value).toBe(42);
  });

  it('does not fire after unmount even if a call was scheduled', () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 300));
    act(() => { result.current(); });
    unmount();
    act(() => { vi.advanceTimersByTime(300); });
    expect(fn).not.toHaveBeenCalled();
  });
});
