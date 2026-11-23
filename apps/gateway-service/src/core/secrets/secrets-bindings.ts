import type { Provider } from '@nestjs/common';
import { SECRETS_COMMUNITY_BINDINGS } from '../../edition/community/secrets.binding';
import { currentEdition } from '../../edition/edition';
import { EE_SECRETS_BINDINGS } from '../../edition/ee-secrets';
import { mergeBindings } from '../../edition/merge-bindings';

/**
 * The secrets source of the running edition, wired by SecretsModule itself and
 * never by EditionModule (two providers for SECRETS_SOURCE would instantiate
 * the cloud source's client twice). Evaluated when the @Module decorator runs,
 * i.e. at import time.
 */
export function secretsBindings(): Provider[] {
  return currentEdition() === 'community'
    ? [...SECRETS_COMMUNITY_BINDINGS]
    : mergeBindings(SECRETS_COMMUNITY_BINDINGS, EE_SECRETS_BINDINGS);
}
