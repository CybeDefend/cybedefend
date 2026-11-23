/**
 * The container registry integrations are cloud-only: their modules and
 * entities belong to the closed edition, so no core file may touch
 * their repositories. This port is the admin surface the core still needs
 * (IntegrationsAdminService: org deletion, billing's plan transitions, the
 * orphan sweep) reduced to what those callers use.
 *
 * Implementations are fail-soft per registry table, as the repositories were
 * before the move: `listOrganizationIds` and `countForOrg` log and continue,
 * `deleteForOrg` logs and continues unless `failClosed` is set, in which case
 * the first failure is rethrown.
 */
export const CONTAINER_REGISTRIES_ADMIN_PORT =
  'CONTAINER_REGISTRIES_ADMIN_PORT';

export interface ContainerRegistriesAdminPort {
  /**
   * Distinct organization ids that own at least one container registry
   * credential row, across every registry token table.
   */
  listOrganizationIds(): Promise<string[]>;

  /** Container registry credential rows the organization owns. */
  countForOrg(organizationId: string): Promise<number>;

  /**
   * Delete the organization's container registry credential rows; returns
   * the number of rows deleted. Fail-soft unless `failClosed` is set: a
   * purge must not answer "complete" over rows a failed delete left behind.
   */
  deleteForOrg(
    organizationId: string,
    options: { failClosed?: boolean },
  ): Promise<number>;
}
