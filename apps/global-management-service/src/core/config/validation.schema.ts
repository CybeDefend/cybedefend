import * as Joi from 'joi';
import { editionEnvSchema } from '../../edition/edition-env-schema';
import { secretsValidationKeys } from '../secrets/secrets.validation';

/**
 * The keys every edition reads. The closed ones (EE_ENV_SCHEMA of
 * src/edition/ee-modules.ts) join them below, outside the Community Edition,
 * through editionEnvSchema().
 */
const CORE_ENV_SCHEMA = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),

  // The secrets block (secrets.validation.ts).
  ...secretsValidationKeys,

  // MUST stay a string: the chart injects "true" and every TypeORM factory
  // compares against the string 'true'. Joi.boolean() would coerce it and
  // silently disable TLS on every MySQL connection.
  DB_SSL_ENABLED: Joi.string().valid('true', 'false').default('false'),
  // The database engine. The Community Edition refuses mysql at boot
  // (assertDialectAllowed in src/core/db/typeorm-options.ts).
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),
  GRPC_URL: Joi.string().default('0.0.0.0:50051'),
  GRPC_URL_SECURITY_SCANNING_SERVICE: Joi.string().required(),
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: Joi.string().required(),
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: Joi.string().required(),
  GRPC_URL_BILLING_SERVICE: Joi.string().default('localhost:50059'),
  // The data purge's DataPurgeService; the chart sets both.
  GRPC_URL_FILE_MANAGEMENT_SERVICE: Joi.string().default('localhost:50051'),
  GRPC_URL_POLICY_MANAGEMENT_SERVICE: Joi.string().default('localhost:50060'),
  PERMIFY_ENDPOINT: Joi.string().required(),
  // Permify's preshared key (src/modules/permify/permify-client.ts): the
  // variable, or a file holding it (the Community Edition), or the secret.
  PERMIFY_PRESHARED_KEY: Joi.string().allow('').optional(),
  PERMIFY_PRESHARED_KEY_FILE: Joi.string().allow('').optional(),
  PERMIFY_SCHEMA_VERSION: Joi.string().optional(),
  FRONTEND_URL: Joi.string().required(),
  // The mail sender. The cloud keeps today's default; the Community
  // Edition has no default and must set one whenever SMTP is configured
  // (EMAIL_HOST is a secret, read as an allowed unknown peer here).
  EMAIL_FROM: Joi.when('CYBEDEFEND_EDITION', {
    is: 'community',
    then: Joi.when('EMAIL_HOST', {
      is: Joi.string().min(1).required(),
      then: Joi.string().required(),
      otherwise: Joi.string().allow('').optional(),
    }),
    otherwise: Joi.string().default('"CybeDefend" <no-reply@cybedefend.com>'),
  }),
  // 'false' selects STARTTLS instead of implicit TLS. Must stay a
  // string like DB_SSL_ENABLED above.
  EMAIL_SECURE: Joi.string().valid('true', 'false').default('true'),
  // The instance setup token. Required with at least 32 characters
  // in the Community Edition (the deploy generates 43: 32 random bytes,
  // base64url), optional in the cloud.
  CYBEDEFEND_SETUP_TOKEN: Joi.when('CYBEDEFEND_EDITION', {
    is: 'community',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().min(32).optional(),
  }),
  // Open sign-up behind the setup.
  AUTH_SIGNUP_MODE: Joi.string()
    .valid('invite_only', 'open')
    .default('invite_only'),
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
});

// The closed keys join the core schema in every edition but community. Joi
// reads keys({}) as « allow none », not as a no-op merge, so the empty map a
// community process produces must not be passed.
const editionKeys = editionEnvSchema();
export const validationSchema = Object.keys(editionKeys).length
  ? CORE_ENV_SCHEMA.keys(editionKeys)
  : CORE_ENV_SCHEMA;
