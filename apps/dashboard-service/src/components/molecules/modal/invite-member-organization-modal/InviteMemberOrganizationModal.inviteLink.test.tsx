import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
// The teams have their own tests; here the section only has to be there.
vi.mock('@/components/molecules/team-assignment-section/TeamAssignmentSection', () => ({
  default: () => <div data-testid="team-assignment" />,
}));

import InviteMemberOrganizationModal from './InviteMemberOrganizationModal';
import type { OrganizationInviteResponseDto } from '@/server/interfaces/Organization';

const TOKEN = '0123456789abcdef'.repeat(4);

const answer = (token: string | null): OrganizationInviteResponseDto => ({
  id: '5f0c6b8e-1f7a-4a53-9a1c-2f3b4c5d6e7f',
  token: token as string,
  email: 'dev@acme.test',
  status: 'pending',
  organizationId: 'org-1',
  organizationName: 'Acme',
  organizationRole: 'member',
  expiresAt: '2026-11-04T00:00:00.000Z',
});

const renderModal = (onSendInvite: (...args: unknown[]) => Promise<OrganizationInviteResponseDto | void>) => {
  const organization = {
    selectedOrganization: { id: 'org-1', name: 'Acme', myRole: 'administrator', subscription: null, products: [] },
  };
  const store = configureStore({ reducer: { organization: (state: object = organization) => state } });
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <InviteMemberOrganizationModal
          organizationId="org-1"
          organizationName="Acme"
          onClose={onClose}
          onSendInvite={onSendInvite}
          roles={[{ value: 'member', label: 'Member' }]}
        />
      </MemoryRouter>
    </Provider>,
  );
  return { onClose };
};

const invite = () => {
  fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'dev@acme.test' } });
  fireEvent.click(screen.getByRole('button', { name: /Select a role/ }));
  fireEvent.click(screen.getByText('Member'));
  fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));
};

afterEach(() => cleanup());

/**
 * No mail configured (the Community Edition without SMTP): the invitation
 * answer carries its token, and the administrator sends the link themselves.
 * The cloud always sends the mail, so its token is empty and the modal closes
 * as it always did.
 */
describe('InviteMemberOrganizationModal — invitation link', () => {
  it('when the answer carries a token, the modal stays open and shows the link with a copy button and the no-mail sentence', async () => {
    const { onClose } = renderModal(vi.fn(async () => answer(TOKEN)));
    invite();

    expect(await screen.findByText(`${window.location.origin}/invite#token=${TOKEN}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the invitation link' })).toBeInTheDocument();
    expect(screen.getByText(/No e-mail was sent: send this link to dev@acme\.test yourself\. It is shown once/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // A click beside the modal does not drop a link shown only once.
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();

    // Closing the modal is the only way out, and it takes the link with it.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('when the token is empty, the modal behaves as today', async () => {
    for (const token of ['', null]) {
      const { onClose } = renderModal(vi.fn(async () => answer(token)));
      invite();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/\/invite\//)).toBeNull();
      expect(screen.queryByText(/No e-mail was sent/)).toBeNull();
      cleanup();
    }
    // A handler that answers nothing (as before this change) closes too.
    const { onClose } = renderModal(vi.fn(async () => undefined));
    invite();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
