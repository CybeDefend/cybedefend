import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from './authRefusals';
import SetupPage from './SetupPage';
import { openSetup, renderAt } from './testHarness';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ getSetupStatus: vi.fn(), setupInstance: vi.fn(), adoptToken: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  getSetupStatus: mocks.getSetupStatus,
  setupInstance: mocks.setupInstance,
}));
vi.mock('@/edition/auth/community/communityAuthClient', () => ({ adoptToken: mocks.adoptToken }));

const field = (key: string) => screen.getByLabelText(translate(`pages.communityAuth.fields.${key}`));

async function fill(password: string) {
  await screen.findByRole('button', { name: translate('pages.communityAuth.setup.submit') });
  fireEvent.change(field('setupToken'), { target: { value: 'the-setup-token' } });
  fireEvent.change(field('organizationName'), { target: { value: 'Acme' } });
  fireEvent.change(field('name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(field('email'), { target: { value: 'ada@example.test' } });
  fireEvent.change(field('password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: translate('pages.communityAuth.setup.submit') }));
}

describe('SetupPage', () => {
  beforeEach(() => {
    mocks.getSetupStatus.mockReset().mockResolvedValue({ ...openSetup, setupOpen: true });
    mocks.setupInstance.mockReset().mockResolvedValue({
      accessToken: 'a.b.c',
      tokenType: 'Bearer',
      expiresIn: 900,
      organizationId: 'org-1',
      teamId: 'team-1',
    });
    mocks.adoptToken.mockReset();
  });

  it('sends the setup token, creates the administrator and signs in', async () => {
    renderAt(<SetupPage />, '/setup');
    await fill('a long password');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(mocks.setupInstance).toHaveBeenCalledWith({
      setupToken: 'the-setup-token',
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      password: 'a long password',
      organizationName: 'Acme',
    });
    expect(mocks.adoptToken).toHaveBeenCalledWith('a.b.c', 900);
  });

  it('a password of 11 characters shows the hint and sends nothing', async () => {
    renderAt(<SetupPage />, '/setup');
    await fill('elevenchars');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.passwordLength'));
    expect(mocks.setupInstance).not.toHaveBeenCalled();
  });

  it('counts code points, not UTF-16 units', async () => {
    renderAt(<SetupPage />, '/setup');
    // 11 emoji: 22 UTF-16 units, 11 code points.
    await fill('😀'.repeat(11));
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.passwordLength'));
    expect(mocks.setupInstance).not.toHaveBeenCalled();
  });

  it('a 400 PASSWORD_POLICY from the server shows the policy sentence', async () => {
    mocks.setupInstance.mockRejectedValue(new AuthApiError(400, 'PASSWORD_POLICY'));
    renderAt(<SetupPage />, '/setup');
    await fill('a long password');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.PASSWORD_POLICY));
  });

  it('a wrong setup token shows its sentence', async () => {
    mocks.setupInstance.mockRejectedValue(new AuthApiError(403, 'SETUP_TOKEN_INVALID'));
    renderAt(<SetupPage />, '/setup');
    await fill('a long password');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.SETUP_TOKEN_INVALID));
    expect(mocks.adoptToken).not.toHaveBeenCalled();
  });

  it('once setup is closed (setupOpen false), /setup sends to /login', async () => {
    mocks.getSetupStatus.mockResolvedValue(openSetup);
    renderAt(<SetupPage />, '/setup');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'));
  });

  it('once setup is closed (409 SETUP_CLOSED), /setup sends to /login', async () => {
    mocks.setupInstance.mockRejectedValue(new AuthApiError(409, 'SETUP_CLOSED'));
    renderAt(<SetupPage />, '/setup');
    await fill('a long password');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'));
  });
});
