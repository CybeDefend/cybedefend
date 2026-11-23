import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

type Props = {
  onSendInvite: (...args: unknown[]) => Promise<unknown>;
  onManageUser: (user: unknown) => void;
  onRoleChange: (role: string) => Promise<unknown>;
};
const { toastSuccess, toastError, addOrganizationMember, updateOrganizationMemberRole, templateProps } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  addOrganizationMember: vi.fn(),
  updateOrganizationMemberRole: vi.fn(),
  templateProps: { current: null as null | Props },
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('react-rebac', () => ({ useAuthorization: () => true, useRebac: () => ({ userEntities: [{}] }) }));
vi.mock('@/server/hooks/useOrganizationUsers', () => ({
  default: () => ({
    users: [],
    totalUsers: 0,
    totalPages: 1,
    currentPage: 1,
    loading: false,
    error: null,
    goToPage: vi.fn(),
    refresh: vi.fn(),
    invitations: [],
    invitationsLoading: false,
    invitationsError: null,
  }),
}));
vi.mock('@/server/services/organizationService', () => ({
  addOrganizationMember,
  removeOrganizationMember: vi.fn(),
  updateOrganizationMemberRole,
  cancelOrganizationInvitation: vi.fn(),
}));
// The page is what is tested here: the template only hands its handler over.
vi.mock('./SettingsOragnizationTemplate', () => ({
  default: (props: Props) => {
    templateProps.current = props;
    return null;
  },
}));

import SettingsOrganizationPage from './SettingsOragnizationPage';

const renderPage = () => {
  const state = {
    organization: { selectedOrganization: { id: 'org-1', name: 'Acme', myRole: 'administrator', products: [] } },
    user: { isProfileLoaded: true },
  };
  const store = configureStore({
    reducer: {
      organization: (s: object = state.organization) => s,
      user: (s: object = state.user) => s,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <SettingsOrganizationPage />
      </MemoryRouter>
    </Provider>,
  );
  return templateProps.current!;
};

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  addOrganizationMember.mockReset();
  updateOrganizationMemberRole.mockReset();
});
afterEach(() => cleanup());

/**
 * The Community Edition's global-management refuses a role it gives nobody
 * (`billing_manager`) with `ROLE_NOT_AVAILABLE`, which the
 * gateway answers as a 400 with `body.code`. The page shows its fixed
 * sentence, never the server's text.
 */
describe('SettingsOrganizationPage — a role the edition does not give', () => {
  const refused = { response: { status: 400, data: { code: 'ROLE_NOT_AVAILABLE', message: 'ROLE_NOT_AVAILABLE' } } };
  const SENTENCE = 'This role is not available in this edition.';

  it('an invitation refused ROLE_NOT_AVAILABLE shows the fixed sentence', async () => {
    addOrganizationMember.mockRejectedValue(refused);
    const { onSendInvite } = renderPage();
    await onSendInvite('dev@acme.test', 'billing_manager');
    expect(toastError).toHaveBeenCalledWith(SENTENCE);
    expect(toastError).not.toHaveBeenCalledWith('ROLE_NOT_AVAILABLE');
  });

  it('a role change refused ROLE_NOT_AVAILABLE shows the fixed sentence', async () => {
    updateOrganizationMemberRole.mockRejectedValue(refused);
    renderPage();
    act(() => templateProps.current!.onManageUser({ id: 'u-2', role: 'member' }));
    await expect(templateProps.current!.onRoleChange('billing_manager')).rejects.toBe(refused);
    expect(toastError).toHaveBeenCalledWith(SENTENCE);
    expect(toastError).not.toHaveBeenCalledWith('ROLE_NOT_AVAILABLE');
  });

  it('any other refusal keeps its toast, as the fixed sentence of its status', async () => {
    addOrganizationMember.mockRejectedValue({ response: { status: 409, data: { message: 'Already a member' } } });
    const { onSendInvite } = renderPage();
    await onSendInvite('dev@acme.test', 'member');
    expect(toastError).toHaveBeenCalledWith('This conflicts with an existing item.');
    expect(toastError).not.toHaveBeenCalledWith('Already a member');
  });
});
