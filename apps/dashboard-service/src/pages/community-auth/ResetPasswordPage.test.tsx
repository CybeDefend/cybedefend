import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from './authRefusals';
import ResetPasswordPage from './ResetPasswordPage';
import { renderAt } from './testHarness';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ confirmPasswordReset: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  confirmPasswordReset: mocks.confirmPasswordReset,
}));

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

/** The address bar the reset mail opens (the page reads the window's, as the browser router does). */
function openAt(url: string) {
  window.history.replaceState(null, '', url);
  return renderAt(<ResetPasswordPage />, '/reset-password', '/reset-password');
}

async function submit(password = 'a long password') {
  fireEvent.change(await screen.findByLabelText(translate('pages.communityAuth.fields.newPassword')), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: translate('pages.communityAuth.reset.submit') }));
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mocks.confirmPasswordReset.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('drops the hash before the request', async () => {
    const order: string[] = [];
    const replaceState = vi.spyOn(window.history, 'replaceState');
    replaceState.mockImplementation(function (this: History, ...args: Parameters<History['replaceState']>) {
      order.push('replaceState');
      return History.prototype.replaceState.apply(this, args);
    });
    let hashAtRequest: string | null = null;
    mocks.confirmPasswordReset.mockImplementation(async () => {
      order.push('request');
      hashAtRequest = window.location.hash;
    });
    window.history.pushState(null, '', `/reset-password#token=${TOKEN}`);
    renderAt(<ResetPasswordPage />, '/reset-password');
    await waitFor(() => expect(window.location.hash).toBe(''));
    await submit();
    await waitFor(() => expect(mocks.confirmPasswordReset).toHaveBeenCalledWith(TOKEN, 'a long password'));
    expect(order.indexOf('replaceState')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('replaceState')).toBeLessThan(order.indexOf('request'));
    expect(hashAtRequest).toBe('');
    expect(window.location.pathname).toBe('/reset-password');
    expect(await screen.findByText(translate('pages.communityAuth.reset.done'))).toBeInTheDocument();
  });

  it('an invalid or used link shows RESET_TOKEN_INVALID', async () => {
    mocks.confirmPasswordReset.mockRejectedValue(new AuthApiError(400, 'RESET_TOKEN_INVALID'));
    openAt(`/reset-password#token=${TOKEN}`);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.RESET_TOKEN_INVALID));
  });

  it('a password the server refuses shows the policy sentence', async () => {
    mocks.confirmPasswordReset.mockRejectedValue(new AuthApiError(400, 'PASSWORD_POLICY'));
    openAt(`/reset-password#token=${TOKEN}`);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.PASSWORD_POLICY));
  });

  it('a short password shows the hint and sends nothing', async () => {
    openAt(`/reset-password#token=${TOKEN}`);
    await submit('short');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.passwordLength'));
    expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it.each(['/reset-password', '/reset-password#', '/reset-password#other=1', '/reset-password#token=a%20b'])(
    'a page with no usable #token (%s) shows RESET_TOKEN_INVALID and sends nothing',
    async (url) => {
      openAt(url);
      expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.RESET_TOKEN_INVALID));
      expect(screen.queryByLabelText(translate('pages.communityAuth.fields.newPassword'))).toBeNull();
      expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('');
    },
  );
});
