/**
 * The origins a cookie-authenticated auth route (refresh, logout) accepts in
 * the Community edition: those of FRONTEND_URL, the comma-separated list the
 * CORS policy allows (cors.options.ts), each reduced to its origin. An entry
 * that is not a URL is ignored.
 */
export function allowedOrigins(frontendUrl: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of (frontendUrl ?? '').split(',')) {
    const origin = originOf(entry.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

/**
 * True when the request comes from one of `allowed`: its `Origin` when it
 * carries one (browsers send it on every POST), else the origin of its
 * `Referer`. Neither, an opaque `null`, a repeated header or a value that is
 * not a URL is false.
 */
export function isRequestFromAllowedOrigin(
  headers: Record<string, string | string[] | undefined>,
  allowed: ReadonlySet<string>,
): boolean {
  const origin = header(headers.origin);
  const source =
    origin !== undefined ? originOf(origin) : originOf(header(headers.referer));
  return source !== undefined && allowed.has(source);
}
