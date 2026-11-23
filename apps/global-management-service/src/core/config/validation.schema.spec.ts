import { validationSchema } from './validation.schema';

// The minimal environment the whole schema accepts (same keys as the boot
// specs of src/edition): the secrets block, the gRPC URLs, Permify, the
// frontend and OTEL disabled.
const MINIMAL_ENV: Record<string, string> = {
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
};

// Nest validates process.env with allowUnknown (ConfigModule's default):
// EMAIL_HOST is a secret read through SecretsService, not a key of this
// schema, so the EMAIL_FROM rule reaches it only as an allowed unknown peer.
// A setup token of exactly the minimum length (32), built at run time so no
// secret scanner takes the fixture for a real token.
const SETUP_TOKEN_32 = 'a'.repeat(32);

const validate = (env: Record<string, string>) =>
  validationSchema.validate(env, { allowUnknown: true });

describe('EMAIL_FROM / EMAIL_SECURE', () => {
  // A valid setup token, so the community-only CYBEDEFEND_SETUP_TOKEN rule
  // does not interfere with these EMAIL_FROM assertions.
  const COMMUNITY_ENV: Record<string, string> = {
    CYBEDEFEND_EDITION: 'community',
    CYBEDEFEND_SETUP_TOKEN: SETUP_TOKEN_32,
  };

  it('requires EMAIL_FROM in community when SMTP is configured', () => {
    const { error } = validate({
      ...MINIMAL_ENV,
      ...COMMUNITY_ENV,
      EMAIL_HOST: 'smtp.test',
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('EMAIL_FROM');
  });

  it('gives EMAIL_FROM no default in community', () => {
    const { error, value } = validate({
      ...MINIMAL_ENV,
      ...COMMUNITY_ENV,
    });
    expect(error).toBeUndefined();
    expect(value.EMAIL_FROM).toBeUndefined();
  });

  it('keeps the cloud default sender', () => {
    const { error, value } = validate(MINIMAL_ENV);
    expect(error).toBeUndefined();
    expect(value.EMAIL_FROM).toBe('"CybeDefend" <no-reply@cybedefend.com>');
  });

  it('accepts EMAIL_FROM in community when SMTP is configured', () => {
    const { error, value } = validate({
      ...MINIMAL_ENV,
      ...COMMUNITY_ENV,
      EMAIL_HOST: 'smtp.test',
      EMAIL_FROM: '"Acme" <sec@acme.test>',
    });
    expect(error).toBeUndefined();
    expect(value.EMAIL_FROM).toBe('"Acme" <sec@acme.test>');
  });

  it('defaults EMAIL_SECURE to true and accepts an explicit false', () => {
    expect(validate(MINIMAL_ENV).value.EMAIL_SECURE).toBe('true');
    expect(
      validate({ ...MINIMAL_ENV, EMAIL_SECURE: 'false' }).value.EMAIL_SECURE,
    ).toBe('false');
    expect(
      validate({ ...MINIMAL_ENV, EMAIL_SECURE: 'yes' }).error,
    ).toBeDefined();
  });
});

describe('CYBEDEFEND_SETUP_TOKEN / AUTH_SIGNUP_MODE', () => {
  it('fails validation in community without CYBEDEFEND_SETUP_TOKEN', () => {
    const { error } = validate({
      ...MINIMAL_ENV,
      CYBEDEFEND_EDITION: 'community',
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('CYBEDEFEND_SETUP_TOKEN');
  });

  it('passes the cloud default without CYBEDEFEND_SETUP_TOKEN', () => {
    const { error, value } = validate(MINIMAL_ENV);
    expect(error).toBeUndefined();
    expect(value.CYBEDEFEND_SETUP_TOKEN).toBeUndefined();
  });

  it('accepts a setup token of at least 32 characters in community', () => {
    const { error } = validate({
      ...MINIMAL_ENV,
      CYBEDEFEND_EDITION: 'community',
      CYBEDEFEND_SETUP_TOKEN: SETUP_TOKEN_32,
    });
    expect(error).toBeUndefined();
  });

  it('refuses a shorter setup token in community', () => {
    const { error } = validate({
      ...MINIMAL_ENV,
      CYBEDEFEND_EDITION: 'community',
      CYBEDEFEND_SETUP_TOKEN: 'short',
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('CYBEDEFEND_SETUP_TOKEN');
  });

  it('refuses a setup token one character short of 32 in community', () => {
    const { error } = validate({
      ...MINIMAL_ENV,
      CYBEDEFEND_EDITION: 'community',
      CYBEDEFEND_SETUP_TOKEN: 'a'.repeat(31),
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('CYBEDEFEND_SETUP_TOKEN');
  });

  it('defaults AUTH_SIGNUP_MODE to invite_only, accepts open and refuses anything else', () => {
    expect(validate(MINIMAL_ENV).value.AUTH_SIGNUP_MODE).toBe('invite_only');
    expect(
      validate({ ...MINIMAL_ENV, AUTH_SIGNUP_MODE: 'open' }).value
        .AUTH_SIGNUP_MODE,
    ).toBe('open');
    expect(
      validate({ ...MINIMAL_ENV, AUTH_SIGNUP_MODE: 'whatever' }).error,
    ).toBeDefined();
  });
});
