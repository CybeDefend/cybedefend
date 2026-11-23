// Community Edition: the secrets source is the Community one (environment and derived keys); no cloud binding or setting exists in this tree.
import type { Provider } from '@nestjs/common';
import type * as Joi from 'joi';

export const EE_SECRETS_BINDINGS: Provider[] = [];
export const EE_SECRETS_ENV_SCHEMA: Joi.PartialSchemaMap = {};
