import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PRODUCTS } from '@/utils/product';

/** A product space the edition registers besides the Platform: none in the Community Edition. */
const CLOSED_SPACE = PRODUCTS.find((product) => product !== 'appsec');
import { configureStore } from '@reduxjs/toolkit';
import organizationReducer, {
  setSelectedOrganization,
} from './organizationSlice';
import userReducer from './userSlice';
import type { ProfileOrganization } from '../interfaces/Organization';

vi.mock('../services/userService', () => ({
  fetchMyProfile: vi.fn(),
}));

import { fetchMyProfile } from '../services/userService';
import { fetchProfileAsync } from './userThunks';

const mockedFetchMyProfile = fetchMyProfile as ReturnType<typeof vi.fn>;

const baseOrg: ProfileOrganization = {
  id: 'org-1',
  name: 'Org',
  description: '',
  myTeams: [],
  myRole: 'admin',
  country: 'FR',
  industry: 'software',
  isActive: true,
  subscription: {
    plan: 'developer',
    seats: 1,
    resetAt: '2026-06-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    trialEndsAt: '2026-06-01',
    currentPeriodEnd: '2026-06-01',
    status: 'active',
    isTrial: true,
    trialCybeLimit: 50,
    trialCybeUsed: 0,
    trialScansLimit: 10,
    trialScansUsed: 0,
    writesBlocked: false,
  },
};

function makeStore(org: ProfileOrganization | null = null) {
  const store = configureStore({
    reducer: {
      organization: organizationReducer,
      user: userReducer,
    },
  });
  if (org) store.dispatch(setSelectedOrganization(org));
  return store;
}

describe('fetchProfileAsync', () => {
  beforeEach(() => {
    mockedFetchMyProfile.mockReset();
  });

  it('updates the user slice with the fetched profile', async () => {
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.com',
      myOrganizations: [baseOrg],
    });
    const store = makeStore(baseOrg);

    await store.dispatch(fetchProfileAsync() as any);

    expect(store.getState().user.id).toBe('u-1');
    expect(store.getState().user.isProfileLoaded).toBe(true);
  });

  it('also patches selectedOrganization.subscription with values from the fetched profile', async () => {
    // Without this, SSE-driven USAGE_UPDATED events would only refresh the
    // user slice — TrialStatusWidget/TrialQuotaBanner read from
    // state.organization.selectedOrganization.subscription and would stay stale.
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.com',
      myOrganizations: [
        {
          ...baseOrg,
          subscription: {
            ...baseOrg.subscription,
            trialCybeUsed: 17,
            trialScansUsed: 4,
            writesBlocked: false,
          },
        },
      ],
    });
    const store = makeStore(baseOrg);

    await store.dispatch(fetchProfileAsync() as any);

    const sub = store.getState().organization.selectedOrganization?.subscription;
    expect(sub?.trialCybeUsed).toBe(17);
    expect(sub?.trialScansUsed).toBe(4);
    expect(sub?.writesBlocked).toBe(false);
  });

  it('marks writesBlocked=true when the profile reports the org is exhausted', async () => {
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      myOrganizations: [
        {
          ...baseOrg,
          subscription: {
            ...baseOrg.subscription,
            trialCybeUsed: 50,
            trialScansUsed: 10,
            writesBlocked: true,
          },
        },
      ],
    });
    const store = makeStore(baseOrg);

    await store.dispatch(fetchProfileAsync() as any);

    expect(
      store.getState().organization.selectedOrganization?.subscription?.writesBlocked,
    ).toBe(true);
  });

  it.runIf(CLOSED_SPACE)('brings the fresh products and a new AppSec subscription into the selected organisation', async () => {
    const products = [
      { product: 'appsec' as const, status: 'active' as const, trialUsed: true },
      { product: CLOSED_SPACE!, status: 'inactive' as const, trialUsed: false },
    ];
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      myOrganizations: [{ ...baseOrg, products }],
    });
    const store = makeStore({ ...baseOrg, subscription: null, products: [] });

    await store.dispatch(fetchProfileAsync() as any);

    const org = store.getState().organization.selectedOrganization;
    expect(org?.products).toEqual(products);
    expect(org?.subscription?.isTrial).toBe(true);
  });

  it('a trial that became a paid plan reaches selectedOrganization.subscription', async () => {
    // A profile read before the subscription changed must not leave the
    // selected organisation on its old subscription: later reads patch the
    // whole subscription, isTrial, the plan and the add-ons included.
    const paid = {
      ...baseOrg.subscription!,
      plan: 'team_v3' as const,
      status: 'active' as const,
      isTrial: false,
      billingCycle: 'month' as const,
      addonExtraCybeQuantity: 2,
      extraSeatsQuantity: 2,
      seatAllowance: 7,
    };
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      myOrganizations: [{ ...baseOrg, subscription: paid }],
    });
    const store = makeStore(baseOrg);

    await store.dispatch(fetchProfileAsync() as any);

    expect(store.getState().organization.selectedOrganization?.subscription).toEqual(paid);
  });

  it('keeps the same selectedOrganization object when the profile carries the same subscription', async () => {
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      myOrganizations: [{ ...baseOrg, subscription: { ...baseOrg.subscription! } }],
    });
    const store = makeStore(baseOrg);
    const before = store.getState().organization.selectedOrganization;

    await store.dispatch(fetchProfileAsync() as any);

    expect(store.getState().organization.selectedOrganization).toBe(before);
  });

  it('does not patch subscription when no organization is selected', async () => {
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      myOrganizations: [baseOrg],
    });
    const store = makeStore(null);

    await store.dispatch(fetchProfileAsync() as any);

    expect(store.getState().organization.selectedOrganization).toBeNull();
  });

  it('does not patch when the selected org is missing from the profile response', async () => {
    mockedFetchMyProfile.mockResolvedValue({
      id: 'u-1',
      myOrganizations: [],
    });
    const store = makeStore(baseOrg);
    const before = store.getState().organization.selectedOrganization?.subscription;

    await store.dispatch(fetchProfileAsync() as any);

    // Untouched — patchSubscription was never dispatched.
    expect(store.getState().organization.selectedOrganization?.subscription).toEqual(before);
  });
});
