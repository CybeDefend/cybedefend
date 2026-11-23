import {
  COMMUNITY_DEFAULT_TRUSTED_PROXY_CIDRS,
  parseTrustProxyCidrs,
  trustedProxyCidrsFromEnv,
} from './trust-proxy';

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

describe('trustedProxyCidrsFromEnv', () => {
  it('prefers TRUSTED_PROXY_CIDRS', () => {
    expect(
      trustedProxyCidrsFromEnv(
        {
          TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 192.168.1.0/24',
          TRUST_PROXY_CIDR: '172.16.0.0/12',
        },
        'cloud',
      ),
    ).toEqual(['10.0.0.0/8', '192.168.1.0/24']);
  });

  /**
   * TRUSTED_PROXY_CIDRS is the only name read. The former variable is
   * ignored — in the cloud that trusts nobody, in the community the compose
   * network is the default.
   */
  it('ignores the former variable name', () => {
    const env = { TRUST_PROXY_CIDR: '10.0.0.0/8' } as NodeJS.ProcessEnv;
    expect(trustedProxyCidrsFromEnv(env, 'cloud')).toBe(false);
    expect(trustedProxyCidrsFromEnv(env, 'community')).toEqual([
      COMMUNITY_DEFAULT_TRUSTED_PROXY_CIDRS,
    ]);
  });

  it('defaults to the compose network in community mode', () => {
    expect(trustedProxyCidrsFromEnv({}, 'community')).toEqual([
      '172.30.240.0/24',
    ]);
  });

  it('trusts nobody in the cloud when neither is set', () => {
    expect(trustedProxyCidrsFromEnv({}, 'cloud')).toBe(false);
    expect(trustedProxyCidrsFromEnv({}, 'enterprise')).toBe(false);
  });

  it('returns false when TRUSTED_PROXY_CIDRS is set but empty', () => {
    expect(
      trustedProxyCidrsFromEnv({ TRUSTED_PROXY_CIDRS: '  ,' }, 'cloud'),
    ).toBe(false);
    expect(
      trustedProxyCidrsFromEnv({ TRUSTED_PROXY_CIDRS: '  ,' }, 'community'),
    ).toEqual([COMMUNITY_DEFAULT_TRUSTED_PROXY_CIDRS]);
  });
});
