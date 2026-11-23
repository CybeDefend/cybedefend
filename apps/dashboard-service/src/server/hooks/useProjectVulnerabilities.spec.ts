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
const fetchIacMock = vi.fn();
const fetchCicdMock = vi.fn();
const fetchSecretMock = vi.fn();
const fetchScaMock = vi.fn();
vi.mock('../services/resultService', () => ({
  fetchSastResultsForProject: (...args: unknown[]) => fetchSastMock(...args),
  fetchIacResultsForProject: (...args: unknown[]) => fetchIacMock(...args),
  fetchCicdResultsForProject: (...args: unknown[]) => fetchCicdMock(...args),
  fetchSecretResultsForProject: (...args: unknown[]) => fetchSecretMock(...args),
  fetchScaResultsForProject: (...args: unknown[]) => fetchScaMock(...args),
}));

vi.mock('react-toastify', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('@/i18n', () => ({ default: { language: 'en' } }));


vi.mock('./utils/hookCache', () => ({
  hookCache: { invalidate: vi.fn(), get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

vi.mock('./useDebouncedValue', () => ({
  default: <T,>(value: T) => value,
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

import useProjectVulnerabilities from './useProjectVulnerabilities';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const mkResponse = (vulns: Array<{ id: string }> = [], total = vulns.length) => ({
  vulnerabilities: vulns,
  scanProjectInfo: null,
  vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 },
  projectName: 'p',
  total,
  totalPages: Math.max(1, Math.ceil(total / 20)),
  isProjectParsed: false,
  reachabilityIgnoredCount: 0,
});

const baseOptions = {
  projectId: 'p1',
  type: 'sast' as const,
  pageSize: 20,
  severity: [] as string[],
  status: [] as string[],
  priority: [] as string[],
  sort: 'createdAt',
  order: 'desc',
  searchQuery: '',
};

describe('useProjectVulnerabilities realtime wiring', () => {
  it('exports a feature flag that defaults to true', () => {
    expect(features.realtime.issues).toBe(true);
  });
});

describe('useProjectVulnerabilities silent refresh', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchSastMock.mockReset();
    navigateMock.mockReset();
  });

  it('keeps loading=false when VULNERABILITY_BATCH_APPENDED triggers a refresh', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalVulnerabilities).toBe(1);

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
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

    // The realtime-driven refetch must NOT toggle the global loading flag —
    // the existing list must remain visible while the silent refetch runs.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkResponse([{ id: 'v1' }, { id: 'v2' }], 2));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.totalVulnerabilities).toBe(2);
  });

  it('silent-refreshes on snapshot-required (stream reconnected, events may have been lost)', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalVulnerabilities).toBe(1);

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
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

    // The realtime-driven refetch must NOT toggle the global loading flag —
    // the existing list must remain visible while the silent refetch runs.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkResponse([{ id: 'v1' }, { id: 'v2' }], 2));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.totalVulnerabilities).toBe(2);
  });

  it('keeps loading=true when the manual refresh is invoked', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    await act(async () => {
      result.current.refresh();
    });

    // Manual refresh keeps the existing loud-loader behaviour.
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveSecond(mkResponse([{ id: 'v2' }], 1));
    });

    expect(result.current.loading).toBe(false);
  });

  it('silent-refreshes on VULNERABILITY_UPDATED so agent verdict changes are reflected', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveSecond: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
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

    // Silent refresh in flight — the page must NOT flash a loader.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveSecond(mkResponse([{ id: 'v1', currentSeverity: 'low' } as any], 1));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.vulnerabilities[0]).toMatchObject({ id: 'v1' });
  });

  it('throttles a burst of realtime events into a single leading refresh (trailing covered by useThrottledRealtimeRefresh)', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCalls = fetchSastMock.mock.calls.length;

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | {
          VULNERABILITY_BATCH_APPENDED?: () => void;
          VULNERABILITY_UPDATED?: () => void;
          SCAN_STATUS_CHANGED?: () => void;
        }
      | undefined;

    // Burst of 4 events within ~0 ms — must produce exactly ONE leading
    // refetch. The trailing fire (within 5 s) is exercised in
    // useThrottledRealtimeRefresh.spec.ts; here we only assert that the
    // burst was actually coalesced.
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    await act(async () => {
      handlers!.VULNERABILITY_BATCH_APPENDED!();
      handlers!.VULNERABILITY_UPDATED!();
      handlers!.SCAN_STATUS_CHANGED!();
      handlers!.VULNERABILITY_BATCH_APPENDED!();
    });

    expect(fetchSastMock.mock.calls.length - initialCalls).toBe(1);
  });

  it('preserves visible data when a silent refresh fails', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalVulnerabilities).toBe(1);

    fetchSastMock.mockRejectedValueOnce(new Error('boom'));

    const handlers = realtimeMock.mock.calls.at(-1)?.[1] as
      | { VULNERABILITY_BATCH_APPENDED?: () => void }
      | undefined;

    await act(async () => {
      handlers!.VULNERABILITY_BATCH_APPENDED!();
    });
    // Let the rejection propagate through React's microtask queue.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.totalVulnerabilities).toBe(1);
    expect(result.current.vulnerabilities).toHaveLength(1);
  });
});

