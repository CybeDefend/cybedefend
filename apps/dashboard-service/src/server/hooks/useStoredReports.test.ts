import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useStoredReports } from './useStoredReports';
import * as resultService from '../services/resultService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

// The handlers the hook registers per stream URL, so a test can fire a
// realtime event. The mock never opens a socket.
const streams: Record<string, Record<string, (env: unknown) => void>> = {};
vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: (url: string | null, handlers: Record<string, (env: unknown) => void>) => {
    if (url) streams[url] = handlers;
  },
}));
vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api.test' }),
}));

vi.mock('../services/resultService', () => ({
  listProjectReports: vi.fn(),
  listOrganizationReports: vi.fn(),
  listTeamReports: vi.fn(),
  deleteProjectReport: vi.fn(),
  deleteOrganizationReport: vi.fn(),
  deleteTeamReport: vi.fn(),
  getGeneratedReport: vi.fn(),
  getGeneratedAggregatedReport: vi.fn(),
  getProjectReportUsage: vi.fn(),
  getOrganizationReportUsage: vi.fn(),
}));

const mocked = resultService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('useStoredReports', () => {
  beforeEach(() => {
    Object.values(mocked).forEach((m) => m.mockReset?.());
    Object.keys(streams).forEach((url) => delete streams[url]);
  });

  describe('when a report of the scope becomes ready', () => {
    const page = (n: number) => ({
      items: Array.from({ length: n }, (_, i) => ({ reportId: `r${i}` })),
      total: n,
      page: 1,
      pageSize: 100,
    });

    it('re-reads the organisation list and the shared usage on AGGREGATED_REPORT_READY', async () => {
      mocked.listOrganizationReports
        .mockResolvedValueOnce(page(0))
        .mockResolvedValueOnce(page(3));
      mocked.getOrganizationReportUsage
        .mockResolvedValueOnce({ used: 0, limit: 500 })
        .mockResolvedValueOnce({ used: 3, limit: 500 });

      const { result } = renderHook(() =>
        useStoredReports({ kind: 'organization', organizationId: 'o1' }, { initialPageSize: 100 }),
      );
      await waitFor(() => expect(result.current.usage).toEqual({ used: 0, limit: 500 }));
      expect(result.current.total).toBe(0);

      const handlers = streams['https://api.test/v1/realtime/orgs/o1/reports/stream'];
      expect(handlers).toBeDefined();
      act(() => {
        handlers.AGGREGATED_REPORT_READY({
          type: 'AGGREGATED_REPORT_READY',
          payload: { aggregatedReportReady: { reportId: 'r2', status: 'ready' } },
        });
      });

      await waitFor(() => expect(result.current.total).toBe(3));
      await waitFor(() => expect(result.current.usage).toEqual({ used: 3, limit: 500 }));
    });

    it('re-reads the project list and the shared usage on REPORT_READY', async () => {
      mocked.listProjectReports.mockResolvedValueOnce(page(0)).mockResolvedValueOnce(page(1));
      mocked.getProjectReportUsage
        .mockResolvedValueOnce({ used: 0, limit: 500 })
        .mockResolvedValueOnce({ used: 1, limit: 500 });

      const { result } = renderHook(() => useStoredReports({ kind: 'project', projectId: 'p1' }));
      await waitFor(() => expect(result.current.usage).toEqual({ used: 0, limit: 500 }));

      act(() => {
        streams['https://api.test/v1/realtime/projects/p1/reports/stream'].REPORT_READY({
          type: 'REPORT_READY',
          payload: { reportReady: { reportId: 'r0', status: 'ready' } },
        });
      });

      await waitFor(() => expect(result.current.total).toBe(1));
      await waitFor(() => expect(result.current.usage).toEqual({ used: 1, limit: 500 }));
    });

    it('re-reads the team list on AGGREGATED_REPORT_READY from the team stream', async () => {
      mocked.listTeamReports.mockResolvedValueOnce(page(0)).mockResolvedValueOnce(page(2));

      const { result } = renderHook(() => useStoredReports({ kind: 'team', teamId: 't1' }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        streams['https://api.test/v1/realtime/teams/t1/reports/stream'].AGGREGATED_REPORT_READY({
          type: 'AGGREGATED_REPORT_READY',
        });
      });

      await waitFor(() => expect(result.current.total).toBe(2));
    });

    it('re-reads the list and the usage after a reconnect (snapshot-required)', async () => {
      mocked.listOrganizationReports.mockResolvedValueOnce(page(0)).mockResolvedValueOnce(page(1));
      mocked.getOrganizationReportUsage
        .mockResolvedValueOnce({ used: 0, limit: 500 })
        .mockResolvedValueOnce({ used: 1, limit: 500 });

      const { result } = renderHook(() =>
        useStoredReports({ kind: 'organization', organizationId: 'o1' }),
      );
      await waitFor(() => expect(result.current.usage).toEqual({ used: 0, limit: 500 }));

      act(() => {
        streams['https://api.test/v1/realtime/orgs/o1/reports/stream']['snapshot-required']({
          type: 'snapshot-required',
        });
      });

      await waitFor(() => expect(result.current.total).toBe(1));
      await waitFor(() => expect(result.current.usage).toEqual({ used: 1, limit: 500 }));
    });

    it('refresh() re-reads the usage as well as the list', async () => {
      mocked.listOrganizationReports.mockResolvedValue(page(0));
      mocked.getOrganizationReportUsage
        .mockResolvedValueOnce({ used: 0, limit: 500 })
        .mockResolvedValueOnce({ used: 4, limit: 500 });

      const { result } = renderHook(() =>
        useStoredReports({ kind: 'organization', organizationId: 'o1' }),
      );
      await waitFor(() => expect(result.current.usage).toEqual({ used: 0, limit: 500 }));

      act(() => {
        result.current.refresh();
      });

      await waitFor(() => expect(result.current.usage).toEqual({ used: 4, limit: 500 }));
    });
  });

  it('loads the project list on mount and exposes items + total', async () => {
    mocked.listProjectReports.mockResolvedValue({
      items: [
        {
          reportId: 'r1',
          kind: 'owasp',
          format: 'pdf',
          status: 'ready',
          filename: 'owasp.pdf',
          createdAtMs: 1,
          expiresAtMs: 2,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    const { result } = renderHook(() =>
      useStoredReports({ kind: 'project', projectId: 'p1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocked.listProjectReports).toHaveBeenCalledWith('p1', 1, 10);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.total).toBe(1);
  });

  it('loads the org-wide shared usage and re-fetches it after a delete', async () => {
    mocked.listProjectReports
      .mockResolvedValueOnce({ items: [{ reportId: 'r1' }], total: 1, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 });
    mocked.deleteProjectReport.mockResolvedValue(undefined);
    mocked.getProjectReportUsage
      .mockResolvedValueOnce({ used: 12, limit: 500 })
      .mockResolvedValueOnce({ used: 11, limit: 500 });

    const { result } = renderHook(() =>
      useStoredReports({ kind: 'project', projectId: 'p1' }),
    );

    await waitFor(() => expect(result.current.usage).toEqual({ used: 12, limit: 500 }));
    expect(mocked.getProjectReportUsage).toHaveBeenCalledWith('p1');

    await act(async () => {
      await result.current.deleteReport('r1');
    });
    // The freed slot is reflected by a fresh usage fetch.
    await waitFor(() => expect(result.current.usage).toEqual({ used: 11, limit: 500 }));
  });

  it('honours initialPageSize for the first fetch (per-card counts need a wide page)', async () => {
    mocked.listProjectReports.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    const { result } = renderHook(() =>
      useStoredReports(
        { kind: 'project', projectId: 'p1' },
        { initialPageSize: 100 },
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocked.listProjectReports).toHaveBeenCalledWith('p1', 1, 100);
    expect(result.current.pageSize).toBe(100);
  });

  it('surfaces an error and empties the list on failure', async () => {
    mocked.listOrganizationReports.mockRejectedValue({
      response: { data: { message: 'boom' } },
    });

    const { result } = renderHook(() =>
      useStoredReports({ kind: 'organization', organizationId: 'org-1' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(apiErrorText(new Error('boom'))); // a fixed sentence, never the raw text
    expect(result.current.items).toEqual([]);
  });

  it('delete calls the per-scope delete then refreshes the list', async () => {
    mocked.listProjectReports
      .mockResolvedValueOnce({ items: [{ reportId: 'r1' }], total: 1, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 });
    mocked.deleteProjectReport.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useStoredReports({ kind: 'project', projectId: 'p1' }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.deleteReport('r1');
    });

    expect(mocked.deleteProjectReport).toHaveBeenCalledWith('p1', 'r1');
    await waitFor(() => expect(result.current.total).toBe(0));
  });

  it('download re-signs via getGeneratedReport and opens the URL', async () => {
    mocked.listProjectReports.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    mocked.getGeneratedReport.mockResolvedValue({
      reportId: 'r1',
      status: 'ready',
      downloadUrl: 'https://signed/x',
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const { result } = renderHook(() =>
      useStoredReports({ kind: 'project', projectId: 'p1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.downloadReport('r1');
    });

    expect(mocked.getGeneratedReport).toHaveBeenCalledWith('p1', 'r1');
    expect(openSpy).toHaveBeenCalledWith(
      'https://signed/x',
      '_blank',
      'noopener',
    );
    openSpy.mockRestore();
  });
});
