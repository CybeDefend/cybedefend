import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Capture the handlers the hook registers on the persistent org/team reports
// stream so the test can fire an AGGREGATED_REPORT_READY event. The mock never
// opens a socket.
let capturedHandlers: any = null;
vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: (url: string | null, handlers: any) => {
    if (url) capturedHandlers = handlers;
  },
}));
vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api.test' }),
}));
vi.mock('../services/resultService', () => ({
  generateOrganizationReport: vi.fn(),
  generateTeamReport: vi.fn(),
  generateBatchReport: vi.fn(),
  getGeneratedAggregatedReport: vi.fn(),
}));

// Drive the fallback poll with injectable clock+sleep so the test can step
// through retries without real timers (mirrors the closed scanner-report hook test).
const fakeNow = { value: 0 };
let pendingSleepers: Array<() => void> = [];
const fakeSleep = vi.fn(async (ms: number) => {
  fakeNow.value += ms;
  await new Promise<void>((resolve) => {
    pendingSleepers.push(resolve);
  });
});
const drainSleepers = () => {
  const toResolve = pendingSleepers;
  pendingSleepers = [];
  for (const r of toResolve) r();
};
vi.mock('./reportPolling', async () => {
  const actual = await vi.importActual<typeof import('./reportPolling')>(
    './reportPolling',
  );
  return {
    ...actual,
    pollReportUntilSettled: (fetcher: any, opts: any) =>
      actual.pollReportUntilSettled(fetcher, {
        ...opts,
        now: () => fakeNow.value,
        sleep: fakeSleep,
      }),
  };
});

import { useAggregatedReports } from './useAggregatedReports';
import {
  generateOrganizationReport,
  generateTeamReport,
  generateBatchReport,
  getGeneratedAggregatedReport,
} from '../services/resultService';

const mockGenerateOrg = vi.mocked(generateOrganizationReport);
const mockGenerateTeam = vi.mocked(generateTeamReport);
const mockGenerateBatch = vi.mocked(generateBatchReport);
const mockGet = vi.mocked(getGeneratedAggregatedReport);

const enqueued = { reportId: 'agg-1', status: 'queued' } as any;
const ready = {
  reportId: 'agg-1',
  status: 'ready',
  reportType: 'owasp',
  scopeType: 'organization',
  scopeId: 'org-1',
  format: 'pdf',
  filename: 'org-report.pdf',
  contentType: 'application/pdf',
  downloadUrl: 'https://storage.googleapis.com/test-bucket/org-report.pdf?sig=stub',
  expiresAtMs: Date.now() + 15 * 60 * 1000,
  error: '',
} as any;

const fireAggReady = (reportId = 'agg-1', status = 'ready') =>
  capturedHandlers?.AGGREGATED_REPORT_READY?.({
    payload: { aggregatedReportReady: { reportId, status } },
  });

