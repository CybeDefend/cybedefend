/**
 * The columns whose MySQL definition carries `ON UPDATE CURRENT_TIMESTAMP[(6)]`.
 * On PostgreSQL `UpdatedAtColumn` drops `onUpdate`, and the baseline migration
 * installs a trigger per entry that sets the column on UPDATE.
 *
 * Frozen with the baseline, which reads it: a table created later is listed
 * in UPDATED_AT_COLUMNS below, and its own common migration installs its
 * trigger.
 */
export const BASELINE_UPDATED_AT_COLUMNS: ReadonlyArray<
  [table: string, column: string]
> = [
  ['github_branches', 'lastSeenAt'],
  ['github_branches', 'updatedAt'],
  ['github_integrations', 'updatedAt'],
  ['github_repositories', 'updatedAt'],
  ['gitlab_branches', 'lastSeenAt'],
  ['gitlab_branches', 'updatedAt'],
  ['jira_integrations', 'updatedAt'],
  ['jira_project_mappings', 'updatedAt'],
  ['slack_channel_mappings', 'updatedAt'],
  ['slack_integrations', 'updatedAt'],
];

/**
 * Every onUpdate column of the core entities: the baseline's, plus those of
 * the tables a common migration created (each installs its own trigger).
 */
export const UPDATED_AT_COLUMNS: ReadonlyArray<
  [table: string, column: string]
> = [
  ...BASELINE_UPDATED_AT_COLUMNS,
  // 1792200000000-CreateLinearIntegration
  ['linear_integrations', 'updatedAt'],
  ['linear_project_mappings', 'updatedAt'],
];
