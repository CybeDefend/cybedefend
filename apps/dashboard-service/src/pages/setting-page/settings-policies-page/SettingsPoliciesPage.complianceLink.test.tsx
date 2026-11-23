import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The policies page links to the compliance overview only for the accounts
 * that may open it: the overview needs `manage_policy` (creator and
 * administrators), the policies list only `read_policy` (managers too).
 * A manager no longer follows a link that ends in a refusal.
 */

const h = vi.hoisted(() => ({ role: 'manager', writesBlocked: false }));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('react-rebac', () => ({
  useAuthorization: (_id: string, _type: string, roles: string[]) => roles.includes(h.role),
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: h.role }] }),
}));
vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/server/hooks/usePolicies', () => ({
  usePolicies: () => ({
    policies: [],
    loading: false,
    error: null,
    total: 0,
    currentPage: 1,
    pageSize: 20,
    totalPages: 0,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    scopeFilter: undefined,
    setScopeFilter: vi.fn(),
    enabledFilter: undefined,
    setEnabledFilter: vi.fn(),
    setCurrentPage: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }),
}));
vi.mock('@/server/services/policyService', () => ({ exportPolicyYaml: vi.fn() }));

import SettingsPoliciesPage from './SettingsPoliciesPage';

const renderAs = (role: string, writesBlocked = false) => {
  h.role = role;
  h.writesBlocked = writesBlocked;
  const store = configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: { id: 'org-1', subscription: { writesBlocked: h.writesBlocked } },
      }),
      user: () => ({ isProfileLoaded: true }),
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/organization/settings/policies']}>
        <SettingsPoliciesPage />
      </MemoryRouter>
    </Provider>,
  );
};

const overviewLink = () =>
  document.querySelector('a[href="/organization/settings/policies/overview"]');

describe('SettingsPoliciesPage — the link to the compliance overview', () => {
  it('is not offered to a manager', async () => {
    renderAs('manager');
    // The page has rendered its header (the i18n mock resolves the real
    // English title): the link is absent from a rendered page, not just
    // from a page still loading.
    await screen.findByText('Security Policies');

    expect(overviewLink()).toBeNull();
  });

  it.each(['creator', 'administrator'])('is offered to a %s', async (role) => {
    renderAs(role);

    await vi.waitFor(() => expect(overviewLink()).not.toBeNull());
  });

});
