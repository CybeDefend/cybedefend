import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

/**
 * The shell mounts the onboarding checklist several times (header, sidebar,
 * the page itself). Each instance completed a step from the progress of ITS
 * render, so all of them sent the same PATCH /user/profile: 41 redundant
 * PATCH out of 150 in 7 days. A step is completed once,
 * whatever the number of instances.
 */

const { completeOnboardingStep } = vi.hoisted(() => ({
  completeOnboardingStep: vi.fn(),
}));
vi.mock('../services/userService', () => ({ completeOnboardingStep }));

import userReducer, { setUserProfile } from '../store/userSlice';
import { useOnboardingProgress, OnboardingStepId } from './useOnboardingProgress';

type Complete = (step: OnboardingStepId) => Promise<void>;
const completes: Complete[] = [];

const Instance: React.FC = () => {
  const { complete } = useOnboardingProgress();
  completes.push(complete);
  return null;
};

const renderInstances = (count: number, onboardingProgress: string[]) => {
  const store = configureStore({ reducer: { user: userReducer } });
  store.dispatch(
    setUserProfile({
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.invalid',
      onboardingProgress,
      myOrganizations: [{ id: 'org-1' }],
    } as never),
  );
  render(
    <Provider store={store}>
      {Array.from({ length: count }, (_, i) => (
        <Instance key={i} />
      ))}
    </Provider>,
  );
  return store;
};

const patchedSteps = () => completeOnboardingStep.mock.calls.map(([step]) => step);

describe('useOnboardingProgress — one PATCH per step', () => {
  beforeEach(() => {
    completes.length = 0;
    completeOnboardingStep.mockReset();
    completeOnboardingStep.mockResolvedValue(undefined);
  });

  it('three instances auto-complete org_created once', async () => {
    const store = renderInstances(3, []);
    await act(async () => undefined);

    expect(patchedSteps()).toEqual(['org_created']);
    expect(store.getState().user.onboardingProgress).toEqual(['org_created']);
  });

  it('two instances completing the same step in one tick send one PATCH', async () => {
    renderInstances(2, ['org_created']);
    await act(async () => undefined);
    const [first, second] = completes;

    await act(async () => {
      await Promise.all([first('team_created'), second('team_created')]);
    });

    expect(patchedSteps()).toEqual(['team_created']);
  });
});
