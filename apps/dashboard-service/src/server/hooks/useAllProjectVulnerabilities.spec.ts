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

const fetchSastMock = vi.fn();
const fetchScaMock = vi.fn();
const fetchIacMock = vi.fn();
const fetchContainerMock = vi.fn();
vi.mock('../services/resultService', () => ({
  fetchSastResultsForProject: (...args: unknown[]) => fetchSastMock(...args),
  fetchScaResultsForProject: (...args: unknown[]) => fetchScaMock(...args),
  fetchIacResultsForProject: (...args: unknown[]) => fetchIacMock(...args),
  fetchContainerResultsForProject: (...args: unknown[]) =>
    fetchContainerMock(...args),
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

import { useAllProjectVulnerabilities } from './useAllProjectVulnerabilities';

const mkResponse = (vulns: Array<{ id: string; currentSeverity?: string; createdAt?: string }> = []) => ({
  vulnerabilities: vulns,
});

describe('useAllProjectVulnerabilities realtime wiring', () => {
  it('exports a feature flag that defaults to true', () => {
    expect(features.realtime.issues).toBe(true);
  });
});

describe('useAllProjectVulnerabilities silent refresh', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchSastMock.mockReset();
    fetchScaMock.mockReset();
    fetchIacMock.mockReset();
    fetchContainerMock.mockReset();
  });

  const settleAll = (sast: any, sca: any, iac: any, container: any) => {
    fetchSastMock.mockResolvedValueOnce(sast);
    fetchScaMock.mockResolvedValueOnce(sca);
    fetchIacMock.mockResolvedValueOnce(iac);
    fetchContainerMock.mockResolvedValueOnce(container);
  };

  it('keeps loading=false when VULNERABILITY_BATCH_APPENDED triggers a refresh', async () => {
    settleAll(
      mkResponse([{ id: 'v1', currentSeverity: 'high' }]),
      mkResponse(),
      mkResponse(),
      mkResponse(),
    );

    const { result } = renderHook(() => useAllProjectVulnerabilities('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.vulnerabilities).toHaveLength(1);

    // Queue one controllable promise for SAST while the others resolve
    // immediately — Promise.allSettled waits for the slowest.
    let resolveSast: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSast = resolve;
        }),
    );
    fetchScaMock.mockResolvedValueOnce(mkResponse());
    fetchIacMock.mockResolvedValueOnce(mkResponse());
    fetchContainerMock.mockResolvedValueOnce(mkResponse());

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { VULNERABILITY_BATCH_APPENDED?: () => void }
      | undefined;
    expect(handlers?.VULNERABILITY_BATCH_APPENDED).toBeTypeOf('function');

    await act(async () => {
      handlers!.VULNERABILITY_BATCH_APPENDED!();
    });

    // Silent refresh in flight — loading must remain false.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSast(
        mkResponse([
          { id: 'v1', currentSeverity: 'high' },
          { id: 'v2', currentSeverity: 'high' },
        ]),
      );
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.vulnerabilities).toHaveLength(2);
  });

  it('silent-refreshes on snapshot-required (stream reconnected, events may have been lost)', async () => {
    settleAll(
      mkResponse([{ id: 'v1', currentSeverity: 'high' }]),
      mkResponse(),
      mkResponse(),
      mkResponse(),
    );

    const { result } = renderHook(() => useAllProjectVulnerabilities('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.vulnerabilities).toHaveLength(1);

    // Queue one controllable promise for SAST while the others resolve
    // immediately — Promise.allSettled waits for the slowest.
    let resolveSast: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSast = resolve;
        }),
    );
    fetchScaMock.mockResolvedValueOnce(mkResponse());
    fetchIacMock.mockResolvedValueOnce(mkResponse());
    fetchContainerMock.mockResolvedValueOnce(mkResponse());

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { 'snapshot-required'?: () => void }
      | undefined;
    expect(handlers?.['snapshot-required']).toBeTypeOf('function');

    await act(async () => {
      handlers!['snapshot-required']!();
    });

    // Silent refresh in flight — loading must remain false.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSast(
        mkResponse([
          { id: 'v1', currentSeverity: 'high' },
          { id: 'v2', currentSeverity: 'high' },
        ]),
      );
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.vulnerabilities).toHaveLength(2);
  });

  it('silent-refreshes on VULNERABILITY_UPDATED so agent verdict changes are reflected', async () => {
    settleAll(
      mkResponse([{ id: 'v1', currentSeverity: 'high' }]),
      mkResponse(),
      mkResponse(),
      mkResponse(),
    );

    const { result } = renderHook(() => useAllProjectVulnerabilities('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSast: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSast = resolve;
        }),
    );
    fetchScaMock.mockResolvedValueOnce(mkResponse());
    fetchIacMock.mockResolvedValueOnce(mkResponse());
    fetchContainerMock.mockResolvedValueOnce(mkResponse());

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { VULNERABILITY_UPDATED?: () => void }
      | undefined;
    expect(handlers?.VULNERABILITY_UPDATED).toBeTypeOf('function');

    await act(async () => {
      handlers!.VULNERABILITY_UPDATED!();
    });

    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSast(mkResponse([{ id: 'v1', currentSeverity: 'low' }]));
    });

    expect(result.current.loading).toBe(false);
  });

  it('keeps loading=true when the manual refetch is invoked', async () => {
    settleAll(
      mkResponse([{ id: 'v1', currentSeverity: 'high' }]),
      mkResponse(),
      mkResponse(),
      mkResponse(),
    );

    const { result } = renderHook(() => useAllProjectVulnerabilities('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSast: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSast = resolve;
        }),
    );
    fetchScaMock.mockResolvedValueOnce(mkResponse());
    fetchIacMock.mockResolvedValueOnce(mkResponse());
    fetchContainerMock.mockResolvedValueOnce(mkResponse());

    await act(async () => {
      result.current.refetch();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveSast(mkResponse([{ id: 'v3', currentSeverity: 'high' }]));
    });

    expect(result.current.loading).toBe(false);
  });
});
