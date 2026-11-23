import type { PurgeStepName } from './data-purge.ledger';

/**
 * What becomes of every global-management table keyed by a project, a team or
 * an organization when that subject is deleted. `data-purge.inventory.spec.ts`
 * fails on a keyed table missing from these three lists.
 */

/** Removed with the subject's own row, in the deleting transaction. */
export const DELETED_WITH_THE_SUBJECT: Readonly<Record<string, string>> = {
  project:
    'deleted by the FK cascade of its team (and by deleteProject itself)',
  team: 'deleted by the FK cascade of its organization (and by deleteTeam itself)',
  project_branch_ingestion:
    'deleted by the FK cascade of its project (and by deleteProject itself)',
  archived_branch: 'deleted by the FK cascade of its project',
  project_security_context: 'deleted by the FK cascade of its project',
  teams_members:
    'deleted by the FK cascade of its team (and by deleteTeam itself)',
  users_organizations_members: 'deleted by the FK cascade of its organization',
  organization_invitations: 'deleted by the FK cascade of its organization',
  // The deletion confirmation code: hash, salt, counters, ids.
  organization_deletion_code: 'deleted by the FK cascade of its organization',
};

// Not listed above on purpose: the local-auth tables —
// local_credential, auth_refresh_token, auth_one_time_token and
// personal_access_token, keyed by user_id, and auth_signing_key,
// instance-level — are keyed by the user, which is not a purge subject, so
// data-purge.inventory.spec.ts asks nothing about them. The four user-keyed
// ones go with the user row through their FK cascade (ON DELETE CASCADE to
// user(id)).

/**
 * No FK to the subject: deleted by a step of the organization's purge job.
 * Empty in the core: the only such table belongs to the closed edition, which
 * lists it in its own purge steps.
 */
export const ORGANIZATION_PURGE_TABLES: readonly {
  table: string;
  column: string;
  step: PurgeStepName;
}[] = [];

/** Kept on purpose. */
export const KEPT_TABLES: Readonly<Record<string, string>> = {
  data_purge_job:
    'the erasure evidence: ids, dates and status of each purge, never a name or any content',
  data_purge_step:
    "the erasure evidence: each service's step, its attempts, the last gRPC code and the counts it deleted",
};
