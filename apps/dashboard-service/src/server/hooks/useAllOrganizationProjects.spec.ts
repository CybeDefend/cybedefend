import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/projectService', () => ({
  fetchProjectsForOrganization: vi.fn(),
}));

import useAllOrganizationProjects, {
  __resetAllOrganizationProjectsCacheForTests,
} from './useAllOrganizationProjects';
import { fetchProjectsForOrganization } from '../services/projectService';

const mockedFetch = fetchProjectsForOrganization as ReturnType<typeof vi.fn>;

const makePage = (page: number, totalPages: number) => ({
  projects: [{ projectId: `p${page}-1`, isScanning: false }],
  mainStatistics: null,
  totalProjects: totalPages,
  totalPages,
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAllOrganizationProjects concurrent-instance deduplication', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    __resetAllOrganizationProjectsCacheForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('issues each /projects?page=X request exactly once when two consumers mount concurrently for the same org', async () => {
    // Same response shape regardless of which page is queried — totalPages=3.
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 3)),
    );

    // Two independent consumers mount concurrently (same pattern as
    // GlobalChatDrawer calling useChatAccessibleProjects directly while
    // useChatPageContext calls it transitively).
    renderHook(() => useAllOrganizationProjects('org-1'));
    renderHook(() => useAllOrganizationProjects('org-1'));

    await flushAsync();

    // Without dedup, each consumer fires page=1 then pages 2..3 in parallel
    // → 2 × 3 = 6 calls. The expected behavior is one fetch per logical page,
    // shared across the two consumers → exactly 3 calls.
    const calls = mockedFetch.mock.calls.map((c) => c[1]); // page numbers
    expect(calls).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it('does not deduplicate across distinct orgs', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 1)),
    );

    renderHook(() => useAllOrganizationProjects('org-A'));
    renderHook(() => useAllOrganizationProjects('org-B'));

    await flushAsync();

    // Each org-scoped consumer must produce its own page=1 request — the
    // dedup key is per-org, not global.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('still returns all projects to both consumers when sharing a single fetch', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 2)),
    );

    const a = renderHook(() => useAllOrganizationProjects('org-1'));
    const b = renderHook(() => useAllOrganizationProjects('org-1'));

    await flushAsync();

    // Both consumers receive the same flattened project list — dedup must not
    // cost any caller their data.
    expect(a.result.current.loading).toBe(false);
    expect(b.result.current.loading).toBe(false);
    expect(a.result.current.projects.map((p: any) => p.projectId)).toEqual([
      'p1-1',
      'p2-1',
    ]);
    expect(b.result.current.projects.map((p: any) => p.projectId)).toEqual([
      'p1-1',
      'p2-1',
    ]);
  });
});

describe('useAllOrganizationProjects lazy enable', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    __resetAllOrganizationProjectsCacheForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches on mount when enabled is omitted (defaults to true)', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 1)),
    );

    renderHook(() => useAllOrganizationProjects('org-1'));
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalled();
  });

  it('does not fetch /projects when enabled=false (covers chat-drawer-closed case)', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 3)),
    );

    renderHook(() => useAllOrganizationProjects('org-1', false));
    await flushAsync();

    // The chat drawer mounts in Layout on every page. While closed, the
    // accessible-projects list is never displayed; deferring the fetch
    // saves 3 /projects requests on initial home-page load.
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('settles loading to false while disabled (no stuck skeleton)', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 1)),
    );

    const { result } = renderHook(() =>
      useAllOrganizationProjects('org-1', false),
    );
    await flushAsync();

    expect(result.current.loading).toBe(false);
  });

  it('fetches /projects when enabled transitions from false to true', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 2)),
    );

    const { rerender, result } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAllOrganizationProjects('org-1', enabled),
      { initialProps: { enabled: false } },
    );

    await flushAsync();
    expect(mockedFetch).not.toHaveBeenCalled();

    // Simulate the user opening the chat drawer.
    rerender({ enabled: true });
    await flushAsync();

    // Now the full sweep runs (page=1 + page=2) — once each.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.current.projects.map((p: any) => p.projectId)).toEqual([
      'p1-1',
      'p2-1',
    ]);
  });

  it('does not refetch when enabled flips back to true after having been true', async () => {
    mockedFetch.mockImplementation((_org: string, page: number) =>
      Promise.resolve(makePage(page, 1)),
    );

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAllOrganizationProjects('org-1', enabled),
      { initialProps: { enabled: true } },
    );

    await flushAsync();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Drawer closed then re-opened in the same session — projects state is
    // sticky on the hook instance; we do not want to spam /projects on every
    // toggle.
    rerender({ enabled: false });
    await flushAsync();
    rerender({ enabled: true });
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
