import {
  clientCountryOf,
  clientIpOf,
  clientUserAgentOf,
  MAX_CLIENT_USER_AGENT,
} from './client-ip';

// The cases that read the edge headers under the default edition (cloud
// when CYBEDEFEND_EDITION is unset) are tested with the cloud edition:
// the Community tree fixes the edition to community, where no edge header is
// read.
describe('clientIpOf', () => {
  it('returns the connection address Fastify resolved', () => {
    expect(clientIpOf({ ip: '203.0.113.9', headers: {} }, 'development')).toBe(
      '203.0.113.9',
    );
  });

  /**
   * The header is only trustworthy where the edge proxy rewrites it. Outside
   * production it is an ordinary request header a caller can write, so it is
   * ignored and the socket wins: the same rule RateLimitGuard applies, and
   * the reason it applies it.
   */
  it('ignores cf-connecting-ip outside production, where anyone can write it', () => {
    expect(
      clientIpOf(
        { ip: '10.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.9' } },
        'development',
      ),
    ).toBe('10.0.0.1');
  });

  it('falls back to the socket address when the header is absent or repeated', () => {
    expect(clientIpOf({ ip: '10.0.0.1', headers: {} }, 'production')).toBe(
      '10.0.0.1',
    );
    // A repeated header reaches Node as an array; only a single string is an
    // edge-written value.
    expect(
      clientIpOf(
        { ip: '10.0.0.1', headers: { 'cf-connecting-ip': ['a', 'b'] } },
        'production',
      ),
    ).toBe('10.0.0.1');
  });

  /**
   * In the Community Edition no edge header is trusted, even with
   * NODE_ENV=production (the compose sets it), because there is no
   * rewriting edge in front of a self-hosted instance — anyone could write the
   * header and rotate the rate-limit buckets.
   */
  it('ignores cf-connecting-ip in community mode, even in production', () => {
    expect(
      clientIpOf(
        { ip: '10.0.0.5', headers: { 'cf-connecting-ip': '6.6.6.6' } },
        'production',
        'community',
      ),
    ).toBe('10.0.0.5');
  });

  it('keeps the cloud rule', () => {
    expect(
      clientIpOf(
        { ip: '10.0.0.5', headers: { 'cf-connecting-ip': '6.6.6.6' } },
        'production',
        'cloud',
      ),
    ).toBe('6.6.6.6');
    expect(
      clientIpOf(
        { ip: '10.0.0.5', headers: { 'cf-connecting-ip': '6.6.6.6' } },
        'production',
        'enterprise',
      ),
    ).toBe('6.6.6.6');
  });

  it('returns an empty string rather than throwing on a request with nothing to read', () => {
    expect(clientIpOf(undefined, 'production')).toBe('');
    expect(clientIpOf({}, 'production')).toBe('');
    expect(clientIpOf({ ip: 42 }, 'production')).toBe('');
  });
});

describe('clientCountryOf', () => {
  const withCountry = (value: unknown) => ({
    ip: '10.0.0.1',
    headers: { 'cf-ipcountry': value },
  });

  /**
   * Same rule as `cf-connecting-ip`: only the edge writes the header in
   * production. Anywhere else a caller could pick its own billing country.
   */
  it('ignores cf-ipcountry outside production, where anyone can write it', () => {
    expect(clientCountryOf(withCountry('US'), 'development')).toBe('');
    expect(clientCountryOf(withCountry('US'), undefined)).toBe('');
  });

  it("refuses the edge's XX (unknown) and T1 (Tor), which are not countries", () => {
    expect(clientCountryOf(withCountry('XX'), 'production')).toBe('');
    expect(clientCountryOf(withCountry('T1'), 'production')).toBe('');
  });

  it('refuses anything that is not an ISO 3166-1 alpha-2 code', () => {
    for (const value of ['USA', 'U', '', 'ZZ', 'U$', '12']) {
      expect(clientCountryOf(withCountry(value), 'production')).toBe('');
    }
  });

  /**
   * The Community Edition has no edge resolving a country, so the
   * header is never trusted there, whatever NODE_ENV says.
   */
  it('gives no country in community mode', () => {
    expect(clientCountryOf(withCountry('US'), 'production', 'community')).toBe(
      '',
    );
    expect(clientCountryOf(withCountry('US'), 'development', 'community')).toBe(
      '',
    );
  });

  it('ignores a repeated header, and never throws on a request with nothing to read', () => {
    expect(clientCountryOf(withCountry(['US', 'FR']), 'production')).toBe('');
    expect(clientCountryOf(undefined, 'production')).toBe('');
    expect(clientCountryOf({}, 'production')).toBe('');
  });
});

describe('clientUserAgentOf', () => {
  it('returns the request user agent', () => {
    expect(
      clientUserAgentOf({ headers: { 'user-agent': 'Mozilla/5.0' } }),
    ).toBe('Mozilla/5.0');
  });

  it('caps the user agent at 512 characters, Meta’s own limit', () => {
    const long = 'a'.repeat(MAX_CLIENT_USER_AGENT + 100);
    expect(clientUserAgentOf({ headers: { 'user-agent': long } })).toHaveLength(
      MAX_CLIENT_USER_AGENT,
    );
  });

  it('returns an empty string when there is no user agent to read', () => {
    expect(clientUserAgentOf(undefined)).toBe('');
    expect(clientUserAgentOf({ headers: {} })).toBe('');
    expect(clientUserAgentOf({ headers: { 'user-agent': ['a', 'b'] } })).toBe(
      '',
    );
  });
});
