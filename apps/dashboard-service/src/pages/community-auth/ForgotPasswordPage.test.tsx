import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { translate } from '@/test/i18n-mock';
import ForgotPasswordPage from './ForgotPasswordPage';
import { openSetup, renderAt } from './testHarness';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const mocks = vi.hoisted(() => ({ getSetupStatus: vi.fn(), requestPasswordReset: vi.fn() }));
vi.mock('@/edition/auth/community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/auth/community/authApi')>()),
  getSetupStatus: mocks.getSetupStatus,
  requestPasswordReset: mocks.requestPasswordReset,
}));

async function ask(email: string) {
  fireEvent.change(await screen.findByLabelText(translate('pages.communityAuth.fields.email')), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: translate('pages.communityAuth.forgot.submit') }));
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    mocks.getSetupStatus.mockReset().mockResolvedValue(openSetup);
    mocks.requestPasswordReset.mockReset().mockResolvedValue(undefined);
  });

  it('answers the same sentence whatever the e-mail', async () => {
    const view = renderAt(<ForgotPasswordPage />, '/forgot-password');
    await ask('ada@example.test');
    expect(await screen.findByText(translate('pages.communityAuth.forgot.sent'))).toBeInTheDocument();
    view.unmount();

    renderAt(<ForgotPasswordPage />, '/forgot-password');
    await ask('nobody@example.test');
    expect(await screen.findByText(translate('pages.communityAuth.forgot.sent'))).toBeInTheDocument();
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith('ada@example.test');
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith('nobody@example.test');
  });

  it('a 429 shows the rate sentence', async () => {
    mocks.requestPasswordReset.mockRejectedValue(new AuthApiError(429, 'RATE_LIMITED'));
    renderAt(<ForgotPasswordPage />, '/forgot-password');
    await ask('ada@example.test');
    expect(await screen.findByRole('alert')).toHaveTextContent(translate('pages.communityAuth.refusals.RATE_LIMITED'));
  });

  it('without passwordResetByEmail, shows the administrator sentence and no form', async () => {
    mocks.getSetupStatus.mockResolvedValue({ ...openSetup, passwordResetByEmail: false });
    renderAt(<ForgotPasswordPage />, '/forgot-password');
    expect(await screen.findByText(translate('pages.communityAuth.forgot.byAdministrator'))).toBeInTheDocument();
    expect(screen.queryByLabelText(translate('pages.communityAuth.fields.email'))).toBeNull();
    expect(screen.queryByRole('button', { name: translate('pages.communityAuth.forgot.submit') })).toBeNull();
    await waitFor(() => expect(mocks.requestPasswordReset).not.toHaveBeenCalled());
  });
});
