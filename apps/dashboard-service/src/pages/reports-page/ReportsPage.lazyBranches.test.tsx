import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';

// Holder hoisted above the vi.mock factories so they can reference it safely.
const h = vi.hoisted(() => ({
  captured: null as any,
  fetchReportBranchMapsMock: vi.fn(),
}));

const mockState = {
  organization: {
    selectedOrganization: {
      id: 'org-1',
      name: 'Org',
      subscription: { featuresDisabled: '' },
    },
  },
};

vi.mock('react-redux', () => ({
  useSelector: (fn: (s: any) => any) => fn(mockState),
  useDispatch: () => vi.fn(),
}));
vi.mock('@/server/hooks/useBillingEntitlements', () => ({
  default: () => ({ entitlements: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('@/server/store/selectors', () => ({
  selectIsWritesBlocked: () => false,
}));
vi.mock('@/server/hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));
vi.mock('@/server/hooks/useOrganizationTeams', () => ({
  default: () => ({ teams: [], loading: false, error: null }),
}));
vi.mock('@/server/hooks/useAllOrganizationProjects', () => ({
  default: () => ({
    projects: [
      { projectId: 'p1', name: 'Project One', teamId: 't1', teamName: 'Team A' },
      { projectId: 'p2', name: 'Project Two', teamId: 't1', teamName: 'Team A' },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('@/server/hooks/useAggregatedReports', () => ({
  default: () => ({
    loading: false,
    error: null,
    generateOrgReport: vi.fn(),
    generateTeamReportFn: vi.fn(),
    generateBatchReportFn: vi.fn(),
    clearError: vi.fn(),
  }),
}));
vi.mock('@/server/services/resultService', () => ({
  archiveBranch: vi.fn(),
  unarchiveBranch: vi.fn(),
}));
vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: any) => <>{children}</>,
}));
vi.mock('./reportBranchData', () => ({
  fetchReportBranchMaps: (...args: unknown[]) =>
    h.fetchReportBranchMapsMock(...args),
}));
// Stub the presentation component: capture the props it receives so the test
// can drive the lazy-load callback and inspect the maps handed down to it.
vi.mock('./ReportsPageTemplate', () => ({
  default: (props: any) => {
    h.captured = props;
    return <div data-testid="tpl" />;
  },
}));

import ReportsPage from './ReportsPage';

beforeEach(() => {
  h.captured = null;
  mockState.organization.selectedOrganization.id = 'org-1';
  h.fetchReportBranchMapsMock.mockReset();
  h.fetchReportBranchMapsMock.mockResolvedValue({
    branchesMap: {},
    archivedBranchesMap: {},
  });
});

describe('ReportsPage — lazy per-project branch loading', () => {
  it('does not fetch any branches on mount, even though projects exist', () => {
    render(<ReportsPage />, { wrapper: MemoryRouter });
    expect(h.captured).toBeTruthy();
    expect(h.fetchReportBranchMapsMock).not.toHaveBeenCalled();
  });

  it('fetches a single project on demand and merges only that project into the maps', async () => {
    h.fetchReportBranchMapsMock.mockResolvedValue({
      branchesMap: { p1: ['main', 'dev'] },
      archivedBranchesMap: { p1: ['legacy'] },
    });
    render(<ReportsPage />, { wrapper: MemoryRouter });
    expect(h.fetchReportBranchMapsMock).not.toHaveBeenCalled();

    await act(async () => {
      await h.captured.onLoadProjectBranches('p1');
    });

    // One request, scoped to the single expanded project — no org-wide fan-out.
    expect(h.fetchReportBranchMapsMock).toHaveBeenCalledTimes(1);
    expect(h.fetchReportBranchMapsMock).toHaveBeenCalledWith('org-1', ['p1']);

    await waitFor(() => {
      expect(h.captured.projectBranchesMap.p1).toEqual(['main', 'dev']);
    });
    expect(h.captured.archivedBranchesMap.p1).toEqual(['legacy']);
    expect(h.captured.loadedProjectIds.has('p1')).toBe(true);
    // The project that was never expanded is never fetched.
    expect(h.captured.projectBranchesMap.p2).toBeUndefined();
  });

  it('does not re-fetch a project whose branches are already loaded', async () => {
    render(<ReportsPage />, { wrapper: MemoryRouter });
    await act(async () => {
      await h.captured.onLoadProjectBranches('p1');
    });
    await waitFor(() => expect(h.captured.loadedProjectIds.has('p1')).toBe(true));

    await act(async () => {
      await h.captured.onLoadProjectBranches('p1');
    });

    expect(h.fetchReportBranchMapsMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT mark a project loaded when the fetch fails, so re-expanding retries', async () => {
    h.fetchReportBranchMapsMock.mockRejectedValueOnce(new Error('boom'));
    render(<ReportsPage />, { wrapper: MemoryRouter });

    await act(async () => {
      await h.captured.onLoadProjectBranches('p1');
    });

    // A failure must leave the project neither loaded nor in-flight, so the
    // row does not get stuck on a misleading "No branches".
    expect(h.captured.loadedProjectIds.has('p1')).toBe(false);
    expect(h.captured.loadingProjectIds.has('p1')).toBe(false);
    expect(h.captured.projectBranchesMap.p1).toBeUndefined();

    // A second expand retries the fetch (the guard must not short-circuit it).
    h.fetchReportBranchMapsMock.mockResolvedValueOnce({
      branchesMap: { p1: ['main'] },
      archivedBranchesMap: {},
    });
    await act(async () => {
      await h.captured.onLoadProjectBranches('p1');
    });

    expect(h.fetchReportBranchMapsMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(h.captured.projectBranchesMap.p1).toEqual(['main']));
    expect(h.captured.loadedProjectIds.has('p1')).toBe(true);
  });

  it('discards a stale in-flight response when the organization changes mid-load', async () => {
    let resolveFetch: (v: any) => void = () => {};
    h.fetchReportBranchMapsMock.mockImplementation(
      () => new Promise((res) => { resolveFetch = res; }),
    );

    const { rerender } = render(<ReportsPage />, { wrapper: MemoryRouter });

    // Kick off an org-1 load for p1; the promise stays pending.
    act(() => {
      h.captured.onLoadProjectBranches('p1');
    });

    // Switch the active organization before the org-1 response lands.
    mockState.organization.selectedOrganization.id = 'org-2';
    rerender(<ReportsPage />);

    // The stale org-1 response resolves — it must NOT pollute org-2's state.
    await act(async () => {
      resolveFetch({ branchesMap: { p1: ['main'] }, archivedBranchesMap: {} });
    });

    expect(h.captured.projectBranchesMap.p1).toBeUndefined();
    expect(h.captured.loadedProjectIds.has('p1')).toBe(false);
  });
});

describe('ReportsPage — a « View report » link while the page is shown', () => {
  it('hands the linked report and a new navigation key to the template without a remount', () => {
    // One element for the route, as the app's route table holds: React then
    // re-renders the page on a navigation only if the page reads the location.
    const page = <ReportsPage />;
    let navigate: NavigateFunction = () => undefined;
    const Navigator = () => {
      navigate = useNavigate();
      return null;
    };
    render(
      <MemoryRouter initialEntries={['/appsec/reports']}>
        <Navigator />
        <Routes>
          <Route path="/appsec/reports" element={page} />
        </Routes>
      </MemoryRouter>,
    );
    expect(h.captured.highlightReportId).toBeUndefined();

    act(() => navigate('/appsec/reports?reportId=r1'));
    expect(h.captured.highlightReportId).toBe('r1');
    const firstKey = h.captured.highlightKey;
    expect(firstKey).toBeTruthy();

    act(() => navigate('/appsec/reports?reportId=r1'));
    expect(h.captured.highlightReportId).toBe('r1');
    expect(h.captured.highlightKey).not.toBe(firstKey);
  });
});