describe('useAggregatedReports (async)', () => {
  beforeEach(() => {
    mockGenerateOrg.mockReset();
    mockGenerateTeam.mockReset();
    mockGenerateBatch.mockReset();
    mockGet.mockReset();
    capturedHandlers = null;
    fakeNow.value = 0;
    fakeSleep.mockClear();
    pendingSleepers = [];
  });

  it('initial state: not loading, no error', () => {
    const { result } = renderHook(() => useAggregatedReports());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(a) queued→ready via fallback poll triggers auto-download + loading=false', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    // The poll sees `queued` once, then `ready` — converges without a realtime
    // event.
    mockGet
      .mockResolvedValueOnce({ ...ready, status: 'queued' } as any)
      .mockResolvedValueOnce(ready);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport(
        'org-1',
        'owasp',
        'pdf',
        true,
        true,
        'all',
        [],
      );
    });

    // After enqueue: still loading, no error.
    expect(mockGenerateOrg).toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    // First drain releases the safety-net grace (poll engages); second drain
    // releases the poll interval so it runs its second iteration and consumes
    // the `ready` mock.
    await act(async () => {
      drainSleepers();
    });
    await act(async () => {
      drainSleepers();
    });

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    click.mockRestore();
  });

  it('(b) failed status surfaces error', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    mockGet.mockResolvedValue({ ...ready, status: 'failed', error: 'render boom' } as any);
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });
    await act(async () => {
      drainSleepers();
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toMatch(/render boom/);
    expect(result.current.loading).toBe(false);
  });

  it('(c) claimSlot prevents double-apply (poll + event do not both download)', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    // Every fetch returns ready; the slot must be applied exactly once across
    // both the realtime event and the fallback poll.
    mockGet.mockResolvedValue(ready);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });

    // The realtime event claims the slot first.
    await act(async () => {
      fireAggReady();
    });
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));

    const callsAfterReady = mockGet.mock.calls.length;
    // Let the fallback poll run; it must NOT re-fetch or download again.
    await act(async () => {
      drainSleepers();
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGet.mock.calls.length).toBe(callsAfterReady);
    expect(click).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    click.mockRestore();
  });

  it('stream is primary: no eager queued poll before the grace; the SSE event resolves with a single fetch', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    mockGet.mockResolvedValue(ready);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });

    // The fallback poll must NOT hit the network eagerly — it waits a grace
    // period so the realtime stream drives the normal path. No `queued` poll.
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    // AGGREGATED_REPORT_READY arrives within the grace → exactly one fetch (the
    // unavoidable signed-URL refetch), then auto-download + loading=false.
    await act(async () => {
      fireAggReady('agg-1', 'ready');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('surfaces error message when the enqueue call throws', async () => {
    mockGenerateOrg.mockRejectedValueOnce(new Error('forbidden'));
    const { result } = renderHook(() => useAggregatedReports());
    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toMatch(/forbidden/);
    expect(result.current.loading).toBe(false);
  });

  it('enqueue response without reportId terminates loading with an error', async () => {
    // Defensive guard: a malformed enqueue response (no reportId, no
    // downloadUrl) must not leave `loading` stuck true forever — no poll can
    // start and no realtime event can claim the slot.
    mockGenerateOrg.mockResolvedValueOnce({ status: 'queued' } as any);
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });

  // Mirrors the closed scanner-report hook test [H12] fallback poll timeout test.
  it('fallback poll surfaces error on timeout', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    // Forever queued — the poll deadline triggers the timeout error.
    mockGet.mockResolvedValue({ ...ready, status: 'queued' } as any);
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });

    // Force the clock past REPORT_POLL_TIMEOUT_MS (10 min), then drain so the
    // poller wakes up and notices it has missed the deadline.
    fakeNow.value = 11 * 60 * 1000;
    await act(async () => {
      drainSleepers();
    });

    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 5000,
    });
    expect(result.current.error).toBe(
      'Report generation timed out. Please try again.',
    );
  });

  it('(a) SSE ready event then refetch rejects surfaces error, loading=false', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    // Fallback poll stays queued so the realtime path owns the slot; its
    // refetch rejects.
    mockGet.mockRejectedValue(new Error('refetch boom'));
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });

    await act(async () => {
      fireAggReady('agg-1', 'ready');
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toMatch(/refetch boom/);
    expect(result.current.loading).toBe(false);
  });

  it('(b) SSE failed event surfaces error without refetch, loading=false', async () => {
    mockGenerateOrg.mockResolvedValueOnce(enqueued);
    // Keep the fallback poll queued so the realtime `failed` event owns the
    // slot first; the failed branch must NOT trigger a refetch.
    mockGet.mockResolvedValue({ ...ready, status: 'queued' } as any);
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateOrgReport('org-1', 'owasp', 'pdf', true, true, 'all', []);
    });

    const callsBeforeEvent = mockGet.mock.calls.length;
    await act(async () => {
      fireAggReady('agg-1', 'failed');
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // The failed branch must NOT trigger a fresh refetch beyond the poll's own.
    expect(mockGet.mock.calls.length).toBe(callsBeforeEvent);
    expect(result.current.loading).toBe(false);
  });

  it('team report polls the team route via streamScope', async () => {
    mockGenerateTeam.mockResolvedValueOnce(enqueued);
    mockGet.mockResolvedValueOnce({ ...ready, status: 'queued' } as any).mockResolvedValueOnce(ready);
    const { result } = renderHook(() => useAggregatedReports());

    await act(async () => {
      await result.current.generateTeamReportFn('team-1', 'owasp', 'pdf', true, false, 'all', [], 'org-1');
    });
    // Drain the safety-net grace, then the poll interval (queued → ready).
    await act(async () => {
      drainSleepers();
    });
    await act(async () => {
      drainSleepers();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGet).toHaveBeenCalledWith({ type: 'team', id: 'team-1' }, 'agg-1');
  });
});
