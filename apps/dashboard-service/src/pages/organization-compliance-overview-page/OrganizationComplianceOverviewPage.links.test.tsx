import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The compliance overview sits under the settings prefix, but it is an AppSec
 * page (`productFromPath` says so for every policies page). An account refused
 * there is sent to the AppSec home, not to the root, which would hand it to the
 * landing rule and could open another product space.
 */

const h = vi.hoisted(() => ({ navigate: vi.fn(), authorized: false }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-rebac', () => ({
  useAuthorization: () => h.authorized,
  useRebac: () => ({ userEntities: [{ id: 'e1' }] }),
}));
vi.mock('@/server/hooks/useOrganizationComplianceOverview', () => ({
  useOrganizationComplianceOverview: () => ({
    stats: null,
    projects: [],
    violationBreakdown: [],
    trend: [],
    loading: false,
    error: null,
    total: 0,
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,
    setCurrentPage: vi.fn(),
    setPageSize: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    complianceStatusFilter: undefined,
    setComplianceStatusFilter: vi.fn(),
    startDate: undefined,
    setStartDate: vi.fn(),
    endDate: undefined,
    setEndDate: vi.fn(),
    sortBy: undefined,
    setSortBy: vi.fn(),
    sortOrder: undefined,
    setSortOrder: vi.fn(),
    timeframe: undefined,
    setTimeframe: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('./components', () => ({
  ComplianceStatsCards: () => null,
  ComplianceTrendChart: () => null,
  ViolationBreakdownChart: () => null,
  ComplianceFilters: () => null,
  ProjectsComplianceTable: () => null,
}));

import OrganizationComplianceOverviewPage from './OrganizationComplianceOverviewPage';

const renderPage = () => {
  const store = configureStore({
    reducer: {
      organization: () => ({ selectedOrganization: { id: 'org-1' } }),
      user: () => ({ isProfileLoaded: true }),
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/organization/settings/policies/overview']}>
        <OrganizationComplianceOverviewPage />
      </MemoryRouter>
    </Provider>,
  );
};

beforeEach(() => {
  h.navigate.mockReset();
});

describe('OrganizationComplianceOverviewPage — access refused', () => {
  it('sends a refused account to the AppSec home', async () => {
    h.authorized = false;
    renderPage();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/appsec'));
  });

  it('keeps an authorized account on the page', async () => {
    h.authorized = true;
    renderPage();
    await waitFor(() => expect(h.navigate).not.toHaveBeenCalled());
  });
});
