import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) => select({ user: { id: 'user-1', email: 'a@b.test', notification: true } }),
  useDispatch: () => vi.fn(),
}));
vi.mock('@/edition/auth/useAuth', () => ({ useAuth: () => ({ loading: false }) }));
vi.mock('./AccountTemplate', () => ({
  default: (props: Record<string, unknown>) => {
    h.props = props;
    return null;
  },
}));

import AccountPage from './AccountPage';

/** The account page carries no hosted-service referral programme. */
describe('AccountPage', () => {
  it('hands its template no referral link', () => {
    render(<AccountPage />);
    expect(h.props).not.toBeNull();
    expect(h.props).not.toHaveProperty('referralLink');
    expect(h.props).not.toHaveProperty('onCopyReferralLink');
  });
});
