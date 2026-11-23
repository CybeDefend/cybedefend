import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CreationCoach, { deriveCoachPhase } from './CreationCoach';

// Return the inline default string so we can assert on the real message text.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// Stub the avatar — the coach test is about phase-driven messages, not the SVG.
vi.mock('@/components/atoms/cybe-avatar/CybeAvatar', () => ({
  CybeAvatar: () => <div data-testid="cybe-avatar" />,
  default: () => <div data-testid="cybe-avatar" />,
}));

function renderCoach(
  overrides: Partial<React.ComponentProps<typeof CreationCoach>> = {},
) {
  const props: React.ComponentProps<typeof CreationCoach> = {
    createMode: 'github',
    step: 1,
    totalSteps: 3,
    createdProjectId: null,
    onDismiss: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CreationCoach {...props} />) };
}

describe('deriveCoachPhase', () => {
  it('returns success whenever a project id exists (regardless of step)', () => {
    expect(
      deriveCoachPhase({
        createMode: 'manual',
        step: 2,
        totalSteps: 2,
        createdProjectId: 'p-1',
      }),
    ).toBe('success');
  });

  it('returns intro when no mode is chosen yet', () => {
    expect(
      deriveCoachPhase({
        createMode: null,
        step: 1,
        totalSteps: 3,
        createdProjectId: null,
      }),
    ).toBe('intro');
  });

  it('returns repoPicker for repo modes on step 1', () => {
    expect(
      deriveCoachPhase({
        createMode: 'github',
        step: 1,
        totalSteps: 3,
        createdProjectId: null,
      }),
    ).toBe('repoPicker');
    expect(
      deriveCoachPhase({
        createMode: 'gitlab',
        step: 1,
        totalSteps: 3,
        createdProjectId: null,
      }),
    ).toBe('repoPicker');
  });

  it('returns basics for manual step 1 and repo step 2', () => {
    expect(
      deriveCoachPhase({
        createMode: 'manual',
        step: 1,
        totalSteps: 2,
        createdProjectId: null,
      }),
    ).toBe('basics');
    expect(
      deriveCoachPhase({
        createMode: 'github',
        step: 2,
        totalSteps: 3,
        createdProjectId: null,
      }),
    ).toBe('basics');
  });

  it('returns securityContext on the final step (manual step 2 / repo step 3)', () => {
    expect(
      deriveCoachPhase({
        createMode: 'manual',
        step: 2,
        totalSteps: 2,
        createdProjectId: null,
      }),
    ).toBe('securityContext');
    expect(
      deriveCoachPhase({
        createMode: 'gitlab',
        step: 3,
        totalSteps: 3,
        createdProjectId: null,
      }),
    ).toBe('securityContext');
  });
});

describe('CreationCoach', () => {
  it('renders a testable root strip with the Cybe avatar', () => {
    renderCoach();
    expect(screen.getByTestId('creation-coach')).toBeInTheDocument();
    expect(screen.getByTestId('cybe-avatar')).toBeInTheDocument();
  });

  it('offers exactly one close control, named in the interface language', () => {
    renderCoach();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveAccessibleName('Dismiss');
  });

  it('shows the repo-picker message for a repo mode on step 1', () => {
    renderCoach({ createMode: 'github', step: 1, totalSteps: 3 });
    expect(screen.getByTestId('creation-coach')).toHaveAttribute(
      'data-phase',
      'repoPicker',
    );
    expect(screen.getByText(/choose the repository to link/i)).toBeInTheDocument();
  });

  it('shows the basics message on the basics step', () => {
    renderCoach({ createMode: 'manual', step: 1, totalSteps: 2 });
    expect(screen.getByTestId('creation-coach')).toHaveAttribute(
      'data-phase',
      'basics',
    );
    expect(screen.getByText(/name your project/i)).toBeInTheDocument();
  });

  it('shows the security-context message on the final step', () => {
    renderCoach({ createMode: 'manual', step: 2, totalSteps: 2 });
    expect(screen.getByTestId('creation-coach')).toHaveAttribute(
      'data-phase',
      'securityContext',
    );
    expect(screen.getByText(/add security context/i)).toBeInTheDocument();
  });

  it('shows the success message once a project has been created', () => {
    renderCoach({ createdProjectId: 'p-42' });
    expect(screen.getByTestId('creation-coach')).toHaveAttribute(
      'data-phase',
      'success',
    );
    expect(screen.getByText(/project created/i)).toBeInTheDocument();
  });

  it('shows the intro message when no mode has been chosen', () => {
    renderCoach({ createMode: null });
    expect(screen.getByTestId('creation-coach')).toHaveAttribute(
      'data-phase',
      'intro',
    );
    expect(screen.getByText(/pick how to add your project/i)).toBeInTheDocument();
  });

  it('calls onDismiss when its translated close button is clicked', () => {
    const onDismiss = vi.fn();
    renderCoach({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismiss hides the coach (controlled by the parent)', () => {
    function Harness() {
      const [dismissed, setDismissed] = useState(false);
      if (dismissed) return null;
      return (
        <CreationCoach
          createMode="github"
          step={1}
          totalSteps={3}
          createdProjectId={null}
          onDismiss={() => setDismissed(true)}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByTestId('creation-coach')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('creation-coach')).not.toBeInTheDocument();
  });
});
