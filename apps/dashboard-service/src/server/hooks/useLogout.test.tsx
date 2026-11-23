import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { ReactNode } from 'react';
import authReducer, { setAccessToken } from '../store/authSlice';

const h = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/edition/auth/useAuth', () => ({ authClient: { signOut: h.signOut } }));

import useLogout from './useLogout';

describe('useLogout', () => {
  it('clears the token, then signs out through the edition’s auth client', async () => {
    const store = configureStore({ reducer: { auth: authReducer } });
    store.dispatch(setAccessToken('jwt'));
    let tokenWhenSigningOut: string | null | undefined;
    h.signOut.mockImplementation(async () => {
      tokenWhenSigningOut = store.getState().auth.accessToken;
    });
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current();
    });

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(tokenWhenSigningOut).toBeNull();
  });

  it('passes a failed sign-out on to the caller', async () => {
    const store = configureStore({ reducer: { auth: authReducer } });
    h.signOut.mockRejectedValueOnce(new Error('down'));
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
    const { result } = renderHook(() => useLogout(), { wrapper });

    await expect(result.current()).rejects.toThrow('down');
  });
});