describe('useProjectVulnerabilities language filter', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchIacMock.mockReset();
  });

  // Regression: the detailed list must NOT send the UI locale (i18n.language,
  // e.g. "en") as the `language` vulnerability filter — the backend
  // would then run `WHERE language IN ('en')`, which matches no real detection
  // language (Terraform/YAML/...) and wrongly empties the detailed view.
  it('does not pass the UI locale as the language filter', async () => {
    fetchIacMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() =>
      useProjectVulnerabilities({ ...baseOptions, type: 'iac' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, options] = fetchIacMock.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(options.language).toBeUndefined();
  });

  it('forwards an explicit language selection and sourcePath to the detailed fetch', async () => {
    fetchSastMock.mockReset();
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() =>
      useProjectVulnerabilities({
        ...baseOptions,
        type: 'sast',
        language: ['python'],
        sourcePath: 'src/auth',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, options] = fetchSastMock.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(options.language).toEqual(['python']);
    expect(options.sourcePath).toBe('src/auth');
  });

  it('does not forward language/sourcePath for the SCA type', async () => {
    fetchScaMock.mockReset();
    fetchScaMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() =>
      useProjectVulnerabilities({
        ...baseOptions,
        type: 'sca',
        language: ['python'],
        sourcePath: 'src/auth',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, options] = fetchScaMock.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(options.language).toBeUndefined();
    expect(options.sourcePath).toBeUndefined();
  });
});

describe('useProjectVulnerabilities embedded languages', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchSastMock.mockReset();
  });

  it('surfaces availableLanguages from the response languages field', async () => {
    fetchSastMock.mockResolvedValueOnce({
      ...mkResponse([{ id: 'v1' }], 1),
      languages: ['go', 'python'],
    });

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.availableLanguages).toEqual(['go', 'python']);
  });

  it('defaults availableLanguages to an empty array when the field is absent', async () => {
    fetchSastMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.availableLanguages).toEqual([]);
  });
});

