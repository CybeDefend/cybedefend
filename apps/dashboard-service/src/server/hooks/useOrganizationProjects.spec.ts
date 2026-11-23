import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { features } from '@/utils/featureFlags';

vi.mock('../services/projectService', () => ({
  fetchProjectsForOrganization: vi.fn(),
}));

vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: vi.fn(),
}));


vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api.test' }),
}));

import useOrganizationProjects from './useOrganizationProjects';
import { fetchProjectsForOrganization } from '../services/projectService';
import { useRealtimeStream } from './useRealtimeStream';

const mockedFetch = fetchProjectsForOrganization as ReturnType<typeof vi.fn>;
const mockedUseRealtimeStream = useRealtimeStream as ReturnType<typeof vi.fn>;

const scanningResponse = {
  projects: [{ id: 'p1', isScanning: true }],
  mainStatistics: null,
  totalProjects: 1,
  totalPages: 1,
};

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOrganizationProjects realtime wiring', () => {
  it('exports a feature flag that defaults to true', () => {
    expect(features.realtime.projectList).toBe(true);
  });
});

describe('useOrganizationProjects silent realtime refresh', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedUseRealtimeStream.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT flip loading to true when SCAN_STATUS_CHANGED triggers a refresh', async () => {
    // Initial fetch completes, loading goes back to false.
    mockedFetch.mockResolvedValueOnce({
      projects: [{ id: 'p1', isScanning: false, projectName: 'before' }],
      mainStatistics: null,
      totalProjects: 1,
      totalPages: 1,
    });

    const { result } = renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();
    expect(result.current.loading).toBe(false);

    // Defer the realtime-triggered refetch so we can observe loading mid-flight.
    let resolveRefetch: (v: any) => void = () => {};
    const refetchPromise = new Promise<any>((resolve) => {
      resolveRefetch = resolve;
    });
    mockedFetch.mockReturnValueOnce(refetchPromise);

    // Pull the latest handlers passed to useRealtimeStream and fire SCAN_STATUS_CHANGED.
    const lastCall = mockedUseRealtimeStream.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const handlers = lastCall![1] as Record<string, (env: any) => void>;
    expect(handlers.SCAN_STATUS_CHANGED).toBeTypeOf('function');

    await act(async () => {
      handlers.SCAN_STATUS_CHANGED({});
      await Promise.resolve();
    });

    // The skeleton must NOT be shown during a realtime-driven refresh — the
    // existing rows stay on screen while we silently refetch in the background.
    expect(result.current.loading).toBe(false);

    // Resolve the deferred fetch — data updates silently, loading stays false.
    await act(async () => {
      resolveRefetch({
        projects: [{ id: 'p1', isScanning: true, projectName: 'after' }],
        mainStatistics: null,
        totalProjects: 1,
        totalPages: 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.hasActiveScans).toBe(true);
  });
});

