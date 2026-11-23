import * as Joi from 'joi';
import { secretsValidationKeys } from '../secrets/secrets.validation';

export const validationSchema = Joi.object({
  // The secret-manager block: optional here, enforced at boot by the closed
  // edition's secrets source.
  ...secretsValidationKeys,

  // MUST stay a string: the chart injects "true" and every TypeORM factory
  // compares against the string 'true'. Joi.boolean() would coerce it and
  // silently disable TLS on every MySQL connection.
  DB_SSL_ENABLED: Joi.string().valid('true', 'false').default('false'),
  // Shared ioredis connection (core/redis/redis.module.ts) — a real
  // connection-level dependency, hence registered here so a malformed value
  // fails boot with a readable Joi message instead of surfacing later as an
  // opaque ioredis connect error. `.default()` rather than `.required()`:
  // every deployment already sets REDIS_URL through the Helm chart, and
  // defaulting to the docker-compose value keeps local dev — and any env that
  // predates this registration — booting unchanged.
  REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),
  // Password of the Redis above, when it requires one (requirepass). Unset or
  // empty: no AUTH is sent. The Community Edition's start hook sets it.
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),
  GRPC_URL: Joi.string().default('0.0.0.0:50051'),
  GRPC_URL_SECURITY_SCANNING_SERVICE: Joi.string().required(),
  GRPC_URL_BILLING_SERVICE: Joi.string().default('localhost:50059'),
  // Read nowhere; the Community compose sets no placeholder for it.
  ALLOWED_SCAN_IPS: Joi.string().optional(),
  // The Community Edition's public app URL (the cloud uses
  // FRONTEND_URL, which stays unregistered here as before).
  APP_PUBLIC_URL: Joi.string().uri().optional(),
  GATEWAY_URL: Joi.string().required(),
  GITLAB_API_URL: Joi.string().uri().default('https://gitlab.com/api/v4'),
  // Accept the token of the former scheme (the OAuth application secret) on
  // the GitLab hooks not yet given their own token, until the
  // `gitlab-webhook-token-migration` task has run. Off by default: a new
  // installation registers every hook with its own token.
  GITLAB_WEBHOOK_LEGACY_TOKEN_ACCEPTED: Joi.boolean().default(false),
  // GitHub App OAuth client credentials — used to exchange the install-callback
  // `code` for a user-to-server token and verify installation ownership.
  // Like the other GitHub App secrets (GITHUB_APP_ID, GITHUB_PRIVATE_KEY) they
  // are read via `getSecretOrEnv`: from `.env` in dev and from the secrets
  // source otherwise, where they are NOT present in `process.env`. They are
  // therefore declared `.optional()` so boot does not fail without them;
  // runtime presence is enforced by the OAuth exchange itself, which fails
  // closed if they are unset.
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
  // The CRM sync keys are not part of the core schema: the Community Edition
  // runs no CRM worker, and the closed edition validates them itself.
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
});
