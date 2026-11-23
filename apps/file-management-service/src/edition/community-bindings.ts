import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { OBJECT_STORAGE_BACKEND_COMMUNITY_BINDINGS } from './community/object-storage-backend.binding';

// Every port's Community binding (SECRETS_SOURCE is not one of them: it is
// wired by SecretsModule from src/edition/ee-secrets.ts).
export const COMMUNITY_BINDINGS: Provider[] = [
  ...OBJECT_STORAGE_BACKEND_COMMUNITY_BINDINGS,
];

export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