describe('useOrganizationProjects no interval polling (Phase 6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue(scanningResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('never sets up an interval timer — SSE is the only periodic refresh trigger', async () => {
    // Phase 6 removed the polling fallback. Realtime SSE drives refresh; even
    // with an actively scanning project, no timer-driven refetch must fire.
    expect(features.realtime.projectList).toBe(true);

    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();

    // Initial fetch ran once and reported a scanning project (hasActiveScans=true).
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // Advancing well past any former polling interval must add no fetches.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('useOrganizationProjects visibility refetch', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedUseRealtimeStream.mockReset();
    mockedFetch.mockResolvedValue({
      projects: [{ id: 'p1', isScanning: false }],
      mainStatistics: null,
      totalProjects: 1,
      totalPages: 1,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('silently refetches when the tab becomes visible again', async () => {
    vi.useFakeTimers();
    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();
    expect(mockedFetch).toHaveBeenCalledTimes(1); // initial load

    // Returning to a backgrounded tab triggers one extra background refetch —
    // browsers throttle hidden tabs and may drop the SSE, so the focus refetch
    // closes any gap left while the tab was hidden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  // A tab switch every few seconds refetched the list each time.
  it('does not refetch a list read less than 60 s ago', async () => {
    vi.useFakeTimers();
    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  // A disabled instance shows nothing (the policy form before the user picks
  // the project scope): neither the tab coming back nor an event refetches it.
  it('never refetches a disabled list, on the tab coming back or on an event', async () => {
    vi.useFakeTimers();
    renderHook(() => useOrganizationProjects('org-1', 10, '', false));
    await flushAsync();
    expect(mockedFetch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await flushAsync();

    const [url] = mockedUseRealtimeStream.mock.calls.at(-1)!;
    expect(url).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

/**
 * Each SCAN_STATUS_CHANGED / PROJECT_STATE_CHANGED of the
 * org projects stream reloaded the list AND the KPI cards at once, with no
 * throttle, in bursts of under a second. The KPI cards are read from
 * the persisted organisation statistics, which change only when the recompute
 * worker announces them (`org_stats_updated`).
 */
describe('useOrganizationProjects realtime refetches are bounded', () => {
  const handlers = () =>
    mockedUseRealtimeStream.mock.calls.at(-1)![1] as Record<string, (env?: unknown) => void>;
  const stateChanged = (changeType: string) => ({
    type: 'PROJECT_STATE_CHANGED',
    payload: { projectStateChanged: { changeType } },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockedFetch.mockReset();
    mockedUseRealtimeStream.mockReset();
    mockedFetch.mockResolvedValue({
      projects: [{ id: 'p1', isScanning: false }],
      mainStatistics: null,
      totalProjects: 1,
      totalPages: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('refetches the list at most twice for 4 SCAN_STATUS_CHANGED in 100 ms', async () => {
    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        handlers().SCAN_STATUS_CHANGED({ type: 'SCAN_STATUS_CHANGED' });
        await vi.advanceTimersByTimeAsync(25);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await flushAsync();

    // 1 initial load + 1 leading + 1 trailing.
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it('reloads the KPI cards on org_stats_updated only', async () => {
    const onOrgStatsUpdated = vi.fn();
    renderHook(() => useOrganizationProjects('org-1', 10, '', true, onOrgStatsUpdated));
    await flushAsync();

    await act(async () => {
      handlers().SCAN_STATUS_CHANGED({ type: 'SCAN_STATUS_CHANGED' });
      handlers().PROJECT_STATE_CHANGED(stateChanged('cyberrisk_updated'));
      handlers().PROJECT_STATE_CHANGED(stateChanged('updated'));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onOrgStatsUpdated).not.toHaveBeenCalled();

    await act(async () => {
      handlers().PROJECT_STATE_CHANGED(stateChanged('org_stats_updated'));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onOrgStatsUpdated).toHaveBeenCalledTimes(1);
  });

  // The gateway replays nothing and ends every stream when its token expires:
  // an `org_stats_updated` published during the reconnect is lost, and the
  // cards would keep the old numbers until the next recompute.
  it('reloads the list and the KPI cards when the stream reconnects', async () => {
    const onOrgStatsUpdated = vi.fn();
    renderHook(() => useOrganizationProjects('org-1', 10, '', true, onOrgStatsUpdated));
    await flushAsync();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers()['snapshot-required']?.({ type: 'snapshot-required' });
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(onOrgStatsUpdated).toHaveBeenCalledTimes(1);
  });

  it('still reloads the list on every kind of project change', async () => {
    renderHook(() => useOrganizationProjects('org-1', 10, ''));
    await flushAsync();

    for (const changeType of ['cyberrisk_updated', 'org_stats_updated', 'created']) {
      await act(async () => {
        handlers().PROJECT_STATE_CHANGED(stateChanged(changeType));
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });
});

/**
 * `loading` cannot tell « not asked yet » from « answered »: it is false for
 * the commit that precedes the first request, and stays false while an
 * instance waits on a request another instance started. `hasLoaded` is what a
 * page reads before it says an organisation has no project.
 */
describe('useOrganizationProjects hasLoaded', () => {
  const emptyResponse = { projects: [], mainStatistics: null, totalProjects: 0, totalPages: 0 };

  /** A request the test answers when it chooses to. */
  const holdRequest = () => {
    let resolve: (value: typeof emptyResponse) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<typeof emptyResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const settle = async (run: () => void) => {
      await act(async () => {
        run();
        await new Promise((done) => setTimeout(done, 0));
      });
    };
    return {
      promise,
      answer: () => settle(() => resolve(emptyResponse)),
      fail: () => settle(() => reject(new Error('boom'))),
    };
  };

  beforeEach(() => {
    mockedFetch.mockReset();
    mockedUseRealtimeStream.mockReset();
  });

  it('is false until the list has answered, even an empty one', async () => {
    const request = holdRequest();
    mockedFetch.mockReturnValueOnce(request.promise);
    const seen: boolean[] = [];

    const { result } = renderHook(() => {
      const value = useOrganizationProjects('org-loaded-1', 10, '');
      // Every render, including the one that precedes the request.
      seen.push(value.hasLoaded);
      return value;
    });

    expect(seen.every((hasLoaded) => hasLoaded === false)).toBe(true);
    expect(result.current.hasLoaded).toBe(false);

    await request.answer();

    expect(result.current.projects).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoaded).toBe(true);
  });

  it('is true once the list has refused to answer: the page then reads `error`', async () => {
    const request = holdRequest();
    mockedFetch.mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useOrganizationProjects('org-loaded-2', 10, ''));

    await request.fail();

    expect(result.current.error).toBeTruthy();
    expect(result.current.hasLoaded).toBe(true);
  });

  it('is false while it waits on a request another instance started', async () => {
    const request = holdRequest();
    mockedFetch.mockReturnValueOnce(request.promise);
    renderHook(() => useOrganizationProjects('org-loaded-3', 10, ''));
    const { result } = renderHook(() => useOrganizationProjects('org-loaded-3', 10, ''));

    // One request for both instances; the second one never reports `loading`.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoaded).toBe(false);

    await request.answer();

    expect(result.current.hasLoaded).toBe(true);
  });

  it('is false again for another organisation, until that one has answered', async () => {
    mockedFetch.mockResolvedValueOnce(emptyResponse);
    const seen: boolean[] = [];
    const { result, rerender } = renderHook(
      ({ organizationId }: { organizationId: string }) => {
        const value = useOrganizationProjects(organizationId, 10, '');
        // Every render, including the first one with the new organisation:
        // `result.current` only shows the last one committed.
        seen.push(value.hasLoaded);
        return value;
      },
      { initialProps: { organizationId: 'org-loaded-4' } },
    );
    await flushAsync();
    expect(result.current.hasLoaded).toBe(true);

    const request = holdRequest();
    mockedFetch.mockReturnValueOnce(request.promise);
    seen.length = 0;
    rerender({ organizationId: 'org-loaded-5' });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((hasLoaded) => hasLoaded === false)).toBe(true);
    expect(result.current.hasLoaded).toBe(false);

    await request.answer();

    expect(result.current.hasLoaded).toBe(true);
  });

  it('keeps the current organisation loaded when a late answer arrives for the one left behind', async () => {
    const left = holdRequest();
    mockedFetch.mockReturnValueOnce(left.promise);
    const { result, rerender } = renderHook(
      ({ organizationId }: { organizationId: string }) =>
        useOrganizationProjects(organizationId, 10, ''),
      { initialProps: { organizationId: 'org-loaded-6' } },
    );

    mockedFetch.mockResolvedValueOnce(emptyResponse);
    rerender({ organizationId: 'org-loaded-7' });
    await flushAsync();
    expect(result.current.hasLoaded).toBe(true);

    await left.answer();

    expect(result.current.hasLoaded).toBe(true);
  });

  it('is false while no organisation is selected', async () => {
    const { result } = renderHook(() => useOrganizationProjects('', 10, '', false));
    await flushAsync();
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(result.current.hasLoaded).toBe(false);
  });
});

/**
 * `fetchProjectsForOrganization` catches the failure of its request and
 * RESOLVES with the error. Read as it comes, a failed request is a list with
 * no project: the page then tells an organisation that has projects to create
 * its first one. The hook reads what it is handed before it calls it a list.
 */
describe('useOrganizationProjects when the service hands back its failure', () => {
  const projectsResponse = (name: string) => ({
    projects: [{ projectId: `p-${name}`, name, isScanning: false }],
    mainStatistics: null,
    totalProjects: 1,
    totalPages: 1,
  });
  /** What the service resolves with when its request fails: the error axios raised. */
  const returnedError = () =>
    Object.assign(new Error('Request failed with status code 403'), {
      response: { status: 403, data: { message: 'Forbidden resource' } },
    });

  /** A request the test settles when it chooses to, with whatever the service would hand back. */
  const holdRequest = () => {
    let resolve: (value: unknown) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const settle = async (run: () => void) => {
      await act(async () => {
        run();
        await new Promise((done) => setTimeout(done, 0));
      });
    };
    return {
      promise,
      answer: (value: unknown) => settle(() => resolve(value)),
      fail: () => settle(() => reject(new Error('boom'))),
    };
  };

  beforeEach(() => {
    mockedFetch.mockReset();
    mockedUseRealtimeStream.mockReset();
  });

  it.each([
    ['the error of its request, returned instead of thrown', 'org-failed-1', () => returnedError()],
    ['an error that carries no response', 'org-failed-2', () => new Error('Network Error')],
    ['an answer without a project list', 'org-failed-3', () => ({ totalProjects: 3 })],
    ['nothing at all', 'org-failed-4', () => undefined],
  ])('reports a failure, not an organisation without project, for %s', async (_case, organizationId, make) => {
    mockedFetch.mockResolvedValueOnce(make());
    const { result } = renderHook(() => useOrganizationProjects(organizationId, 10, ''));
    await flushAsync();

    expect(result.current.error).toBeTruthy();
    // Answered, as on a thrown failure: the page reads `error` before it reads the list.
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toEqual([]);
    expect(result.current.totalProjects).toBe(0);
    expect(result.current.totalPages).toBe(0);
  });

  it('reports it to the instance that waits on a request another instance started', async () => {
    const request = holdRequest();
    mockedFetch.mockReturnValueOnce(request.promise);
    const first = renderHook(() => useOrganizationProjects('org-failed-5', 10, ''));
    const second = renderHook(() => useOrganizationProjects('org-failed-5', 10, ''));
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await request.answer(returnedError());

    for (const { result } of [first, second]) {
      expect(result.current.error).toBeTruthy();
      expect(result.current.hasLoaded).toBe(true);
      expect(result.current.projects).toEqual([]);
    }
  });

  it('forgets the failure once a retry answers with the list', async () => {
    mockedFetch.mockResolvedValueOnce(returnedError());
    const { result } = renderHook(() => useOrganizationProjects('org-failed-6', 10, ''));
    await flushAsync();
    expect(result.current.error).toBeTruthy();

    mockedFetch.mockResolvedValueOnce(projectsResponse('api-gateway'));
    await act(async () => {
      result.current.refresh();
      await new Promise((done) => setTimeout(done, 0));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.projects).toHaveLength(1);
  });

  it('still reads a list with no project as an organisation without project', async () => {
    mockedFetch.mockResolvedValueOnce({ projects: [], mainStatistics: null, totalProjects: 0, totalPages: 0 });
    const { result } = renderHook(() => useOrganizationProjects('org-failed-7', 10, ''));
    await flushAsync();
    expect(result.current.error).toBeNull();
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.projects).toEqual([]);
  });

  describe('an answer that comes back for the organisation left behind', () => {
    const switchOrganization = (from: string, to: string) =>
      renderHook(
        ({ organizationId }: { organizationId: string }) =>
          useOrganizationProjects(organizationId, 10, ''),
        { initialProps: { organizationId: from } },
      );

    it('never replaces the list of the current organisation', async () => {
      const left = holdRequest();
      mockedFetch.mockReturnValueOnce(left.promise);
      const { result, rerender } = switchOrganization('org-left-1', 'org-current-1');

      mockedFetch.mockResolvedValueOnce(projectsResponse('current'));
      rerender({ organizationId: 'org-current-1' });
      await flushAsync();
      expect(result.current.projects.map((project) => project.name)).toEqual(['current']);

      await left.answer(projectsResponse('left-behind'));

      expect(result.current.hasLoaded).toBe(true);
      expect(result.current.projects.map((project) => project.name)).toEqual(['current']);
    });

    it.each([
      ['returned', (request: ReturnType<typeof holdRequest>) => request.answer(returnedError())],
      ['thrown', (request: ReturnType<typeof holdRequest>) => request.fail()],
    ])('never raises its failure, %s, on the current organisation', async (_case, settleLeft) => {
      const left = holdRequest();
      mockedFetch.mockReturnValueOnce(left.promise);
      const { result, rerender } = switchOrganization(`org-left-${_case}`, `org-current-${_case}`);

      mockedFetch.mockResolvedValueOnce(projectsResponse('current'));
      rerender({ organizationId: `org-current-${_case}` });
      await flushAsync();

      await settleLeft(left);

      expect(result.current.error).toBeNull();
      expect(result.current.projects.map((project) => project.name)).toEqual(['current']);
    });
  });
});
