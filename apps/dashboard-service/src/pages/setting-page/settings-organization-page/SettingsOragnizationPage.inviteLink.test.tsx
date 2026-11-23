import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

const { toastSuccess, toastError, addOrganizationMember, templateProps } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  addOrganizationMember: vi.fn(),
  templateProps: { current: null as null | { onSendInvite: (...args: unknown[]) => Promise<unknown> } },
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
  updateOrganizationMemberRole: vi.fn(),
  cancelOrganizationInvitation: vi.fn(),
}));
// The page is what is tested here: the template only hands its handler over.
vi.mock('./SettingsOragnizationTemplate', () => ({
  default: (props: { onSendInvite: (...args: unknown[]) => Promise<unknown> }) => {
    templateProps.current = props;
    return null;
  },
}));

import SettingsOrganizationPage from './SettingsOragnizationPage';

const TOKEN = '0123456789abcdef'.repeat(4);

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
});
afterEach(() => cleanup());

/**
 * The invitation answer reaches the modal, which shows the link when no mail
 * was sent. « Invitation sent » is said only when a mail went out.
 */
describe('SettingsOrganizationPage — invitation answer', () => {
  it('hands the answer to the modal and says « sent » when the mail went out', async () => {
    const answer = { id: 'i-1', token: '', email: 'dev@acme.test' };
    addOrganizationMember.mockResolvedValue(answer);
    const { onSendInvite } = renderPage();
    await expect(onSendInvite('dev@acme.test', 'member')).resolves.toBe(answer);
    expect(toastSuccess).toHaveBeenCalledWith('Invitation sent successfully.');
  });

  it('hands the answer to the modal without saying « sent » when no mail was sent', async () => {
    const answer = { id: 'i-1', token: TOKEN, email: 'dev@acme.test' };
    addOrganizationMember.mockResolvedValue(answer);
    const { onSendInvite } = renderPage();
    await expect(onSendInvite('dev@acme.test', 'member')).resolves.toBe(answer);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
