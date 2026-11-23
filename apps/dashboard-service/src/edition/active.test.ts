import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import type { AuthClient } from './auth/authClient';
import { EMPTY_EXTENSIONS } from './extensions';
import type { SlotContext, SlotRegistration } from './slots';

const { eeReg, ceReg, fakeClient, eeRoute } = vi.hoisted(() => {
  const eeReg: SlotRegistration = {
    slot: 'upsell',
    id: 'ee-slot',
    order: 1,
    render: (_ctx: SlotContext) => null,
  };
  const ceReg: SlotRegistration = {
    slot: 'upsell',
    id: 'community-slot',
    order: 1,
    render: (_ctx: SlotContext) => null,
  };
  const fakeClient: AuthClient = {
    useAuthState: () => ({ isAuthenticated: true, loading: false, error: null, retry: () => {} }),
    getAccessToken: () => Promise.resolve(null),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  };
  const eeRoute: RouteObject = { path: '/ee-only' };
  return { eeReg, ceReg, fakeClient, eeRoute };
});

vi.mock('@/edition/ee-entry', () => ({
  eeRoutes: [eeRoute],
  eeSlots: [eeReg],
  eeAuthClient: fakeClient,
  eeExtensions: EMPTY_EXTENSIONS,
}));

vi.mock('@/edition/community-slots', () => ({ COMMUNITY_SLOTS: [ceReg] }));

import { activeEeAuthClient, activeEeRoutes, activeSlots } from './active';

describe('the active* functions', () => {
  it('a private build run as community uses no ee route, slot or auth client', () => {
    expect(activeEeRoutes('community')).toEqual([]);
    expect(activeSlots('community')).toEqual([ceReg]);
    expect(activeEeAuthClient('community')).toBeNull();
  });

  it('cloud uses the ee route, slots and auth client and no community slot', () => {
    expect(activeEeRoutes('cloud')).toEqual([{ path: '/ee-only' }]);
    expect(activeSlots('cloud')).toEqual([eeReg]);
    expect(activeEeAuthClient('cloud')).toBe(fakeClient);
  });

  it('enterprise behaves like cloud', () => {
    expect(activeEeRoutes('enterprise')).toEqual([{ path: '/ee-only' }]);
    expect(activeSlots('enterprise')).toEqual([eeReg]);
    expect(activeEeAuthClient('enterprise')).toBe(fakeClient);
  });

  it('the constants follow EDITION', async () => {
    vi.resetModules();
    vi.doMock('@/edition/edition', () => ({ EDITION: 'community', EDITIONS: ['community', 'cloud', 'enterprise'] }));
    let mod = await import('./active');
    expect(mod.ACTIVE_EE_ROUTES).toEqual([]);
    expect(mod.ACTIVE_EE_SLOTS).toEqual([]);
    expect(mod.ACTIVE_EE_AUTH_CLIENT).toBeNull();

    vi.resetModules();
    vi.doMock('@/edition/edition', () => ({ EDITION: 'cloud', EDITIONS: ['community', 'cloud', 'enterprise'] }));
    mod = await import('./active');
    expect(mod.ACTIVE_EE_ROUTES).toEqual([{ path: '/ee-only' }]);
    expect(mod.ACTIVE_EE_SLOTS).toEqual([eeReg]);
    expect(mod.ACTIVE_EE_AUTH_CLIENT).toBe(fakeClient);

    vi.doUnmock('@/edition/edition');
  });
});

describe('active edition constants', () => {
  const ceReg: SlotRegistration = { slot: 'upsell', id: 'ce', order: 1, render: () => null };

  beforeEach(() => {
    vi.resetModules();
  });

  it('exposes the ee routes, slots and extensions in the cloud', async () => {
    vi.doMock('@/edition/edition', async (orig) => ({ ...(await orig()), EDITION: 'cloud' }));
    vi.doMock('@/edition/community-slots', () => ({ COMMUNITY_SLOTS: [ceReg] }));
    vi.doMock('@/edition/ee-entry', () => ({
      eeRoutes: [{ path: '/x' }],
      eeSlots: [{ slot: 'upsell', id: 'a', order: 1, render: () => null }],
      eeAuthClient: { name: 'ee' },
      eeExtensions: { ...EMPTY_EXTENSIONS, boot: [vi.fn()] },
    }));
    const m = await import('./active');
    expect(m.ACTIVE_EE_ROUTES).toHaveLength(1);
    expect(m.ACTIVE_SLOTS.map((s) => s.id)).toEqual(['a']);
    expect(m.ACTIVE_EE_AUTH_CLIENT).not.toBeNull();
    expect(m.ACTIVE_EXTENSIONS.boot).toHaveLength(1);
  });

  it('exposes nothing from ee in community mode, even when ee code is present', async () => {
    vi.doMock('@/edition/edition', async (orig) => ({ ...(await orig()), EDITION: 'community' }));
    vi.doMock('@/edition/community-slots', () => ({ COMMUNITY_SLOTS: [ceReg] }));
    vi.doMock('@/edition/ee-entry', () => ({
      eeRoutes: [{ path: '/x' }],
      eeSlots: [{ slot: 'upsell', id: 'a', order: 1, render: () => null }],
      eeAuthClient: { name: 'ee' },
      eeExtensions: { ...EMPTY_EXTENSIONS, boot: [vi.fn()] },
    }));
    // After vi.resetModules(), the fresh registry's EMPTY_EXTENSIONS is the one active.ts sees.
    const { EMPTY_EXTENSIONS: emptyExtensions } = await import('./extensions');
    const m = await import('./active');
    expect(m.ACTIVE_EE_ROUTES).toEqual([]);
    expect(m.ACTIVE_SLOTS).toEqual([ceReg]);
    expect(m.ACTIVE_EE_AUTH_CLIENT).toBeNull();
    expect(m.ACTIVE_EXTENSIONS).toBe(emptyExtensions);
  });
});
