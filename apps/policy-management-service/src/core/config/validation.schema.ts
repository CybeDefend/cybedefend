import * as Joi from 'joi';
import { secretsValidationKeys } from '../secrets/secrets.validation';

/**
 * Validation schema for environment variables.
 * Uses Joi for robust configuration validation at startup.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),

  // The secrets block (secrets.validation.ts).
  ...secretsValidationKeys,

  // Database configuration (PostgreSQL)
  POLICY_DB_SSL_ENABLED: Joi.boolean().default(false),

  // gRPC configuration
  GRPC_URL: Joi.string().default('0.0.0.0:50060'),

  // Queue metrics HTTP endpoint (KEDA autoscaling)
  METRICS_PORT: Joi.number().default(9095),
  QUEUE_METRICS_TOKEN: Joi.string().optional(),

  // OpenTelemetry configuration
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().optional(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  // Password of the Redis above, when it requires one (requirepass). Unset or
  // empty: no AUTH is sent. The Community Edition's start hook sets it.
  REDIS_PASSWORD: Joi.string().allow('').optional(),
});
