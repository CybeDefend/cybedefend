import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The phone tour per edition: its « Cybe does the triage » slide presents the
 * Cybe analysis, which the Community Edition does not ship. The
 * component reads `EDITION` once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
const state = {
  user: { isProfileLoaded: true, isOnboardingCompleted: false, onboardingPersona: 'tech_lead', myOrganizations: [{ id: 'org-1' }] },
};
vi.mock('react-redux', () => ({ useSelector: (fn: (s: unknown) => unknown) => fn(state) }));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/server/hooks/useFinishOnboarding', () => ({ useFinishOnboarding: () => vi.fn() }));
vi.mock('@/server/hooks/useOnboardingConfig', () => ({
  useOnboardingConfig: () => ({ hasAccessToStep: () => true, isReady: true }),
}));

const renderIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  window.matchMedia = vi.fn((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const MobileOnboardingTour = (await import('./MobileOnboardingTour')).default;
  render(<MobileOnboardingTour />);
};

describe('MobileOnboardingTour per edition', () => {
  afterEach(() => {
    // @ts-expect-error restore jsdom's default (no matchMedia)
    delete window.matchMedia;
  });

  it('the Community Edition walks through three slides, none about the Cybe analysis', async () => {
    await renderIn('community');
    expect(within(screen.getByRole('dialog', { name: 'Scan your code' })).getByText('1 of 3')).toBeInTheDocument();
  });

  it('the Community Edition asks to import the first results, not to launch a scan', async () => {
    await renderIn('community');
    const slide = screen.getByRole('dialog', { name: 'Scan your code' });
    expect(within(slide).getByText(/then import your first results\./)).toBeInTheDocument();
    expect(within(slide).queryByText(/launch your first scan/)).toBeNull();
  });

  it('the cloud asks to launch the first scan', async () => {
    await renderIn('cloud');
    expect(within(screen.getByRole('dialog', { name: 'Scan your code' })).getByText(/launch your first scan/)).toBeInTheDocument();
  });

  it('the cloud walks through the four slides', async () => {
    await renderIn('cloud');
    expect(within(screen.getByRole('dialog', { name: 'Scan your code' })).getByText('1 of 4')).toBeInTheDocument();
  });
});
