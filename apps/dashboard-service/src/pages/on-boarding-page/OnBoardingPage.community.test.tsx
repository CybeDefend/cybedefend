import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * The organisation creation form per edition: its « No payment details
 * required… if you upgrade » line speaks of plans, which the Community Edition
 * does not have (billing is closed). The page reads `EDITION` once at
 * load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
const state = { user: { id: 'user-1', email: 'dev@example.com', isProfileLoaded: true, myOrganizations: [] } };
vi.mock('react-redux', () => ({ useSelector: (fn: (s: unknown) => unknown) => fn(state), useDispatch: () => vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('../../server/services/organizationService', () => ({ createOrganization: vi.fn() }));
vi.mock('@/server/hooks/useOnboardingProgress', () => ({ useOnboardingProgress: () => ({ complete: vi.fn() }) }));

const NO_PAYMENT = /No payment details required/;

const renderCreateFormIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const OnboardingPage = (await import('./OnBoardingPage')).default;
  render(<OnboardingPage />);
  fireEvent.click(screen.getByTestId('chooser-create-card'));
  return screen.getByTestId('onboarding-create-form');
};

describe('OnBoardingPage — the payment line per edition', () => {
  it('the Community Edition says nothing about payment or upgrades', async () => {
    const form = await renderCreateFormIn('community');
    expect(form.textContent).not.toMatch(NO_PAYMENT);
  });

  it('the cloud says no payment details are required', async () => {
    const form = await renderCreateFormIn('cloud');
    expect(form.textContent).toMatch(NO_PAYMENT);
  });
});
