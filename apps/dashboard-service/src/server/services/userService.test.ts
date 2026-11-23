import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — declared before importing the service so vi.mock hoisting picks them
// ─────────────────────────────────────────────────────────────────────────────

const gatewayGet = vi.fn();
const gatewayPatch = vi.fn();

vi.mock('@/server/api/gatewayAPI', () => ({
  default: {
    get: (...args: unknown[]) => gatewayGet(...args),
    patch: (...args: unknown[]) => gatewayPatch(...args),
  },
}));

// userService imports the Redux store for the optimistic onboarding-progress
// dispatch — stub it so this test stays a pure unit test.
vi.mock('../store', () => ({
  default: { dispatch: vi.fn() },
}));

import { fetchMyProfile, updateUserProfile } from './userService';

describe('userService — updateUserProfile', () => {
  beforeEach(() => {
    gatewayGet.mockReset();
    gatewayPatch.mockReset();
    gatewayPatch.mockResolvedValue({ data: { message: 'ok', userId: 'u-1' } });
  });

  it('keeps the legacy (notification) call shape intact', async () => {
    await updateUserProfile(true);
    expect(gatewayPatch).toHaveBeenCalledWith('/user/profile', {
      notification: true,
    });
  });

  it('keeps the legacy (null, isOnboardingCompleted) call shape intact', async () => {
    await updateUserProfile(null, true);
    expect(gatewayPatch).toHaveBeenCalledWith('/user/profile', {
      isOnboardingCompleted: true,
    });
  });

  it('sends onboardingPersona + onboardingUsage (array) when provided', async () => {
    await updateUserProfile(null, undefined, {
      onboardingPersona: 'tech_lead',
      onboardingUsage: ['compliance'],
    });
    expect(gatewayPatch).toHaveBeenCalledWith('/user/profile', {
      onboardingPersona: 'tech_lead',
      onboardingUsage: ['compliance'],
    });
  });

  it('combines persona fields with the existing flags without dropping either', async () => {
    await updateUserProfile(null, true, {
      onboardingPersona: 'solo_dev',
      onboardingUsage: ['vibecoding'],
    });
    expect(gatewayPatch).toHaveBeenCalledWith('/user/profile', {
      isOnboardingCompleted: true,
      onboardingPersona: 'solo_dev',
      onboardingUsage: ['vibecoding'],
    });
  });

  it('sends a multi-value onboardingUsage array as-is, not joined to a CSV string', async () => {
    await updateUserProfile(null, undefined, {
      onboardingPersona: 'security_pro',
      onboardingUsage: ['vibecoding', 'compliance'],
    });
    const [, body] = gatewayPatch.mock.calls[gatewayPatch.mock.calls.length - 1];
    expect(Array.isArray(body.onboardingUsage)).toBe(true);
    expect(body.onboardingUsage).toEqual(['vibecoding', 'compliance']);
  });
});

describe('userService — fetchMyProfile', () => {
  beforeEach(() => {
    gatewayGet.mockReset();
  });

  it('returns the profile payload including persona/usage fields', async () => {
    gatewayGet.mockResolvedValue({
      data: {
        id: 'u-1',
        onboardingPersona: 'security_pro',
        onboardingUsage: 'team_security',
      },
    });

    const profile = await fetchMyProfile();

    expect(gatewayGet).toHaveBeenCalledWith('/user/profile');
    expect(profile.onboardingPersona).toBe('security_pro');
    expect(profile.onboardingUsage).toBe('team_security');
  });
});