describe('useProjectVulnerabilities malware filter', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchScaMock.mockReset();
  });

  it('does not send malwareOnly when the option is unset (default excludes malware)', async () => {
    fetchScaMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() =>
      useProjectVulnerabilities({ ...baseOptions, type: 'sca' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, options] = fetchScaMock.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(options.malwareOnly).toBeUndefined();
  });

  it('forwards malwareOnly=true to the SCA fetch when the malware tab is active', async () => {
    fetchScaMock.mockResolvedValueOnce(mkResponse([{ id: 'v1' }], 1));

    const { result } = renderHook(() =>
      useProjectVulnerabilities({ ...baseOptions, type: 'sca', malwareOnly: true }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const [, options] = fetchScaMock.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(options.malwareOnly).toBe(true);
  });

  it('surfaces the project-wide malwareCount from the response', async () => {
    fetchScaMock.mockResolvedValueOnce({
      ...mkResponse([{ id: 'v1' }], 1),
      malwareCount: 3,
    });

    const { result } = renderHook(() =>
      useProjectVulnerabilities({ ...baseOptions, type: 'sca' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.malwareCount).toBe(3);
  });
});

describe('useProjectVulnerabilities — a project the user cannot see', () => {
  beforeEach(() => {
    fetchSastMock.mockReset();
    navigateMock.mockReset();
  });

  it.each([403, 404])('on %s leaves for the AppSec home, never the root', async (status) => {
    fetchSastMock.mockRejectedValueOnce({ response: { status }, message: 'no access' });

    renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/appsec', { replace: true }));
  });
});

// A Results page never shows the autofix counts: it asks the
// list to leave them out.
describe('useProjectVulnerabilities autofix counts', () => {
  beforeEach(() => {
    fetchSastMock.mockReset();
    fetchScaMock.mockReset();
  });

  it('asks the list to leave out the autofix counts', async () => {
    fetchSastMock.mockResolvedValue(mkResponse());

    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSastMock).toHaveBeenCalled();
    expect(fetchSastMock.mock.calls[0][1]).toMatchObject({ excludeAutofixCounts: true });
  });

  it('does the same on the SCA list', async () => {
    fetchScaMock.mockResolvedValue(mkResponse());

    const { result } = renderHook(() =>
      useProjectVulnerabilities({ ...baseOptions, type: 'sca' as const }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchScaMock.mock.calls[0][1]).toMatchObject({ excludeAutofixCounts: true });
  });
});

// Same two defects as the grouped view. The abort guard
// read `abortControllerRef.current`, i.e. the controller of the NEWEST
// request, so an answer to a superseded one was never recognised as stale.
describe('useProjectVulnerabilities — filter change away from page 1', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchSastMock.mockReset();
    navigateMock.mockReset();
  });

  const pageOf = (call: unknown[]) => (call[1] as { pageNumber: number }).pageNumber;

  it('sends one request, for page 1, when a filter changes on page 3', async () => {
    fetchSastMock.mockImplementation(async (_p: string, o: { pageNumber: number }) =>
      mkResponse([{ id: `page-${o.pageNumber}` }], 200),
    );
    const { result, rerender } = renderHook(
      (props: { severity: string[] }) =>
        useProjectVulnerabilities({ ...baseOptions, initialPage: 3, severity: props.severity }),
      { initialProps: { severity: [] as string[] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSastMock.mock.calls.map(pageOf)).toEqual([3]);

    fetchSastMock.mockClear();
    await act(async () => {
      rerender({ severity: ['HIGH'] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchSastMock.mock.calls.map(pageOf)).toEqual([1]);
    expect(fetchSastMock.mock.calls[0][1]).toMatchObject({ severity: ['HIGH'] });
    expect(result.current.currentPage).toBe(1);
  });

  it('ignores the answer to a superseded page that lands after the newer one', async () => {
    let resolvePage3: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementation((_p: string, o: { pageNumber: number }) =>
      o.pageNumber === 3
        ? new Promise((resolve) => {
            resolvePage3 = resolve;
          })
        : Promise.resolve(mkResponse([{ id: `page-${o.pageNumber}` }], 200)),
    );
    const { result, rerender } = renderHook(
      (props: { severity: string[] }) =>
        useProjectVulnerabilities({ ...baseOptions, severity: props.severity }),
      { initialProps: { severity: [] as string[] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.goToPage(3);
    });
    await act(async () => {
      rerender({ severity: ['HIGH'] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.vulnerabilities[0] as { id: string }).id).toBe('page-1');

    await act(async () => {
      resolvePage3(mkResponse([{ id: 'page-3-STALE' }], 200));
    });

    expect((result.current.vulnerabilities[0] as { id: string }).id).toBe('page-1');
    expect(result.current.currentPage).toBe(1);
    expect(result.current.loading).toBe(false);
  });
});

describe('useProjectVulnerabilities — answer after unmount', () => {
  beforeEach(() => {
    fetchSastMock.mockReset();
    navigateMock.mockReset();
  });

  it('does not navigate away on a 403 that lands after the page was left', async () => {
    let reject403: (error: unknown) => void = () => {};
    fetchSastMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          reject403 = reject;
        }),
    );
    const { unmount } = renderHook(() => useProjectVulnerabilities(baseOptions));
    await waitFor(() => expect(fetchSastMock).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      reject403({ status: 403 });
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// A realtime refresh that supersedes the
// first, visible load takes over its role: if it fails, the error shows.
describe('useProjectVulnerabilities — a silent refresh that supersedes the visible load', () => {
  beforeEach(() => {
    realtimeMock.mockClear();
    fetchSastMock.mockReset();
    navigateMock.mockReset();
  });

  it('shows its error when it fails before anything is on screen', async () => {
    let resolveVisible: (value: ReturnType<typeof mkResponse>) => void = () => {};
    fetchSastMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVisible = resolve;
        }),
    );
    const { result } = renderHook(() => useProjectVulnerabilities(baseOptions));
    await waitFor(() => expect(fetchSastMock).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);

    fetchSastMock.mockRejectedValueOnce(new Error('gateway timeout'));
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
    expect(result.current.vulnerabilities).toHaveLength(0);
  });
});
