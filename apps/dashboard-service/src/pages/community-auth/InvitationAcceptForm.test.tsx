import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from './authRefusals';
import InvitationAcceptForm from './InvitationAcceptForm';
import { renderAt } from './testHarness';
import { INVITE_EMAIL_STORAGE_KEY } from '@/lib/invite-email';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ acceptInvitation: vi.fn(), adoptToken: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  acceptInvitation: mocks.acceptInvitation,
}));
vi.mock('@/edition/auth/community/communityAuthClient', () => ({ adoptToken: mocks.adoptToken }));

const TOKEN = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
const field = (key: string) => screen.getByLabelText(translate(`pages.communityAuth.fields.${key}`));

function renderForm(token: string) {
  return renderAt(<InvitationAcceptForm token={token} />, `/invite/${token}`, '/invite/:token');
}

async function fill() {
  await screen.findByRole('button', { name: translate('pages.communityAuth.invitation.submit') });
  fireEvent.change(field('name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(field('password'), { target: { value: 'a long password' } });
  fireEvent.click(screen.getByRole('button', { name: translate('pages.communityAuth.invitation.submit') }));
}

describe('InvitationAcceptForm', () => {
  beforeEach(() => {
    mocks.acceptInvitation
      .mockReset()
      .mockResolvedValue({ accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900, organizationId: 'org-9' });
    mocks.adoptToken.mockReset();
  });

  it('creates the account and signs in', async () => {
    const { store } = renderForm(TOKEN);
    await fill();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(TOKEN, { name: 'Ada Lovelace', password: 'a long password' });
    expect(mocks.adoptToken).toHaveBeenCalledWith('a.b.c', 900);
    expect(store.getState().invitation.newlyJoinedOrgId).toBe('org-9');
  });

  it('forgets the invited address once the invitation is accepted', async () => {
    window.sessionStorage.setItem(INVITE_EMAIL_STORAGE_KEY, JSON.stringify({ tokenDigest: 'x', email: 'a@b.c' }));
    renderForm(TOKEN);
    await fill();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY)).toBeNull();
  });

  it('keeps the invited address while the accept is refused', async () => {
    mocks.acceptInvitation.mockRejectedValue(new AuthApiError(400, 'PASSWORD_POLICY'));
    window.sessionStorage.setItem(INVITE_EMAIL_STORAGE_KEY, JSON.stringify({ tokenDigest: 'x', email: 'a@b.c' }));
    renderForm(TOKEN);
    await fill();
    await screen.findByRole('alert');
    expect(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY)).not.toBeNull();
    window.sessionStorage.clear();
  });

  it('ACCOUNT_EXISTS offers to sign in, then come back to the invitation', async () => {
    mocks.acceptInvitation.mockRejectedValue(new AuthApiError(409, 'ACCOUNT_EXISTS'));
    renderForm(TOKEN);
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.ACCOUNT_EXISTS));
    expect(mocks.adoptToken).not.toHaveBeenCalled();
    const link = screen.getByRole('link', { name: translate('pages.communityAuth.invitation.signIn') });
    expect(link).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent('/invite')}`);
    expect(link.getAttribute('href')).not.toContain(TOKEN);
  });

  it('from a fragment link (`/invite`), the sign-in link comes back to /invite, the token never in its URL', async () => {
    renderAt(<InvitationAcceptForm token={TOKEN} />, '/invite', '/invite');
    await screen.findByRole('button', { name: translate('pages.communityAuth.invitation.submit') });
    const link = screen.getByRole('link', { name: translate('pages.communityAuth.invitation.signIn') });
    expect(link).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent('/invite')}`);
    expect(link.getAttribute('href')).not.toContain(TOKEN);
  });

  it('a password the server refuses shows the policy sentence', async () => {
    mocks.acceptInvitation.mockRejectedValue(new AuthApiError(400, 'PASSWORD_POLICY'));
    renderForm(TOKEN);
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.PASSWORD_POLICY));
  });

  it.each(['abc', TOKEN.toUpperCase(), `${TOKEN}0`, TOKEN.slice(1)])(
    'a token that is not 64 hex characters (%s) shows INVITATION_INVALID with no request',
    async (token) => {
      renderForm(token);
      expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.INVITATION_INVALID));
      expect(screen.queryByRole('button', { name: translate('pages.communityAuth.invitation.submit') })).toBeNull();
      expect(mocks.acceptInvitation).not.toHaveBeenCalled();
    },
  );
});
