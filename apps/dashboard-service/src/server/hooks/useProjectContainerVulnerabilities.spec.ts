import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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

const fetchMock = vi.fn();
vi.mock('../services/resultService', () => ({
  fetchContainerResultsForProject: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

vi.mock('./useDebouncedValue', () => ({
  default: (v: unknown) => v,
}));

import useProjectContainerVulnerabilities from './useProjectContainerVulnerabilities';

const baseOptions = { projectId: 'p1', imageId: 'img1', pageSize: 10, severity: [], status: [], priority: [], classType: [], sort: 'cvssScore', order: 'desc', searchQuery: '' };
const first = () => ({ vulnerabilities: [{ id: 'v1' }], total: 1, totalPages: 1, page: 1, projectName: 'p', scanProjectInfo: null, vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 1 } });
const second = () => ({ vulnerabilities: [{ id: 'v1' }, { id: 'v2' }], total: 2, totalPages: 1, page: 1, projectName: 'p', scanProjectInfo: null, vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 2 } });

type Handlers = Record<string, ((env?: unknown) => void) | undefined>;
const lastHandlers = (): Handlers =>
  realtimeMock.mock.calls.at(-1)?.[1] as Handlers;

// The Container Results page never refreshed on its own — unlike the
// SAST/SCA/IaC/Secret lists, these hooks had no realtime subscription at all,
// so a container scan's results only showed up after a manual reload.
describe('useProjectContainerVulnerabilities realtime wiring', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchMock.mockReset();
  });

  it('subscribes to the project issues stream with the scan/vuln/reconnect handlers', async () => {
    fetchMock.mockResolvedValueOnce(first());
    const { result } = renderHook(() => useProjectContainerVulnerabilities(baseOptions));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const [url, handlers] = realtimeMock.mock.calls.at(-1)!;
    expect(url).toBe('https://api/v1/realtime/projects/p1/issues/stream');
    expect(handlers.VULNERABILITY_BATCH_APPENDED).toBeTypeOf('function');
    expect(handlers.VULNERABILITY_UPDATED).toBeTypeOf('function');
    expect(handlers.SCAN_STATUS_CHANGED).toBeTypeOf('function');
    expect(handlers['snapshot-required']).toBeTypeOf('function');
  });

  it('refetches silently on VULNERABILITY_BATCH_APPENDED: no loading flash, data updated', async () => {
    fetchMock.mockResolvedValueOnce(first());
    const { result } = renderHook(() => useProjectContainerVulnerabilities(baseOptions));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalVulnerabilities).toBe(1);
    const initialCalls = fetchMock.mock.calls.length;

    let resolveSecond: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSecond = resolve; }),
    );

    await act(async () => {
      lastHandlers().VULNERABILITY_BATCH_APPENDED!();
    });
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 1);
    // The list must stay visible while the realtime refetch is in flight.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(second());
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.totalVulnerabilities).toBe(2);
  });

  it('refetches silently on snapshot-required (stream reconnected)', async () => {
    fetchMock.mockResolvedValueOnce(first());
    const { result } = renderHook(() => useProjectContainerVulnerabilities(baseOptions));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialCalls = fetchMock.mock.calls.length;

    fetchMock.mockResolvedValueOnce(second());
    await act(async () => {
      lastHandlers()['snapshot-required']!();
    });
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 1);
    expect(result.current.loading).toBe(false);
  });

  it('refetches the CURRENT page, not page 1', async () => {
    fetchMock.mockResolvedValueOnce(first());
    const { result } = renderHook(() => useProjectContainerVulnerabilities(baseOptions));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchMock.mockResolvedValueOnce({ ...first(), page: 3, currentPage: 3 });
    await act(async () => {
      result.current.goToPage(3);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ page: 3 }),
    );

    fetchMock.mockResolvedValueOnce({ ...second(), page: 3, currentPage: 3 });
    await act(async () => {
      lastHandlers().VULNERABILITY_BATCH_APPENDED!();
    });
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ page: 3 }),
    );
  });

  it('preserves visible data when a silent refetch fails', async () => {
    fetchMock.mockResolvedValueOnce(first());
    const { result } = renderHook(() => useProjectContainerVulnerabilities(baseOptions));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      lastHandlers().VULNERABILITY_BATCH_APPENDED!();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.totalVulnerabilities).toBe(1);
  });
  // A disabled hook must not hold an SSE connection open nor
  // issue no-op refetches on every event.
  it('does NOT open the stream while the hook is disabled', async () => {
    const { result } = renderHook(() => useProjectContainerVulnerabilities({ ...baseOptions, enabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const [url] = realtimeMock.mock.calls.at(-1)!;
    expect(url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The "no image selected" early return must honour the
  // silent contract too — a realtime refetch never touches the visible state.
  it('silent refetch without a selected image leaves the state untouched', async () => {
    fetchMock.mockResolvedValue(first());
    const { result } = renderHook(() => useProjectContainerVulnerabilities({ ...baseOptions, imageId: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = { ...result.current };
    const initialCalls = fetchMock.mock.calls.length;

    fetchMock.mockClear();
    await act(async () => {
      lastHandlers().VULNERABILITY_BATCH_APPENDED!();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.totalVulnerabilities).toBe(before.totalVulnerabilities);
    void initialCalls;
  });
});
