import * as Joi from 'joi';
import { secretsValidationKeys } from '../secrets/secrets.validation';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),
  // The database engine. The Community Edition refuses mysql at boot
  // (DB_TYPE_NOT_SUPPORTED, src/core/db/typeorm-options.ts).
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),

  // The secret-manager block: optional here, enforced at boot by the
  // closed secrets source.
  ...secretsValidationKeys,

  // MUST stay a string: the chart injects "true" and every TypeORM factory
  // compares against the string 'true'. Joi.boolean() would coerce it, and
  // the comparison would then read false and silently disable TLS.
  DB_SSL_ENABLED: Joi.string().valid('true', 'false').default('false'),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  // Password of the Redis above, when it requires one (requirepass). Unset or
  // empty: no AUTH is sent. The Community Edition's start hook sets it.
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  GRPC_URL: Joi.string().default('0.0.0.0:50051'),
  // Live base-OS end-of-life lookup (non-blocking).
  ENDOFLIFE_API_BASE_URL: Joi.string()
    .uri()
    .default('https://endoflife.date/api'),
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: Joi.string().required(),
  GRPC_URL_SECURITY_SCANNING_SERVICE: Joi.string().required(),
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: Joi.string().required(),
  // The closed agent and billing clients live in the closed modules, so
  // their URLs are required only outside the Community Edition.
  GRPC_URL_AGENT_SERVICE: Joi.when('CYBEDEFEND_EDITION', {
    is: Joi.valid('community').required(),
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required(),
  }),
  GRPC_URL_BILLING_SERVICE: Joi.when('CYBEDEFEND_EDITION', {
    is: Joi.valid('community').required(),
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required(),
  }),
  // The instance's public URL, base of every dashboard link (issue tickets,
  // report deep links). Community only: the compose passes it from
  // CYBEDEFEND_PUBLIC_URL. Not .uri(): a bad value falls back to the default
  // with one warning (resolveConfiguredFrontendUrl) rather than failing the boot. The
  // cloud resolves its host through FRONTEND_URL_RESOLVER and ignores it.
  FRONTEND_URL: Joi.when('CYBEDEFEND_EDITION', {
    is: Joi.valid('community').required(),
    then: Joi.string().allow('').default('http://localhost:8080'), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.any(),
  }),
  // Scanner-call authentication (src/core/scanner-auth/scanner-auth.contract.ts).
  SCANNER_AUTH_MODE: Joi.string().valid('verify', 'enforce').default('verify'),
  SCANNER_AUTH_NAMESPACES: Joi.string().default(
    'scanners-namespace,scanners-container-namespace',
  ),
  // No default, as in security-scanning where it also turns the scanner pods'
  // token on: the verifier's default (scanner-grpc) comes from the contract.
  SCANNER_AUTH_SERVICE_ACCOUNT: Joi.string().optional(),
  SCANNER_AUTH_CLOSED_GRACE_SECONDS: Joi.number()
    .integer()
    .min(0)
    .max(3600)
    .default(120),
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
});
