import * as Joi from 'joi';
import { editionEnvSchema } from '../../edition/edition-env-schema';
import { secretsValidationKeys } from '../secrets/secrets.validation';

/**
 * The keys every edition validates. The keys only the closed (ee/) code
 * reads — agent and AI gRPC clients, lead and SSO rate limits, Logto app
 * IDs, the ingestion URL — live in the cloud edition's CLOUD_ENV_SCHEMA
 * and are registered only outside the
 * Community Edition, through editionEnvSchema().
 */
/**
 * Hosts on which a browser may be served the refresh cookie without Secure:
 * the operator's own machine. `host.docker.internal` is how Docker Desktop and
 * OrbStack name it, and the one address that both the browser and the scan
 * pods of a local cluster reach (`localhost` in a pod is the pod). It is never
 * a public name: ICANN reserves `.internal` for private use.
 */
const INSECURE_COOKIE_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  'host.docker.internal',
]);

/**
 * `AUTH_COOKIE_INSECURE_LOCALHOST=true` drops `Secure` from the refresh
 * cookie, which is acceptable only for an evaluation on the operator's own
 * machine. Anywhere else the gateway refuses to boot.
 */
export function insecureCookieOnLocalhostOnly(
  env: Record<string, unknown>,
): Record<string, unknown> {
  if (env.AUTH_COOKIE_INSECURE_LOCALHOST !== true) return env;
  let host = '';
  try {
    host = new URL(String(env.APP_PUBLIC_URL ?? '')).hostname;
  } catch {
    host = '';
  }
  if (!INSECURE_COOKIE_HOSTS.has(host)) {
    throw new Error(
      'AUTH_COOKIE_INSECURE_LOCALHOST requires APP_PUBLIC_URL on localhost, 127.0.0.1 or host.docker.internal',
    );
  }
  return env;
}

export const CORE_ENV_SCHEMA = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  CYBEDEFEND_EDITION: Joi.string()
    .valid('community', 'cloud', 'enterprise')
    .default('cloud'),

  // The secrets block (secrets.validation.ts).
  ...secretsValidationKeys,

  GRPC_URL_ANALYSIS_REPORTING_SERVICE: Joi.string().required(),
  GRPC_URL_SECURITY_SCANNING_SERVICE: Joi.string().required(),
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: Joi.string().required(),
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: Joi.string().required(),
  GRPC_URL_FILE_MANAGEMENT_SERVICE: Joi.string().required(),
  REDIS_URL: Joi.string().uri().required(),
  PERMIFY_ENDPOINT: Joi.string().required(),
  // Permify's preshared key (src/core/utils/permify-client.ts): the
  // variable, or a file holding it (the Community Edition), or the secret.
  PERMIFY_PRESHARED_KEY: Joi.string().allow('').optional(),
  PERMIFY_PRESHARED_KEY_FILE: Joi.string().allow('').optional(),
  IP_RATE_LIMIT: Joi.number().default(100),
  USER_RATE_LIMIT: Joi.number().default(300),
  API_KEY_RATE_LIMIT: Joi.number().default(600),
  SYSTEM_RATE_LIMIT: Joi.number().default(18000),
  // The only proxy-CIDR variable the gateway reads.
  TRUSTED_PROXY_CIDRS: Joi.string().optional(),
  FRONTEND_URL: Joi.string().required(),
  // The GitLab authorize URL is built on this instance.
  GITLAB_API_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .default('https://gitlab.com/api/v4'),
  // Overrides for the cloud JWKS_SOURCE (Logto's OIDC set is the
  // default when they are unset).
  AUTH_JWKS_URL: Joi.string().uri().optional(),
  AUTH_ISSUER: Joi.string().optional(),
  AUTH_AUDIENCE: Joi.string().optional(),
  // The Community refresh cookie. Its path (the compose serves
  // the gateway under /api), and the one exception to its Secure flag.
  AUTH_COOKIE_PATH: Joi.string()
    .pattern(/^\/[A-Za-z0-9/_-]*$/)
    .default('/auth'),
  AUTH_COOKIE_INSECURE_LOCALHOST: Joi.boolean().default(false),
  APP_PUBLIC_URL: Joi.string().uri().optional(),
  OTEL_DISABLED: Joi.string().valid('true', 'false').default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.alternatives().conditional('OTEL_DISABLED', {
    is: 'true',
    then: Joi.string().optional(), // NOSONAR - 'then' is part of Joi's conditional validation API
    otherwise: Joi.string().required().messages({
      'any.required': `"OTEL_EXPORTER_OTLP_ENDPOINT" is required unless "OTEL_DISABLED" is set to "true"`,
    }),
  }),
}).custom(insecureCookieOnLocalhostOnly);

// The closed keys join the core schema in every edition but community. Joi 18
// reads keys({}) as « allow none », not as a no-op merge, so the empty map a
// community pod produces must not be passed.
const editionKeys = editionEnvSchema();
export const validationSchema = Object.keys(editionKeys).length
  ? CORE_ENV_SCHEMA.keys(editionKeys)
  : CORE_ENV_SCHEMA;
