import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { RebacProvider } from 'react-rebac';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import store from './server/store';
import { clearAccessToken } from './server/store/authSlice';
import { resetInvitation } from './server/store/invitationSlice';
import { captureInviteEmail } from './lib/invite-email';

/**
 * In the Community Edition the token of `/invite/<token>` is the whole
 * credential (accepting takes a name and a password, no e-mail): App must not
 * keep the invitation's path in the browser's storage, where someone later on
 * the same profile could read it. The cloud keeps it, as today.
 */
const mocks = vi.hoisted(() => ({ edition: 'community' as string }));

vi.mock('@/edition/edition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/edition')>();
  return {
    ...actual,
    get EDITION() {
      return mocks.edition;
    },
  };
});
vi.mock('react-rebac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-rebac')>()),
  useRebac: () => ({ setUser: vi.fn() }),
}));
vi.mock('@/edition/auth/useAuth', () => ({
  useAuth: () => ({ loading: false, authError: null, retryAuth: vi.fn() }),
  authClient: { signIn: vi.fn() },
}));
vi.mock('@/server/hooks/useLogout', () => ({ default: () => vi.fn() }));
vi.mock('@/server/hooks/useBackgroundTasks', () => ({ useBackgroundTasks: () => undefined, default: () => undefined }));
vi.mock('@/server/hooks/useActiveScanTasksTracker', () => ({
  useActiveScanTasksTracker: () => undefined,
  default: () => undefined,
}));
vi.mock('@/pages/community-auth/InvitationAcceptForm', () => ({
  default: () => <p data-testid="invitation-form">form</p>,
}));
vi.mock('@/pages/OrganizationInvitationPage', () => ({
  default: () => <p data-testid="invitation-page">invitation</p>,
}));

const TOKEN = '0123456789abcdef'.repeat(4);

const storedValues = (): string[] =>
  [window.localStorage, window.sessionStorage].flatMap((storage) =>
    Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '') ?? ''),
  );

/** The link global-management mails when SMTP is configured, in both editions. */
const mailedLink = () =>
  `/invite/${TOKEN}?organizationName=Acme&organizationRole=member&expiresAt=${encodeURIComponent(
    new Date(Date.now() + 86_400_000).toISOString(),
  )}&email=a%40b.c&fromInvitation=true`;

/** Opens `path` as the browser does: the boot's capture of `?email` (index.tsx), then App. */
async function visit(path: string) {
  window.history.replaceState(null, '', path);
  captureInviteEmail();
  path = `${window.location.pathname}${window.location.search}`;
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <RebacProvider>
          <App />
        </RebacProvider>
      </MemoryRouter>
    </Provider>,
  );
  expect(await screen.findByTestId('invitation-page')).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('App on an invitation link', () => {
  beforeEach(() => {
    store.dispatch(clearAccessToken());
    store.dispatch(resetInvitation());
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('in the Community Edition, keeps the token in no storage', async () => {
    mocks.edition = 'community';
    await visit(`/invite/${TOKEN}`);
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
  });

  it('in the Community Edition, keeps the token in no storage after the mailed link either', async () => {
    mocks.edition = 'community';
    await visit(mailedLink());
    expect(window.sessionStorage.getItem('cybe_invite_email')).toContain('a@b.c');
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
  });

  it('in the Community Edition, serves the fragment link /invite#token=… and keeps the token in no storage nor URL', async () => {
    mocks.edition = 'community';
    window.history.replaceState(null, '', `/invite#token=${TOKEN}&email=a%40b.c`);
    captureInviteEmail();
    expect(window.location.href).toBe(`${window.location.origin}/invite`);
    await visit('/invite');
    expect(window.sessionStorage.getItem('cybe_invite_email')).toContain('a@b.c');
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('in the cloud, keeps the pending invitation as today', async () => {
    mocks.edition = 'cloud';
    await visit(mailedLink());
    expect(window.localStorage.getItem('invitationContext')).toContain(`/invite/${TOKEN}`);
    expect(JSON.parse(window.sessionStorage.getItem('cybe_invite_email') ?? 'null')).toEqual({
      token: TOKEN,
      email: 'a@b.c',
    });
  });
});
