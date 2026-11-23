import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { LocalAuthModule } from 'src/modules/local-auth/local-auth.module';
import { DataPurgeSchedulerModule } from 'src/modules/data-purge/data-purge-scheduler.module';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './community/entitlements.binding';
import { IDENTITY_PROVIDER_COMMUNITY_BINDINGS } from './community/identity-provider.binding';
import { PURGE_STEPS_COMMUNITY_BINDINGS } from './community/purge-steps.binding';
import { ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS } from './community/organization-lifecycle.binding';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from './community/member-products.binding';
import { PROJECT_SETTINGS_COMMUNITY_BINDINGS } from './community/project-settings.binding';
import { ORGANIZATION_PROFILE_COMMUNITY_BINDINGS } from './community/organization-profile.binding';
import { SUPPORT_CONTACT_COMMUNITY_BINDINGS } from './community/support-contact.binding';

// global-management's ports: entitlements, identity-provider, purge-steps
// (no telemetry port; no secrets binding file either — SECRETS_SOURCE is
// wired by SecretsModule from src/edition/ee-secrets.ts), then
// organization-lifecycle, member-products, project-settings,
// organization-profile, support-contact.
export const COMMUNITY_BINDINGS: Provider[] = [
  ...ENTITLEMENTS_COMMUNITY_BINDINGS,
  ...IDENTITY_PROVIDER_COMMUNITY_BINDINGS,
  ...PURGE_STEPS_COMMUNITY_BINDINGS,
  ...ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS,
  ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
  ...PROJECT_SETTINGS_COMMUNITY_BINDINGS,
  ...ORGANIZATION_PROFILE_COMMUNITY_BINDINGS,
  ...SUPPORT_CONTACT_COMMUNITY_BINDINGS,
];

// The local auth gRPC server loads in community mode only (in the
// cloud every LocalAuthService call answers UNIMPLEMENTED).
// The data purge runs in-process, every 10 minutes (the cloud keeps
// its CronJob, the Community compose has none).
export const COMMUNITY_ONLY_MODULES: Array<Type<unknown> | DynamicModule> = [
  LocalAuthModule,
  DataPurgeSchedulerModule,
];

// The Community-only modules of a non-API context (editionImportsFor): none.
export const COMMUNITY_CONTEXT_MODULES: Record<
  string,
  Array<Type<unknown> | DynamicModule>
> = {};
