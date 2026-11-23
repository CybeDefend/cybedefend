import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// On a phone the page-by-page spotlight tour is replaced by one self-contained
// component (MobileOnboardingTour). The steps mounted on each page must then be
// completely inert: no scrim, no scroll lock, no bubble — and above all no
// automatic navigation, which is what made the phone tour hop between pages.

const mockDispatch = vi.fn();
let mockSelectorValues: Record<string, any> = {};
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('react-redux', () => ({
  useSelector: (fn: (state: any) => any) => fn(mockSelectorValues),
  useDispatch: () => mockDispatch,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children }: any) => <a>{children}</a>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-rebac', () => ({ useRebac: () => ({ setUser: vi.fn() }) }));
vi.mock('@/server/services/userService', () => ({
  fetchMyProfile: vi.fn(),
  updateUserProfile: vi.fn(),
}));
vi.mock('@/server/store/userSlice', () => ({
  setOnboardingStep: vi.fn((step: number) => ({ type: 'setOnboardingStep', payload: step })),
  setUserProfile: vi.fn(),
}));
vi.mock('@/components/atoms/cybe-avatar/CybeAvatar', () => ({ CybeAvatar: () => <div /> }));

let mockConfig: any;
vi.mock('@/server/hooks/useOnboardingConfig', () => ({ useOnboardingConfig: () => mockConfig }));

import OnboardingStep from './OnboardingStep';
import { updateUserProfile } from '@/server/services/userService';

const setViewport = (compact: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: compact,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

const activeStep = ({ hasAccess = true } = {}) => {
  mockConfig = {
    totalSteps: 3,
    steps: [{ id: 'projects', path: '/appsec' }, { id: 'reports', path: '/appsec/reports' }, { id: 'createProject', path: '/appsec' }],
    getStepNumber: () => 1,
    getNextPath: () => '/appsec/reports',
    isLastStep: () => false,
    hasAccessToStep: () => hasAccess,
    isReady: true,
  };
  mockSelectorValues = {
    user: { isOnboardingCompleted: false, isProfileLoaded: true, onboardingStep: 1, onboardingPersona: 'tech_lead' },
  };
};

describe('OnboardingStep on a compact viewport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = '';
    setViewport(true);
  });
  afterEach(() => {
    // @ts-expect-error restore jsdom's default (no matchMedia)
    delete window.matchMedia;
  });

  it('leaves its target untouched: no spotlight, no bubble, no scroll lock', async () => {
    activeStep();
    render(
      <OnboardingStep title="Projects" subtitle="Your projects" stepId="projects">
        <button data-testid="target">Open</button>
      </OnboardingStep>,
    );

    // The bubble normally appears after a 300ms reveal delay: wait past it.
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(screen.getByTestId('target').className).not.toContain('pointer-events-none');
    expect(screen.queryByText('common.gotIt')).toBeNull();
    expect(screen.queryByText('Projects')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('never navigates on its own, even for a step the user has no access to', async () => {
    // On a wide screen an inaccessible step auto-skips to the next page. On a
    // phone nothing may move the user off the page they are on.
    activeStep({ hasAccess: false });
    render(
      <OnboardingStep title="Projects" subtitle="Your projects" stepId="projects">
        <button>Open</button>
      </OnboardingStep>,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(updateUserProfile).not.toHaveBeenCalled();
  });
});
