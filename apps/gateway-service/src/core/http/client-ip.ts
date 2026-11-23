import { isISO31661Alpha2 } from 'class-validator';
import { currentEdition, type Edition } from '../../edition/edition';
import { rateLimitAddressOf } from './rate-limit-address';

/**
 * The network context of the caller, as the gateway is allowed to know it.
 *
 * One rule, in one place, for every route that has to name its caller to a
 * downstream service. It is deliberately the same rule `RateLimitGuard`
 * applies, and for the same reason:
 *
 *  - in the cloud and enterprise editions, in production the edge proxy
 *    rewrites `cf-connecting-ip` on every request, so a
 *    client cannot forge it past the edge;
 *  - everywhere else the header is an ordinary request header anyone can
 *    write, so it is ignored and the socket wins. The Community Edition
 *    applies that rule always: a self-hosted instance has no edge in
 *    front of it, so even with NODE_ENV=production the header is forgeable.
 *
 * `req.ip` is Fastify's, which resolves `X-Forwarded-For` only when the hop
 * that sent it sits inside `TRUSTED_PROXY_CIDRS` (see
 * `trustedProxyCidrsFromEnv` and the adapter in `main.ts`); with the
 * variable unset in a cloud deployment it is the socket origin. So this
 * function never trusts a header the gateway does not already trust.
 *
 * One route of a closed extension does not use this: its body carries an
 * address another service observed. Everywhere else, organisation creation
 * included, the browser is talking to the gateway directly and the
 * connection is the visitor.
 */

type RequestLike =
  | {
      ip?: unknown;
      headers?: Record<string, unknown>;
    }
  | null
  | undefined;

/** Meta's own cap. A longer UA is a malformed header, not a browser. */
export const MAX_CLIENT_USER_AGENT = 512;

/** A single header value, or '': a repeated header reaches Node as an array. */
function header(req: RequestLike, name: string): string {
  const value = req?.headers?.[name];
  return typeof value === 'string' ? value : '';
}

/**
 * @returns the caller's address, or '' when there is nothing to read. Never
 * throws: this is called on paths whose failure mode must be a weaker match,
 * never a failed request.
 *
 * In the Community Edition `cf-connecting-ip` is never read, whatever
 * `nodeEnv` is — there is no edge that rewrites it, so any caller could set
 * it and rotate the rate-limit buckets. `req.ip` is Fastify's, with
 * `X-Forwarded-For` trusted only from `TRUSTED_PROXY_CIDRS`.
 */
export function clientIpOf(
  req: RequestLike,
  nodeEnv?: string,
  edition: Edition = currentEdition(),
): string {
  if (edition !== 'community' && nodeEnv === 'production') {
    const cfIp = header(req, 'cf-connecting-ip');
    if (cfIp) return cfIp;
  }
  const ip = req?.ip;
  return typeof ip === 'string' ? ip : '';
}

/**
 * @returns the key of the caller's address for a rate-limit bucket:
 * `clientIpOf`, with an IPv6 address folded to its /64 and an IPv4-mapped
 * one turned into its IPv4 (`rateLimitAddressOf`). Every limiter that keys a
 * bucket on the caller's address uses this, never `clientIpOf` itself.
 */
export function clientRateLimitAddressOf(
  req: RequestLike,
  nodeEnv?: string,
  edition: Edition = currentEdition(),
): string {
  return rateLimitAddressOf(clientIpOf(req, nodeEnv, edition));
}

/**
 * @returns the caller's country (ISO 3166-1 alpha-2, upper case) as the edge
 * resolved it from their address, or '' when there is none to trust.
 *
 * Same trust rule as `clientIpOf`: `cf-ipcountry` is the edge's own only
 * where that edge is in front — and never in the Community Edition,
 * which answers '' whatever `nodeEnv` is. The header's two non-countries,
 * `XX` (unknown) and `T1` (Tor), fail the same ISO check that
 * `OrganizationCreateBodyDto.country` applies to a declared country.
 *
 * A default, never a fact: it stands in only for a country nobody declared,
 * and whatever the user confirms in the billing form replaces it.
 */
export function clientCountryOf(
  req: RequestLike,
  nodeEnv?: string,
  edition: Edition = currentEdition(),
): string {
  if (edition === 'community') return '';
  if (nodeEnv !== 'production') return '';
  const country = header(req, 'cf-ipcountry').trim().toUpperCase();
  return isISO31661Alpha2(country) ? country : '';
}

/** @returns the caller's user agent, capped, or '' when there is none. */
export function clientUserAgentOf(req: RequestLike): string {
  return header(req, 'user-agent').slice(0, MAX_CLIENT_USER_AGENT);
}
