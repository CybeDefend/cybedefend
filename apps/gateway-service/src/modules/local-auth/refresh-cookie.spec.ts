import { ConfigService } from '@nestjs/config';
import {
  REFRESH_COOKIE,
  buildRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  refreshCookieOptions,
} from './refresh-cookie';

const NOW = Date.parse('2026-11-02T00:00:00Z');
const IN_30_DAYS = Date.parse('2026-12-02T00:00:00Z');

describe('refresh cookie', () => {
  it('is named cd_refresh', () => {
    expect(REFRESH_COOKIE).toBe('cd_refresh');
  });

  it('builds the exact cookie', () => {
    expect(
      buildRefreshCookie('t', IN_30_DAYS, { path: '/auth', secure: true }, NOW),
    ).toBe(
      'cd_refresh=t; Max-Age=2592000; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('uses the configured path', () => {
    expect(
      buildRefreshCookie(
        't',
        IN_30_DAYS,
        { path: '/api/auth', secure: true },
        NOW,
      ),
    ).toMatch(/Path=\/api\/auth; HttpOnly; Secure; SameSite=Strict$/);
  });

  it('drops Secure only when told', () => {
    const cookie = buildRefreshCookie(
      't',
      IN_30_DAYS,
      { path: '/auth', secure: false },
      NOW,
    );
    expect(cookie).not.toMatch(/Secure/);
    expect(cookie).toBe(
      'cd_refresh=t; Max-Age=2592000; Path=/auth; HttpOnly; SameSite=Strict',
    );
  });

  it('clears it', () => {
    expect(clearRefreshCookie({ path: '/auth', secure: true })).toBe(
      'cd_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('reads it among other cookies', () => {
    expect(readRefreshCookie('a=1; cd_refresh=abc; b=2')).toBe('abc');
    expect(readRefreshCookie('a=1; b=2')).toBeUndefined();
    expect(readRefreshCookie(undefined)).toBeUndefined();
    expect(readRefreshCookie('cd_refresh=')).toBeUndefined();
    expect(
      readRefreshCookie(['a=1', 'cd_refresh=first', 'cd_refresh=second']),
    ).toBe('first');
  });

  it('ignores a value that is not a refresh token', () => {
    expect(readRefreshCookie('cd_refresh=a b')).toBeUndefined();
    expect(readRefreshCookie(`cd_refresh=${'a'.repeat(513)}`)).toBeUndefined();
  });

  it('never returns a negative Max-Age', () => {
    expect(
      buildRefreshCookie(
        't',
        NOW - 60_000,
        { path: '/auth', secure: true },
        NOW,
      ),
    ).toBe(
      'cd_refresh=t; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('refuses a token that would break the header', () => {
    expect(() =>
      buildRefreshCookie(
        't; Path=/',
        IN_30_DAYS,
        { path: '/auth', secure: true },
        NOW,
      ),
    ).toThrow();
  });

  it('reads the options from the environment', () => {
    expect(refreshCookieOptions(new ConfigService({}))).toEqual({
      path: '/auth',
      secure: true,
    });
    expect(
      refreshCookieOptions(
        new ConfigService({
          AUTH_COOKIE_PATH: '/api/auth',
          AUTH_COOKIE_INSECURE_LOCALHOST: true,
        }),
      ),
    ).toEqual({ path: '/api/auth', secure: false });
    expect(
      refreshCookieOptions(
        new ConfigService({ AUTH_COOKIE_INSECURE_LOCALHOST: 'false' }),
      ),
    ).toEqual({ path: '/auth', secure: true });
  });
});
