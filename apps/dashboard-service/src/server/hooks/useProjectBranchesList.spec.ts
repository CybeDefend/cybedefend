import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';


vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api.test' }),
}));

vi.mock('@/server/services/resultService', () => ({
  getProjectBranchesList: vi.fn(),
}));

import * as resultService from '@/server/services/resultService';
import { useProjectBranchesList, DEFAULT_BRANCH_LIST_QUERY } from './useProjectBranchesList';
import { hookCache } from './utils/hookCache';

const getList = resultService.getProjectBranchesList as ReturnType<typeof vi.fn>;

const page = (
  names: string[],
  total: number,
  p = 1,
) => ({
  branches: names.map((n) => ({
    name: n,
    isDefault: n === 'main',
    isProtected: false,
    archived: false,
  })),
  pagination: { page: p, pageSize: 30, total, hasMore: p * 30 < total },
  defaultBranch: 'main',
  scanBranch: '',
});

describe('useProjectBranchesList', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getList.mockReset();
    // The default page-1 view is cached in the hookCache singleton (survives
    // unmount) so sibling issue-list pages hydrate synchronously. Clear it
    // between tests so each starts cold and the mount fetch fires as expected.
    hookCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads page 1 on mount', async () => {
    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await waitFor(() => expect(result.current.branches.length).toBe(2));
    expect(getList).toHaveBeenCalledWith('p1', expect.objectContaining({ page: 1 }));
  });

  it('debounces search (300ms), resets to page 1 and replaces the list', async () => {
    vi.useFakeTimers();
    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    const { result } = renderHook(() => useProjectBranchesList('p1'));

    // Flush the mount load
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {});

    getList.mockResolvedValueOnce(page(['feature/x'], 1));
    act(() => result.current.setSearch('fea'));

    // Not yet fired (debounced)
    expect(getList).toHaveBeenCalledTimes(1);

    // Advance past debounce window
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {});

    expect(getList).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ search: 'fea', page: 1 }),
    );
    // The list is REPLACED (not appended) with the search results.
    expect(result.current.branches.map((b) => b.name)).toEqual(['feature/x']);
    expect(result.current.searching).toBe(false);
  });

  it('search uses the inline `searching` flag, never the full-skeleton `loading` flag', async () => {
    vi.useFakeTimers();
    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    const { result } = renderHook(() => useProjectBranchesList('p1'));

    // Flush the mount load
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {});
    expect(result.current.loading).toBe(false);

    // Make the search request hang so we can observe the in-flight flags.
    let resolveSearch: (v: any) => void = () => {};
    getList.mockImplementationOnce(
      () => new Promise((r) => {
        resolveSearch = r;
      }),
    );
    act(() => result.current.setSearch('fea'));

    // Advance past the debounce window so the fetch actually fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // While the search is in-flight: the dropdown stays mounted (inline spinner)
    // — `searching` is true but the full-skeleton `loading` flag must stay false.
    expect(result.current.searching).toBe(true);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSearch(page(['feature/x'], 1));
    });
    expect(result.current.searching).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('toggleArchived refetches without flipping the full-skeleton `loading` flag', async () => {
    vi.useFakeTimers();
    getList.mockResolvedValueOnce(page(['main'], 1));
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {});
    expect(result.current.loading).toBe(false);

    let resolveToggle: (v: any) => void = () => {};
    getList.mockImplementationOnce(
      () => new Promise((r) => {
        resolveToggle = r;
      }),
    );
    act(() => result.current.toggleArchived());

    // The dropdown is already open when the user toggles archived — the full
    // skeleton must not replace it.
    await act(async () => {});
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveToggle(page(['main', 'archived-x'], 2));
    });
    expect(result.current.loading).toBe(false);
  });

  it('loadMore appends the next page and respects hasMore', async () => {
    getList.mockResolvedValueOnce(page(['b1', 'b2'], 40, 1)); // hasMore true (1*30 < 40)
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await waitFor(() => expect(result.current.branches.length).toBe(2));
    expect(result.current.hasMore).toBe(true);

    getList.mockResolvedValueOnce({
      ...page(['b3'], 40, 2),
      pagination: { page: 2, pageSize: 30, total: 40, hasMore: false },
    });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.branches.map((b) => b.name)).toEqual(['b1', 'b2', 'b3']);
    expect(result.current.hasMore).toBe(false);
  });

  it('hydrates from cache on remount — branches synchronously available, no skeleton, no refetch on navigation', async () => {
    getList.mockResolvedValue(page(['main', 'dev'], 2));

    // First mount loads page 1 and caches the default view.
    const first = renderHook(() => useProjectBranchesList('p1'));
    await waitFor(() => expect(first.result.current.branches.length).toBe(2));
    expect(getList).toHaveBeenCalledTimes(1);
    first.unmount();

    // Navigating to a sibling issue-list page (sast → sca) remounts the hook.
    const second = renderHook(() => useProjectBranchesList('p1'));

    // Branches are present on the FIRST commit (no async wait) and the
    // full-skeleton `loading` flag never flips — the BranchSelector shows the
    // real trigger immediately instead of flashing its animate-pulse skeleton.
    expect(second.result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
    expect(second.result.current.loading).toBe(false);

    // No redundant GET /project/:id/branches/list fired on navigation.
    await waitFor(() => expect(second.result.current.branches.length).toBe(2));
    expect(getList).toHaveBeenCalledTimes(1);
  });

  // An async Select lifts '' on mount and on every close. The
  // scan modal's branch picker now shares this list, so each opening of the
  // modal sent a /branches/list request for the view already on screen.
  it('does not refetch when the search is set to the value it already has', async () => {
    vi.useFakeTimers();
    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {});
    expect(getList).toHaveBeenCalledTimes(1);

    act(() => result.current.setSearch(''));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(getList).toHaveBeenCalledTimes(1);
    expect(result.current.searching).toBe(false);
    expect(result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
  });

  it('still clears a search back to the default view', async () => {
    vi.useFakeTimers();
    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    getList.mockResolvedValueOnce(page(['feature/x'], 1));
    act(() => result.current.setSearch('fea'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    act(() => result.current.setSearch(''));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {});

    expect(getList).toHaveBeenCalledTimes(3);
    expect(getList).toHaveBeenLastCalledWith('p1', DEFAULT_BRANCH_LIST_QUERY);
    expect(result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
  });

  it('toggleArchived refetches from page 1', async () => {
    getList.mockResolvedValueOnce(page(['main'], 1));
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await waitFor(() => expect(result.current.branches.length).toBe(1));

    getList.mockResolvedValueOnce(page(['main', 'archived-x'], 2));
    act(() => result.current.toggleArchived());

    await waitFor(() => expect(result.current.includeArchived).toBe(true));
    expect(getList).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ includeArchived: true, page: 1 }),
    );
  });

  // Archiving or unarchiving a branch changes the list the selector holds; the
  // results page reloads its own, and the selector reloads through reload().
  it('reload() asks page 1 again with the current view and replaces the list', async () => {
    getList.mockResolvedValueOnce(page(['main', 'dev', 'old'], 3));
    const { result } = renderHook(() => useProjectBranchesList('p1'));
    await waitFor(() => expect(result.current.branches.length).toBe(3));

    getList.mockResolvedValueOnce(page(['main', 'dev'], 2));
    await act(async () => {
      await result.current.reload();
    });

    expect(getList).toHaveBeenCalledTimes(2);
    expect(getList).toHaveBeenLastCalledWith('p1', expect.objectContaining({ page: 1, includeArchived: false }));
    expect(result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
  });
});
