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

const fetchGroupedSastMock = vi.fn();
const fetchGroupedContainerMock = vi.fn();
const fetchGroupedScaMock = vi.fn();
vi.mock('../services/resultService', () => ({
  fetchGroupedSastResults: (...args: unknown[]) => fetchGroupedSastMock(...args),
  fetchGroupedIacResults: vi.fn(),
  fetchGroupedCicdResults: vi.fn(),
  fetchGroupedSecretResults: vi.fn(),
  fetchGroupedScaResults: (...args: unknown[]) => fetchGroupedScaMock(...args),
  fetchGroupedContainerResults: (...args: unknown[]) => fetchGroupedContainerMock(...args),
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

vi.mock('./useDebouncedValue', () => ({
  default: <T,>(value: T) => value,
}));

import { useGroupedVulnerabilities } from './useGroupedVulnerabilities';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const mkResponse = (
  groups: Array<{ id: string }> = [],
  total = groups.length,
) => ({
  groupedVulnerabilities: groups,
  total,
  totalOccurrences: total,
  limit: 50,
  totalPages: Math.max(1, Math.ceil(total / 50)),
  projectName: 'p',
  scanProjectInfo: null,
  vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 },
  autofixCountByType: null,
  isProjectParsed: false,
});

const baseOptions = {
  projectId: 'p1',
  type: 'sast' as const,
};

describe('useGroupedVulnerabilities realtime wiring', () => {
  it('reuses the realtime.issues feature flag (same channel as detailed view)', () => {
    // Grouped + detailed views of the same project share the
    // cybe:event:project:<id>:issues channel so a single feature flag controls both.
    expect(features.realtime.issues).toBe(true);
  });
});

describe('useGroupedVulnerabilities silent refresh', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchGroupedSastMock.mockReset();
  });

  it('keeps loading=false when VULNERABILITY_BATCH_APPENDED triggers a refresh', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalGroups).toBe(1);

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchGroupedSastMock.mockImplementationOnce(
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
      resolveSecond(mkResponse([{ id: 'g1' }, { id: 'g2' }], 2));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.totalGroups).toBe(2);
  });

  it('silent-refreshes on snapshot-required (stream reconnected, events may have been lost)', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalGroups).toBe(1);

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchGroupedSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { 'snapshot-required'?: () => void }
      | undefined;
    expect(handlers?.['snapshot-required']).toBeTypeOf('function');

    await act(async () => {
      handlers!['snapshot-required']!();
    });

    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkResponse([{ id: 'g1' }, { id: 'g2' }], 2));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.totalGroups).toBe(2);
  });

  it('keeps loading=true when the manual refresh is invoked', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchGroupedSastMock.mockImplementationOnce(
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
      resolveSecond(mkResponse([{ id: 'g2' }], 1));
    });

    expect(result.current.loading).toBe(false);
  });

  it('silent-refreshes on VULNERABILITY_UPDATED so agent verdict changes are reflected', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchGroupedSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { VULNERABILITY_UPDATED?: () => void }
      | undefined;
    expect(handlers?.VULNERABILITY_UPDATED).toBeTypeOf('function');

    await act(async () => {
      handlers!.VULNERABILITY_UPDATED!();
    });

    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkResponse([{ id: 'g1' }], 1));
    });

    expect(result.current.loading).toBe(false);
  });

  it('routes type=container to fetchGroupedContainerResults with imageId + classType mapping', async () => {
    fetchGroupedContainerMock.mockReset();
    fetchGroupedContainerMock.mockResolvedValueOnce(mkResponse([{ id: 'tar' }], 1));

    const { result } = renderHook(() =>
      useGroupedVulnerabilities({
        projectId: 'p1',
        type: 'container',
        imageId: 'img-1',
        classTypeFilter: ['lang-pkgs'],
        severityFilter: ['critical'],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalGroups).toBe(1);

    expect(fetchGroupedContainerMock).toHaveBeenCalledTimes(1);
    const [, , opts] = fetchGroupedContainerMock.mock.calls[0];
    expect(opts).toMatchObject({
      imageId: 'img-1',
      classTypeFilter: ['lang-pkgs'],
      severityFilter: ['critical'],
    });
  });

  it('preserves visible data when a silent refresh fails', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalGroups).toBe(1);

    fetchGroupedSastMock.mockRejectedValueOnce(new Error('boom'));

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
    expect(result.current.totalGroups).toBe(1);
    expect(result.current.groups).toHaveLength(1);
  });
});

describe('useGroupedVulnerabilities embedded languages', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchGroupedSastMock.mockReset();
  });

  it('surfaces availableLanguages from the grouped response languages field', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce({
      ...mkResponse([{ id: 'g1' }], 1),
      languages: ['go', 'python'],
    });

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.availableLanguages).toEqual(['go', 'python']);
  });

  it('defaults availableLanguages to an empty array when the field is absent', async () => {
    fetchGroupedSastMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.availableLanguages).toEqual([]);
  });
});

