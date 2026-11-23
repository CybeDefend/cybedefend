import { validationSchema } from './validation.schema';

// What AppModule's Joi schema requires (the BOOT_ENV of
// src/app.module.bootstrap.spec.ts). Placeholders: nothing connects.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_FILE_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_AI_SERVICE: '127.0.0.1:1',
  GRPC_URL_AGENT_SERVICE: '127.0.0.1:1',
  REDIS_URL: 'redis://127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  AI_SERVICE_URL: 'http://127.0.0.1:1',
  INGESTION_SERVICE_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
};

// ConfigModule's own options for validationSchema.
const validate = (env: Record<string, string>) =>
  validationSchema.validate(
    { ...BOOT_ENV, ...env },
    { allowUnknown: true, abortEarly: false },
  );

const MESSAGE =
  'AUTH_COOKIE_INSECURE_LOCALHOST requires APP_PUBLIC_URL on localhost, 127.0.0.1 or host.docker.internal';

describe('auth cookie environment', () => {
  it('defaults the path to /auth and keeps the cookie Secure', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    expect(value.AUTH_COOKIE_PATH).toBe('/auth');
    expect(value.AUTH_COOKIE_INSECURE_LOCALHOST).toBe(false);
  });

  it('refuses the insecure cookie off localhost', () => {
    const { error } = validate({
      AUTH_COOKIE_INSECURE_LOCALHOST: 'true',
      APP_PUBLIC_URL: 'https://appsec.acme.test',
    });
    expect(error?.message).toContain(MESSAGE);
  });

  it('refuses it without APP_PUBLIC_URL', () => {
    const { error } = validate({ AUTH_COOKIE_INSECURE_LOCALHOST: 'true' });
    expect(error?.message).toContain(MESSAGE);
  });

  // host.docker.internal: the operator's own machine as Docker Desktop and
  // OrbStack name it, the one address both the browser and the scan pods of a
  // local cluster reach (`.internal` is reserved for private use by ICANN)
  it.each([
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://host.docker.internal:8080',
  ])('accepts it on %s', (url) => {
    const { error, value } = validate({
      AUTH_COOKIE_INSECURE_LOCALHOST: 'true',
      APP_PUBLIC_URL: url,
    });
    expect(error).toBeUndefined();
    expect(value.AUTH_COOKIE_INSECURE_LOCALHOST).toBe(true);
  });

  it.each([
    'http://localhost.acme.test',
    'http://host.docker.internal.acme.test',
    'http://docker.internal:8080',
  ])('refuses a host that only looks like one of them: %s', (url) => {
    const { error } = validate({
      AUTH_COOKIE_INSECURE_LOCALHOST: 'true',
      APP_PUBLIC_URL: url,
    });
    expect(error?.message).toContain(MESSAGE);
  });

  it('accepts a configured path', () => {
    const { error, value } = validate({ AUTH_COOKIE_PATH: '/api/auth' });
    expect(error).toBeUndefined();
    expect(value.AUTH_COOKIE_PATH).toBe('/api/auth');
  });

  it('refuses a cookie path that does not start with /', () => {
    expect(validate({ AUTH_COOKIE_PATH: 'auth' }).error).toBeDefined();
    expect(
      validate({ AUTH_COOKIE_PATH: '/auth;Domain=x' }).error,
    ).toBeDefined();
  });

  it('refuses an APP_PUBLIC_URL that is not a URL', () => {
    expect(validate({ APP_PUBLIC_URL: 'not a url' }).error).toBeDefined();
  });
});
