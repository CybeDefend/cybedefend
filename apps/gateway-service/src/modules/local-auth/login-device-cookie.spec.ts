import {
  LOGIN_DEVICE_COOKIE,
  buildLoginDeviceCookie,
  newLoginDeviceToken,
  readLoginDeviceCookie,
} from './login-device-cookie';

const TOKEN = 'A'.repeat(43);

/**
 * The login device cookie: a random token the browser keeps after a
 * successful sign-in, so a locked account still lets that browser in. It is
 * a pointer to a server-side record, never a credential on its own.
 */
describe('login device cookie', () => {
  it('is named cd_login_device', () => {
    expect(LOGIN_DEVICE_COOKIE).toBe('cd_login_device');
  });

  it('draws 32 random bytes in base64url', () => {
    const a = newLoginDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newLoginDeviceToken()).not.toBe(a);
  });

  it('is HttpOnly, Secure, SameSite=Strict, on the auth path, for 30 days', () => {
    expect(buildLoginDeviceCookie(TOKEN, { path: '/auth', secure: true })).toBe(
      `cd_login_device=${TOKEN}; Max-Age=2592000; Path=/auth; HttpOnly; Secure; SameSite=Strict`,
    );
    expect(
      buildLoginDeviceCookie(TOKEN, { path: '/x', secure: false }),
    ).not.toContain('Secure');
  });

  it('refuses to write a token of another shape', () => {
    expect(() =>
      buildLoginDeviceCookie('x; Domain=evil', { path: '/auth', secure: true }),
    ).toThrow();
  });

  it('reads the token among other cookies, and ignores a malformed one', () => {
    expect(
      readLoginDeviceCookie(`cd_refresh=r1; cd_login_device=${TOKEN}; a=b`),
    ).toBe(TOKEN);
    expect(readLoginDeviceCookie('cd_login_device=short')).toBeUndefined();
    expect(readLoginDeviceCookie(undefined)).toBeUndefined();
    expect(readLoginDeviceCookie([`cd_login_device=${TOKEN}`])).toBe(TOKEN);
  });
});
