import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The end of the guided tour in the Community Edition: it lands on the
 * project list (`/appsec/projects`), where the last step's « New project »
 * button and the modal Finish opens live, never on `/appsec` (« Get started »).
 * The cloud case (`/appsec`) is OnboardingStep.test.tsx.
 */
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'community',
}));

// --- Mocks ---

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const mockDispatch = vi.fn();
let mockSelectorValues: Record<string, any> = {};

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('react-redux', () => ({
  useSelector: (fn: (state: any) => any) => fn(mockSelectorValues),
  useDispatch: () => mockDispatch,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-rebac', () => ({
  useRebac: () => ({ setUser: vi.fn() }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    h3: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...rest } = props;
      return <h3 {...rest}>{children}</h3>;
    },
    p: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, ...rest } = props;
      return <p {...rest}>{children}</p>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/server/services/userService', () => ({
  fetchMyProfile: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('@/server/store/userSlice', () => ({
  setOnboardingStep: vi.fn(),
  setUserProfile: vi.fn(),
}));

vi.mock('@/components/atoms/cybe-avatar/CybeAvatar', () => ({
  CybeAvatar: () => <div data-testid="cybe-avatar" />,
}));

// Mutable so individual tests can drive the "last step" finish path.
let mockConfig: any = {
  totalSteps: 3,
  steps: [
    { id: 'projects', path: '/appsec' },
    { id: 'reports', path: '/appsec/reports' },
    { id: 'createProject', path: '/appsec' },
  ],
  getStepNumber: (id: string) => (id === 'projects' ? 1 : 2),
  getNextPath: () => '/appsec/reports',
  isLastStep: () => false,
  hasAccessToStep: () => true,
  isReady: true,
};

vi.mock('@/server/hooks/useOnboardingConfig', () => ({
  useOnboardingConfig: () => mockConfig,
}));

vi.mock('@/components/atoms/button/Button', () => ({
  default: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

import OnboardingStep from './OnboardingStep';
import { updateUserProfile } from '@/server/services/userService';

describe('OnboardingStep in the Community Edition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      totalSteps: 2,
      steps: [
        { id: 'projects', path: '/appsec/projects' },
        { id: 'createProject', path: '/appsec/projects' },
      ],
      getStepNumber: () => 2,
      getNextPath: () => undefined,
      isLastStep: () => true,
      hasAccessToStep: () => true,
      isReady: true,
    };
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: false,
        isProfileLoaded: true,
        onboardingStep: 2,
        onboardingPersona: 'tech_lead',
      },
    };
  });

  it('finishing the tour lands on the project list and opens the create-project step', async () => {
    const onFinish = vi.fn();
    vi.mocked(updateUserProfile).mockResolvedValueOnce({} as never);
    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="createProject" onFinish={onFinish}>
        <button>Click me</button>
      </OnboardingStep>
    );

    fireEvent.click(await screen.findByText('common.finish'));

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('/appsec/projects');
    expect(mockNavigate).not.toHaveBeenCalledWith('/appsec');
  });
});
