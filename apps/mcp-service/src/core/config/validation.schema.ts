import * as Joi from 'joi';

import { editionEnvSchema } from '../../edition/edition-env-schema';

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
  RATE_LIMIT_MAX: Joi.number().integer().min(1).max(100_000).default(120),
  RATE_LIMIT_WINDOW: Joi.string().default('1 minute'),

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
