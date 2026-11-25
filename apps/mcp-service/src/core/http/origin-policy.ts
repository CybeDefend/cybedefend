import type { Edition } from '../../edition/edition';

/**
 * Which browser origins may call this service.
 *
 * A request sent by a web page carries an `Origin` header; a coding agent
 * running on the user's machine sends none. The MCP Streamable HTTP
 * transport requires a server to validate `Origin`: otherwise any page the
 * user opens can post to an MCP server listening on the user's machine (a
 * cross-site POST with a plain body needs no preflight).
 *
 * `'*'` allows every origin; a set allows the origins it holds.
 */
export type AllowedOrigins = '*' | ReadonlySet<string>;

/**
 * The origin a value names (`scheme://host[:port]`, lower case, no path),
 * or null when it is not an http(s) URL.
 */
function originOf(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The entries of an `MCP_ALLOWED_ORIGINS` value that are neither `*` nor an
 * http(s) origin (`scheme://host[:port]`, a trailing `/` tolerated, no path,
 * query, fragment or credentials). The boot refuses a value with any, rather
 * than silently allowing fewer origins than the operator wrote.
 */
export function invalidAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '*')
    .filter((entry) => {
      try {
        const url = new URL(entry);
        return !(
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password &&
          !entry.includes('?') &&
          !entry.includes('#')
        );
      } catch {
        return true;
      }
    });
}

/**
 * The allow-list, from `MCP_ALLOWED_ORIGINS` (comma-separated origins, or
 * `*` for any), plus the service's own `PUBLIC_URL` origin, which is always
 * allowed.
 *
 * When `MCP_ALLOWED_ORIGINS` is unset: the Community Edition allows no other
 * origin, because its server usually listens on the user's machine or
 * network and no web page needs to reach it. The other editions allow any
 * origin: their server is a public host whose OAuth discovery serves
 * browser-based MCP clients of any site, and every route there answers a
 * bearer token only, never a cookie, so a page of another site gains
 * nothing it could not do from its own server.
 */
export function allowedOriginsFrom(
  raw: string | undefined,
  publicUrl: string | undefined,
  edition: Edition,
): AllowedOrigins {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) return '*';
  if (entries.length === 0 && edition !== 'community') return '*';

  const allowed = new Set<string>();
  for (const entry of [...entries, publicUrl ?? '']) {
    const origin = originOf(entry);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

/** True when a request carrying this `Origin` header value may proceed. */
export function isOriginAllowed(
  origin: string,
  allowed: AllowedOrigins,
): boolean {
  if (allowed === '*') return true;
  const normalised = originOf(origin);
  return normalised !== null && allowed.has(normalised);
}
