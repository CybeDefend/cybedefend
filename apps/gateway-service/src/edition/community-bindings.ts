import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './community/entitlements.binding';
import { JWKS_SOURCE_COMMUNITY_BINDINGS } from './community/jwks-source.binding';
import { InstanceModule } from '../modules/instance/instance.module';
import { LocalAuthModule } from '../modules/local-auth/local-auth.module';
import { ScanRunModule } from '../modules/scan-run/scan-run.module';
import { ScanImportModule } from '../modules/scan/import/scan-import.module';
import { CommunityContainerRegistriesOverviewModule } from './community/container-registries-overview.community.module';

// The gateway's ports (entitlements, jwks-source). No secrets binding file:
// SECRETS_SOURCE is wired by SecretsModule from src/edition/ee-secrets.ts.
// A new port spreads its <PORT>_COMMUNITY_BINDINGS here.
export const COMMUNITY_BINDINGS: Provider[] = [
  ...ENTITLEMENTS_COMMUNITY_BINDINGS,
  ...JWKS_SOURCE_COMMUNITY_BINDINGS,
];

// The Community sign-in routes (/auth/*, /.well-known/jwks.json).
// GET /instance/capabilities, whether this instance runs cluster scans.
// POST /scan-runs/:scanId/results, the scanner pods' upload route. Only
// Community mints upload tokens, so the cloud mounts neither the route (404)
// nor its throttle's Redis client.
export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [
  LocalAuthModule,
  InstanceModule,
  ScanRunModule,
  // POST /project/:projectId/scan/import/start, the SARIF import: a Community
  // Edition feature, so the cloud answers 404.
  ScanImportModule,
  // The overview's registry stats bind to the empty implementation (no
  // container registry is ever connected); the cloud edition counts them.
  CommunityContainerRegistriesOverviewModule,
];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
