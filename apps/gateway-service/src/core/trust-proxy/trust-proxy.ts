import { currentEdition, type Edition } from '../../edition/edition';

/**
 * Parse the comma-separated CIDR list of the TRUSTED_PROXY_CIDRS env var
 * into the value Fastify's `trustProxy` option expects.
 *
 * Returning `false` (rather than an empty array) when the var yields no CIDR
 * is deliberate: it leaves `req.ip` resolving to the socket origin so neither
 * the rate-limit guards nor any audit consumer can be steered by a
 * spoofed X-Forwarded-For header from an unauthenticated client.
 *
 * TRUSTED_PROXY_CIDRS is the only variable read — the former
 * TRUST_PROXY_CIDR name is ignored.
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

/**
 * The Community Edition's own compose network (CYBEDEFEND_SUBNET):
 * the only hop whose X-Forwarded-For the bundled nginx writes, so the only
 * one trusted by default when TRUSTED_PROXY_CIDRS is unset.
 */
export const COMMUNITY_DEFAULT_TRUSTED_PROXY_CIDRS = '172.30.240.0/24';

/**
 * The Fastify `trustProxy` value for this process, from the environment.
 *
 * TRUSTED_PROXY_CIDRS wins when it carries at least one CIDR; otherwise the
 * Community Edition falls back to its compose network (the bundled nginx
 * overwrites X-Forwarded-For with $remote_addr inside it) and every other
 * edition trusts nobody (`false`).
 */
export function trustedProxyCidrsFromEnv(
  env: NodeJS.ProcessEnv,
  edition: Edition = currentEdition(),
): string[] | false {
  const configured = parseTrustProxyCidrs(env.TRUSTED_PROXY_CIDRS);
  if (configured !== false) return configured;
  if (edition === 'community') return [COMMUNITY_DEFAULT_TRUSTED_PROXY_CIDRS];
  return false;
}
