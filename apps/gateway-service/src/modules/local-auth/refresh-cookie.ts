/**
 * The Community refresh cookie:
 *
 *   cd_refresh=<token>; Max-Age=<s>; Path=${AUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict
 *
 * The browser never reads it (HttpOnly) and sends it only to the auth routes
 * (Path), only to this site (SameSite=Strict), only over HTTPS (Secure). The
 * one exception to Secure is `AUTH_COOKIE_INSECURE_LOCALHOST=true`, which the
 * environment schema accepts only when `APP_PUBLIC_URL` is on localhost.
 */
export const REFRESH_COOKIE = 'cd_refresh';

export const DEFAULT_AUTH_COOKIE_PATH = '/auth';

/** The shape the environment schema enforces on AUTH_COOKIE_PATH. */
const COOKIE_PATH_RE = /^\/[A-Za-z0-9/_-]*$/;

/**
 * A refresh token is 32 random bytes in base64url (43 characters). Anything
 * else in the cookie is not one of ours: it is treated as absent, so it never
 * reaches global-management nor a header we write.
 */
const REFRESH_TOKEN_RE = /^[A-Za-z0-9_-]{1,512}$/;

export interface RefreshCookieOptions {
  path: string;
  secure: boolean;
}

/** The one ConfigService method read (any ConfigService instance fits). */
export interface ConfigReader {
  get(key: string): unknown;
}

export function refreshCookieOptions(
  config: ConfigReader,
): RefreshCookieOptions {
  const configured = config.get('AUTH_COOKIE_PATH');
  const path =
    typeof configured === 'string' && COOKIE_PATH_RE.test(configured)
      ? configured
      : DEFAULT_AUTH_COOKIE_PATH;
  const insecure = config.get('AUTH_COOKIE_INSECURE_LOCALHOST');
  return { path, secure: !(insecure === true || insecure === 'true') };
}

function attributes(options: RefreshCookieOptions): string {
  return `Path=${options.path}; HttpOnly${
    options.secure ? '; Secure' : ''
  }; SameSite=Strict`;
}

export function buildRefreshCookie(
  token: string,
  expiresAtMs: number,
  options: RefreshCookieOptions,
  nowMs: number = Date.now(),
): string {
  if (!REFRESH_TOKEN_RE.test(token)) {
    // Never written into a header: it would let a value add attributes.
    throw new Error('refresh token has an unexpected shape');
  }
  const seconds = Math.floor((Number(expiresAtMs) - nowMs) / 1000);
  const maxAge = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return `${REFRESH_COOKIE}=${token}; Max-Age=${maxAge}; ${attributes(options)}`;
}

export function clearRefreshCookie(options: RefreshCookieOptions): string {
  return `${REFRESH_COOKIE}=; Max-Age=0; ${attributes(options)}`;
}

function readOne(header: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return REFRESH_TOKEN_RE.test(value) ? value : undefined;
  }
  return undefined;
}

/** The first `cd_refresh` of the request, or undefined. */
export function readRefreshCookie(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  const headers = Array.isArray(cookieHeader)
    ? cookieHeader
    : typeof cookieHeader === 'string'
      ? [cookieHeader]
      : [];
  for (const header of headers) {
    if (typeof header !== 'string') continue;
    for (const part of header.split(';')) {
      // Find the first header that names the cookie at all.
      if (part.trim().startsWith(`${REFRESH_COOKIE}=`)) {
        return readOne(header);
      }
    }
  }
  return undefined;
}
