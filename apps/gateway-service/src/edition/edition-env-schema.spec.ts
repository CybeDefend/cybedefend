import type { ObjectSchema } from 'joi';
import { EE_ENV_SCHEMA } from './ee-modules';
import { EE_SECRETS_ENV_SCHEMA } from './ee-secrets';

// doMock factories may only capture variables prefixed with « mock ».
const mockEeEnvSchema = EE_ENV_SCHEMA;

/**
 * validationSchema is CORE_ENV_SCHEMA.keys(editionEnvSchema()) and both sides
 * are evaluated when the module is loaded, so each case reloads
 * validation.schema in an isolated registry with CYBEDEFEND_EDITION set
 * first (a value set only in .env is ignored; the compose sets the
 * variable in environment:).
 */

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

// The keys only the closed (ee/) code reads; the cloud edition's
// CLOUD_ENV_SCHEMA (re-exported as EE_ENV_SCHEMA) is the authority for the
// list.
const CLOUD_KEYS: readonly string[] = [
  'GRPC_URL_AI_SERVICE',
  'GRPC_URL_AGENT_SERVICE',
  'LEAD_RATE_LIMIT_IP_10M',
  'LEAD_RATE_LIMIT_IP_24H',
  'LEAD_RATE_LIMIT_EMAIL_24H',
  'LEAD_RATE_LIMIT_GLOBAL_1H',
  'TURNSTILE_ALLOWED_HOSTNAMES',
  'SSO_CONNECTORS_RATE_LIMIT_IP_1M',
  'AI_SERVICE_URL',
  'INGESTION_SERVICE_URL',
  'LOGTO_CLI_APP_ID',
  'LOGTO_VSCODE_APP_ID',
  'LOGTO_INTELLIJ_APP_ID',
];

// BOOT_ENV without the cloud-only keys: all a Community Edition pod needs.
const CORE_ENV: Record<string, string> = Object.fromEntries(
  Object.entries(BOOT_ENV).filter(([key]) => !CLOUD_KEYS.includes(key)),
);

async function loadValidationSchema(
  edition: string | undefined,
): Promise<ObjectSchema> {
  if (edition === undefined) {
    delete process.env.CYBEDEFEND_EDITION;
  } else {
    process.env.CYBEDEFEND_EDITION = edition;
  }
  let mod: typeof import('../core/config/validation.schema') | undefined;
  await jest.isolateModulesAsync(async () => {
    // Keep the isolated load light: the ee module tree is not what is under
    // test here, only that validation.schema registers EE_ENV_SCHEMA.
    jest.doMock('./ee-modules', () => ({ EE_ENV_SCHEMA: mockEeEnvSchema }));
    mod = await import('../core/config/validation.schema');
  });
  return mod!.validationSchema;
}

// The cloud cases (the closed keys still required, EE_ENV_SCHEMA holding
// exactly them) are tested with the cloud edition: the
// Community tree has an empty EE_ENV_SCHEMA.
describe('validationSchema per edition', () => {
  const KEY = 'CYBEDEFEND_EDITION';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = saved;
    }
  });

  it('community needs no agent or ingestion value', async () => {
    const schema = await loadValidationSchema('community');
    expect(schema.validate(CORE_ENV).error).toBeUndefined();
  }, 120_000);

  it('EE_ENV_SCHEMA holds no secrets key (that block is EE_SECRETS_ENV_SCHEMA)', () => {
    expect(
      Object.keys(EE_ENV_SCHEMA).filter((key) => key in EE_SECRETS_ENV_SCHEMA),
    ).toEqual([]);
  });
});
