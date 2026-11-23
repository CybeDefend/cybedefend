import { parseTrustProxyCidrs } from './trust-proxy';

describe('parseTrustProxyCidrs', () => {
  it('returns false when TRUST_PROXY_CIDR is unset (undefined)', () => {
    expect(parseTrustProxyCidrs(undefined)).toBe(false);
  });

  it('returns false when TRUST_PROXY_CIDR is the empty string', () => {
    expect(parseTrustProxyCidrs('')).toBe(false);
  });

  it('returns false when TRUST_PROXY_CIDR contains only whitespace and commas', () => {
    expect(parseTrustProxyCidrs('  ,   ,')).toBe(false);
  });

  it('parses a single CIDR', () => {
    expect(parseTrustProxyCidrs('127.0.0.1/32')).toEqual(['127.0.0.1/32']);
  });

  it('parses a comma-separated list of CIDRs', () => {
    expect(parseTrustProxyCidrs('10.0.0.0/8,192.168.1.0/24')).toEqual([
      '10.0.0.0/8',
      '192.168.1.0/24',
    ]);
  });

  it('trims surrounding whitespace around each entry', () => {
    expect(parseTrustProxyCidrs('  10.0.0.0/8 ,  192.168.1.0/24  ')).toEqual([
      '10.0.0.0/8',
      '192.168.1.0/24',
    ]);
  });

  it('drops empty entries so a trailing comma is harmless', () => {
    expect(parseTrustProxyCidrs('127.0.0.1/32,')).toEqual(['127.0.0.1/32']);
  });
});
