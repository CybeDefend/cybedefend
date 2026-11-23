import * as Joi from 'joi';
import { currentEdition } from '../../edition/edition';
import { EE_SECRETS_ENV_SCHEMA } from '../../edition/ee-secrets';
import { decodeMasterKey } from './secret-key';

/**
 * The secrets block of the service's environment schema. The core reads its
 * secrets from the environment and from <KEY>_FILE, so the only key it
 * declares is the optional master key the Community Edition derives its keys
 * from. A cloud secrets source declares its own connection settings through
 * EE_SECRETS_ENV_SCHEMA; the Community Edition registers none of them.
 */
export const secretsValidationKeys: Joi.PartialSchemaMap = {
  ...(currentEdition() === 'community' ? {} : EE_SECRETS_ENV_SCHEMA),
  CYBEDEFEND_SECRET_KEY: Joi.string()
    .allow('')
    .custom((value: string) => {
      if (value !== '') decodeMasterKey(value);
      return value;
    }),
};
