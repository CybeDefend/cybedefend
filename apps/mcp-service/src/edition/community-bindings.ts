import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { BEARER_VERIFIER_COMMUNITY_BINDINGS } from './community/bearer-verifier.binding';
import { GATEWAY_ERROR_TRANSLATOR_COMMUNITY_BINDINGS } from './community/gateway-error-translator.binding';
import { MCP_EDITION_TEXTS_COMMUNITY_BINDINGS } from './community/mcp-edition-texts.binding';

// mcp-service's three ports. No secrets binding: the core reads its
// configuration from the environment only.
export const COMMUNITY_BINDINGS: Provider[] = [
  ...BEARER_VERIFIER_COMMUNITY_BINDINGS,
  ...GATEWAY_ERROR_TRANSLATOR_COMMUNITY_BINDINGS,
  ...MCP_EDITION_TEXTS_COMMUNITY_BINDINGS,
];

export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
