import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from './authRefusals';
import CommunityLoginPage from './CommunityLoginPage';
import { answered, openSetup, renderAt } from './testHarness';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ getSetupStatus: vi.fn(), signInWithPassword: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  getSetupStatus: mocks.getSetupStatus,
}));
vi.mock('@/edition/auth/community/communityAuthClient', () => ({ signInWithPassword: mocks.signInWithPassword }));

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText(translate('pages.communityAuth.fields.email')), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(translate('pages.communityAuth.fields.password')), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: translate('pages.communityAuth.login.submit') }));
};

describe('CommunityLoginPage', () => {
  beforeEach(() => {
    mocks.getSetupStatus.mockReset().mockResolvedValue(openSetup);
    mocks.signInWithPassword.mockReset().mockResolvedValue(undefined);
  });

  it('submits e-mail and password and lands on returnTo', async () => {
    renderAt(<CommunityLoginPage />, '/login?returnTo=%2Fproject%2Fabc%3Fx%3D1');
    fill('ada@example.test', 'a long password');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/project/abc?x=1'));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith('ada@example.test', 'a long password');
  });

  it('lands on the home without returnTo', async () => {
    renderAt(<CommunityLoginPage />, '/login');
    fill('ada@example.test', 'a long password');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
  });

  it('an unknown e-mail and a wrong password show the same sentence', async () => {
    mocks.signInWithPassword.mockRejectedValue(new AuthApiError(401, 'INVALID_CREDENTIALS'));
    renderAt(<CommunityLoginPage />, '/login');
    fill('nobody@example.test', 'a long password');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.INVALID_CREDENTIALS));
    fill('ada@example.test', 'another password');
    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.INVALID_CREDENTIALS));
  });

  it('a 429 shows the rate sentence', async () => {
    mocks.signInWithPassword.mockRejectedValue(new AuthApiError(429, 'RATE_LIMITED', 60));
    renderAt(<CommunityLoginPage />, '/login');
    fill('ada@example.test', 'a long password');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.refusals.RATE_LIMITED'));
  });

  it("never renders the server's message", async () => {
    mocks.signInWithPassword.mockRejectedValue(answered(400, { message: 'boom' }));
    renderAt(<CommunityLoginPage />, '/login');
    fill('ada@example.test', 'a long password');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.GENERIC));
    expect(screen.queryByText('boom')).toBeNull();
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)'])(
    'a returnTo of %s is ignored',
    async (returnTo) => {
      renderAt(<CommunityLoginPage />, `/login?returnTo=${encodeURIComponent(returnTo)}`);
      fill('ada@example.test', 'a long password');
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    },
  );

  it('shows the sign-up link only when signupMode is open', async () => {
    const view = renderAt(<CommunityLoginPage />, '/login');
    await waitFor(() => expect(mocks.getSetupStatus).toHaveBeenCalled());
    await screen.findByRole('button', { name: translate('pages.communityAuth.login.submit') });
    expect(screen.queryByRole('link', { name: translate('pages.communityAuth.login.signUp') })).toBeNull();
    view.unmount();

    mocks.getSetupStatus.mockResolvedValue({ ...openSetup, signupMode: 'open' });
    renderAt(<CommunityLoginPage />, '/login');
    expect(await screen.findByRole('link', { name: translate('pages.communityAuth.login.signUp') })).toHaveAttribute(
      'href',
      '/signup',
    );
  });

  it('sends to /setup while setup is open', async () => {
    mocks.getSetupStatus.mockResolvedValue({ ...openSetup, setupOpen: true });
    renderAt(<CommunityLoginPage />, '/login');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/setup'));
  });

  it('says when the last sign-out did not complete on the server', async () => {
    renderAt(<CommunityLoginPage />, '/login?signout=incomplete');
    expect(await screen.findByText(translate('pages.communityAuth.login.signoutIncomplete'))).toBeInTheDocument();
  });

  it('says nothing about the sign-out for any other value', async () => {
    renderAt(<CommunityLoginPage />, '/login?signout=done');
    await screen.findByRole('button', { name: translate('pages.communityAuth.login.submit') });
    expect(screen.queryByText(translate('pages.communityAuth.login.signoutIncomplete'))).toBeNull();
  });
});
