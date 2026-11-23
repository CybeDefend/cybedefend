import { Global, Module } from '@nestjs/common';
import { CONTAINER_REGISTRIES_OVERVIEW_PORT } from '../ports/container-registries-overview.port';
import { CommunityContainerRegistriesOverview } from './container-registries-overview.community';

/**
 * Community Edition only (COMMUNITY_ONLY_MODULES): binds
 * CONTAINER_REGISTRIES_OVERVIEW_PORT to the empty-implementation, so
 * IntegrationOverviewModule resolves it in every module once the root
 * imports the edition layer. The cloud counterpart
 * needs the closed
 * gRPC client, which the global EditionModule cannot inject.
 */
@Global()
@Module({
  providers: [
    CommunityContainerRegistriesOverview,
    {
      provide: CONTAINER_REGISTRIES_OVERVIEW_PORT,
      useExisting: CommunityContainerRegistriesOverview,
    },
  ],
  exports: [CONTAINER_REGISTRIES_OVERVIEW_PORT],
})
export class CommunityContainerRegistriesOverviewModule {}
