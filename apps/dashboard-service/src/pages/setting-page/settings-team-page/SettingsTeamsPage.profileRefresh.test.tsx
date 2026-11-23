import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The Teams settings page must not reload when the trial safety-net poll
 * refetches an unchanged profile.
 *
 * Layout dispatches `fetchProfileAsync()` every 15 s while the organization is
 * on a trial. Keyed on the organization object, every `GET /user/profile`
 * would be followed by `GET /organization/:id/teams`, `GET /team/:teamId/members`
 * and a new teams SSE stream, and aborted streams can stay open at the origin
 * for minutes, although nothing on the page changed: the profile is identical.
 *
 * The test drives the real thunk, the real slices, the real page and template,
 * and counts the requests at the gateway client and the streams opened — the
 * same things the ingress access log showed.
 */

const { api, openStream, streamClose } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  openStream: vi.fn(),
  streamClose: vi.fn(),
}));

vi.mock('@/server/api/gatewayAPI', () => ({
  default: api,
  isTrialExhaustedError: () => false,
}));

vi.mock('@/server/services/realtimeStream', () => ({ openStream }));
vi.mock('@/server/api/tokenManager', () => ({
  getAccessTokenForFetch: vi.fn().mockResolvedValue('token'),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('react-rebac', () => ({
  useAuthorization: () => true,
  useRebac: () => ({ userEntities: [{ id: 'org-1' }] }),
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-toastify', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/server/hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ complete: vi.fn(), isCompleted: () => true }),
}));

import authReducer, { setAccessToken } from '@/server/store/authSlice';
import userReducer, { setUserProfile } from '@/server/store/userSlice';
import organizationReducer, { setSelectedOrganization } from '@/server/store/organizationSlice';
import { fetchProfileAsync } from '@/server/store/userThunks';
import SettingsTeamsPage from './SettingsTeamsPage';

const TEAM_A = { id: 'team-a', name: 'Alpha', description: '', myRole: 'team_manager' };

const organization = (myTeams: unknown[], trialCybeUsed = 3) => ({
  id: 'org-1',
  name: 'Acme',
  description: '',
  myRole: 'creator',
  myTeams,
  country: 'FR',
  industry: 'software',
  isActive: true,
  subscription: {
    plan: 'team',
    status: 'trialing',
    isTrial: true,
    trialScansUsed: 1,
    trialScansLimit: 10,
    trialCybeUsed,
    trialCybeLimit: 50,
    writesBlocked: false,
    featuresDisabled: '',
  },
});

// A fresh object on every call, as a real HTTP response would be.
const profile = (myTeams: unknown[], trialCybeUsed = 3) => ({
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.invalid',
  picture: '',
  notification: false,
  isOnboardingCompleted: true,
  onboardingProgress: ['org_created'],
  onboardingPersona: 'developer',
  onboardingUsage: '',
  createdAt: '',
  updatedAt: '',
  myOrganizations: [organization(myTeams, trialCybeUsed)],
  myAccessibleProjects: [],
});

// What the gateway currently reports for the trial's Cybe consumption.
let serverTrialCybeUsed = 3;

const getCalls = (path: string) =>
  api.get.mock.calls.filter(([url]) => url === path).length;

const setup = async (myTeams: unknown[]) => {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/user/profile') return { data: profile(myTeams, serverTrialCybeUsed) };
    if (url === '/organization/org-1/teams') return { data: { teams: [TEAM_A] } };
    if (url === '/team/team-a/members') {
      return { data: { users: [], totalUsers: 0, totalPages: 0 } };
    }
    if (url.startsWith('/organization/org-1/billing/features/')) {
      return { data: { allowed: true, reason: '', requiredPlan: '' } };
    }
    throw new Error(`unexpected GET ${url}`);
  });

  const store = configureStore({
    reducer: {
      auth: authReducer,
      user: userReducer,
      organization: organizationReducer,
    },
  });
  store.dispatch(setAccessToken('token'));
  store.dispatch(setUserProfile(profile(myTeams) as never));
  store.dispatch(setSelectedOrganization(organization(myTeams) as never));

  render(
    <Provider store={store}>
      <MemoryRouter>
        <SettingsTeamsPage />
      </MemoryRouter>
    </Provider>,
  );

  // The page has settled: team A is selected, its members were fetched and its
  // stream is open.
  await waitFor(() => expect(getCalls('/team/team-a/members')).toBe(1));
  await waitFor(() => expect(openStream).toHaveBeenCalledTimes(1));
  expect(openStream.mock.calls[0][0]).toMatch(/\/v1\/realtime\/teams\/team-a\/stream$/);

  return store;
};

const refreshProfile = async (store: Awaited<ReturnType<typeof setup>>) => {
  await act(async () => {
    await store.dispatch(fetchProfileAsync() as never);
    // Let any effect the refresh schedules run its requests.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

describe('SettingsTeamsPage — the trial profile poll does not reload the page', () => {
  beforeEach(() => {
    localStorage.clear();
    serverTrialCybeUsed = 3;
    api.get.mockReset();
    openStream.mockReset();
    streamClose.mockReset();
    openStream.mockImplementation(() => ({ close: streamClose }));
  });

  afterEach(() => cleanup());

  it.each([
    ['a member of the team', [TEAM_A]],
    // An org creator/administrator sees every team of the organization but is
    // not necessarily a member of any: their profile carries no `myTeams`.
    ['not a member of any team', []],
  ])('when the user is %s', async (_label, myTeams) => {
    const store = await setup(myTeams);
    const teamsBefore = getCalls('/organization/org-1/teams');

    await refreshProfile(store);
    await refreshProfile(store);

    expect({
      profileFetches: getCalls('/user/profile'),
      teamsFetches: getCalls('/organization/org-1/teams'),
      membersFetches: getCalls('/team/team-a/members'),
      streamsOpened: openStream.mock.calls.length,
      streamsClosed: streamClose.mock.calls.length,
    }).toEqual({
      profileFetches: 2,
      teamsFetches: teamsBefore,
      membersFetches: 1,
      streamsOpened: 1,
      streamsClosed: 0,
    });
  });

  // The poll exists to move the trial counters. When they really move (a scan
  // or a Cybe unit consumed while the user is on the page), the counters must
  // follow and the team list must still not reload: it does not depend on them.
  it('when the trial counters really changed', async () => {
    const store = await setup([]);
    const teamsBefore = getCalls('/organization/org-1/teams');

    serverTrialCybeUsed = 4;
    await refreshProfile(store);

    expect(
      store.getState().organization.selectedOrganization?.subscription?.trialCybeUsed,
    ).toBe(4);
    expect({
      teamsFetches: getCalls('/organization/org-1/teams'),
      membersFetches: getCalls('/team/team-a/members'),
      streamsOpened: openStream.mock.calls.length,
      streamsClosed: streamClose.mock.calls.length,
    }).toEqual({
      teamsFetches: teamsBefore,
      membersFetches: 1,
      streamsOpened: 1,
      streamsClosed: 0,
    });
  });
});
