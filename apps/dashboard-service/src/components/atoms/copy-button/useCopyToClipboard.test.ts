import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCopyToClipboard } from './useCopyToClipboard';

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCopyToClipboard', () => {
  it('writes the text to the clipboard and marks it copied', async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.copied).toBe(false);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy('hello');
    });

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(ok).toBe(true);
    expect(result.current.copied).toBe(true);
  });

  it('takes the mark away after 2 seconds by default', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('hello');
    });
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.copied).toBe(false);
  });

  it('honours resetAfterMs', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyToClipboard({ resetAfterMs: 500 }));
    await act(async () => {
      await result.current.copy('hello');
    });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.copied).toBe(false);
  });

  // One timer at a time: a second copy restarts the countdown instead of
  // letting the first one take the mark away early.
  it('restarts the countdown on a new copy', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyToClipboard({ resetAfterMs: 1000 }));
    await act(async () => {
      await result.current.copy('a');
    });
    act(() => vi.advanceTimersByTime(800));
    await act(async () => {
      await result.current.copy('b');
    });
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.copied).toBe(false);
  });

  it('resolves false and stays unmarked when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const { result } = renderHook(() => useCopyToClipboard());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy('hello');
    });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
  });

  it('resolves false when the browser has no clipboard API', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const { result } = renderHook(() => useCopyToClipboard());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy('hello');
    });
    expect(ok).toBe(false);
  });

  it('clears its timer on unmount', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('hello');
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
