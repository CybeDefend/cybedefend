import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  updateUserProfile: vi.fn(),
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock('@/server/services/userService', () => ({ updateUserProfile: h.updateUserProfile }));
vi.mock('react-redux', () => ({
  useDispatch: () => h.dispatch,
  useSelector: (select: (state: unknown) => unknown) => select(h.state),
}));
vi.mock('@/server/store/selectors', () => ({ selectIsProductChoicePending: () => false }));

import UnaskedPersonaRecorder, { resetUnaskedPersonaForTests, UNASKED_PERSONA } from './UnaskedPersonaRecorder';

const user = (over: Record<string, unknown> = {}) => ({
  isProfileLoaded: true,
  isOnboardingCompleted: false,
  onboardingPersona: null,
  onboardingUsage: [],
  myOrganizations: [{ id: 'org-1' }],
  ...over,
});
const at = (over: Record<string, unknown> = {}) => {
  h.state = { user: user(over), organization: { selectedOrganization: { id: 'org-1' } } };
};

/**
 * The AppSec tour waits for a non-null profile. With no product question to
 * ask (the Community Edition), the shell records the unasked profile on its
 * own, once per page load, so the tour opens.
 */
describe('UnaskedPersonaRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUnaskedPersonaForTests();
    h.updateUserProfile.mockResolvedValue({});
  });

  it('records the unasked profile once, and opens the tour gate', async () => {
    at();
    const { rerender } = render(<UnaskedPersonaRecorder />);
    rerender(<UnaskedPersonaRecorder />);
    await waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(1));
    expect(h.updateUserProfile).toHaveBeenCalledTimes(1);
    expect(h.updateUserProfile).toHaveBeenCalledWith(null, undefined, { onboardingPersona: UNASKED_PERSONA });
    expect(UNASKED_PERSONA).toBe('unspecified');
  });

  it('records nothing before the profile is loaded, nor for an answered profile', () => {
    at({ isProfileLoaded: false });
    render(<UnaskedPersonaRecorder />);
    at({ onboardingPersona: 'solo_dev' });
    render(<UnaskedPersonaRecorder />);
    expect(h.updateUserProfile).not.toHaveBeenCalled();
  });

  it('opens nothing when the save fails, and does not retry in this page load', async () => {
    at();
    h.updateUserProfile.mockRejectedValue(new Error('500'));
    render(<UnaskedPersonaRecorder />);
    await waitFor(() => expect(h.updateUserProfile).toHaveBeenCalledTimes(1));
    render(<UnaskedPersonaRecorder />);
    expect(h.updateUserProfile).toHaveBeenCalledTimes(1);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
