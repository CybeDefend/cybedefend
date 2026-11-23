import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

/**
 * The Teams settings page selects the first team of the profile, then loads
 * the organization's teams. That list must not change the selection: its
 * callback read the selection of the first render (always "") and took its
 * own first team, whose order the SQL does not fix. The members were then
 * loaded twice and the teams stream reopened.
 *
 * The real page, slices and template; the gateway client and the stream are
 * counted, as the ingress access log would.
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
import userReducer from '@/server/store/userSlice';
import organizationReducer, { setSelectedOrganization } from '@/server/store/organizationSlice';
import SettingsTeamsPage from './SettingsTeamsPage';

const TEAM_A = { id: 'team-a', name: 'Alpha', description: '' };
const TEAM_B = { id: 'team-b', name: 'Bravo', description: '' };

const getCalls = (path: string) =>
  api.get.mock.calls.filter(([url]) => url === path).length;

const renderPage = (myTeams: unknown[], orgTeams: unknown[]) => {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/organization/org-1/teams') return { data: { teams: orgTeams } };
    if (url.startsWith('/team/') && url.endsWith('/members')) {
      return { data: { users: [], totalUsers: 0, totalPages: 0 } };
    }
    if (url.startsWith('/organization/org-1/billing/features/')) {
      return { data: { allowed: true, reason: '', requiredPlan: '' } };
    }
    throw new Error(`unexpected GET ${url}`);
  });

  const store = configureStore({
    reducer: { auth: authReducer, user: userReducer, organization: organizationReducer },
  });
  store.dispatch(setAccessToken('token'));
  store.dispatch(
    setSelectedOrganization({
      id: 'org-1',
      name: 'Acme',
      description: '',
      myRole: 'administrator',
      myTeams,
      isActive: true,
      subscription: { plan: 'team', isTrial: false, writesBlocked: false, featuresDisabled: '' },
    } as never),
  );

  render(
    <Provider store={store}>
      <MemoryRouter>
        <SettingsTeamsPage />
      </MemoryRouter>
    </Provider>,
  );
};

/** Let every request and stream the page schedules go out. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

describe('SettingsTeamsPage — the team selected on arrival', () => {
  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset();
    openStream.mockReset();
    streamClose.mockReset();
    openStream.mockImplementation(() => ({ close: streamClose }));
  });

  afterEach(() => cleanup());

  it("keeps the profile's first team when the organization lists another one first", async () => {
    // An administrator sees every team of the organization, and is a member of Bravo only.
    renderPage([TEAM_B], [TEAM_A, TEAM_B]);

    await waitFor(() => expect(getCalls('/organization/org-1/teams')).toBe(1));
    await settle();

    expect({
      bravoMembers: getCalls('/team/team-b/members'),
      alphaMembers: getCalls('/team/team-a/members'),
      streams: openStream.mock.calls.map(([url]) => url.replace(/^.*\/realtime\//, '')),
      streamsClosed: streamClose.mock.calls.length,
    }).toEqual({
      bravoMembers: 1,
      alphaMembers: 0,
      streams: ['teams/team-b/stream'],
      streamsClosed: 0,
    });
  });

  it('selects the first team of the organization when the profile has none', async () => {
    renderPage([], [TEAM_A, TEAM_B]);

    await waitFor(() => expect(getCalls('/team/team-a/members')).toBe(1));
    await settle();

    expect(getCalls('/team/team-b/members')).toBe(0);
    expect(openStream.mock.calls.map(([url]) => url.replace(/^.*\/realtime\//, ''))).toEqual([
      'teams/team-a/stream',
    ]);
  });
});
