import { currentEdition, type Edition } from '../../edition/edition';
import { rateLimitAddressOf } from './rate-limit-address';

/**
 * The caller's address, read with the same rule as the gateway's:
 *
 *  - in the cloud and enterprise editions, in production, the edge proxy
 *    rewrites `cf-connecting-ip` on every request, so a client cannot forge
 *    it past the edge;
 *  - everywhere else that header is an ordinary request header anyone can
 *    write, so it is ignored. The Community Edition applies that rule
 *    always: a self-hosted instance has no such edge in front of it.
 *
 * `req.ip` is Fastify's, which resolves `X-Forwarded-For` only when the hop
 * that sent it sits inside `TRUST_PROXY_CIDR` (see `httpAdapterOptions`);
 * with the variable unset it is the socket origin. So this function never
 * trusts a header the service does not already trust.
 */

type RequestLike =
  | {
      ip?: unknown;
      headers?: Record<string, unknown>;
    }
  | null
  | undefined;

/** A single header value, or '': a repeated header reaches Node as an array. */
function header(req: RequestLike, name: string): string {
  const value = req?.headers?.[name];
  return typeof value === 'string' ? value : '';
}

/** @returns the caller's address, or '' when there is nothing to read. */
export function clientIpOf(
  req: RequestLike,
  nodeEnv?: string,
  edition: Edition = currentEdition(),
): string {
  if (edition !== 'community' && nodeEnv === 'production') {
    const edgeIp = header(req, 'cf-connecting-ip').trim();
    if (edgeIp) return edgeIp;
  }
  const ip = req?.ip;
  return typeof ip === 'string' ? ip : '';
}

/**
 * @returns the key of the caller's address for a rate-limit bucket:
 * `clientIpOf`, with an IPv6 address folded to its /64 and an IPv4-mapped
 * one turned into its IPv4 (`rateLimitAddressOf`).
 */
export function clientRateLimitAddressOf(
  req: RequestLike,
  nodeEnv?: string,
  edition: Edition = currentEdition(),
): string {
  return rateLimitAddressOf(clientIpOf(req, nodeEnv, edition));
}

/**
 * True for a request that reached the service without crossing the edge:
 * in the cloud and enterprise editions, in production, every request from
 * outside carries the edge's `cf-connecting-ip`, so one without it comes
 * from a peer inside the deployment (another service). Its address is that
 * peer's and is shared by everyone it calls for, so it must never key a
 * limit. Never true in the Community Edition or outside production.
 */
export function isInternalPeer(
  req: RequestLike,
  nodeEnv?: string,
  edition: Edition = currentEdition(),
): boolean {
  if (edition === 'community' || nodeEnv !== 'production') return false;
  return header(req, 'cf-connecting-ip').trim() === '';
}
