import type { PartialSchemaMap } from 'joi';
import { currentEdition } from './edition';
import { EE_ENV_SCHEMA } from './ee-modules';

/**
 * The closed environment keys, registered only outside the Community Edition
 * (EE_ENV_SCHEMA is a standard optional export of ee-modules.ts, blanked
 * to {} by the export overlay). Read when validation.schema.ts is loaded —
 * before ConfigModule loads .env — so CYBEDEFEND_EDITION must be a real
 * environment variable; a value set only in .env is ignored here.
 */
export function editionEnvSchema(): PartialSchemaMap {
  return currentEdition() === 'community' ? {} : EE_ENV_SCHEMA;
}
