import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AuthClient, AuthState } from './authClient';

/**
 * The core reads the session through one client: the active edition's
 * (`ACTIVE_EE_AUTH_CLIENT`) when the closed tree is active, the Community
 * client otherwise. `useAuth()` hands App and the pages the shape they have
 * always read (`loading`, `authError`, `retryAuth`).
 */
const holder = vi.hoisted(() => ({ client: null as AuthClient | null }));

vi.mock('@/edition/active', () => ({
  get ACTIVE_EE_AUTH_CLIENT() {
    return holder.client;
  },
  // What the store reads (the community client holds its token there).
  ACTIVE_EXTENSIONS: { reducers: {}, responseInterceptors: [] },
}));

// The Community client's boot exchange: no refresh cookie here.
const refresh = vi.hoisted(() => vi.fn(() => Promise.resolve({ kind: 'signed-out' as const })));
vi.mock('./community/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./community/authApi')>()),
  refresh,
}));

async function loadUseAuth() {
  vi.resetModules();
  return import('./useAuth');
}

afterEach(() => {
  holder.client = null;
});

describe('useAuth', () => {
  it('the cloud client is used when ee is active', async () => {
    const retry = vi.fn();
    const error = new Error('bootstrap');
    let state: AuthState = { isAuthenticated: false, loading: true, error: null, retry };
    const fake: AuthClient = {
      useAuthState: () => state,
      getAccessToken: () => Promise.resolve('jwt'),
      signIn: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
    };
    holder.client = fake;
    const { authClient, useAuth } = await loadUseAuth();

    expect(authClient).toBe(fake);
    const { result, rerender } = renderHook(() => useAuth());
    expect(result.current).toEqual({ isAuthenticated: false, loading: true, authError: null, retryAuth: retry });

    state = { isAuthenticated: true, loading: false, error, retry };
    rerender();
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.authError).toBe(error);
    result.current.retryAuth();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('without ee, the community client is used', async () => {
    holder.client = null;
    const { authClient, communityAuthClient, useAuth } = await loadUseAuth();

    expect(authClient).toBe(communityAuthClient);
    const { result } = renderHook(() => useAuth());
    // The boot asks the refresh route once; no cookie means signed out, not an error.
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ isAuthenticated: false, loading: false, authError: null });
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(authClient.getAccessToken()).resolves.toBeNull();
  });
});
