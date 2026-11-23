import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { translate } from '@/test/i18n-mock';

/**
 * The profile's account page per edition: the Community Edition adds its
 * password change (there is no identity provider account page to send to)
 * and offers no e-mail change; the cloud page is unchanged.
 */

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const state = vi.hoisted(() => ({ edition: 'cloud' as 'cloud' | 'community' }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return state.edition;
  },
}));

const USER = { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test', picture: '', notification: true };
vi.mock('react-redux', () => ({
  useSelector: (selector: (s: unknown) => unknown) => selector({ user: USER }),
  useDispatch: () => vi.fn(),
}));
vi.mock('@/edition/auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../server/services/userService', () => ({ updateUserProfile: vi.fn() }));
vi.mock('../../../server/store/userSlice', () => ({ updateUserNotification: vi.fn() }));
vi.mock('../../../utils/function/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/function/utils')>()),
  clearScannerStorage: vi.fn(),
}));
vi.mock('../../../components/molecules/wrapper/ProfileWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./ChangePasswordForm', () => ({
  ChangePasswordForm: () => <section data-testid="change-password-form" />,
  default: () => <section data-testid="change-password-form" />,
}));

import AccountPage from './AccountPage';

describe('AccountPage per edition', () => {
  beforeEach(() => {
    state.edition = 'cloud';
  });
  afterEach(cleanup);

  it('in community the account page shows the password change and no e-mail change', () => {
    state.edition = 'community';
    render(<AccountPage />);
    expect(screen.getByTestId('change-password-form')).toBeInTheDocument();
    // The address is shown, read only: nothing offers to change it.
    const email = screen.getByLabelText(translate('pages.accountTemplate.emailAddress'));
    expect(email).toHaveValue(USER.email);
    expect(email).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /e-?mail/i })).not.toBeInTheDocument();
  });

  it('in the cloud it is unchanged', () => {
    render(<AccountPage />);
    expect(screen.queryByTestId('change-password-form')).not.toBeInTheDocument();
    expect(screen.getByLabelText(translate('pages.accountTemplate.emailAddress'))).toHaveAttribute('readonly');
    expect(screen.getByText(translate('pages.accountTemplate.notifications'))).toBeInTheDocument();
    expect(screen.getByText(translate('pages.accountTemplate.support.title'))).toBeInTheDocument();
  });
});
