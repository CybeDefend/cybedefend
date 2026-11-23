import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const getOrganizationOverviewMock = vi.fn();
vi.mock('@/server/services/resultService', () => ({
  getOrganizationOverview: (...args: unknown[]) =>
    getOrganizationOverviewMock(...args),
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

import { useOrganizationOverview } from './useOrganizationOverview';
import { IN_FLIGHT_MAX_WAIT_MS } from './useThrottledRealtimeRefresh';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const mkOverview = (overrides: Record<string, unknown> = {}) => ({
  totalVulnerabilities: 10,
  ...overrides,
});

describe('useOrganizationOverview realtime wiring', () => {
  it('exports a feature flag that defaults to true', () => {
    expect(features.realtime.orgOverview).toBe(true);
  });
});

describe('useOrganizationOverview silent refresh', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    getOrganizationOverviewMock.mockReset();
  });

  it('keeps loading=false when VULNERABILITY_BATCH_APPENDED triggers a refresh', async () => {
    getOrganizationOverviewMock.mockResolvedValue(
      mkOverview({ totalVulnerabilities: 10 }),
    );

    const { result } = renderHook(() => useOrganizationOverview('org-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(result.current.data?.totalVulnerabilities).toBe(10),
    );

    let resolveSecond: (value: ReturnType<typeof mkOverview>) => void = () => {};
    getOrganizationOverviewMock.mockImplementationOnce(
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

    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkOverview({ totalVulnerabilities: 12 }));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data?.totalVulnerabilities).toBe(12);
  });

  it('keeps loading=true when the manual refresh is invoked', async () => {
    getOrganizationOverviewMock.mockResolvedValue(
      mkOverview({ totalVulnerabilities: 5 }),
    );

    const { result } = renderHook(() => useOrganizationOverview('org-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSecond: (value: ReturnType<typeof mkOverview>) => void = () => {};
    getOrganizationOverviewMock.mockImplementationOnce(
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
    getOrganizationOverviewMock.mockResolvedValue(
      mkOverview({ totalVulnerabilities: 10 }),
    );

    const { result } = renderHook(() => useOrganizationOverview('org-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(result.current.data?.totalVulnerabilities).toBe(10),
    );

    getOrganizationOverviewMock.mockRejectedValueOnce(new Error('boom'));

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
 * The overview is an org-wide aggregate (p95 2.2 s), and
 * every event of the org overview stream relaunched it, a scan publishing one
 * VULNERABILITY_BATCH_APPENDED per batch. It is now throttled, and an answer
 * that a newer request superseded never reaches the screen.
 */
describe('useOrganizationOverview bounded realtime refresh', () => {
  /** Every overview request, each answered when the test chooses. */
  const heldRequests = () => {
    const answers: Array<(value: ReturnType<typeof mkOverview>) => void> = [];
    getOrganizationOverviewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    return {
      count: () => answers.length,
      answer: async (index: number, totalVulnerabilities: number) => {
        await act(async () => {
          answers[index](mkOverview({ totalVulnerabilities }));
          await Promise.resolve();
        });
      },
    };
  };
  const handlers = () =>
    realtimeMock.mock.calls.at(-1)![1] as Record<string, (env?: unknown) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    realtimeMock.mockClear();
    getOrganizationOverviewMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('relaunches the aggregate at most twice for 10 events in 1 s', async () => {
    getOrganizationOverviewMock.mockResolvedValue(mkOverview());
    renderHook(() => useOrganizationOverview('org-1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getOrganizationOverviewMock).toHaveBeenCalledTimes(1);

    const types = [
      'VULNERABILITY_BATCH_APPENDED',
      'SCAN_STATUS_CHANGED',
      'STATS_AGGREGATE_CHANGED',
      'PROJECT_STATE_CHANGED',
      'POLICY_EVALUATION_COMPLETED',
    ];
    for (let i = 0; i < 10; i += 1) {
      await act(async () => {
        handlers()[types[i % types.length]]();
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // 1 initial load + 1 leading + 1 trailing.
    expect(getOrganizationOverviewMock).toHaveBeenCalledTimes(3);
  });

  it('never runs two realtime refreshes of the aggregate at once', async () => {
    const requests = heldRequests();
    renderHook(() => useOrganizationOverview('org-1'));
    await requests.answer(0, 10);

    await act(async () => {
      handlers().VULNERABILITY_BATCH_APPENDED();
      handlers().VULNERABILITY_BATCH_APPENDED();
      // Well past the window, still under the wait bound.
      await vi.advanceTimersByTimeAsync(IN_FLIGHT_MAX_WAIT_MS - 1);
    });
    expect(requests.count()).toBe(2);

    await requests.answer(1, 11);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requests.count()).toBe(3);
  });

  it('ignores an answer that a newer request superseded', async () => {
    const requests = heldRequests();
    const { result } = renderHook(() => useOrganizationOverview('org-1'));
    await requests.answer(0, 10);

    // A realtime refresh starts, then the user asks for a refresh.
    await act(async () => {
      handlers().SCAN_STATUS_CHANGED();
    });
    await act(async () => {
      void result.current.refresh();
    });
    expect(requests.count()).toBe(3);

    // The newer request answers first, the older one last.
    await requests.answer(2, 20);
    await requests.answer(1, 15);

    expect(result.current.data).toEqual(mkOverview({ totalVulnerabilities: 20 }));
    expect(result.current.loading).toBe(false);
  });

  // A realtime refresh that supersedes the first (blocking) load and fails
  // would otherwise leave no data, no error and no loader: a blank page.
  it('reports the failure of a silent refresh when nothing is on screen yet', async () => {
    let failSilent: (reason: unknown) => void = () => {};
    getOrganizationOverviewMock
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failSilent = reject;
          }),
      );
    const { result } = renderHook(() => useOrganizationOverview('org-1'));
    await act(async () => {
      handlers().SCAN_STATUS_CHANGED();
    });

    await act(async () => {
      failSilent(new Error('gateway timeout'));
      await Promise.resolve();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(apiErrorText(new Error('gateway timeout'))); // a fixed sentence, never the raw text
  });
});
