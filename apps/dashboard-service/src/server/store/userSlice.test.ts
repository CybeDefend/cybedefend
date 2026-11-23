import { describe, it, expect } from 'vitest';
import reducer, {
  setUserProfile,
  setOnboardingPersona,
  setOnboardingUsage,
  clearUserProfile,
} from './userSlice';
import type { UserProfile } from '../interfaces/User';

const baseProfile = {
  id: 'u-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  picture: '',
  notification: true,
  isOnboardingCompleted: false,
  onboardingProgress: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  myOrganizations: [],
} as unknown as UserProfile;

describe('userSlice — onboarding persona fields', () => {
  it('initial state has onboardingPersona and onboardingUsage as null', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.onboardingPersona).toBeNull();
    expect(state.onboardingUsage).toBeNull();
  });

  it('setUserProfile maps empty-string persona/usage (API "unset") to null', () => {
    const state = reducer(
      undefined,
      setUserProfile({
        ...baseProfile,
        onboardingPersona: '',
        onboardingUsage: '',
      } as UserProfile),
    );
    expect(state.onboardingPersona).toBeNull();
    expect(state.onboardingUsage).toBeNull();
  });

  it('setUserProfile maps missing persona/usage to null', () => {
    const state = reducer(undefined, setUserProfile(baseProfile));
    expect(state.onboardingPersona).toBeNull();
    expect(state.onboardingUsage).toBeNull();
  });

  it('setUserProfile keeps real persona/usage values (single value CSV -> single-item array)', () => {
    const state = reducer(
      undefined,
      setUserProfile({
        ...baseProfile,
        onboardingPersona: 'tech_lead',
        onboardingUsage: 'compliance',
      } as UserProfile),
    );
    expect(state.onboardingPersona).toBe('tech_lead');
    expect(state.onboardingUsage).toEqual(['compliance']);
  });

  it('setUserProfile parses a multi-value CSV string into an array', () => {
    const state = reducer(
      undefined,
      setUserProfile({
        ...baseProfile,
        onboardingUsage: 'vibecoding,compliance',
      } as UserProfile),
    );
    expect(state.onboardingUsage).toEqual(['vibecoding', 'compliance']);
  });

  it('setUserProfile passes an already-parsed array through (filtered copy)', () => {
    const state = reducer(
      undefined,
      setUserProfile({
        ...baseProfile,
        onboardingUsage: ['vibecoding', 'compliance'] as unknown as string,
      } as UserProfile),
    );
    expect(state.onboardingUsage).toEqual(['vibecoding', 'compliance']);
  });

  it('setUserProfile filters whitespace/empty entries out of the CSV string', () => {
    const state = reducer(
      undefined,
      setUserProfile({
        ...baseProfile,
        onboardingUsage: ' vibecoding , , compliance ,',
      } as UserProfile),
    );
    expect(state.onboardingUsage).toEqual(['vibecoding', 'compliance']);
  });

  it('setUserProfile maps an array that filters down to empty to null', () => {
    const state = reducer(
      undefined,
      setUserProfile({
        ...baseProfile,
        onboardingUsage: ['', '  '] as unknown as string,
      } as UserProfile),
    );
    expect(state.onboardingUsage).toBeNull();
  });

  it('setOnboardingPersona updates both fields (usage normalized to array)', () => {
    const state = reducer(
      reducer(undefined, { type: '@@INIT' }),
      setOnboardingPersona({
        onboardingPersona: 'solo_dev',
        onboardingUsage: 'vibecoding',
      }),
    );
    expect(state.onboardingPersona).toBe('solo_dev');
    expect(state.onboardingUsage).toEqual(['vibecoding']);
  });

  // The product question of an existing account changes the usages alone: the
  // persona it answered at sign-up stays what it was.
  it('setOnboardingUsage replaces the usages and leaves the persona alone', () => {
    const answered = reducer(
      undefined,
      setOnboardingPersona({
        onboardingPersona: 'tech_lead',
        onboardingUsage: ['team_security'],
      }),
    );
    const state = reducer(answered, setOnboardingUsage(['team_security', 'vibecoding']));
    expect(state.onboardingUsage).toEqual(['team_security', 'vibecoding']);
    expect(state.onboardingPersona).toBe('tech_lead');
  });

  it('setOnboardingUsage normalizes like the profile does: no usage is null, not an empty array', () => {
    const state = reducer(undefined, setOnboardingUsage([]));
    expect(state.onboardingUsage).toBeNull();
  });

  it('clearUserProfile resets persona/usage back to null', () => {
    const withPersona = reducer(
      undefined,
      setOnboardingPersona({
        onboardingPersona: 'security_pro',
        onboardingUsage: 'team_security',
      }),
    );
    const state = reducer(withPersona, clearUserProfile());
    expect(state.onboardingPersona).toBeNull();
    expect(state.onboardingUsage).toBeNull();
  });
});
