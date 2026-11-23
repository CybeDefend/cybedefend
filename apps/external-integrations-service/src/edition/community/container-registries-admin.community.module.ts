import { Global, Module } from '@nestjs/common';
import { CONTAINER_REGISTRIES_ADMIN_PORT } from '../ports/container-registries-admin.port';
import { CommunityContainerRegistriesAdmin } from './container-registries-admin.community';

/**
 * Community Edition only (COMMUNITY_ONLY_MODULES): binds
 * CONTAINER_REGISTRIES_ADMIN_PORT to the no-op implementation, so
 * IntegrationsAdminModule resolves it in every module once the root imports
 * the edition layer. Global, because the closed edition's
 * counterpart needs the repository providers of a
 * closed module, which the global EditionModule cannot inject.
 */
@Global()
@Module({
  providers: [
    CommunityContainerRegistriesAdmin,
    {
      provide: CONTAINER_REGISTRIES_ADMIN_PORT,
      useExisting: CommunityContainerRegistriesAdmin,
    },
  ],
  exports: [CONTAINER_REGISTRIES_ADMIN_PORT],
})
export class CommunityContainerRegistriesAdminModule {}
