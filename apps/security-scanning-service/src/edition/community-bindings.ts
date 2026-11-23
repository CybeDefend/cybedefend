import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './community/entitlements.binding';
import { AI_ANALYSIS_COMMUNITY_BINDINGS } from './community/ai-analysis.binding';
import { SCANNER_ORCHESTRATOR_COMMUNITY_BINDINGS } from './community/scanner-orchestrator.binding';
import { SCANNER_PODS_COMMUNITY_BINDINGS } from './community/scanner-pods.binding';
import { SCAN_LIFECYCLE_HOOKS_COMMUNITY_BINDINGS } from './community/scan-lifecycle-hooks.binding';
import { SCANNER_CALL_COMMUNITY_BINDINGS } from './community/scanner-call-binding.binding';
import { PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS } from './community/project-scan-settings.binding';
import { GIT_HISTORY_MODE_COMMUNITY_BINDINGS } from './community/git-history-mode.binding';
import { ClusterScanningModule } from '../modules/cluster-scanning/cluster-scanning.module';

// Community implementations of security-scanning's ports, concatenated in
// the Inventory table's order (entitlements, ai-analysis,
// scanner-orchestrator), then the service-local ports (scanner-pods,
// scan-lifecycle-hooks, scanner-call-binding). No secrets binding file: SECRETS_SOURCE is wired by
// SecretsModule from src/edition/ee-secrets.ts.
export const COMMUNITY_BINDINGS: Provider[] = [
  ...ENTITLEMENTS_COMMUNITY_BINDINGS,
  ...AI_ANALYSIS_COMMUNITY_BINDINGS,
  ...SCANNER_ORCHESTRATOR_COMMUNITY_BINDINGS,
  ...SCANNER_PODS_COMMUNITY_BINDINGS,
  ...SCAN_LIFECYCLE_HOOKS_COMMUNITY_BINDINGS,
  ...SCANNER_CALL_COMMUNITY_BINDINGS,
  ...PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS,
  ...GIT_HISTORY_MODE_COMMUNITY_BINDINGS,
];

// The cluster engine (scanner pods on a connected
// Kubernetes cluster) and the ClusterScanService it serves, Community only.
export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [
  ClusterScanningModule,
];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
