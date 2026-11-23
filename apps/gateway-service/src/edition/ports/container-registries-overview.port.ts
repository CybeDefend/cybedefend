import type {
  ContainerRegistryStatsDto,
  GithubInstallationDto,
} from '../../modules/integrations/integration-overview/dto/integration-overview.dto';

/**
 * The container registry integrations are cloud-only (their REST modules and
 * gRPC servers live under src/ee): the overview's registry stats reach them
 * through this port, never through the generated gRPC clients.
 */
export const CONTAINER_REGISTRIES_OVERVIEW_PORT =
  'CONTAINER_REGISTRIES_OVERVIEW_PORT';

export interface ContainerRegistriesOverviewPort {
  /**
   * The organization's connected registry credentials, by type, with the
   * total. The GHCR count is one when the GitHub App is installed, so the
   * GitHub installation read is passed along.
   */
  collectStats(
    organizationId: string,
    githubInstallation: Promise<GithubInstallationDto | null>,
  ): Promise<ContainerRegistryStatsDto>;
}
