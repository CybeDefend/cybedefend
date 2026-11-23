import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/organizationComplianceService', () => ({
  fetchOrganizationComplianceOverview: vi.fn(),
}));

import { useOrganizationComplianceOverview } from './useOrganizationComplianceOverview';
import { fetchOrganizationComplianceOverview } from '../services/organizationComplianceService';
import type {
  GetComplianceOverviewParams,
  OrganizationComplianceOverviewResponse,
} from '../interfaces/OrganizationCompliance';

const mockFetch = vi.mocked(fetchOrganizationComplianceOverview);

const responseFor = (
  params: GetComplianceOverviewParams,
): OrganizationComplianceOverviewResponse => ({
  stats: {
    totalProjects: 30,
    compliantProjects: 10,
    nonCompliantProjects: 10,
    pendingProjects: 10,
    totalViolations: 0,
    totalBlocked: 0,
    totalWarned: 0,
    activePoliciesCount: 1,
    complianceRate: 50,
  },
  projects: [],
  violationBreakdown: [],
  trend: [],
  total: 30,
  page: params.page ?? 1,
  pageSize: params.pageSize ?? 10,
});

type Hook = ReturnType<typeof useOrganizationComplianceOverview>;

/**
 * A filter or sort change past page 1 sent two requests,
 * the current page with the new filter, then page 1 once a separate effect had
 * reset the page; the first answer could also land last and show the wrong
 * page. A change now resets the page in the same update: one request, page 1.
 */
describe('useOrganizationComplianceOverview — one request per filter change', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (params) => responseFor(params));
  });

  const changes: Array<[string, (hook: Hook) => void, Partial<GetComplianceOverviewParams>]> = [
    ['search', (h) => h.setSearchQuery('api'), { search: 'api' }],
    [
      'compliance status',
      (h) => h.setComplianceStatusFilter('Non-Compliant'),
      { complianceStatus: 'Non-Compliant' },
    ],
    ['start date', (h) => h.setStartDate('2026-09-01'), { startDate: '2026-09-01' }],
    ['end date', (h) => h.setEndDate('2026-10-01'), { endDate: '2026-10-01' }],
    ['sort field', (h) => h.setSortBy('projectName'), { sortBy: 'projectName' }],
    ['sort order', (h) => h.setSortOrder('asc'), { sortOrder: 'asc' }],
  ];

  it.each(changes)(
    'fetches page 1 once when the %s changes on page 3',
    async (_label, change, expected) => {
      const { result } = renderHook(() =>
        useOrganizationComplianceOverview({ organizationId: 'org-1' }),
      );
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      act(() => result.current.setCurrentPage(3));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 3 }),
      );

      mockFetch.mockClear();
      act(() => change(result.current));
      await waitFor(() => expect(result.current.loading).toBe(false));
      // Let any follow-up effect run before counting.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, ...expected }),
      );
      expect(result.current.currentPage).toBe(1);
    },
  );

  it('keeps the page when only the page changes', async () => {
    const { result } = renderHook(() =>
      useOrganizationComplianceOverview({ organizationId: 'org-1' }),
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
    expect(result.current.currentPage).toBe(2);
  });
});

/**
 * Two changes close together (status then sort, a search
 * typed in two bursts, a page change) run two requests at once. Each answer
 * wrote the table and cleared `loading`, so whichever came back LAST won, not
 * the latest request. Only the latest request may write the state.
 */
describe('useOrganizationComplianceOverview — the latest request wins', () => {
  const deferred = () => {
    let resolve: (value: OrganizationComplianceOverviewResponse) => void =
      () => undefined;
    let reject: (reason: Error) => void = () => undefined;
    const promise = new Promise<OrganizationComplianceOverviewResponse>(
      (res, rej) => {
        resolve = res;
        reject = rej;
      },
    );
    return { promise, resolve, reject };
  };

  const answerNamed = (
    params: GetComplianceOverviewParams,
    name: string,
    total: number,
  ): OrganizationComplianceOverviewResponse => ({
    ...responseFor(params),
    projects: [
      {
        projectId: name,
        projectName: name,
        complianceStatus: 'Compliant',
        totalViolations: 0,
        blockedCount: 0,
        warnedCount: 0,
        applicablePoliciesCount: 1,
        teamIds: [],
      },
    ],
    total,
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('keeps the answer of the second request when the first one comes back last', async () => {
    mockFetch.mockImplementation(async (params) => responseFor(params));
    const { result } = renderHook(() =>
      useOrganizationComplianceOverview({ organizationId: 'org-1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const first = deferred();
    const second = deferred();
    mockFetch.mockReset();
    mockFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    act(() => result.current.setComplianceStatusFilter('Non-Compliant'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    act(() => result.current.setSortBy('projectName'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [firstParams] = mockFetch.mock.calls[0];
    const [secondParams] = mockFetch.mock.calls[1];

    // The second request comes back first...
    await act(async () => {
      second.resolve(answerNamed(secondParams, 'second', 2));
    });
    expect(result.current.projects.map((p) => p.projectId)).toEqual([
      'second',
    ]);
    expect(result.current.loading).toBe(false);

    // ...then the first one: it changes nothing.
    await act(async () => {
      first.resolve(answerNamed(firstParams, 'first', 1));
    });
    expect(result.current.projects.map((p) => p.projectId)).toEqual([
      'second',
    ]);
    expect(result.current.total).toBe(2);
    expect(result.current.loading).toBe(false);
  });

  it('stays loading until the latest request answers, whatever an older one does', async () => {
    mockFetch.mockImplementation(async (params) => responseFor(params));
    const { result } = renderHook(() =>
      useOrganizationComplianceOverview({ organizationId: 'org-1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const first = deferred();
    const second = deferred();
    mockFetch.mockReset();
    mockFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    act(() => result.current.setSearchQuery('ap'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    act(() => result.current.setSearchQuery('api'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [firstParams] = mockFetch.mock.calls[0];
    const [secondParams] = mockFetch.mock.calls[1];

    // The older request answers, then an older failure: still loading, no
    // error, nothing written.
    await act(async () => {
      first.resolve(answerNamed(firstParams, 'first', 1));
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.projects).toEqual([]);

    await act(async () => {
      second.resolve(answerNamed(secondParams, 'second', 2));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.projects.map((p) => p.projectId)).toEqual([
      'second',
    ]);
    expect(result.current.error).toBeNull();
  });

  it('does not stay loading when a refresh without organization supersedes a request', async () => {
    const pending = deferred();
    mockFetch.mockImplementation(() => pending.promise);
    const { result, rerender } = renderHook(
      ({ organizationId }) => useOrganizationComplianceOverview({ organizationId }),
      { initialProps: { organizationId: 'org-1' } },
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);

    rerender({ organizationId: '' });
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      pending.resolve(answerNamed(mockFetch.mock.calls[0][0], 'org-1', 1));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toEqual([]);
  });

  it('ignores the failure of a request that is no longer the latest', async () => {
    mockFetch.mockImplementation(async (params) => responseFor(params));
    const { result } = renderHook(() =>
      useOrganizationComplianceOverview({ organizationId: 'org-1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const first = deferred();
    const second = deferred();
    mockFetch.mockReset();
    mockFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    act(() => result.current.setCurrentPage(3));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [secondParams] = mockFetch.mock.calls[1];

    await act(async () => {
      second.resolve(answerNamed(secondParams, 'page-3', 30));
    });
    await act(async () => {
      first.reject(new Error('Network Error'));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.projects.map((p) => p.projectId)).toEqual([
      'page-3',
    ]);
    expect(result.current.loading).toBe(false);
  });
});
