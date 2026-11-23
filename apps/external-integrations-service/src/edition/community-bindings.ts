import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './community/entitlements.binding';
import { PRODUCT_LINKS_COMMUNITY_BINDINGS } from './community/product-links.binding';
import { ScanCapabilityModule } from '../core/scan-capability/scan-capability.module';
import { CommunityContainerRegistriesAdminModule } from './community/container-registries-admin.community.module';

// external-integrations binds two ports here: entitlements and product links
// (no secrets binding file — SECRETS_SOURCE is wired by SecretsModule from
// src/edition/ee-secrets.ts).
export const COMMUNITY_BINDINGS: Provider[] = [
  ...ENTITLEMENTS_COMMUNITY_BINDINGS,
  ...PRODUCT_LINKS_COMMUNITY_BINDINGS,
];

// ScanCapabilityModule: the scan capability cache, read by
// CommunityEntitlements. Community only, so the cloud never calls
// GetScanCapabilities. The Community edition also binds the
// CONTAINER_REGISTRIES_ADMIN_PORT to its no-op implementation: the closed
// tables do not exist, and IntegrationsAdminModule injects the port.
export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [
  ScanCapabilityModule,
  CommunityContainerRegistriesAdminModule,
];

// The Community-only modules of a non-API context (editionImportsFor). The
// worker runs PendingRescanConsumer, whose deferred rescans are decided by
// CommunityEntitlements like a push. The cron contexts get
// none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {
  worker: [ScanCapabilityModule],
};
