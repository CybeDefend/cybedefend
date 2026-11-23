import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { productHome } from '@/utils/product';

/**
 * The compliance overview is served by GET
 * /organization/:organizationId/compliance-overview, which the gateway guards
 * with the `manage_policy` permission (policy.controller.ts, @Permission
 * ('manage_policy')), granted to the creator and the administrators only
 * (schema.perm: `manage_policy = writable and (creator or administrator)`).
 * The page let a manager in: every visit was a guaranteed 403 behind a
 * broken page. The page now admits the roles the permission
 * admits, and asks for nothing before it has admitted the account. The
 * backend check stays the protection; this one only spares the request.
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastError: vi.fn(),
  role: 'manager',
  writesBlocked: false,
  fetchOverview: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock('react-rebac', () => ({
  // The account holds one organization role; a check passes when it is listed.
  useAuthorization: (_id: string, _type: string, roles: string[]) => roles.includes(h.role),
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: h.role }] }),
}));
vi.mock('@/server/services/organizationComplianceService', () => ({
  fetchOrganizationComplianceOverview: h.fetchOverview,
}));
vi.mock('./components', () => ({
  ComplianceStatsCards: () => null,
  ComplianceTrendChart: () => null,
  ViolationBreakdownChart: () => null,
  ComplianceFilters: () => null,
  ProjectsComplianceTable: () => null,
}));

import OrganizationComplianceOverviewPage from './OrganizationComplianceOverviewPage';

const renderPage = async () => {
  const store = configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: { id: 'org-1', subscription: { writesBlocked: h.writesBlocked } },
      }),
      user: () => ({ isProfileLoaded: true }),
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/organization/settings/policies/overview']}>
        <OrganizationComplianceOverviewPage />
      </MemoryRouter>
    </Provider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe('OrganizationComplianceOverviewPage — who may open it', () => {
  beforeEach(() => {
    h.writesBlocked = false;
    h.navigate.mockReset();
    h.toastError.mockReset();
    h.fetchOverview.mockReset();
    h.fetchOverview.mockResolvedValue({
      stats: null,
      projects: [],
      violationBreakdown: [],
      trend: [],
      total: 0,
    });
  });

  it.each(['manager', 'member', 'billing_manager'])(
    'refuses a %s, without asking for the overview the gateway would refuse',
    async (role) => {
      h.role = role;

      await renderPage();

      expect(h.toastError).toHaveBeenCalledTimes(1);
      expect(h.navigate).toHaveBeenCalledWith(productHome('appsec'));
      expect(h.fetchOverview).not.toHaveBeenCalled();
    },
  );

  it.each(['creator', 'administrator'])('opens the page for a %s', async (role) => {
    h.role = role;

    await renderPage();

    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.fetchOverview).toHaveBeenCalledTimes(1);
  });

});
