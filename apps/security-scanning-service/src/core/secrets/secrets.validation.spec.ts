import * as fs from 'node:fs';
import * as path from 'node:path';
import { validationSchema } from '../config/validation.schema';
import { EE_SECRETS_ENV_SCHEMA } from '../../edition/ee-secrets';
import { secretsValidationKeys } from './secrets.validation';

// The required keys of security-scanning's schema.
const MINIMAL_ENV: Record<string, string> = {
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_FILE_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_AGENT_SERVICE: '127.0.0.1:1',
  KUBERNETES_ENV: 'kubeconfig',
  SCAN_IMAGE_REGISTRY: 'registry.invalid',
  ALLOWED_SCAN_IPS: '127.0.0.1',
  GCR_NAME: 'gcr.invalid',
  GCP_BUCKET_NAME: 'bucket',
  OTEL_DISABLED: 'true',
};

function validate(env: Record<string, string>): {
  error?: { message: string };
  value: Record<string, unknown>;
} {
  return validationSchema.validate(
    { ...MINIMAL_ENV, ...env },
    { allowUnknown: true, abortEarly: false },
  ) as { error?: { message: string }; value: Record<string, unknown> };
}

describe('secrets validation keys', () => {
  const savedEnv = process.env;

  afterEach(() => {
    process.env = savedEnv;
  });

  it('accepts an environment that sets no secret-store variable', () => {
    const { error } = validate({});
    expect(error).toBeUndefined();
  });

  it('declares only the master key besides the edition secrets keys', () => {
    expect(Object.keys(secretsValidationKeys).sort()).toEqual(
      ['CYBEDEFEND_SECRET_KEY', ...Object.keys(EE_SECRETS_ENV_SCHEMA)].sort(),
    );
  });

  it('registers no cloud secrets key in the Community Edition', async () => {
    process.env = { ...savedEnv, CYBEDEFEND_EDITION: 'community' };
    let keys: string[] = [];
    await jest.isolateModulesAsync(async () => {
      const mod = await import('./secrets.validation');
      keys = Object.keys(mod.secretsValidationKeys);
    });
    expect(keys).toEqual(['CYBEDEFEND_SECRET_KEY']);
  });

  it('refuses a malformed CYBEDEFEND_SECRET_KEY, naming it', () => {
    const { error } = validate({ CYBEDEFEND_SECRET_KEY: 'short' });
    expect(error).toBeDefined();
    expect(error?.message).toContain('CYBEDEFEND_SECRET_KEY');
    expect(validate({ CYBEDEFEND_SECRET_KEY: '' }).error).toBeUndefined();
    expect(
      validate({ CYBEDEFEND_SECRET_KEY: 'ab'.repeat(32) }).error,
    ).toBeUndefined();
  });

  it('names no environment value of a deployment', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'secrets.validation.ts'),
      'utf8',
    );
    expect(source).not.toContain('.valid(');
    expect(source).not.toContain('prod-');
  });
});
