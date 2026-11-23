import { useCallback, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useRebac } from 'react-rebac';
import { Team } from '../interfaces/Team';
import { fetchMyProfile, updateUserProfile } from '../services/userService';
import { setUserProfile } from '../store/userSlice';

/**
 * Ends the onboarding for good: flags it complete on the profile, then reloads
 * the profile and the ReBAC entities (that reload is what lets the sidebar show
 * what the user is entitled to).
 *
 * Same effects, in the same order, as OnboardingStep's Skip — kept separate so
 * the desktop tour's code path is not touched by the phone tour. One save at a
 * time; a failure is thrown to the caller and leaves the hook retryable.
 */
export const useFinishOnboarding = (): (() => Promise<void>) => {
  const dispatch = useDispatch();
  const { setUser } = useRebac();
  const inFlight = useRef<Promise<void> | null>(null);

  return useCallback(() => {
    if (inFlight.current) return inFlight.current;

    const run = (async () => {
      await updateUserProfile(null, true);

      const profile = await fetchMyProfile();
      dispatch(setUserProfile(profile));
      setUser([
        ...profile.myOrganizations.map((org: { id: string; myRole: string }) => ({
          id: org.id,
          type: 'organization',
          relation: org.myRole,
        })),
        ...profile.myOrganizations.flatMap((org: { myTeams: Team[] }) =>
          org.myTeams.map((team: Team) => ({
            id: team.id,
            name: team.name,
            description: team.description,
            type: 'team',
            relation: team.myRole,
          })),
        ),
      ]);
    })();

    inFlight.current = run.finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [dispatch, setUser]);
};
