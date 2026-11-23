import type { DynamicModule, Provider, Type } from '@nestjs/common';

// policy-management has no port, so both lists stay empty (no secrets binding
// file either: SECRETS_SOURCE is wired by SecretsModule from
// src/edition/ee-secrets.ts). A service with ports spreads its
// <PORT>_COMMUNITY_BINDINGS here.
export const COMMUNITY_BINDINGS: Provider[] = [];

export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
