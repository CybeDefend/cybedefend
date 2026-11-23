import type { DynamicModule, Provider, Type } from '@nestjs/common';
import {
  COMMUNITY_BINDINGS,
  COMMUNITY_CONTEXT_MODULES,
  COMMUNITY_ONLY_MODULES,
} from './community-bindings';
import { EE_BINDINGS, EE_CONTEXT_MODULES, EE_MODULES } from './ee-modules';
import { isCommunityEdition } from './edition';
import { mergeBindings } from './merge-bindings';

/**
 * The API context spreads `...editionImports()`; every other Nest context
 * (worker, cron…) spreads `...editionImportsFor('<its name>')`. Both run
 * when the @Module decorator is evaluated, i.e. at import time.
 */
export function editionImports(): Array<Type<unknown> | DynamicModule> {
  return isCommunityEdition() ? [...COMMUNITY_ONLY_MODULES] : [...EE_MODULES];
}

export function editionImportsFor(
  context: string,
): Array<Type<unknown> | DynamicModule> {
  if (isCommunityEdition()) {
    return [...(COMMUNITY_CONTEXT_MODULES[context] ?? [])];
  }
  return [...(EE_CONTEXT_MODULES[context] ?? [])];
}

export function editionBindings(): Provider[] {
  return isCommunityEdition()
    ? [...COMMUNITY_BINDINGS]
    : mergeBindings(COMMUNITY_BINDINGS, EE_BINDINGS);
}

export { editionMigrations } from './edition-migrations';

export function editionModuleClass(
  m: Type<unknown> | DynamicModule,
): Type<unknown> {
  return typeof m === 'function' ? m : m.module;
}
