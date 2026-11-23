import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './community/entitlements.binding';
import { SCAN_COMPLETED_LISTENERS_COMMUNITY_BINDINGS } from './community/scan-completed-listeners.binding';
import { EXPLOITABILITY_SCORER_COMMUNITY_BINDINGS } from './community/exploitability-scorer.binding';
import { FRONTEND_URL_COMMUNITY_BINDINGS } from './community/frontend-url.binding';
import { SCANNER_CALL_BINDING_COMMUNITY_BINDINGS } from './community/scanner-call-binding.binding';

// analysis-reporting binds one port here: entitlements (no secrets binding
// file — SECRETS_SOURCE is wired by SecretsModule from
// src/edition/ee-secrets.ts). Further ports spread their
// <PORT>_COMMUNITY_BINDINGS here.
export const COMMUNITY_BINDINGS: Provider[] = [
  ...ENTITLEMENTS_COMMUNITY_BINDINGS,
  // No scan-completed listener.
  ...SCAN_COMPLETED_LISTENERS_COMMUNITY_BINDINGS,
  // The verdict table scores every exploitability update.
  ...EXPLOITABILITY_SCORER_COMMUNITY_BINDINGS,
  // Dashboard links use the instance's FRONTEND_URL.
  ...FRONTEND_URL_COMMUNITY_BINDINGS,
  // No scanner token is admitted, so no scanner call is ever bound.
  ...SCANNER_CALL_BINDING_COMMUNITY_BINDINGS,
];

export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
