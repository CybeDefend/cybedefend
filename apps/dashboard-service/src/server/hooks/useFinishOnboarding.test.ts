import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Finishing (or skipping) the phone tour must leave the account in exactly the
// state the desktop tour's Skip leaves it in: onboarding flagged complete on the
// profile, then the profile and the ReBAC entities reloaded — that reload is
// what makes the sidebar show what the user is entitled to.

const dispatch = vi.fn();
const setUser = vi.fn();

vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('react-rebac', () => ({ useRebac: () => ({ setUser }) }));
vi.mock('../services/userService', () => ({
  updateUserProfile: vi.fn(),
  fetchMyProfile: vi.fn(),
}));
vi.mock('../store/userSlice', () => ({
  setUserProfile: (profile: unknown) => ({ type: 'user/setUserProfile', payload: profile }),
}));

import { useFinishOnboarding } from './useFinishOnboarding';
import { fetchMyProfile, updateUserProfile } from '../services/userService';

const profile = {
  id: 'u1',
  isOnboardingCompleted: true,
  myOrganizations: [
    {
      id: 'org-1',
      myRole: 'creator',
      myTeams: [{ id: 'team-1', name: 'Core', description: 'core team', myRole: 'manager' }],
    },
  ],
};

describe('useFinishOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateUserProfile).mockResolvedValue({ message: 'ok', userId: 'u1' });
    vi.mocked(fetchMyProfile).mockResolvedValue(profile);
  });

  it('flags onboarding complete, then reloads the profile and the ReBAC entities', async () => {
    const { result } = renderHook(() => useFinishOnboarding());

    await act(() => result.current());

    expect(updateUserProfile).toHaveBeenCalledWith(null, true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'user/setUserProfile', payload: profile });
    expect(setUser).toHaveBeenCalledWith([
      { id: 'org-1', type: 'organization', relation: 'creator' },
      { id: 'team-1', name: 'Core', description: 'core team', type: 'team', relation: 'manager' },
    ]);
    // Order matters: reloading before the flag is saved would read the old flag.
    expect(vi.mocked(updateUserProfile).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetchMyProfile).mock.invocationCallOrder[0],
    );
  });

  it('saves once when tapped twice in a row', async () => {
    const { result } = renderHook(() => useFinishOnboarding());

    await act(async () => {
      await Promise.all([result.current(), result.current()]);
    });

    expect(updateUserProfile).toHaveBeenCalledTimes(1);
  });

  it('reports a failed save to the caller and can be retried', async () => {
    vi.mocked(updateUserProfile).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useFinishOnboarding());

    await expect(act(() => result.current())).rejects.toThrow('network');
    expect(fetchMyProfile).not.toHaveBeenCalled();

    await act(() => result.current());
    expect(updateUserProfile).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledTimes(1);
  });
});
