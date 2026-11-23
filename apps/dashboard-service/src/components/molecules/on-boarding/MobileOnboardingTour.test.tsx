import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These cases describe the cloud's behaviour; the Community Edition's is pinned
// by MobileOnboardingTour.community.test.tsx.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

// The tour on a phone: ONE component on the home page that walks through what
// the product does, then leaves the user where they already are. It replaces a
// spotlight tour that navigated to a new page for every step.

let mockState: Record<string, any> = {};
vi.mock('react-redux', () => ({ useSelector: (fn: (s: any) => any) => fn(mockState) }));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const toastError = vi.fn();
vi.mock('react-toastify', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const finish = vi.fn();
vi.mock('@/server/hooks/useFinishOnboarding', () => ({ useFinishOnboarding: () => finish }));

let access: string[] = [];
let configReady = true;
vi.mock('@/server/hooks/useOnboardingConfig', () => ({
  useOnboardingConfig: () => ({ hasAccessToStep: (id: string) => access.includes(id), isReady: configReady }),
}));

import MobileOnboardingTour from './MobileOnboardingTour';

const setViewport = (compact: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: compact,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

const newAccount = (overrides: Record<string, unknown> = {}) => ({
  user: {
    isProfileLoaded: true,
    isOnboardingCompleted: false,
    onboardingPersona: 'tech_lead',
    myOrganizations: [{ id: 'org-1' }],
    ...overrides,
  },
});

const slide = (name: string) => screen.getByRole('dialog', { name });
const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('MobileOnboardingTour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finish.mockResolvedValue(undefined);
    access = ['projects', 'reports', 'organizationOverview', 'integrationsSettings', 'createProject'];
    configReady = true;
    mockState = newAccount();
    setViewport(true);
  });
  afterEach(() => {
    // @ts-expect-error restore jsdom's default (no matchMedia)
    delete window.matchMedia;
  });

  // ── When it shows ─────────────────────────────────────────────────────────

  it('stays out of the way on a wide viewport, where the spotlight tour runs', () => {
    setViewport(false);
    render(<MobileOnboardingTour />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['the persona questions are not answered yet', { onboardingPersona: null }],
    ['onboarding is already completed', { isOnboardingCompleted: true }],
    ['the profile has not loaded', { isProfileLoaded: false }],
    ['the user has no organisation', { myOrganizations: [] }],
  ])('does not show while %s', (_label, overrides) => {
    mockState = newAccount(overrides);
    render(<MobileOnboardingTour />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits for the role check, so slides do not appear and then vanish', () => {
    configReady = false;
    render(<MobileOnboardingTour />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // ── What it shows ─────────────────────────────────────────────────────────

  it('walks through the product in one place', () => {
    render(<MobileOnboardingTour />);

    expect(within(slide('Scan your code')).getByText('1 of 4')).toBeInTheDocument();
    tap('Next');
    expect(slide('Cybe does the triage')).toBeInTheDocument();
    tap('Next');
    expect(slide('Track your posture')).toBeInTheDocument();
    tap('Next');
    expect(within(slide('Plug in your tools')).getByText('4 of 4')).toBeInTheDocument();
  });

  // Pictograms said nothing; each slide shows the real desktop screen instead,
  // in the user's language, with a dark variant for the dark theme.
  it('shows a screenshot of the product on every slide', () => {
    render(<MobileOnboardingTour />);

    for (const id of ['scan', 'cybe', 'posture', 'tools']) {
      const shots = within(screen.getByTestId('mobile-tour-shot')).getAllByRole('presentation', { hidden: true });
      expect(shots.map((img) => img.getAttribute('src'))).toEqual([
        `/image/onboarding/tour-${id}-en-light.webp`,
        `/image/onboarding/tour-${id}-en-dark.webp`,
      ]);
      if (id !== 'tools') tap('Next');
    }
  });

  it('fetches the next screenshots ahead of time, so a slide never opens on a blank frame', () => {
    const requested: string[] = [];
    const RealImage = window.Image;
    // @ts-expect-error minimal stand-in recording what gets requested
    window.Image = class {
      set src(value: string) {
        requested.push(value);
      }
    };
    try {
      render(<MobileOnboardingTour />);
    } finally {
      window.Image = RealImage;
    }

    expect(requested).toEqual(
      expect.arrayContaining([
        '/image/onboarding/tour-cybe-en-light.webp',
        '/image/onboarding/tour-posture-en-light.webp',
        '/image/onboarding/tour-tools-en-light.webp',
      ]),
    );
  });

  it('shows the organisation overview to anyone who can open it, reports or not', () => {
    // A solo developer has no reports step, but does have the overview page.
    access = ['projects', 'organizationOverview', 'createProject'];
    render(<MobileOnboardingTour />);

    tap('Next');
    tap('Next');

    expect(within(slide('Track your posture')).getByText('3 of 3')).toBeInTheDocument();
  });

  it('only presents what this user can actually reach', () => {
    // A solo developer who came for their AI agents: no reports, no integrations.
    access = ['projects', 'createProject'];
    render(<MobileOnboardingTour />);

    expect(within(slide('Scan your code')).getByText('1 of 2')).toBeInTheDocument();
    tap('Next');
    expect(slide('Cybe does the triage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: "Let's go" })).toBeInTheDocument();
  });

  it('goes back one slide, and has nowhere to go back to on the first', () => {
    render(<MobileOnboardingTour />);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    tap('Next');
    tap('Back');

    expect(slide('Scan your code')).toBeInTheDocument();
  });

  // Screen readers start reading the new slide from its top, and the button
  // just tapped does not keep a focus ring through the whole tour.
  it('moves focus to the slide when it changes, but does not steal it on arrival', () => {
    render(<MobileOnboardingTour />);
    const area = screen.getByTestId('mobile-tour-slide');
    expect(document.activeElement).not.toBe(area);

    tap('Next');

    expect(document.activeElement).toBe(area);
  });

  it('follows a swipe: left for the next slide, right for the previous one', () => {
    render(<MobileOnboardingTour />);
    const area = screen.getByTestId('mobile-tour-slide');

    fireEvent.touchStart(area, { changedTouches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 120, clientY: 210 }] });
    expect(slide('Cybe does the triage')).toBeInTheDocument();

    fireEvent.touchStart(area, { changedTouches: [{ clientX: 120, clientY: 200 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 300, clientY: 190 }] });
    expect(slide('Scan your code')).toBeInTheDocument();
  });

  it('ignores a vertical scroll gesture', () => {
    render(<MobileOnboardingTour />);
    const area = screen.getByTestId('mobile-tour-slide');

    fireEvent.touchStart(area, { changedTouches: [{ clientX: 200, clientY: 400 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 150, clientY: 150 }] });

    expect(slide('Scan your code')).toBeInTheDocument();
  });

  // ── How it ends ───────────────────────────────────────────────────────────

  it('finishes onboarding from the last slide', async () => {
    access = ['projects', 'createProject'];
    render(<MobileOnboardingTour />);
    tap('Next');

    tap("Let's go");

    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
  });

  it('lets the user skip from any slide, with the button or the close control', async () => {
    const { unmount } = render(<MobileOnboardingTour />);
    tap('Skip');
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    unmount();

    render(<MobileOnboardingTour />);
    tap('Close');
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(2));
  });

  it('says so and stays open when the save fails', async () => {
    finish.mockRejectedValueOnce(new Error('network'));
    render(<MobileOnboardingTour />);

    tap('Skip');

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't save that. Please try again."));
    expect(slide('Scan your code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
  });
});
