import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from '@/pages/community-auth/authRefusals';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * The Community Edition's password change:
 * POST /auth/password/change answers a new access token and a rotated cookie,
 * every other session being signed out. A wrong current password is a 400,
 * never a sign-out.
 */

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), adoptToken: vi.fn(), markSessionBroken: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  changePassword: mocks.changePassword,
}));
vi.mock('@/edition/auth/community/communityAuthClient', () => ({ adoptToken: mocks.adoptToken }));
vi.mock('@/server/api/tokenManager', () => ({ markSessionBroken: mocks.markSessionBroken }));

const CURRENT = 'the old password';
const NEXT = 'a brand new password';

const field = (key: string) => screen.getByLabelText(translate(key));
const submit = () => screen.getByRole('button', { name: translate('pages.communityAuth.changePassword.submit') });

function fill(current = CURRENT, next = NEXT) {
  fireEvent.change(field('pages.communityAuth.changePassword.current'), { target: { value: current } });
  fireEvent.change(field('pages.communityAuth.fields.newPassword'), { target: { value: next } });
  fireEvent.click(submit());
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    mocks.changePassword.mockReset().mockResolvedValue({ accessToken: 'n.e.w', tokenType: 'Bearer', expiresIn: 900 });
    mocks.adoptToken.mockReset();
    mocks.markSessionBroken.mockReset();
  });

  it('a 200 adopts the new token and says other sessions were signed out', async () => {
    render(<ChangePasswordForm />);
    fill();
    expect(await screen.findByRole('status')).toHaveTextContent(translate('pages.communityAuth.changePassword.done'));
    expect(mocks.changePassword).toHaveBeenCalledWith(CURRENT, NEXT);
    expect(mocks.adoptToken).toHaveBeenCalledWith('n.e.w', 900);
    // The passwords do not outlive the request: the fields are emptied.
    expect(field('pages.communityAuth.changePassword.current')).toHaveValue('');
    expect(field('pages.communityAuth.fields.newPassword')).toHaveValue('');
  });

  it('CURRENT_PASSWORD_INVALID shows its sentence and keeps the session', async () => {
    mocks.changePassword.mockRejectedValue(new AuthApiError(400, 'CURRENT_PASSWORD_INVALID'));
    render(<ChangePasswordForm />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.CURRENT_PASSWORD_INVALID));
    expect(mocks.markSessionBroken).not.toHaveBeenCalled();
    expect(mocks.adoptToken).not.toHaveBeenCalled();
  });

  it('PASSWORD_POLICY shows its sentence', async () => {
    mocks.changePassword.mockRejectedValue(new AuthApiError(400, 'PASSWORD_POLICY'));
    render(<ChangePasswordForm />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.PASSWORD_POLICY));
  });

  it('PAT_NOT_ALLOWED and RATE_LIMITED show their sentences', async () => {
    mocks.changePassword.mockRejectedValueOnce(new AuthApiError(403, 'PAT_NOT_ALLOWED'));
    render(<ChangePasswordForm />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.PAT_NOT_ALLOWED));
    mocks.changePassword.mockRejectedValueOnce(new AuthApiError(429, 'RATE_LIMITED', 60));
    fill();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.RATE_LIMITED)),
    );
  });

  it('an answer outside the list is GENERIC', async () => {
    mocks.changePassword.mockRejectedValue(new AuthApiError(400, null));
    render(<ChangePasswordForm />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(translate(AUTH_REFUSAL_KEYS.GENERIC));
  });

  it('a new password outside 12 to 128 characters is refused with no request', async () => {
    render(<ChangePasswordForm />);
    fill(CURRENT, 'short');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.passwordLength'));
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('an empty current password sends nothing', async () => {
    render(<ChangePasswordForm />);
    fill('', NEXT);
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.changePassword.currentRequired'));
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it.each([
    ['CURRENT_PASSWORD_INVALID', new AuthApiError(400, 'CURRENT_PASSWORD_INVALID')],
    ['PASSWORD_POLICY', new AuthApiError(400, 'PASSWORD_POLICY')],
    ['RATE_LIMITED', new AuthApiError(429, 'RATE_LIMITED', 60)],
    ['a network failure', new AuthApiError(null, null)],
  ] as const)('after %s both password fields are empty', async (_label, error) => {
    mocks.changePassword.mockRejectedValue(error);
    render(<ChangePasswordForm />);
    fill();
    await screen.findByRole('alert');
    await waitFor(() => expect(field('pages.communityAuth.changePassword.current')).toHaveValue(''));
    expect(field('pages.communityAuth.fields.newPassword')).toHaveValue('');
    expect(mocks.adoptToken).not.toHaveBeenCalled();
  });
});
