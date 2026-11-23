import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The policies pages keep their URL under the settings prefix, but they are
 * AppSec pages (`productFromPath` says so for every `/organization/settings/policies`
 * page, and the shell shows AppSec there). An account refused on one of them is
 * sent to the AppSec home, not to the root, which would hand it to the landing
 * rule and could open another product space. The other settings pages are common to both
 * products and keep sending to the root.
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
vi.mock('@/server/hooks/usePolicies', () => ({
  usePolicies: () => ({
    policies: [],
    loading: false,
    error: null,
    total: 0,
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    setCurrentPage: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }),
}));
vi.mock('@/server/services/policyService', () => ({
  exportPolicyYaml: vi.fn(),
  validatePolicyConfig: vi.fn(),
  // The edit page reads its policy first: it stays pending, so the refusal is the only way out.
  fetchPolicy: () => new Promise(() => undefined),
}));

import SettingsPoliciesPage from './SettingsPoliciesPage';
import CreatePolicyPage from './create-policy/CreatePolicyPage';
import EditPolicyPage from './edit-policy/EditPolicyPage';

const renderAt = (url: string, path: string, page: React.ReactElement) => {
  const store = configureStore({
    reducer: {
      organization: () => ({ selectedOrganization: { id: 'org-1', subscription: {} } }),
      user: () => ({ isProfileLoaded: true }),
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={path} element={page} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

const pages: [string, string, string, React.ReactElement][] = [
  ['the policies list', '/organization/settings/policies', '/organization/settings/policies', <SettingsPoliciesPage />],
  ['the policy creation', '/organization/settings/policies/create', '/organization/settings/policies/create', <CreatePolicyPage />],
  [
    'the policy edition',
    '/organization/settings/policies/pol-1/edit',
    '/organization/settings/policies/:policyId/edit',
    <EditPolicyPage />,
  ],
];

beforeEach(() => {
  h.navigate.mockReset();
  h.authorized = false;
});

describe('the policies pages — access refused', () => {
  it.each(pages)('sends an account refused on %s to the AppSec home', async (_name, url, path, page) => {
    renderAt(url, path, page);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/appsec'));
    expect(h.navigate).not.toHaveBeenCalledWith('/');
  });
});
