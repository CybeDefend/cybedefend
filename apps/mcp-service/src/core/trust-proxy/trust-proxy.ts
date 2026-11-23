/**
 * Parse a comma-separated list of CIDRs from the TRUST_PROXY_CIDR env var
 * into the value Fastify's `trustProxy` option expects.
 *
 * Returning `false` (rather than an empty array) when the var is unset is
 * deliberate: Fastify treats an empty array as "trust nothing" too, but
 * `false` is the documented, unambiguous "ignore X-Forwarded-For" setting.
 * Pre-auth rate-limiter keys on `req.ip`, so a missing/blank value MUST
 * fall back to the socket origin instead of any client-controlled header.
 */
export function parseTrustProxyCidrs(
  rawCidr: string | undefined,
): string[] | false {
  const list = (rawCidr ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return list.length > 0 ? list : false;
}
