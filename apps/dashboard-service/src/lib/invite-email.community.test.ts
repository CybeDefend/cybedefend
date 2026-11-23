import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortDigest } from '@/utils/shortDigest';
import { captureInviteEmail, clearInviteEmail, INVITE_EMAIL_STORAGE_KEY, readInviteEmail } from './invite-email';
import { forgetInviteToken, rememberedInviteToken } from './invite-token';

/**
 * In the Community Edition the invitation token alone accepts the invitation
 * (a name and a password, no e-mail): the invited address is kept bound to a
 * digest of the token, never to the token itself. The cloud keeps its form
 * (`invite-email.test.ts`).
 */
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'community',
}));

const TOKEN = '0123456789abcdef'.repeat(4);
const MAILED = `/invite/${TOKEN}?organizationName=Acme&organizationRole=member&expiresAt=2099-01-01T00%3A00%3A00.000Z&email=a%40b.c&fromInvitation=true`;

const storedValues = (): string[] =>
  [window.localStorage, window.sessionStorage].flatMap((storage) =>
    Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '') ?? ''),
  );

describe('the invited address in the Community Edition', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, '', MAILED);
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('keeps the address of the mailed link without the token', () => {
    captureInviteEmail();
    expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
    expect(JSON.parse(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY) ?? 'null')).toEqual({
      tokenDigest: shortDigest(TOKEN),
      email: 'a@b.c',
    });
    expect(window.location.search).not.toContain('email=');
  });

  it('still hands the address back for its token, and only for it', () => {
    captureInviteEmail();
    expect(readInviteEmail(TOKEN)).toBe('a@b.c');
    expect(readInviteEmail('f'.repeat(64))).toBeNull();
  });

  it('is forgotten by clearInviteEmail', () => {
    captureInviteEmail();
    clearInviteEmail();
    expect(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY)).toBeNull();
    expect(readInviteEmail(TOKEN)).toBeNull();
  });

  describe('of the fragment link (`/invite#token=…&email=…`)', () => {
    const FRAGMENT = `/invite#token=${TOKEN}&email=a%40b.c`;

    beforeEach(() => {
      forgetInviteToken();
      window.history.replaceState({ usr: null, key: 'k', idx: 0 }, '', FRAGMENT);
    });

    it('keeps the address bound to a digest of the token, never the token', () => {
      captureInviteEmail();
      expect(JSON.parse(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY) ?? 'null')).toEqual({
        tokenDigest: shortDigest(TOKEN),
        email: 'a@b.c',
      });
      expect(storedValues().some((value) => value.includes(TOKEN))).toBe(false);
      expect(readInviteEmail(TOKEN)).toBe('a@b.c');
    });

    it('wipes the whole fragment at boot, the history state kept, the token held in memory', () => {
      captureInviteEmail();
      expect(window.location.href).toBe(`${window.location.origin}/invite`);
      expect(window.history.state).toEqual({ usr: null, key: 'k', idx: 0 });
      expect(rememberedInviteToken()).toBe(TOKEN);
    });

    it('keeps no address for a malformed token, and still wipes the fragment', () => {
      window.history.replaceState(null, '', '/invite#token=nope&email=a%40b.c');
      captureInviteEmail();
      expect(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY)).toBeNull();
      expect(window.location.hash).toBe('');
    });

    it('clearInviteEmail forgets the address and the token', () => {
      captureInviteEmail();
      clearInviteEmail();
      expect(readInviteEmail(TOKEN)).toBeNull();
      expect(rememberedInviteToken()).toBeNull();
    });
  });
});
