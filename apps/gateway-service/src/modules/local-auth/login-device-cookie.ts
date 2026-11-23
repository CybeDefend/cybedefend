import { randomBytes } from 'node:crypto';
import type { RefreshCookieOptions } from './refresh-cookie';

/**
 * The login device cookie of the Community sign-in:
 *
 *   cd_login_device=<token>; Max-Age=2592000; Path=${AUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict
 *
 * 32 random bytes the browser keeps after a successful sign-in or password
 * reset. The token proves nothing on its own: LoginAccountLimiter records it
 * server-side for the account that signed in, and lets only a recorded
 * (token, account) pair through a locked account. Same attributes as the
 * refresh cookie (HttpOnly, the auth path, this site only, HTTPS only).
 */
export const LOGIN_DEVICE_COOKIE = 'cd_login_device';

/** As long as the server-side trust record (LOGIN_TRUST_TTL_SECONDS). */
const MAX_AGE_SECONDS = 30 * 86_400;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newLoginDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function buildLoginDeviceCookie(
  token: string,
  options: RefreshCookieOptions,
): string {
  if (!TOKEN_RE.test(token)) {
    // Never written into a header: it would let a value add attributes.
    throw new Error('login device token has an unexpected shape');
  }
  return `${LOGIN_DEVICE_COOKIE}=${token}; Max-Age=${MAX_AGE_SECONDS}; Path=${
    options.path
  }; HttpOnly${options.secure ? '; Secure' : ''}; SameSite=Strict`;
}

/** The first well-formed `cd_login_device` of the request, or undefined. */
export function readLoginDeviceCookie(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  const headers = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  for (const header of headers) {
    if (typeof header !== 'string') continue;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0 || part.slice(0, eq).trim() !== LOGIN_DEVICE_COOKIE) continue;
      const value = part.slice(eq + 1).trim();
      return TOKEN_RE.test(value) ? value : undefined;
    }
  }
  return undefined;
}
