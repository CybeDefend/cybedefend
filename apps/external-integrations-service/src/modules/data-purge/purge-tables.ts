import { ident, sql } from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';

/**
 * What external-integrations purges when a project or an organization is
 * deleted.
 *
 * `data-purge.inventory.spec.ts` reads every entity and fails on a column
 * named like a project, team or organization key that is neither listed here
 * nor kept in KEPT_COLUMNS with its reason.
 */

/** A call stops starting new work after this budget and answers `complete: false`. */
export const PURGE_CALL_BUDGET_MS = 60_000;

/** Rows per statement (`… LIMIT 1000`), so neither a delete nor its cascade is unbounded. */
export const PURGE_BATCH_SIZE = 1000;

export interface PurgeTable {
  /** Database table name. */
  readonly table: string;
  /** The key column the purge matches. */
  readonly column: string;
  /**
   * The WHERE clause when it is not `column = <id>`; it takes the purged id
   * as its only parameter. Built with `sql`/`ident`, never raw quoted text,
   * so it renders on both engines.
   */
  readonly where?: (id: unknown) => Sql;
}

/**
 * A deleted project's repositories are UNLINKED, never deleted: the rows
 * belong to the GitHub App installation or the GitLab connection, which
 * outlive the project: deleting them would unlink the organization's whole
 * GitHub or GitLab connection. `projectId` and `scanBranch` are cleared.
 */
export const PROJECT_UNLINK_TABLES: readonly PurgeTable[] = [
  { table: 'github_repositories', column: 'projectId' },
  { table: 'gitlab_repositories', column: 'projectId' },
];

/** Rows that exist only for the project, deleted by `projectId`. */
export const PROJECT_PURGE_TABLES: readonly PurgeTable[] = [
  { table: 'jira_project_mappings', column: 'projectId' },
  { table: 'linear_project_mappings', column: 'projectId' },
  { table: 'slack_channel_mappings', column: 'projectId' },
  { table: 'vulnerability_issue_mapping', column: 'projectId' },
];

/**
 * The integration types `IntegrationsAdminService.deleteIntegrationsForOrg`
 * deletes at an organization's deletion: the five global-management sent
 * before this purge took it over, plus `linear`. `github_issues` /
 * `gitlab_issues` are the GitHub App installation and the GitLab connection
 * themselves.
 */
export const ORGANIZATION_INTEGRATION_TYPES: readonly string[] = [
  'jira',
  'linear',
  'slack',
  'github_issues',
  'gitlab_issues',
  'container_registry',
];

/**
 * The tables those types delete, by `organizationId`, with what goes with
 * them by FK cascade (`jira_project_mappings`, `linear_project_mappings`,
 * `slack_channel_mappings`, repositories and branches). Checked against the
 * service by the inventory spec. The `container_registry` type goes through
 * CONTAINER_REGISTRIES_ADMIN_PORT, never through a core repository.
 */
export const CORE_INTEGRATION_TABLES: readonly PurgeTable[] = [
  'jira_integrations',
  'linear_integrations',
  'slack_integrations',
  'github_integrations',
  'gitlab_integrations',
].map((table) => ({ table, column: 'organizationId' }));

/**
 * Deleted, in this order, BEFORE the integrations (and after the closed
 * tables of PURGE_TABLE_EXTENSIONS, when supplied): the branches and
 * repositories of the organization's installations in batches, so the cascade from an
 * integration row is bounded instead of taking every repository and branch
 * of the installation in one statement.
 */
export const ORGANIZATION_PURGE_TABLES: readonly PurgeTable[] = [
  {
    table: 'github_branches',
    column: 'repositoryId',
    where: (id) =>
      sql`${ident('repositoryId')} IN (SELECT ${ident('r.id')} FROM ${ident('github_repositories')} r JOIN ${ident('github_integrations')} i ON ${ident('i.id')} = ${ident('r.integrationId')} WHERE ${ident('i.organizationId')} = ${id})`,
  },
  {
    table: 'github_repositories',
    column: 'integrationId',
    where: (id) =>
      sql`${ident('integrationId')} IN (SELECT ${ident('i.id')} FROM ${ident('github_integrations')} i WHERE ${ident('i.organizationId')} = ${id})`,
  },
  {
    table: 'gitlab_branches',
    column: 'repositoryId',
    where: (id) =>
      sql`${ident('repositoryId')} IN (SELECT ${ident('r.id')} FROM ${ident('gitlab_repositories')} r JOIN ${ident('gitlab_integrations')} i ON ${ident('i.id')} = ${ident('r.integrationId')} WHERE ${ident('i.organizationId')} = ${id})`,
  },
  {
    table: 'gitlab_repositories',
    column: 'integrationId',
    where: (id) =>
      sql`${ident('integrationId')} IN (SELECT ${ident('i.id')} FROM ${ident('gitlab_integrations')} i WHERE ${ident('i.organizationId')} = ${id})`,
  },
];

/** `table.column` → why that key column is not purged by it. */
export const KEPT_COLUMNS: Readonly<Record<string, string>> = {
  'slack_integrations.teamId':
    'a Slack workspace id, not a CybeDefend team; the row is purged with its organization',
  'linear_project_mappings.teamId':
    'a Linear team id, not a CybeDefend team; the row is purged with its project, and with its organization by FK cascade',
};
