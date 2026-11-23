import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetInviteToken,
  isInvitationPagePath,
  rememberedInviteToken,
  takeInviteTokenFromHash,
  takeInviteTokenFromPath,
} from './invite-token';

/**
 * A Community invitation link is `/invite#token=<64 hex>`: the token is the
 * whole credential, so it travels in the fragment (no server, no access log,
 * no `Referer`), leaves the address bar at once, and is kept in this page's
 * memory only, never in a storage.
 */
const TOKEN = '0123456789abcdef'.repeat(4);

const storedValues = (): string[] =>
  [window.localStorage, window.sessionStorage].flatMap((storage) =>
    Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '') ?? ''),
  );

describe('the invitation token of a fragment link', () => {
  beforeEach(() => {
    forgetInviteToken();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('is taken from the fragment, which leaves the address bar and the history entry', () => {
    window.history.replaceState({ usr: { kept: true }, key: 'k1', idx: 3 }, '', `/invite#token=${TOKEN}`);
    expect(takeInviteTokenFromHash()).toBe(TOKEN);
    expect(window.location.href).toBe(`${window.location.origin}/invite`);
    expect(window.location.hash).toBe('');
    expect(window.history.state).toEqual({ usr: { kept: true }, key: 'k1', idx: 3 });
    expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
  });

  it('stays in memory once the fragment is gone (a strict-mode remount, a sign-in round trip)', () => {
    window.history.replaceState(null, '', `/invite#token=${TOKEN}&email=a%40b.c`);
    takeInviteTokenFromHash();
    expect(window.location.hash).toBe('');
    expect(takeInviteTokenFromHash()).toBe(TOKEN);
    expect(rememberedInviteToken()).toBe(TOKEN);
  });

  it.each(['A'.repeat(64), TOKEN.slice(1), `${TOKEN}0`, '../../auth/login', ''])(
    'a malformed token (%j) is dropped from the address bar and not remembered',
    (token) => {
      window.history.replaceState(null, '', `/invite#token=${encodeURIComponent(token)}`);
      expect(takeInviteTokenFromHash()).toBeNull();
      expect(window.location.hash).toBe('');
    },
  );

  it('a new link replaces the token of an earlier one, a malformed one forgets it', () => {
    window.history.replaceState(null, '', `/invite#token=${TOKEN}`);
    takeInviteTokenFromHash();
    window.history.replaceState(null, '', '/invite#token=nope');
    expect(takeInviteTokenFromHash()).toBeNull();
  });

  it('reads nothing on another path, and leaves its fragment alone', () => {
    window.history.replaceState(null, '', `/reset-password#token=${TOKEN}`);
    expect(takeInviteTokenFromHash()).toBeNull();
    expect(window.location.hash).toBe(`#token=${TOKEN}`);
  });

  it('is forgotten by forgetInviteToken', () => {
    window.history.replaceState(null, '', `/invite#token=${TOKEN}`);
    takeInviteTokenFromHash();
    forgetInviteToken();
    expect(rememberedInviteToken()).toBeNull();
    expect(takeInviteTokenFromHash()).toBeNull();
  });
});

describe('the invitation token of the former path link (`/invite/<token>`)', () => {
  beforeEach(() => {
    forgetInviteToken();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('is taken into memory, the address bar rewritten to /invite with the history state kept', () => {
    window.history.replaceState({ usr: { kept: true }, key: 'k2', idx: 1 }, '', `/invite/${TOKEN}?organizationName=Acme`);
    expect(takeInviteTokenFromPath(`/invite/${TOKEN}`)).toBe(TOKEN);
    expect(window.location.href).toBe(`${window.location.origin}/invite`);
    expect(window.history.state).toEqual({ usr: { kept: true }, key: 'k2', idx: 1 });
    expect(rememberedInviteToken()).toBe(TOKEN);
  });

  it('a trailing slash is dropped from the token', () => {
    window.history.replaceState(null, '', `/invite/${TOKEN}/`);
    expect(takeInviteTokenFromPath(`/invite/${TOKEN}/`)).toBe(TOKEN);
    expect(window.location.pathname).toBe('/invite');
  });

  it.each(['not-hex', TOKEN.toUpperCase(), `${TOKEN}0`])('a malformed token (%s) is not remembered, the URL rewritten too', (token) => {
    window.history.replaceState(null, '', `/invite/${token}`);
    expect(takeInviteTokenFromPath(`/invite/${token}`)).toBeNull();
    expect(window.location.href).toBe(`${window.location.origin}/invite`);
  });

  it('reads the router path even when the address bar already moved on, and rewrites nothing else', () => {
    window.history.replaceState(null, '', '/somewhere');
    expect(takeInviteTokenFromPath(`/invite/${TOKEN}`)).toBe(TOKEN);
    expect(window.location.pathname).toBe('/somewhere');
  });

  it('on /invite itself, hands back the token held in memory', () => {
    window.history.replaceState(null, '', `/invite/${TOKEN}`);
    takeInviteTokenFromPath(`/invite/${TOKEN}`);
    expect(takeInviteTokenFromPath('/invite')).toBe(TOKEN);
  });
});

describe('isInvitationPagePath', () => {
  it.each(['/invite', '/invite/', `/invite/${TOKEN}`, `/invite/${TOKEN}/`])('%s is the invitation page', (path) => {
    expect(isInvitationPagePath(path)).toBe(true);
  });

  it.each(['/', '/invites', '/inviteX', '/on-boarding', '/organization/invite'])('%s is not', (path) => {
    expect(isInvitationPagePath(path)).toBe(false);
  });
});
