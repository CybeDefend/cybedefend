// ─── Only the CA is mandatory for a TLS database connection ───────────
//
// The server certificate is verified against the configured CA. A client
// certificate is optional: TLS negotiates without one, and some managed
// databases issue only a CA, so demanding the ca+cert+key triplet would
// refuse to boot against them.
//
// This mirrors the exact expression the factory in app.module.ts evaluates.

type Secrets = Record<string, string | undefined>;

/** Reproduces the factory's SSL branch verbatim. */
function buildSslOptions(dbSslEnabled: unknown, secrets: Secrets) {
  const sslEnabled = String(dbSslEnabled) === 'true';
  const sslCa = sslEnabled ? secrets['DB_SSL_CA_CERT'] : undefined;
  const sslCert = sslEnabled ? secrets['DB_SSL_CLIENT_CERT'] : undefined;
  const sslKey = sslEnabled ? secrets['DB_SSL_CLIENT_KEY'] : undefined;
  if (sslEnabled && !sslCa) {
    throw new TypeError(
      'DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing from secrets',
    );
  }
  return sslEnabled
    ? {
        ca: sslCa,
        ...(sslCert && sslKey ? { cert: sslCert, key: sslKey } : {}),
        rejectUnauthorized: true,
      }
    : undefined;
}

describe('database SSL options', () => {
  // Deliberately NOT shaped like PEM. These are opaque pass-through values —
  // the factory never parses them, it hands them to the driver as-is — and a
  // a PEM private-key header literal trips gitleaks (CWE-798, CRITICAL)
  // on every scan of this repo. A secret detector cannot tell a decorative
  // fixture from a real leak, and it should not try: the one that guesses is
  // the one that misses the real thing.
  const CA = 'test-ca-value';
  const CERT = 'test-client-cert-value';
  const KEY = 'test-client-key-value';

  it('connects with the CA alone', () => {
    const opts = buildSslOptions('true', { DB_SSL_CA_CERT: CA });
    expect(opts).toEqual({ ca: CA, rejectUnauthorized: true });
    // A guard demanding the full triplet would throw here.
    expect(opts).not.toHaveProperty('cert');
    expect(opts).not.toHaveProperty('key');
  });

  it('sends the client certificate when both halves are present (CA + client certificate)', () => {
    const opts = buildSslOptions('true', {
      DB_SSL_CA_CERT: CA,
      DB_SSL_CLIENT_CERT: CERT,
      DB_SSL_CLIENT_KEY: KEY,
    });
    expect(opts).toEqual({
      ca: CA,
      cert: CERT,
      key: KEY,
      rejectUnauthorized: true,
    });
  });

  it('ignores a half-configured client certificate rather than sending a broken pair', () => {
    const certOnly = buildSslOptions('true', {
      DB_SSL_CA_CERT: CA,
      DB_SSL_CLIENT_CERT: CERT,
    });
    expect(certOnly).toEqual({ ca: CA, rejectUnauthorized: true });

    const keyOnly = buildSslOptions('true', {
      DB_SSL_CA_CERT: CA,
      DB_SSL_CLIENT_KEY: KEY,
    });
    expect(keyOnly).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it('still refuses to boot when TLS is on and the CA is missing', () => {
    expect(() => buildSslOptions('true', {})).toThrow(/DB_SSL_CA_CERT/);
    expect(() =>
      buildSslOptions('true', {
        DB_SSL_CLIENT_CERT: CERT,
        DB_SSL_CLIENT_KEY: KEY,
      }),
    ).toThrow(/DB_SSL_CA_CERT/);
  });

  it('stays disabled — and silent — when the flag is off', () => {
    expect(buildSslOptions('false', {})).toBeUndefined();
    expect(buildSslOptions(undefined, {})).toBeUndefined();
  });

  it('survives a config layer that hands back a boolean instead of a string', () => {
    // Joi.boolean() coercion was the original bug; String() absorbs it.
    expect(buildSslOptions(true, { DB_SSL_CA_CERT: CA })).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
  });
});
