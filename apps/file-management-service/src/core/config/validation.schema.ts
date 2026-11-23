import * as Joi from 'joi';
import { secretsValidationKeys } from '../secrets/secrets.validation';
import { DEFAULT_ZIP_LIMITS } from '../../file/zip-limits.util';
import { editionEnvSchema } from '../../edition/edition-env-schema';

export const validationSchema = Joi.object({
  GRPC_URL: Joi.string().default('0.0.0.0:50051'),
  GRPC_URL_SECURITY_SCANNING_SERVICE: Joi.string().required(),
  NODE_ENV: Joi.string().valid('development', 'production'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),

  // The secrets block (secrets.validation.ts).
  ...secretsValidationKeys,

  // The object store: 's3', any S3-compatible store (MinIO, SeaweedFS, AWS
  // S3…). An edition may register other stores (editionEnvSchema below).
  STORAGE_PROVIDER: Joi.string().valid('s3').default('s3'),

  // S3-compatible storage configuration (required when STORAGE_PROVIDER = 's3')
  S3_BUCKET_NAME: Joi.when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  S3_ENDPOINT: Joi.when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  AWS_REGION: Joi.when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.string().required(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.optional(),
  }),
  // Browser/agent-reachable origin for the signed URLs handed to them;
  // when unset, S3_ENDPOINT is used for every signed URL.
  S3_PUBLIC_ENDPOINT: Joi.string().uri().optional(),
  // Size limits of an uploaded full-scan archive, in bytes (entries for
  // FULL_SCAN_MAX_ENTRIES): compressed object, uncompressed total, any single
  // entry, entry count. Checked from the central directory before filtering
  // and against the bytes really inflated while filtering.
  FULL_SCAN_MAX_ARCHIVE_BYTES: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_ZIP_LIMITS.maxArchiveBytes),
  FULL_SCAN_MAX_UNCOMPRESSED_BYTES: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_ZIP_LIMITS.maxTotalBytes),
  FULL_SCAN_MAX_ENTRY_BYTES: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_ZIP_LIMITS.maxEntryBytes),
  FULL_SCAN_MAX_ENTRIES: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_ZIP_LIMITS.maxEntries),
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
  // MUST stay a string: the chart injects "true" and every TypeORM factory
  // compares against the string 'true'. Joi.boolean() would coerce it and
  // silently disable TLS on every MySQL connection.
  DB_SSL_ENABLED: Joi.string().valid('true', 'false').default('false'),

  // The edition's own keys, last: a key it registers again replaces the core one.
  ...editionEnvSchema(),
});
