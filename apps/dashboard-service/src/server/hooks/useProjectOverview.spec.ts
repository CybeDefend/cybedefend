import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { features } from '@/utils/featureFlags';

const realtimeMock = vi.fn();
vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: (
    url: string | null,
    handlers: Record<string, (...args: unknown[]) => void>,
    deps: unknown[],
  ) => {
    realtimeMock(url, handlers, deps);
  },
}));

const getProjectOverviewMock = vi.fn();
const getProjectBranchesMock = vi.fn();
const getArchivedBranchesMock = vi.fn();
const archiveBranchMock = vi.fn();
const unarchiveBranchMock = vi.fn();
vi.mock('@/server/services/resultService', () => ({
  getProjectOverview: (...args: unknown[]) => getProjectOverviewMock(...args),
  getProjectBranches: (...args: unknown[]) => getProjectBranchesMock(...args),
  getArchivedBranches: (...args: unknown[]) => getArchivedBranchesMock(...args),
  archiveBranch: (...args: unknown[]) => archiveBranchMock(...args),
  unarchiveBranch: (...args: unknown[]) => unarchiveBranchMock(...args),
}));

const fetchProjectMock = vi.fn();
vi.mock('@/server/services/projectService', () => ({
  fetchProject: (...args: unknown[]) => fetchProjectMock(...args),
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

import { useProjectOverview } from './useProjectOverview';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const mkOverview = (overrides: Record<string, unknown> = {}) => ({
  totalVulnerabilities: 10,
  ...overrides,
});

/** The mocked overview only carries this one field. */
const totalOf = (data: unknown): number | undefined =>
  (data as { totalVulnerabilities?: number } | null)?.totalVulnerabilities;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// The overview used to be fetched twice per visit — once
// unfiltered on mount, once more when the branch list landed, because the
// fetch depended on the branches array itself — and the unfiltered answer
// could land last and stay on screen.
describe('useProjectOverview — one overview per visit, the latest answer wins', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    getProjectOverviewMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    fetchProjectMock.mockReset();
    fetchProjectMock.mockResolvedValue({ parsedBranches: [] });
  });

  it('fetches the overview once when no branch is archived', async () => {
    getProjectBranchesMock.mockResolvedValue({ branches: ['main', 'dev'] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    getProjectOverviewMock.mockResolvedValue(mkOverview());

    const { result } = renderHook(() => useProjectOverview('p1'));

    await waitFor(() => expect(result.current.branches).toHaveLength(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getProjectOverviewMock).toHaveBeenCalledTimes(1);
    expect(getProjectOverviewMock).toHaveBeenCalledWith('p1');
  });

  it('requests the archived branches without waiting for the branch list', async () => {
    getProjectBranchesMock.mockReturnValue(new Promise(() => {}));
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    getProjectOverviewMock.mockResolvedValue(mkOverview());

    renderHook(() => useProjectOverview('p1'));

    await waitFor(() => expect(getArchivedBranchesMock).toHaveBeenCalledWith('p1'));
  });

  it('keeps the filtered overview when the unfiltered one answers last', async () => {
    getProjectBranchesMock.mockResolvedValue({ branches: ['main', 'old'] });
    getArchivedBranchesMock.mockResolvedValue({ branches: ['old'] });
    const unfiltered = deferred<ReturnType<typeof mkOverview>>();
    getProjectOverviewMock.mockImplementation(
      (_projectId: string, _branch?: string, branches?: string[]) =>
        branches ? Promise.resolve(mkOverview({ totalVulnerabilities: 5 })) : unfiltered.promise,
    );

    const { result } = renderHook(() => useProjectOverview('p1'));

    await waitFor(() => expect(totalOf(result.current.data)).toBe(5));
    expect(getProjectOverviewMock).toHaveBeenLastCalledWith('p1', undefined, ['main']);

    // The request sent before the archived branch was known answers last.
    await act(async () => {
      unfiltered.resolve(mkOverview({ totalVulnerabilities: 10 }));
    });

    expect(totalOf(result.current.data)).toBe(5);
    expect(result.current.loading).toBe(false);
  });

  it('ignores a realtime refresh that answers after the branch filter changed', async () => {
    getProjectBranchesMock.mockResolvedValue({ branches: ['main', 'dev'] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    getProjectOverviewMock.mockResolvedValue(mkOverview({ totalVulnerabilities: 1 }));

    const { result } = renderHook(() => useProjectOverview('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const stale = deferred<ReturnType<typeof mkOverview>>();
    getProjectOverviewMock.mockImplementationOnce(() => stale.promise);
    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as { STATS_AGGREGATE_CHANGED: () => void };
    await act(async () => {
      handlers.STATS_AGGREGATE_CHANGED();
    });

    getProjectOverviewMock.mockResolvedValueOnce(mkOverview({ totalVulnerabilities: 7 }));
    await act(async () => {
      result.current.setSelectedBranch('dev');
    });
    await waitFor(() => expect(totalOf(result.current.data)).toBe(7));

    await act(async () => {
      stale.resolve(mkOverview({ totalVulnerabilities: 99 }));
    });

    expect(totalOf(result.current.data)).toBe(7);
  });
});

describe('useProjectOverview realtime wiring', () => {
  it('exports a feature flag that defaults to true', () => {
    expect(features.realtime.projectStats).toBe(true);
  });
});

describe('useProjectOverview silent refresh', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    getProjectOverviewMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    fetchProjectMock.mockReset();

    getProjectBranchesMock.mockResolvedValue({ branches: [] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    fetchProjectMock.mockResolvedValue({ parsedBranches: [] });
  });

  it('keeps loading=false when VULNERABILITY_BATCH_APPENDED triggers a refresh', async () => {
    getProjectOverviewMock.mockResolvedValue(mkOverview({ totalVulnerabilities: 10 }));

    const { result } = renderHook(() => useProjectOverview('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(result.current.data?.totalVulnerabilities).toBe(10),
    );

    let resolveSecond: (value: ReturnType<typeof mkOverview>) => void = () => {};
    getProjectOverviewMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { VULNERABILITY_BATCH_APPENDED?: () => void }
      | undefined;
    expect(handlers?.VULNERABILITY_BATCH_APPENDED).toBeTypeOf('function');

    await act(async () => {
      handlers!.VULNERABILITY_BATCH_APPENDED!();
    });

    // The realtime-driven refetch must NOT toggle the global loading flag.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkOverview({ totalVulnerabilities: 12 }));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data?.totalVulnerabilities).toBe(12);
  });

  it('keeps loading=true when the manual refresh is invoked', async () => {
    getProjectOverviewMock.mockResolvedValue(mkOverview({ totalVulnerabilities: 5 }));

    const { result } = renderHook(() => useProjectOverview('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSecond: (value: ReturnType<typeof mkOverview>) => void = () => {};
    getProjectOverviewMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    await act(async () => {
      result.current.refresh();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveSecond(mkOverview({ totalVulnerabilities: 6 }));
    });

    expect(result.current.loading).toBe(false);
  });

  it('preserves visible data when a silent refresh fails', async () => {
    getProjectOverviewMock.mockResolvedValue(mkOverview({ totalVulnerabilities: 10 }));

    const { result } = renderHook(() => useProjectOverview('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(result.current.data?.totalVulnerabilities).toBe(10),
    );

    getProjectOverviewMock.mockRejectedValueOnce(new Error('boom'));

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { VULNERABILITY_BATCH_APPENDED?: () => void }
      | undefined;

    await act(async () => {
      handlers!.VULNERABILITY_BATCH_APPENDED!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.totalVulnerabilities).toBe(10);
  });
});

/**
 * Every event of the project stats stream
 * relaunched the overview (24 SQL in series + a project Get), a scan
 * publishing one VULNERABILITY_BATCH_APPENDED per ingested batch. The
 * refresh is now throttled, the last event of a burst included.
 */
describe('useProjectOverview bounded realtime refresh', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    getProjectOverviewMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    fetchProjectMock.mockReset();

    getProjectOverviewMock.mockResolvedValue(mkOverview());
    getProjectBranchesMock.mockResolvedValue({ branches: [] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    fetchProjectMock.mockResolvedValue({ parsedBranches: [] });
  });

  it('relaunches the overview at most twice for 8 stats events in 1 s', async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useProjectOverview('p1'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const atMount = getProjectOverviewMock.mock.calls.length;

      const types = [
        'VULNERABILITY_BATCH_APPENDED',
        'SCAN_STATUS_CHANGED',
        'STATS_AGGREGATE_CHANGED',
        'POLICY_EVALUATION_COMPLETED',
      ];
      for (let i = 0; i < 8; i += 1) {
        await act(async () => {
          const handlers = realtimeMock.mock.calls.at(-1)![1] as Record<string, () => void>;
          handlers[types[i % types.length]]();
          await vi.advanceTimersByTimeAsync(125);
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      // 1 leading + 1 trailing.
      expect(getProjectOverviewMock.mock.calls.length - atMount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// A realtime refresh that supersedes the
// first, visible load takes over its role. Silent or not, if it fails while
// nothing is on screen, the page must show the error, not stay empty.
describe('useProjectOverview — a silent refresh that supersedes the visible load', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    getProjectOverviewMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    fetchProjectMock.mockReset();
    getProjectBranchesMock.mockResolvedValue({ branches: [] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    fetchProjectMock.mockResolvedValue({ parsedBranches: [] });
  });

  it('shows its error when it fails before anything is on screen', async () => {
    const visible = deferred<ReturnType<typeof mkOverview>>();
    getProjectOverviewMock.mockReturnValueOnce(visible.promise);
    const { result } = renderHook(() => useProjectOverview('p1'));
    expect(result.current.loading).toBe(true);

    getProjectOverviewMock.mockRejectedValueOnce(new Error('gateway timeout'));
    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as { STATS_AGGREGATE_CHANGED: () => void };
    await act(async () => {
      handlers.STATS_AGGREGATE_CHANGED();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(apiErrorText(new Error('gateway timeout'))); // a fixed sentence, never the raw text
    expect(result.current.data).toBeNull();

    // The superseded visible load lands afterwards: ignored.
    await act(async () => {
      visible.resolve(mkOverview({ totalVulnerabilities: 3 }));
    });
    expect(result.current.error).toBe(apiErrorText(new Error('gateway timeout'))); // a fixed sentence, never the raw text
  });
});

// The branch list of a project the user
// already left must not replace the one of the project on screen.
describe('useProjectOverview — branches of a project already left', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    getProjectOverviewMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    fetchProjectMock.mockReset();
    getProjectOverviewMock.mockResolvedValue(mkOverview());
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    fetchProjectMock.mockResolvedValue({ parsedBranches: [] });
  });

  it('are ignored when they land after the next project', async () => {
    const forP1 = deferred<{ branches: string[] }>();
    getProjectBranchesMock.mockImplementation((projectId: string) =>
      projectId === 'p1' ? forP1.promise : Promise.resolve({ branches: ['develop'] }),
    );
    const { result, rerender } = renderHook((props: { id: string }) => useProjectOverview(props.id), {
      initialProps: { id: 'p1' },
    });

    rerender({ id: 'p2' });
    await waitFor(() => expect(result.current.branches.map((b) => b.name)).toEqual(['develop']));

    await act(async () => {
      forP1.resolve({ branches: ['main', 'old'] });
    });

    expect(result.current.branches.map((b) => b.name)).toEqual(['develop']);
  });
});
