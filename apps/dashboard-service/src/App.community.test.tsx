import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RebacProvider } from 'react-rebac';
import { describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

import App from './App';
import { fetchMyProfile } from './server/services/userService';
import store from './server/store';
import { setAccessToken } from './server/store/authSlice';
import { appsecProjectListPath } from './utils/appsecProjectList';

/**
 * The Community Edition has no billing: no subscription to suspend, no trial,
 * no plan to upgrade. The whole App is rendered with the active edition
 * forced to community (`ACTIVE_*` empty, the community slots only), and with
 * a profile whose organisation still carries a cloud subscription that would
 * suspend it and a trial that would show its banner: neither may reach the
 * page. Only what reaches outside the browser is stubbed, as in
 * `App.profileFailure.test.tsx`.
 */
vi.mock('react-rebac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-rebac')>()),
  useRebac: () => ({ setUser: vi.fn() }),
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/edition/auth/useAuth', () => ({
  useAuth: () => ({ loading: false, authError: null, retryAuth: vi.fn() }),
}));
vi.mock('@/server/hooks/useLogout', () => ({ default: () => vi.fn() }));
vi.mock('@/server/hooks/useAppVersion', () => ({ useAppVersion: () => null }));
vi.mock('@/server/hooks/useBackgroundTasks', () => ({ useBackgroundTasks: () => undefined, default: () => undefined }));
vi.mock('@/server/hooks/useActiveScanTasksTracker', () => ({
  useActiveScanTasksTracker: () => undefined,
  default: () => undefined,
}));
vi.mock('@/server/services/userService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/userService')>()),
  fetchMyProfile: vi.fn(),
}));
vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  const { COMMUNITY_SLOTS } = await import('@/edition/community-slots');
  return {
    ...actual,
    activeSlots: () => COMMUNITY_SLOTS,
    activeEeRoutes: () => [],
    activeEeAuthClient: () => null,
    activeExtensions: () => EMPTY_EXTENSIONS,
    ACTIVE_EE_ROUTES: [],
    ACTIVE_EE_SLOTS: [],
    ACTIVE_EE_AUTH_CLIENT: null,
    ACTIVE_SLOTS: COMMUNITY_SLOTS,
    ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS,
  };
});
// The page itself is not under test: the AppSec home is a stub, so only App's
// own decisions (which page, which address) and the shell around it run.
vi.mock('@/pages/home-page/HomePage', () => ({ default: () => <p data-testid="home-page">home</p> }));

const Address = () => <output data-testid="address">{useLocation().pathname}</output>;

/** An organisation whose cloud subscription is cancelled, on an exhausted trial. */
function profileWithSuspendedTrial() {
  return {
    id: 'user-1',
    email: 'ada@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    isOnboardingCompleted: true,
    onboardingPersona: 'unspecified',
    myOrganizations: [
      {
        id: 'org-1',
        name: 'Acme',
        myRole: 'creator',
        myTeams: [],
        products: [{ product: 'appsec', status: 'active' }],
        subscription: {
          status: 'canceled',
          plan: 'pro_v3',
          isTrial: true,
          writesBlocked: true,
          trialScansUsed: 10,
          trialScansLimit: 10,
          trialCybeUsed: 100,
          trialCybeLimit: 100,
        },
      },
    ],
  } as unknown as Awaited<ReturnType<typeof fetchMyProfile>>;
}

async function renderApp(path: string) {
  vi.mocked(fetchMyProfile).mockResolvedValue(profileWithSuspendedTrial());
  localStorage.removeItem('selectedOrganization');
  store.dispatch(setAccessToken('signed-in'));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <RebacProvider>
          <App />
        </RebacProvider>
        <Address />
      </MemoryRouter>
    </Provider>,
  );
  expect(await screen.findByTestId('home-page', {}, { timeout: 10_000 })).toBeInTheDocument();
  // Let every effect of the started app run (the suspension redirect ran in one).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const location = () => ({ pathname: screen.getByTestId('address').textContent });

// The AppSec project list, where the stubbed HomePage renders: the AppSec home
// in the cloud, /appsec/projects in a Community build (its home is « Get started »).
const PROJECTS = appsecProjectListPath();

describe('App in the Community Edition', () => {
  it('a suspended subscription never redirects in community', async () => {
    await renderApp(PROJECTS);
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(location().pathname).toBe(PROJECTS);
  }, 30_000);

  it('no trial banner and no billing link in community', async () => {
    await renderApp(PROJECTS);
    expect(screen.queryByText(i18n.t('billing.upgrade_to_pro'))).toBeNull();
    expect(screen.queryByTestId('trial-quota-banner')).toBeNull();
    expect(screen.queryByTestId('trial-status-widget')).toBeNull();
    expect(document.querySelector('a[href="/appsec/billing"]')).toBeNull();
    expect(document.querySelector('a[href="/organization/settings/billing"]')).toBeNull();
  }, 30_000);
});