describe('useGroupedVulnerabilities malware filter', () => {
  beforeEach(() => {
    fetchGroupedScaMock.mockReset();
  });

  it('does not send malwareOnly for SCA when the option is unset (default excludes malware)', async () => {
    fetchGroupedScaMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() =>
      useGroupedVulnerabilities({ projectId: 'p1', type: 'sca' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, , opts] = fetchGroupedScaMock.mock.calls.at(-1) as [
      string,
      string | undefined,
      Record<string, unknown>,
    ];
    expect(opts.malwareOnly).toBeUndefined();
  });

  it('forwards malwareOnly=true to the grouped SCA fetch when the malware tab is active', async () => {
    fetchGroupedScaMock.mockResolvedValueOnce(mkResponse([{ id: 'g1' }], 1));

    const { result } = renderHook(() =>
      useGroupedVulnerabilities({ projectId: 'p1', type: 'sca', malwareOnly: true }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, , opts] = fetchGroupedScaMock.mock.calls.at(-1) as [
      string,
      string | undefined,
      Record<string, unknown>,
    ];
    expect(opts.malwareOnly).toBe(true);
  });

  it('surfaces the project-wide malwareCount from the grouped SCA response', async () => {
    fetchGroupedScaMock.mockResolvedValueOnce({
      ...mkResponse([{ id: 'g1' }], 1),
      malwareCount: 2,
    });

    const { result } = renderHook(() =>
      useGroupedVulnerabilities({ projectId: 'p1', type: 'sca' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.malwareCount).toBe(2);
  });
});

// A Results page never shows the autofix counts: it asks the
// grouped list to leave them out.
describe('useGroupedVulnerabilities autofix counts', () => {
  beforeEach(() => {
    fetchGroupedSastMock.mockReset();
  });

  it('asks the grouped list to leave out the autofix counts', async () => {
    fetchGroupedSastMock.mockResolvedValue(mkResponse());

    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchGroupedSastMock).toHaveBeenCalled();
    expect(fetchGroupedSastMock.mock.calls[0][2]).toMatchObject({ excludeAutofixCounts: true });
  });
});

// Changing a filter away from page 1 sent two requests
// (the new filter on the old page, then page 1 once the reset effect ran),
// and an answer to a superseded request could land last and stay on screen.
describe('useGroupedVulnerabilities — filter change away from page 1', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchGroupedSastMock.mockReset();
  });

  const pageOf = (call: unknown[]) => (call[2] as { page: number }).page;

  it('sends one request, for page 1, when a filter changes on page 3', async () => {
    fetchGroupedSastMock.mockImplementation(
      async (_p: string, _s: string, o: { page: number }) => mkResponse([{ id: `page-${o.page}` }], 200),
    );
    const { result, rerender } = renderHook(
      (props: { severity: string[] }) =>
        useGroupedVulnerabilities({ ...baseOptions, page: 3, severityFilter: props.severity }),
      { initialProps: { severity: [] as string[] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchGroupedSastMock.mock.calls.map(pageOf)).toEqual([3]);

    fetchGroupedSastMock.mockClear();
    await act(async () => {
      rerender({ severity: ['HIGH'] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchGroupedSastMock.mock.calls.map(pageOf)).toEqual([1]);
    expect(fetchGroupedSastMock.mock.calls[0][2]).toMatchObject({ severityFilter: ['HIGH'] });
    expect(result.current.currentPage).toBe(1);
  });

  it('ignores the answer to a superseded page that lands after the newer one', async () => {
    let resolvePage3: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchGroupedSastMock.mockImplementation((_p: string, _s: string, o: { page: number }) =>
      o.page === 3
        ? new Promise((resolve) => {
            resolvePage3 = resolve;
          })
        : Promise.resolve(mkResponse([{ id: `page-${o.page}` }], 200)),
    );
    const { result, rerender } = renderHook(
      (props: { severity: string[] }) =>
        useGroupedVulnerabilities({ ...baseOptions, severityFilter: props.severity }),
      { initialProps: { severity: [] as string[] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The user opens page 3, then changes a filter before page 3 answers.
    await act(async () => {
      result.current.goToPage(3);
    });
    await act(async () => {
      rerender({ severity: ['HIGH'] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.groups[0] as unknown as { id: string }).id).toBe('page-1');

    await act(async () => {
      resolvePage3(mkResponse([{ id: 'page-3-STALE' }], 200));
    });

    expect((result.current.groups[0] as unknown as { id: string }).id).toBe('page-1');
    expect(result.current.currentPage).toBe(1);
    expect(result.current.loading).toBe(false);
  });
});

// A realtime refresh that supersedes the
// first, visible load takes over its role: if it fails, the error shows.
describe('useGroupedVulnerabilities — a silent refresh that supersedes the visible load', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchGroupedSastMock.mockReset();
  });

  it('shows its error when it fails before anything is on screen', async () => {
    let resolveVisible: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchGroupedSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVisible = resolve;
        }),
    );
    const { result } = renderHook(() => useGroupedVulnerabilities(baseOptions));
    await waitFor(() => expect(fetchGroupedSastMock).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);

    fetchGroupedSastMock.mockRejectedValueOnce(new Error('gateway timeout'));
    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as { VULNERABILITY_BATCH_APPENDED: () => void };
    await act(async () => {
      handlers.VULNERABILITY_BATCH_APPENDED();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(apiErrorText(new Error('gateway timeout'))); // a fixed sentence, never the raw text

    await act(async () => {
      resolveVisible(mkResponse([{ id: 'stale' }], 1));
    });
    expect(result.current.error).toBe(apiErrorText(new Error('gateway timeout'))); // a fixed sentence, never the raw text
    expect(result.current.groups).toHaveLength(0);
  });
});
