import { validationSchema } from './validation.schema';

/**
 * Boot-time env validation.
 *
 * Redis is now a real connection dependency of this service (shared
 * `REDIS_CLIENT` provider), so per the repo convention every connection-level
 * var must be declared here: boot fails fast with a readable Joi message
 * instead of dying later inside ioredis.
 */
describe('validationSchema — REDIS_URL', () => {
  /**
   * Smallest env that satisfies the unrelated `.required()` keys, so each
   * assertion below is only ever about REDIS_URL.
   */
  function baseEnv(): Record<string, string> {
    return {
      GRPC_URL_SECURITY_SCANNING_SERVICE: 'localhost:50053',
      ALLOWED_SCAN_IPS: '127.0.0.1',
      GATEWAY_URL: 'http://localhost:3000',
      OTEL_DISABLED: 'true',
    };
  }

  it('boots without any CRM variable', () => {
    // The CRM sync keys belong to the closed edition: the core schema must
    // accept an environment that has none of them.
    const { error } = validationSchema.validate(baseEnv());

    expect(error).toBeUndefined();
  });

  it('defaults to the conventional local Redis when REDIS_URL is absent', () => {
    const { error, value } = validationSchema.validate(baseEnv());

    expect(error).toBeUndefined();
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('keeps an explicitly configured REDIS_URL', () => {
    const { error, value } = validationSchema.validate({
      ...baseEnv(),
      REDIS_URL: 'rediss://user:pass@redis.internal:6380',
    });

    expect(error).toBeUndefined();
    expect(value.REDIS_URL).toBe('rediss://user:pass@redis.internal:6380');
  });

  it('rejects a REDIS_URL that is not a URI', () => {
    const { error } = validationSchema.validate({
      ...baseEnv(),
      REDIS_URL: 'not a redis url',
    });

    // Must fail on the URI rule itself, not on Joi's "is not allowed"
    // unknown-key error — that would mean the key is still unregistered.
    expect(error?.message).toBe('"REDIS_URL" must be a valid uri');
  });
});

describe('validationSchema — APP_PUBLIC_URL and ALLOWED_SCAN_IPS', () => {
  function baseEnv(): Record<string, string> {
    return {
      GRPC_URL_SECURITY_SCANNING_SERVICE: 'localhost:50053',
      ALLOWED_SCAN_IPS: '127.0.0.1',
      GATEWAY_URL: 'http://localhost:3000',
      OTEL_DISABLED: 'true',
    };
  }

  it('accepts APP_PUBLIC_URL', () => {
    const { error, value } = validationSchema.validate({
      ...baseEnv(),
      APP_PUBLIC_URL: 'https://appsec.acme.test',
    });

    expect(error).toBeUndefined();
    expect(value.APP_PUBLIC_URL).toBe('https://appsec.acme.test');
  });

  it('rejects an APP_PUBLIC_URL that is not a URI', () => {
    const { error } = validationSchema.validate({
      ...baseEnv(),
      APP_PUBLIC_URL: 'not a url',
    });

    expect(error?.message).toBe('"APP_PUBLIC_URL" must be a valid uri');
  });

  it('boots without ALLOWED_SCAN_IPS', () => {
    // The key is read nowhere; the Community compose sets no
    // placeholder for it.
    const env = baseEnv();
    delete env.ALLOWED_SCAN_IPS;

    const { error } = validationSchema.validate(env);

    expect(error).toBeUndefined();
  });
});

describe('validationSchema — GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED', () => {
  const env = (extra: Record<string, string> = {}) => ({
    GRPC_URL_SECURITY_SCANNING_SERVICE: 'localhost:50053',
    GATEWAY_URL: 'http://localhost:3000',
    OTEL_DISABLED: 'true',
    ...extra,
  });

  it('is off by default: a hook gets its own token, the OAuth secret is no token', () => {
    const { error, value } = validationSchema.validate(env(), {
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
    expect(value.GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED).toBe(false);
  });

  it('reads true and false', () => {
    for (const [raw, parsed] of [
      ['true', true],
      ['false', false],
    ] as const) {
      const { error, value } = validationSchema.validate(
        env({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: raw }),
        { allowUnknown: true },
      );
      expect(error).toBeUndefined();
      expect(value.GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED).toBe(parsed);
    }
  });

  it('refuses anything else, rather than guessing', () => {
    const { error } = validationSchema.validate(
      env({ GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: 'yes please' }),
      { allowUnknown: true },
    );
    expect(error?.message).toContain('GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED');
  });
});
