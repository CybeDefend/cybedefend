import { ident, sql } from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';

/**
 * What a project purge deletes, in order (see `DataPurgeService.purgeProject`
 * for why): first the scans that have no pod yet, then, once the pods of the
 * running scans are stopped, every remaining scan. `container` has no project
 * key: its rows go with their scan by the FK cascade (`onDelete: 'CASCADE'`),
 * bounded by the batch of scans. `scanner` and `supported_language` are the
 * global scanner catalogue and carry no key.
 */
export const NOT_STARTED_SCANS = {
  table: 'scan',
  column: 'projectId',
  // The extra condition is built per engine (a bare `state` is
  // lowercase and portable, the backticks were MySQL-only).
  where: sql`${ident('state')} IN ('queued', 'waiting_for_file')`,
} as const;

export const ALL_SCANS = { table: 'scan', column: 'projectId' } as const;

/** One row per branch: small, deleted once the scans are gone. */
export const GIT_HISTORY_CURSORS = {
  table: 'git_history_cursor',
  column: 'projectId',
} as const;

export const PROJECT_PURGE_TABLES: readonly {
  table: string;
  column: string;
  where?: Sql;
}[] = [NOT_STARTED_SCANS, ALL_SCANS, GIT_HISTORY_CURSORS];

/**
 * Tables with a column named like a project, team or organization key that a
 * purge leaves alone, each with its reason. The inventory test fails on any
 * keyed table found in neither list.
 */
export const KEPT_TABLES: Readonly<Record<string, string>> = {};
