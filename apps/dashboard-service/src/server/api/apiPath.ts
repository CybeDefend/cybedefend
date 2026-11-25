/**
 * Guards for the paths the shared API client sends.
 *
 * Route and query parameters end up in request paths. A value such as
 * `../../policies/<id>` would make the browser resolve the request to another
 * route of the API, sent with the signed-in user's bearer. The client refuses
 * such a path before the request leaves instead of rewriting it, so the caller
 * sees an error and nothing reaches the network.
 */

/** The code of the error a refused path rejects with. */
export const UNSAFE_API_PATH = 'UNSAFE_API_PATH';

export class UnsafeApiPathError extends Error {
  readonly code = UNSAFE_API_PATH;

  constructor() {
    super('Refused an API path that would leave its route');
    this.name = 'UnsafeApiPathError';
  }
}

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i;
/** `/` and its percent-encoded form, which some servers decode before routing. */
const SEPARATOR = /\/|%2f/i;
/** A percent-encoded `.` (`%2e`, read as `.` by the URL parser) or `\`. */
const ENCODED_DOT_OR_BACKSLASH = /%2e|%5c/i;

/**
 * C0 control characters, space and DEL. The URL parser strips tabs and line
 * breaks before it resolves dot segments (`.<TAB>.` is sent as `..`); a path
 * the application builds never holds any of them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000- \u007f]/;

/** The base used to resolve a candidate when the caller gives none. */
const DEFAULT_BASE = 'https://api.invalid/';

/** The page's origin, for a base given as a path; a placeholder outside a browser. */
const pageOrigin = (): string =>
  typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
    ? window.location.origin
    : 'https://app.invalid';

/** `base` and `url` joined the way the HTTP client joins them (one `/` between). */
const joined = (base: URL, url: string): string =>
  ABSOLUTE.test(url) ? url : `${base.href.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;

/** The literal path of an absolute URL string, before any resolution. */
const literalPath = (absolute: string): string => absolute.split(/[?#]/, 1)[0].replace(ABSOLUTE, '') || '/';

/**
 * The resolution layer: the candidate is resolved with the platform's URL
 * parser, exactly as the browser will send it, and refused when that changes
 * its path (a dot segment resolved, a `\` read as `/`, a character stripped
 * that changed a segment) or when it leaves the API base.
 */
const resolvesElsewhere = (url: string, baseInput: string): boolean => {
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(baseInput, pageOrigin());
    resolved = new URL(joined(base, url));
  } catch {
    return true;
  }
  if (resolved.origin !== base.origin) return true;
  const basePath = base.pathname.replace(/\/+$/, '');
  if (resolved.pathname !== basePath && !resolved.pathname.startsWith(`${basePath}/`)) return true;
  // Percent-encoding by the parser never adds nor removes a `/`: a different
  // number of segments means a segment was resolved away or added.
  const literal = literalPath(joined(base, url));
  return literal.split('/').length !== resolved.pathname.split('/').length;
};

/**
 * True when `url` must not be sent. Two layers: explicit refusals (a control
 * character, space or DEL, a `.` or `..` segment also behind an encoded `/`,
 * a backslash, a percent-encoded `.` or `\`, a fragment, a protocol-relative
 * start), then the resolution of the candidate against `base` (the API base
 * URL) as the browser resolves it. An encoded `/` inside a segment (a branch
 * `feature%2Fx`) is accepted. The query string is not a path: only the
 * resolution layer reads it, to find where the path ends.
 */
export function unsafeApiPath(url: string | undefined, base: string = DEFAULT_BASE): boolean {
  if (!url) return false;
  if (url.includes('#') || url.includes('\\')) return true;
  if (url.startsWith('//')) return true;

  const withoutQuery = url.split('?', 1)[0];
  if (CONTROL_OR_SPACE.test(withoutQuery)) return true;
  const path = withoutQuery.replace(ABSOLUTE, '');
  if (ENCODED_DOT_OR_BACKSLASH.test(path)) return true;
  if (path.split(SEPARATOR).some((segment) => segment === '.' || segment === '..')) return true;
  return resolvesElsewhere(url, base);
}

/**
 * One value as one path segment: encoded, and refused when it is empty or a
 * dot segment. For new code that puts a value in a request path.
 */
export function pathSegment(value: string): string {
  if (value === '' || value === '.' || value === '..') throw new UnsafeApiPathError();
  return encodeURIComponent(value);
}
