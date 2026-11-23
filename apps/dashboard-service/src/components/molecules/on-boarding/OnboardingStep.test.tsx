import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { appsecProjectListPath } from '@/utils/appsecProjectList';
import { updateUserProfile } from '@/server/services/userService';
import { setOnboardingStep } from '@/server/store/userSlice';

describe('OnboardingStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
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
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: false,
        isProfileLoaded: false,
        onboardingStep: 1,
      },
    };
  });

  it('renders only children when profile is not yet loaded', () => {
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: false,
        isProfileLoaded: false,
        onboardingStep: 1,
      },
    };

    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="projects">
        <div data-testid="child-content">Hello</div>
      </OnboardingStep>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    // Should NOT have pointer-events-none wrapper (onboarding overlay structure)
    const child = screen.getByTestId('child-content');
    expect(child.className).not.toContain('pointer-events-none');
  });

  it('renders only children when onboarding is completed', () => {
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: true,
        isProfileLoaded: true,
        onboardingStep: 1,
      },
    };

    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="projects">
        <div data-testid="child-content">Hello</div>
      </OnboardingStep>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    const child = screen.getByTestId('child-content');
    expect(child.className).not.toContain('pointer-events-none');
  });

  it('does not wrap children in pointer-events-none before profile loads even when step matches', () => {
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: false,
        isProfileLoaded: false,
        onboardingStep: 1,
      },
    };

    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="projects">
        <button data-testid="clickable-btn">Click me</button>
      </OnboardingStep>
    );

    const btn = screen.getByTestId('clickable-btn');
    // Before profile loads, button should remain interactive (no overlay wrapper)
    expect(btn.className).not.toContain('pointer-events-none');
  });

  // ── Persona gate: the tour waits for the persona questions to be answered ──

  it('renders no tour overlay while onboardingPersona is null, even when the step matches', () => {
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: false,
        isProfileLoaded: true,
        onboardingStep: 1,
        onboardingPersona: null,
      },
    };

    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="projects">
        <button data-testid="clickable-btn">Click me</button>
      </OnboardingStep>
    );

    const btn = screen.getByTestId('clickable-btn');
    // Tour must NOT engage: children stay interactive, no overlay wrapper
    expect(btn.className).not.toContain('pointer-events-none');
  });

  it('renders the tour overlay once onboardingPersona is set and the step matches', () => {
    mockSelectorValues = {
      user: {
        isOnboardingCompleted: false,
        isProfileLoaded: true,
        onboardingStep: 1,
        onboardingPersona: 'tech_lead',
      },
    };

    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="projects">
        <button data-testid="clickable-btn">Click me</button>
      </OnboardingStep>
    );

    const btn = screen.getByTestId('clickable-btn');
    // Tour engaged: the active-step wrapper disables the target's own clicks
    expect(btn.className).toContain('pointer-events-none');
  });

  // ── onFinish: fired when the LAST step's Finish button is clicked ──────────

  it('invokes onFinish after the tour finishes on the last step', async () => {
    const onFinish = vi.fn();
    // Drive the "last step" path: step 2 (so no welcome/skip button), active,
    // and it is the last step so the primary button reads "Finish".
    mockConfig = {
      totalSteps: 2,
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

    render(
      <OnboardingStep
        title="Test"
        subtitle="Sub"
        stepId="createProject"
        onFinish={onFinish}
      >
        <button data-testid="clickable-btn">Click me</button>
      </OnboardingStep>
    );

    // The tour bubble appears after a short reveal delay.
    const finishBtn = await screen.findByText('common.finish');
    fireEvent.click(finishBtn);

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });

  // ── interactive mode: the spotlighted element itself completes the tour ─────

  const interactiveLastStep = () => {
    mockConfig = {
      totalSteps: 2,
      steps: [
        { id: 'projects', path: '/appsec' },
        { id: 'createProject', path: '/appsec' },
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
  };

  it('interactive mode keeps the child clickable, hides the Finish button, and completes on click', async () => {
    const onFinish = vi.fn();
    const childClick = vi.fn();
    interactiveLastStep();

    render(
      <OnboardingStep
        interactive
        title="Test"
        subtitle="Sub"
        stepId="createProject"
        onFinish={onFinish}
      >
        <button data-testid="clickable-btn" onClick={childClick}>
          Create Project
        </button>
      </OnboardingStep>
    );

    // Bubble is up in interactive mode: Skip present, no primary Finish.
    await screen.findByText('common.skip');
    expect(screen.queryByText('common.finish')).not.toBeInTheDocument();
    expect(screen.queryByText('common.gotIt')).not.toBeInTheDocument();

    const btn = screen.getByTestId('clickable-btn');
    // Interactive: the spotlighted element stays fully clickable.
    expect(btn.className).not.toContain('pointer-events-none');

    fireEvent.click(btn);

    // The child's original onClick fires (opens the modal in real usage) ...
    expect(childClick).toHaveBeenCalledTimes(1);
    // ... and the tour completes (profile marked onboarded).
    await waitFor(() =>
      expect(updateUserProfile).toHaveBeenCalledWith(null, true)
    );
    // Interactive mode never fires onFinish.
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('interactive mode completes exactly once on a rapid double-click', async () => {
    const childClick = vi.fn();
    interactiveLastStep();

    render(
      <OnboardingStep interactive title="Test" subtitle="Sub" stepId="createProject">
        <button data-testid="clickable-btn" onClick={childClick}>
          Create Project
        </button>
      </OnboardingStep>
    );

    const btn = screen.getByTestId('clickable-btn');
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() => expect(updateUserProfile).toHaveBeenCalledTimes(1));
  });

  it('interactive mode: Skip still completes the tour', async () => {
    interactiveLastStep();

    render(
      <OnboardingStep interactive title="Test" subtitle="Sub" stepId="createProject">
        <button data-testid="clickable-btn">Create Project</button>
      </OnboardingStep>
    );

    const skip = await screen.findByText('common.skip');
    fireEvent.click(skip);

    await waitFor(() =>
      expect(updateUserProfile).toHaveBeenCalledWith(null, true)
    );
  });

  it('interactive mode fires onInteract on click (active step), before the child onClick', async () => {
    interactiveLastStep();
    const calls: string[] = [];
    const onInteract = vi.fn(() => calls.push('interact'));
    const childClick = vi.fn(() => calls.push('child'));

    render(
      <OnboardingStep
        interactive
        onInteract={onInteract}
        title="Test"
        subtitle="Sub"
        stepId="createProject"
      >
        <button data-testid="clickable-btn" onClick={childClick}>
          Create Project
        </button>
      </OnboardingStep>
    );

    await screen.findByText('common.skip');
    fireEvent.click(screen.getByTestId('clickable-btn'));

    expect(onInteract).toHaveBeenCalledTimes(1);
    // onInteract must run BEFORE the child's own onClick so the caller's guided
    // flag is set in the same batched render as whatever the child opens.
    expect(calls).toEqual(['interact', 'child']);
  });

  it('interactive mode renders the invitation hint in its own contained banner (not beside skip)', async () => {
    interactiveLastStep();

    render(
      <OnboardingStep
        interactive
        interactiveHint="👆 Click Create Project to continue"
        title="Test"
        subtitle="Sub"
        stepId="createProject"
      >
        <button data-testid="clickable-btn">Create Project</button>
      </OnboardingStep>
    );

    // The full invitation copy renders (contained banner, free to wrap) ...
    expect(
      await screen.findByText('👆 Click Create Project to continue')
    ).toBeInTheDocument();
    // ... and the de-emphasised skip link is still present and functional.
    expect(screen.getByText('common.skip')).toBeInTheDocument();
  });

  it('lets the user click a previous step dot to jump back to it', async () => {
    // Last step (2 of 2), so step 1 is a past step the user can return to.
    interactiveLastStep();

    render(
      <OnboardingStep interactive title="Test" subtitle="Sub" stepId="createProject">
        <button data-testid="clickable-btn">Create Project</button>
      </OnboardingStep>
    );

    // The dots live inside the bubble, which appears after the reveal delay.
    await screen.findByText('common.skip');

    // Step 1 is in the past → its dot is an enabled control.
    const dot1 = screen.getByTestId('onboarding-dot-1');
    expect(dot1).not.toBeDisabled();

    fireEvent.click(dot1);

    // Jumps the tour back to step 1 and navigates to that step's page.
    expect(setOnboardingStep).toHaveBeenCalledWith(1);
    expect(mockNavigate).toHaveBeenCalledWith('/appsec');
  });

  it('does not let the user jump forward past the current step via its dot', async () => {
    // Second step of three is the active one; step 3 lies ahead.
    mockConfig = {
      totalSteps: 3,
      steps: [
        { id: 'projects', path: '/appsec' },
        { id: 'reports', path: '/appsec/reports' },
        { id: 'createProject', path: '/appsec' },
      ],
      getStepNumber: () => 2,
      getNextPath: () => '/appsec',
      isLastStep: () => false,
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

    render(
      <OnboardingStep title="Test" subtitle="Sub" stepId="reports">
        <button data-testid="clickable-btn">Reports</button>
      </OnboardingStep>
    );

    // Bubble is up once the primary "Got it" button renders.
    await screen.findByText('common.gotIt');

    // The current step's own dot and any future dot are inert (disabled).
    expect(screen.getByTestId('onboarding-dot-2')).toBeDisabled();
    const dot3 = screen.getByTestId('onboarding-dot-3');
    expect(dot3).toBeDisabled();

    fireEvent.click(dot3);
    expect(setOnboardingStep).not.toHaveBeenCalled();
  });

  it('does NOT fire onInteract when this interactive step is NOT the active tour step', () => {
    // The over-trigger fix: onInteract must only fire for a genuine active-step
    // click. Here onboardingStep=1 but the step resolves to 2 → inactive: the
    // child renders plain (no spotlight, no interception).
    mockConfig = {
      totalSteps: 2,
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
        onboardingStep: 1, // active step is 1, not this step (2)
        onboardingPersona: 'tech_lead',
      },
    };
    const onInteract = vi.fn();
    const childClick = vi.fn();

    render(
      <OnboardingStep
        interactive
        onInteract={onInteract}
        title="Test"
        subtitle="Sub"
        stepId="createProject"
      >
        <button data-testid="clickable-btn" onClick={childClick}>
          Create Project
        </button>
      </OnboardingStep>
    );

    fireEvent.click(screen.getByTestId('clickable-btn'));

    expect(onInteract).not.toHaveBeenCalled();
    // The child's own onClick still works (it's just a normal button now).
    expect(childClick).toHaveBeenCalledTimes(1);
    // No completion either — this isn't the active tour click.
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  // ── the completion save fails ─────────────────────────────────────────────
  // A completion PATCH can hang for minutes on a dead connection, then fail with
  // an axios "Network Error". Clicking Skip twice must not send two PATCHes, the
  // failure must be shown, and no failure may escape as an unhandled rejection.

  describe('when a completion step fails', () => {
    const networkError = () =>
      Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    // Node reports an unhandled rejection on the macrotask after it happened.
    const flushRejections = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      unhandled.length = 0;
      process.on('unhandledRejection', onUnhandled);
    });

    afterEach(() => {
      process.off('unhandledRejection', onUnhandled);
    });

    it('Finish shows a translated toast, stays put, and can be retried', async () => {
      const onFinish = vi.fn();
      mockConfig = {
        totalSteps: 2,
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
      vi.mocked(updateUserProfile).mockRejectedValueOnce(networkError());

      render(
        <OnboardingStep title="Test" subtitle="Sub" stepId="createProject" onFinish={onFinish}>
          <button>Click me</button>
        </OnboardingStep>
      );

      fireEvent.click(await screen.findByText('common.finish'));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('components.onboarding.saveFailed')
      );
      await flushRejections();
      expect(unhandled).toEqual([]);
      expect(onFinish).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();

      vi.mocked(updateUserProfile).mockResolvedValueOnce({} as never);
      fireEvent.click(screen.getByText('common.finish'));

      await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
      expect(updateUserProfile).toHaveBeenCalledTimes(2);
    });

    it('Skip saves once on a double-click, shows a toast, and can be retried', async () => {
      interactiveLastStep();
      let rejectSave: (err: unknown) => void = () => {};
      vi.mocked(updateUserProfile).mockImplementationOnce(
        () => new Promise((_resolve, reject) => { rejectSave = reject; })
      );

      render(
        <OnboardingStep interactive title="Test" subtitle="Sub" stepId="createProject">
          <button>Create Project</button>
        </OnboardingStep>
      );

      const skip = await screen.findByText('common.skip');
      fireEvent.click(skip);
      fireEvent.click(skip);
      expect(updateUserProfile).toHaveBeenCalledTimes(1);

      rejectSave(networkError());

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('components.onboarding.saveFailed')
      );
      await flushRejections();
      expect(unhandled).toEqual([]);
      expect(mockNavigate).not.toHaveBeenCalled();

      vi.mocked(updateUserProfile).mockResolvedValueOnce({} as never);
      fireEvent.click(screen.getByText('common.skip'));

      // the end of the tour lands on the project list: /appsec in the cloud,
      // /appsec/projects in the Community Edition (whose home is Get started)
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(appsecProjectListPath()));
      expect(updateUserProfile).toHaveBeenCalledTimes(2);
    });

    it('a saved tour still finishes when clearing the guide dismissals throws', async () => {
      const onFinish = vi.fn();
      mockConfig = {
        totalSteps: 2,
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
      vi.mocked(updateUserProfile).mockResolvedValueOnce({} as never);
      localStorage.setItem('cybe-guide-dismissed-reports', '1');
      // Storage disabled by the browser: every access raises a SecurityError.
      const removeItem = vi
        .spyOn(Storage.prototype, 'removeItem')
        .mockImplementation(() => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        });

      try {
        render(
          <OnboardingStep title="Test" subtitle="Sub" stepId="createProject" onFinish={onFinish}>
            <button>Click me</button>
          </OnboardingStep>
        );

        fireEvent.click(await screen.findByText('common.finish'));

        await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
        expect(removeItem).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith(appsecProjectListPath());
        expect(toastError).not.toHaveBeenCalled();
        await flushRejections();
        expect(unhandled).toEqual([]);
      } finally {
        removeItem.mockRestore();
        localStorage.clear();
      }
    });

    it('the interactive click shows a toast instead of an unhandled rejection', async () => {
      interactiveLastStep();
      vi.mocked(updateUserProfile).mockRejectedValueOnce(networkError());

      render(
        <OnboardingStep interactive title="Test" subtitle="Sub" stepId="createProject">
          <button>Create Project</button>
        </OnboardingStep>
      );

      await screen.findByText('common.skip');
      fireEvent.click(screen.getByText('Create Project'));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('components.onboarding.saveFailed')
      );
      await flushRejections();
      expect(unhandled).toEqual([]);
    });
  });
});
