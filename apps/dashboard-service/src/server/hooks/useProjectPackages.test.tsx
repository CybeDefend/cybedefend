import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { hookCache } from './utils/hookCache';

const fetchScaPackagesMock = vi.fn();
vi.mock('../services/resultService', () => ({
  fetchScaPackagesForProject: (...args: unknown[]) => fetchScaPackagesMock(...args),
}));

vi.mock('./useDebouncedValue', () => ({
  default: <T,>(value: T) => value,
}));

import useProjectPackages from './useProjectPackages';

const store = configureStore({
  reducer: { organization: () => ({ selectedOrganization: { id: 'org-1' } }) },
});
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(Provider, { store, children });

const answer = (name: string) => ({
  packages: [{ id: name, name }],
  total: 1,
  totalPages: 1,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const options = { projectId: 'p1', pageSize: 10, searchQuery: '' };

/**
 * `refresh()` invalidated `<org>:packages:<project>` while
 * the entries are keyed `<org>:packages_<page>_…:<project>`, so nothing was
 * dropped, and its boolean flag only bypassed the cache every other time: the
 * second refresh served the cached page. A fetch in flight also swallowed the
 * next one, so a search typed meanwhile was never sent.
 */
describe('useProjectPackages', () => {
  beforeEach(() => {
    fetchScaPackagesMock.mockReset();
    hookCache.clear();
  });

  // The mocked packages only carry a name.
  const names = (result: { current: { packages: unknown[] } }) =>
    result.current.packages.map((p) => (p as { name?: string }).name);

  it('refetches on every refresh, not only every other one', async () => {
    fetchScaPackagesMock.mockResolvedValue(answer('v1'));
    const { result } = renderHook(() => useProjectPackages(options), { wrapper });
    await waitFor(() => expect(names(result)).toEqual(['v1']));

    fetchScaPackagesMock.mockResolvedValue(answer('v2'));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(names(result)).toEqual(['v2']));

    fetchScaPackagesMock.mockResolvedValue(answer('v3'));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(names(result)).toEqual(['v3']));

    expect(fetchScaPackagesMock).toHaveBeenCalledTimes(3);
  });

  it('drops the cached pages of the project on refresh', async () => {
    fetchScaPackagesMock.mockResolvedValue(answer('v1'));
    const { result, unmount } = renderHook(() => useProjectPackages(options), { wrapper });
    await waitFor(() => expect(names(result)).toEqual(['v1']));

    act(() => {
      result.current.refresh();
    });
    unmount();

    // A later visit of the same view must not be served the pre-refresh page.
    fetchScaPackagesMock.mockResolvedValue(answer('v2'));
    const again = renderHook(() => useProjectPackages(options), { wrapper });
    await waitFor(() => expect(names(again.result)).toEqual(['v2']));
  });

  it('sends a search typed while the previous fetch is in flight', async () => {
    const first = deferred<ReturnType<typeof answer>>();
    fetchScaPackagesMock.mockImplementation((_p: string, o: { searchQuery: string }) =>
      o.searchQuery ? Promise.resolve(answer(`match-${o.searchQuery}`)) : first.promise,
    );
    const { result, rerender } = renderHook(
      (props: { searchQuery: string }) => useProjectPackages({ ...options, ...props }),
      { wrapper, initialProps: { searchQuery: '' } },
    );
    await waitFor(() => expect(fetchScaPackagesMock).toHaveBeenCalledTimes(1));

    rerender({ searchQuery: 'lodash' });

    await waitFor(() =>
      expect(fetchScaPackagesMock).toHaveBeenLastCalledWith(
        'p1',
        expect.objectContaining({ searchQuery: 'lodash' }),
      ),
    );
    await waitFor(() => expect(names(result)).toEqual(['match-lodash']));
  });

  it('keeps the latest answer when an older one lands last', async () => {
    const first = deferred<ReturnType<typeof answer>>();
    fetchScaPackagesMock.mockImplementation((_p: string, o: { searchQuery: string }) =>
      o.searchQuery ? Promise.resolve(answer(`match-${o.searchQuery}`)) : first.promise,
    );
    const { result, rerender } = renderHook(
      (props: { searchQuery: string }) => useProjectPackages({ ...options, ...props }),
      { wrapper, initialProps: { searchQuery: '' } },
    );
    rerender({ searchQuery: 'lodash' });
    await waitFor(() => expect(names(result)).toEqual(['match-lodash']));

    await act(async () => {
      first.resolve(answer('unfiltered'));
    });

    expect(names(result)).toEqual(['match-lodash']);
    expect(result.current.loading).toBe(false);
  });
});
