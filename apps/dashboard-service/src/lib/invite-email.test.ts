import { beforeEach, describe, expect, it } from 'vitest';

import { captureInviteEmail, clearInviteEmail, readInviteEmail } from './invite-email';

const TOKEN = 'a1b2c3d4';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('invite-email capture', () => {
  it('captures ?email of the invitation page for its token, in sessionStorage only', () => {
    window.history.pushState(
      {},
      '',
      `/invite/${TOKEN}?organizationName=Acme&email=${encodeURIComponent('ada@example.test')}`,
    );
    captureInviteEmail();
    expect(readInviteEmail(TOKEN)).toBe('ada@example.test');
    // Personal data never lands in localStorage, which outlives the tab.
    expect(JSON.stringify({ ...localStorage })).not.toContain('ada@example.test');
  });

  it('wipes ?email from the address bar as soon as it is captured, keeping the rest', () => {
    window.history.pushState(
      { from: 'mail' },
      '',
      `/invite/${TOKEN}?organizationName=Acme&email=ada%40example.test&expiresAt=2026-09-23#top`,
    );
    captureInviteEmail();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('email')).toBeNull();
    expect(params.get('organizationName')).toBe('Acme');
    expect(params.get('expiresAt')).toBe('2026-09-23');
    expect(window.location.pathname).toBe(`/invite/${TOKEN}`);
    expect(window.location.hash).toBe('#top');
    expect(window.history.state).toEqual({ from: 'mail' });
  });

  it('wipes even a value it refuses to keep', () => {
    window.history.pushState({}, '', `/invite/${TOKEN}?email=not-an-address`);
    captureInviteEmail();
    expect(window.location.search).toBe('');
  });

  it('leaves ?email in the address bar outside the invitation page, where it is the page input (/sso)', () => {
    window.history.pushState({}, '', '/sso?email=ada%40example.test');
    captureInviteEmail();
    expect(window.location.search).toBe('?email=ada%40example.test');
  });

  it('does not answer for another invitation token', () => {
    window.history.pushState({}, '', `/invite/${TOKEN}?email=ada%40example.test`);
    captureInviteEmail();
    expect(readInviteEmail('another-token')).toBeNull();
  });

  it('ignores ?email outside the invitation page', () => {
    window.history.pushState({}, '', '/sso?email=ada%40example.test');
    captureInviteEmail();
    expect(sessionStorage.length).toBe(0);
  });

  it('restores a plus sign that a link rewriter decoded into a space', () => {
    window.history.pushState({}, '', `/invite/${TOKEN}?email=ada+security%40example.test`);
    captureInviteEmail();
    expect(readInviteEmail(TOKEN)).toBe('ada+security@example.test');
  });

  it('ignores a value that is not an email address', () => {
    window.history.pushState({}, '', `/invite/${TOKEN}?email=not-an-address`);
    captureInviteEmail();
    expect(readInviteEmail(TOKEN)).toBeNull();
  });

  it('keeps the earlier capture when the invitation page is reached without ?email (Logto round trip)', () => {
    window.history.pushState({}, '', `/invite/${TOKEN}?email=ada%40example.test`);
    captureInviteEmail();
    window.history.pushState({}, '', `/invite/${TOKEN}?organizationName=Acme`);
    captureInviteEmail();
    expect(readInviteEmail(TOKEN)).toBe('ada@example.test');
  });

  it('clearInviteEmail forgets it', () => {
    window.history.pushState({}, '', `/invite/${TOKEN}?email=ada%40example.test`);
    captureInviteEmail();
    clearInviteEmail();
    expect(readInviteEmail(TOKEN)).toBeNull();
  });
});
