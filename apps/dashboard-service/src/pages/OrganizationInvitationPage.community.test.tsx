import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import invitationReducer from '../server/store/invitationSlice';
import userReducer from '../server/store/userSlice';
import organizationReducer from '../server/store/organizationSlice';
import authReducer from '../server/store/authSlice';
import { translate } from '@/test/i18n-mock';
import OrganizationInvitationPage from './OrganizationInvitationPage';
import { forgetInviteToken, rememberedInviteToken } from '@/lib/invite-token';

/**
 * `/invite/:token` in the Community Edition: a signed-out visitor gets the
 * account form (InvitationAcceptForm, tested on its own); a signed-in one gets
 * today's accept flow, `POST /organization/invite/accept`. The link of a
 * Community invitation carries no query (`${origin}/invite/<token>`).
 */
const mocks = vi.hoisted(() => ({
  edition: 'community' as string,
  acceptInvite: vi.fn(),
  signIn: vi.fn(),
  toastError: vi.fn(),
  hashAtFormRender: [] as string[],
}));

vi.mock('@/edition/edition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/edition')>();
  return {
    ...actual,
    get EDITION() {
      return mocks.edition;
    },
  };
});
vi.mock('@/edition/auth/useAuth', () => ({ authClient: { signIn: mocks.signIn } }));
vi.mock('./community-auth/InvitationAcceptForm', () => ({
  default: ({ token }: { token: string }) => {
    // What the address bar holds when the form first renders, before it can send anything.
    mocks.hashAtFormRender.push(window.location.hash);
    return <p data-testid="invitation-form">{token}</p>;
  },
}));
vi.mock('../server/hooks/useLogout', () => ({ default: () => vi.fn() }));
vi.mock('react-rebac', () => ({ useRebac: () => ({ setUser: vi.fn() }) }));
vi.mock('react-toastify', () => ({ toast: { error: mocks.toastError, success: vi.fn() }, ToastContainer: () => null }));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_target, prop: string) =>
        ({ initial, animate, exit, transition, whileHover, whileTap, variants, ...rest }: Record<string, unknown>) => {
          void initial; void animate; void exit; void transition; void whileHover; void whileTap; void variants;
          const Tag = prop as unknown as React.ElementType;
          return <Tag {...rest} />;
        },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../server/services/organizationService', () => ({
  acceptOrganizationInvite: (...args: unknown[]) => mocks.acceptInvite(...args),
  fetchOrganizationById: vi.fn().mockResolvedValue({}),
}));
vi.mock('../server/services/userService', () => ({ fetchMyProfile: vi.fn().mockRejectedValue(new Error('offline')) }));

const TOKEN = '0123456789abcdef'.repeat(4);

const storeFor = (signedIn: boolean) =>
  configureStore({
    reducer: { invitation: invitationReducer, user: userReducer, organization: organizationReducer, auth: authReducer },
    preloadedState: {
      auth: { accessToken: signedIn ? 'token' : null, isAuthenticated: signedIn, justLoggedOut: false },
    },
  });

/** Every value this browser keeps, in both storages. */
const storedValues = (): string[] =>
  [window.localStorage, window.sessionStorage].flatMap((storage) =>
    Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '') ?? ''),
  );

