import * as Joi from 'joi';

import { editionEnvSchema } from '../../edition/edition-env-schema';
import { invalidAllowedOrigins } from '../http/origin-policy';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),

  PORT: Joi.number().default(3010),
  FRONTEND_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().uri().optional(),
  }),
  PUBLIC_URL: Joi.string().uri().required(),

  // The CybeDefend API (gateway) the tools call, forwarding the caller's
  // bearer — required in every edition.
  CYBEDEFEND_API_RESOURCE: Joi.string().uri().required(),

  // gRPC listener for internal RPCs (currently only the Gateway's
  // SecretRotation fan-out). Defaults to :50061 to avoid collisions with
  // the ports already claimed by the other services (50051–50060).
  GRPC_URL: Joi.string().default('0.0.0.0:50061'),

  // Rate limiting (public entry — see src/main.ts)
  // RATE_LIMIT_MAX: per authenticated person; RATE_LIMIT_ANONYMOUS_MAX: per
  // address, for requests without a bearer (see core/http/request-guards.ts).
  RATE_LIMIT_MAX: Joi.number().integer().min(1).max(100_000).default(120),
  RATE_LIMIT_ANONYMOUS_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100_000)
    .default(60),
  RATE_LIMIT_WINDOW: Joi.string().default('1 minute'),

  // Browser origins allowed to call the service (comma-separated http(s)
  // origins, or `*`). A malformed entry fails the boot rather than being
  // dropped. Unset: the instance's own PUBLIC_URL only in the Community
  // Edition, any origin elsewhere (see core/http/origin-policy.ts).
  MCP_ALLOWED_ORIGINS: Joi.string()
    .allow('')
    .optional()
    .custom((value: string) => {
      const bad = invalidAllowedOrigins(value);
      if (bad.length > 0) {
        throw new Error(
          `entries that are not an http(s) origin: ${bad.join(', ')}`,
        );
      }
      return value;
    }),

  // Redis session store — absent = in-memory fallback (see mcp.module.ts).
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),

  // OTEL
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(),
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
  OTEL_APP_ENV: Joi.string().default('development'),

  ...editionEnvSchema(),
});
