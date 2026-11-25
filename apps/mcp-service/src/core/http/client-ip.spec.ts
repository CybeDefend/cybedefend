import Fastify from 'fastify';

import { parseTrustProxyCidrs } from '../trust-proxy/trust-proxy';
import {
  clientIpOf,
  clientRateLimitAddressOf,
  isInternalPeer,
} from './client-ip';

describe('isInternalPeer', () => {
  const edge = { ip: '10.0.0.9', headers: { 'cf-connecting-ip': '1.2.3.4' } };
  const inside = { ip: '10.0.5.5', headers: {} };

  it('is a request without the edge header behind the edge of a production deployment', () => {
    expect(isInternalPeer(inside, 'production', 'cloud')).toBe(true);
    expect(isInternalPeer(edge, 'production', 'cloud')).toBe(false);
  });

  it('is never true in the Community Edition or outside production', () => {
    expect(isInternalPeer(inside, 'production', 'community')).toBe(false);
    expect(isInternalPeer(inside, 'development', 'cloud')).toBe(false);
  });
});

/**
 * The caller's address, read the way the gateway reads it: the edge's
 * `cf-connecting-ip` only where an edge rewrites it (never in the Community
 * Edition), else Fastify's `req.ip`, which honours `X-Forwarded-For` only
 * from the proxies `TRUST_PROXY_CIDR` names.
 */
describe('clientIpOf', () => {
  const req = {
    ip: '198.51.100.9',
    headers: { 'cf-connecting-ip': '1.2.3.4' },
  };

  it('never reads cf-connecting-ip in the Community Edition', () => {
    expect(clientIpOf(req, 'production', 'community')).toBe('198.51.100.9');
  });

  it('reads cf-connecting-ip behind the edge of a production deployment', () => {
    expect(clientIpOf(req, 'production', 'cloud')).toBe('1.2.3.4');
  });

  it('ignores cf-connecting-ip outside production', () => {
    expect(clientIpOf(req, 'development', 'cloud')).toBe('198.51.100.9');
  });

  it('ignores a repeated cf-connecting-ip header', () => {
    expect(
      clientIpOf(
        { ip: '198.51.100.9', headers: { 'cf-connecting-ip': ['1', '2'] } },
        'production',
        'cloud',
      ),
    ).toBe('198.51.100.9');
  });

  it('answers an empty string when there is nothing to read', () => {
    expect(clientIpOf(undefined, 'production', 'community')).toBe('');
    expect(clientIpOf({}, 'production', 'community')).toBe('');
  });

  it('folds the address into its rate-limit key', () => {
    expect(
      clientRateLimitAddressOf(
        { ip: '2001:db8:1:2::9', headers: {} },
        'production',
        'community',
      ),
    ).toBe('2001:db8:1:2::/64');
  });
});

describe('clientIpOf on a real Fastify request', () => {
  async function addressSeen(
    trustProxyCidr: string | undefined,
    remoteAddress: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const app = Fastify({ trustProxy: parseTrustProxyCidrs(trustProxyCidr) });
    app.get('/', async (req) => ({
      key: clientRateLimitAddressOf(req, 'production', 'community'),
    }));
    const res = await app.inject({ url: '/', remoteAddress, headers });
    await app.close();
    return (res.json() as { key: string }).key;
  }

  it('ignores a spoofed X-Forwarded-For from a peer that is not a trusted proxy', async () => {
    await expect(
      addressSeen('10.0.0.0/8', '203.0.113.7', {
        'x-forwarded-for': '198.51.100.1',
      }),
    ).resolves.toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    await expect(
      addressSeen(undefined, '10.1.2.3', { 'x-forwarded-for': '198.51.100.1' }),
    ).resolves.toBe('10.1.2.3');
  });

  it('reads X-Forwarded-For from a trusted proxy', async () => {
    await expect(
      addressSeen('10.0.0.0/8', '10.1.2.3', {
        'x-forwarded-for': '198.51.100.1',
      }),
    ).resolves.toBe('198.51.100.1');
  });
});