const renderAt = (url: string, signedIn: boolean) =>
  render(
    <Provider store={storeFor(signedIn)}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/invite/:token" element={<OrganizationInvitationPage />} />
          <Route path="/invite" element={<OrganizationInvitationPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

describe('OrganizationInvitationPage in the Community Edition', () => {
  beforeEach(() => {
    mocks.edition = 'community';
    mocks.acceptInvite.mockReset().mockResolvedValue({ organization: { id: 'org-1' } });
    mocks.signIn.mockReset();
    mocks.toastError.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('a signed-out visitor gets the account form, with the link as it comes (no query)', () => {
    renderAt(`/invite/${TOKEN}`, false);
    expect(screen.getByTestId('invitation-form')).toHaveTextContent(TOKEN);
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });

  it('a signed-out visitor gets the form with no token for a malformed one (it refuses it itself)', () => {
    renderAt('/invite/not-hex', false);
    expect(screen.getByTestId('invitation-form')).toHaveTextContent(/^$/);
  });

  it('a signed-in visitor accepts with today\'s flow, from a link without query', async () => {
    renderAt(`/invite/${TOKEN}`, true);
    expect(screen.queryByTestId('invitation-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(mocks.acceptInvite).toHaveBeenCalledWith({ token: TOKEN }));
  });

  it('the cloud keeps its sign-in providers for a signed-out visitor', () => {
    mocks.edition = 'cloud';
    const expiresAt = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    renderAt(`/invite/${TOKEN}?organizationName=Acme&organizationRole=member&expiresAt=${expiresAt}`, false);
    expect(screen.queryByTestId('invitation-form')).toBeNull();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('the cloud still refuses a link without its query', () => {
    mocks.edition = 'cloud';
    renderAt(`/invite/${TOKEN}`, true);
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    expect(screen.getByText(translate('pages.orgInvitation.errors.invalidLink'))).toBeInTheDocument();
    expect(mocks.acceptInvite).not.toHaveBeenCalled();
  });

  it('a signed-out visit keeps the token in no storage', () => {
    renderAt(`/invite/${TOKEN}`, false);
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
  });

  it('a signed-in visit keeps the token in no storage', async () => {
    renderAt(`/invite/${TOKEN}`, true);
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
  });

  it('the cloud still keeps the pending invitation (today\'s behaviour)', () => {
    mocks.edition = 'cloud';
    const expiresAt = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    renderAt(`/invite/${TOKEN}?organizationName=Acme&organizationRole=member&expiresAt=${expiresAt}`, false);
    expect(window.localStorage.getItem('invitationContext')).toContain(`/invite/${TOKEN}`);
  });

  it.each(['not-hex', TOKEN.toUpperCase(), TOKEN.slice(1), `${TOKEN}0`])(
    'a signed-in visitor with a malformed token (%s) gets the invalid sentence and no request',
    (token) => {
      renderAt(`/invite/${token}`, true);
      expect(screen.getByText(translate('pages.communityAuth.refusals.INVITATION_INVALID'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
      expect(mocks.acceptInvite).not.toHaveBeenCalled();
    },
  );

  it('a trailing slash after the token is accepted, the token sent without it', async () => {
    renderAt(`/invite/${TOKEN}/`, true);
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(mocks.acceptInvite).toHaveBeenCalledWith({ token: TOKEN }));
  });

  it('a refused accept shows a fixed sentence, never the server\'s text', async () => {
    mocks.acceptInvite.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: { message: 'boom' } } });
    renderAt(`/invite/${TOKEN}`, true);
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError).toHaveBeenCalledWith(translate('pages.orgInvitation.toast.acceptError'));
    expect(mocks.toastError).not.toHaveBeenCalledWith('boom');
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('an acceptance refused ROLE_NOT_AVAILABLE says the role is not available here', async () => {
    mocks.acceptInvite.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'ROLE_NOT_AVAILABLE' } },
    });
    renderAt(`/invite/${TOKEN}`, true);
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError).toHaveBeenCalledWith(translate('components.organizationRoleRefusal.ROLE_NOT_AVAILABLE'));
  });

  it('ignores the name, role and expiry a crafted link carries', async () => {
    const expiresAt = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    renderAt(`/invite/${TOKEN}?organizationName=EvilCorp&organizationRole=superadmin&expiresAt=${expiresAt}`, true);
    expect(screen.queryByText(/EvilCorp/)).toBeNull();
    expect(screen.queryByText(/superadmin/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(mocks.acceptInvite).toHaveBeenCalledWith({ token: TOKEN }));
  });

  it('a crafted link with a bad expiry is still the token-only invitation', () => {
    renderAt(`/invite/${TOKEN}?organizationName=Acme&organizationRole=admin&expiresAt=not-a-date`, true);
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  });

  describe('the fragment link (`/invite#token=…`)', () => {
    /** Opens the link as the browser does: the window's address, then the router's location. */
    const openFragmentLink = (fragment: string, signedIn: boolean) => {
      window.history.replaceState({ usr: null, key: 'k1', idx: 0 }, '', `/invite${fragment}`);
      return renderAt(`/invite${fragment}`, signedIn);
    };

    beforeEach(() => {
      forgetInviteToken();
      mocks.hashAtFormRender.length = 0;
    });
    afterEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('a signed-out visitor gets the form with the token, the fragment gone before it renders', () => {
      openFragmentLink(`#token=${TOKEN}`, false);
      expect(screen.getByTestId('invitation-form')).toHaveTextContent(TOKEN);
      expect(mocks.hashAtFormRender.length).toBeGreaterThan(0);
      expect(mocks.hashAtFormRender.every((hash) => hash === '')).toBe(true);
    });

    it('after mount, no URL in the history and no history state holds the token, and no storage', () => {
      openFragmentLink(`#token=${TOKEN}&email=a%40b.c`, false);
      expect(window.location.href).toBe(`${window.location.origin}/invite`);
      expect(window.history.state).toEqual({ usr: null, key: 'k1', idx: 0 });
      expect(JSON.stringify(window.history.state ?? null)).not.toContain(TOKEN);
      expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
    });

    it('a signed-in visitor accepts with the token of the fragment', async () => {
      openFragmentLink(`#token=${TOKEN}`, true);
      expect(window.location.hash).toBe('');
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
      await waitFor(() => expect(mocks.acceptInvite).toHaveBeenCalledWith({ token: TOKEN }));
      await waitFor(() => expect(rememberedInviteToken()).toBeNull());
      expect(window.location.href).not.toContain(TOKEN);
    });

    it.each(['#token=nope', `#token=${TOKEN.toUpperCase()}`, `#token=${TOKEN}0`, ''])(
      'a signed-in visitor with a malformed or missing token (%j) gets the invalid sentence and no request',
      (fragment) => {
        openFragmentLink(fragment, true);
        expect(screen.getByText(translate('pages.communityAuth.refusals.INVITATION_INVALID'))).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
        expect(mocks.acceptInvite).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('');
      },
    );

    it('a signed-out visitor with a malformed token gets the form with no token (it refuses it itself)', () => {
      openFragmentLink('#token=nope', false);
      expect(screen.getByTestId('invitation-form')).toHaveTextContent(/^$/);
    });

    it('back on /invite after signing in, the token held in memory is accepted', async () => {
      const first = openFragmentLink(`#token=${TOKEN}`, false);
      first.unmount();
      window.history.replaceState(null, '', '/invite');
      renderAt('/invite', true);
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
      await waitFor(() => expect(mocks.acceptInvite).toHaveBeenCalledWith({ token: TOKEN }));
    });
  });

  describe('the former path link (`/invite/<token>`)', () => {
    /** Opens the link as the browser does: the window's address, then the router's location. */
    const openPathLink = (path: string, signedIn: boolean) => {
      window.history.replaceState({ usr: null, key: 'k2', idx: 0 }, '', path);
      return renderAt(path, signedIn);
    };

    beforeEach(() => {
      forgetInviteToken();
      mocks.hashAtFormRender.length = 0;
    });
    afterEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('after mount the address bar is /invite, the history state kept, no storage holds the token', () => {
      openPathLink(`/invite/${TOKEN}?organizationName=Acme`, false);
      expect(screen.getByTestId('invitation-form')).toHaveTextContent(TOKEN);
      expect(window.location.href).toBe(`${window.location.origin}/invite`);
      expect(window.history.state).toEqual({ usr: null, key: 'k2', idx: 0 });
      expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
    });

    it('a signed-in visitor accepts with the token of the path, the address bar already rewritten', async () => {
      openPathLink(`/invite/${TOKEN}`, true);
      expect(window.location.href).toBe(`${window.location.origin}/invite`);
      fireEvent.click(screen.getByRole('button', { name: /accept/i }));
      await waitFor(() => expect(mocks.acceptInvite).toHaveBeenCalledWith({ token: TOKEN }));
    });

    it('a malformed token shows the invalid sentence, sends nothing, and the URL is rewritten too', () => {
      openPathLink('/invite/not-hex', true);
      expect(screen.getByText(translate('pages.communityAuth.refusals.INVITATION_INVALID'))).toBeInTheDocument();
      expect(mocks.acceptInvite).not.toHaveBeenCalled();
      expect(window.location.href).toBe(`${window.location.origin}/invite`);
    });

    it('the cloud keeps its path and query', () => {
      mocks.edition = 'cloud';
      const expiresAt = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
      const path = `/invite/${TOKEN}?organizationName=Acme&organizationRole=member&expiresAt=${expiresAt}`;
      openPathLink(path, false);
      expect(`${window.location.pathname}${window.location.search}`).toBe(path);
    });
  });
});
