import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from './authRefusals';
import SignUpPage from './SignUpPage';
import { openSetup, renderAt } from './testHarness';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ getSetupStatus: vi.fn(), signUp: vi.fn(), adoptToken: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  getSetupStatus: mocks.getSetupStatus,
  signUp: mocks.signUp,
}));
vi.mock('@/edition/auth/community/communityAuthClient', () => ({ adoptToken: mocks.adoptToken }));

const field = (key: string) => screen.getByLabelText(translate(`pages.communityAuth.fields.${key}`));

async function fill() {
  await screen.findByRole('button', { name: translate('pages.communityAuth.signup.submit') });
  fireEvent.change(field('name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(field('email'), { target: { value: 'ada@example.test' } });
  fireEvent.change(field('password'), { target: { value: 'a long password' } });
  fireEvent.click(screen.getByRole('button', { name: translate('pages.communityAuth.signup.submit') }));
}

describe('SignUpPage', () => {
  beforeEach(() => {
    mocks.getSetupStatus.mockReset().mockResolvedValue({ ...openSetup, signupMode: 'open' });
    mocks.signUp.mockReset().mockResolvedValue({ accessToken: 'a.b.c', tokenType: 'Bearer', expiresIn: 900 });
    mocks.adoptToken.mockReset();
  });

  it('creates the account and signs in', async () => {
    renderAt(<SignUpPage />, '/signup');
    await fill();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(mocks.signUp).toHaveBeenCalledWith({ email: 'ada@example.test', name: 'Ada Lovelace', password: 'a long password' });
    expect(mocks.adoptToken).toHaveBeenCalledWith('a.b.c', 900);
  });

  it.each([
    [403, 'SIGNUP_DISABLED'],
    [409, 'SETUP_REQUIRED'],
  ] as const)('%s %s shows its sentence', async (status, code) => {
    mocks.signUp.mockRejectedValue(new AuthApiError(status, code));
    renderAt(<SignUpPage />, '/signup');
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS[code]));
    expect(mocks.adoptToken).not.toHaveBeenCalled();
  });

  it('409 ACCOUNT_EXISTS offers to sign in', async () => {
    mocks.signUp.mockRejectedValue(new AuthApiError(409, 'ACCOUNT_EXISTS'));
    renderAt(<SignUpPage />, '/signup');
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.ACCOUNT_EXISTS));
    expect(screen.getAllByRole('link', { name: translate('pages.communityAuth.signup.signIn') })[0]).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('with signupMode invite_only, /signup sends to /login', async () => {
    mocks.getSetupStatus.mockResolvedValue(openSetup);
    renderAt(<SignUpPage />, '/signup');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'));
  });

  it('while setup is open, /signup sends to /login', async () => {
    mocks.getSetupStatus.mockResolvedValue({ ...openSetup, signupMode: 'open', setupOpen: true });
    renderAt(<SignUpPage />, '/signup');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'));
  });
});
