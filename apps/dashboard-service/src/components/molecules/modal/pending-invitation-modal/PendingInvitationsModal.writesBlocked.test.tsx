import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import PendingInvitationsModal from './PendingInvitationsModal';

// ─── Mock i18n ───────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const makeStore = (writesBlocked: boolean) =>
  configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: { id: 'org-1', subscription: { writesBlocked } },
      }),
    },
  });

const invitations = [
  {
    id: 'inv-1',
    email: 'alice@example.com',
    organizationRole: 'developer',
    expiresAt: new Date('2026-12-31').toISOString(),
  } as any,
];

describe('PendingInvitationsModal — writes_blocked gate', () => {
  it('renders the active Cancel button (no blocked wrapper) when writesBlocked=true', () => {
    const onCancel = vi.fn();
    const store = makeStore(true);
    render(
      <Provider store={store}>
        <PendingInvitationsModal
          invitations={invitations}
          onClose={() => {}}
          onCancelInvitation={onCancel}
        />
      </Provider>,
    );

    expect(
      screen.queryByTestId('cancel-invitation-blocked-wrapper-inv-1'),
    ).not.toBeInTheDocument();
    const cancelBtn = screen.getByRole('button', { name: 'common.cancel' });
    expect(cancelBtn).toBeEnabled();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledWith('inv-1');
  });

  it('renders the active Cancel button when writesBlocked=false', () => {
    const onCancel = vi.fn();
    const store = makeStore(false);
    render(
      <Provider store={store}>
        <PendingInvitationsModal
          invitations={invitations}
          onClose={() => {}}
          onCancelInvitation={onCancel}
        />
      </Provider>,
    );

    expect(
      screen.queryByTestId('cancel-invitation-blocked-wrapper-inv-1'),
    ).not.toBeInTheDocument();
    const cancelBtn = screen.getByRole('button', { name: 'common.cancel' });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledWith('inv-1');
  });
});
