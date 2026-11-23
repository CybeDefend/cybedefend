/**
 * What the purge of a deleted project, team or organization removes from this
 * service's PostgreSQL database. `data-purge.inventory.spec.ts` fails on any
 * entity column keyed by a project, team or organization that is in none of
 * these lists.
 */

/** A purge call stops starting new work after this long and answers `complete: false`. */
export const PURGE_CALL_BUDGET_MS = 60_000;

/** Rows per statement; batched so a purge (and a cascade) stays bounded. */
export const PURGE_BATCH_SIZE = 1000;

export interface PurgeTable {
  readonly table: string;
  readonly column: string;
}

/** Rows deleted where `column` = the project id, in this order. */
export const PROJECT_PURGE_TABLES: readonly PurgeTable[] = [
  { table: 'policy_violations', column: 'projectId' },
  { table: 'policy_evaluations', column: 'projectId' },
];

/**
 * JSONB arrays of target ids: the project id is removed, the row is kept
 * (a policy targets several projects and belongs to its organization).
 */
export const PROJECT_TARGET_COLUMNS: readonly PurgeTable[] = [
  { table: 'security_policies', column: 'projectIds' },
];

/** No row of this service is owned by a team alone. */
export const TEAM_PURGE_TABLES: readonly PurgeTable[] = [];

/** JSONB arrays of target ids: the team id is removed, the row is kept. */
export const TEAM_TARGET_COLUMNS: readonly PurgeTable[] = [
  { table: 'security_policies', column: 'teamIds' },
];

/**
 * Rows deleted where `column` = the organization id, in this order. The
 * violations would go with their policy (FK CASCADE); they are deleted first,
 * in batches, so the cascade of a policy batch stays bounded.
 */
export const ORGANIZATION_PURGE_TABLES: readonly PurgeTable[] = [
  { table: 'policy_violations', column: 'organizationId' },
  { table: 'policy_evaluations', column: 'organizationId' },
  { table: 'security_policies', column: 'organizationId' },
];

/** `table.column` → why that keyed column needs no purge of its own. */
export const KEPT_COLUMNS: Readonly<Record<string, string>> = {
  'policy_evaluations.teamId':
    'a filter copy of the project team: the evaluation is purged with its project (projectId) or its organization (organizationId)',
};
