import { DeleteResult, EntityManager, EntityTarget } from 'typeorm';
import { ident } from '@cybedefend/db-dialect';

/**
 * Rows per INSERT … ON DUPLICATE KEY UPDATE when a branch sync writes a
 * repository's branches. 500 rows is ~2 000 bound parameters
 * per statement, far below what MySQL accepts.
 */
export const BRANCH_UPSERT_CHUNK_SIZE = 500;

/** One row of `github_branches` / `gitlab_branches`, as a sync writes it. */
export interface BranchUpsertRow {
  repositoryId: string;
  name: string;
  isProtected: boolean;
}

/**
 * Upserts a repository's branches, BRANCH_UPSERT_CHUNK_SIZE rows per
 * statement, on the unique `(repositoryId, name)` index.
 *
 * The statement is the one `Repository.upsert(row, { conflictPaths:
 * ['repositoryId', 'name'] })` builds, with two differences: it carries many
 * rows, and `updateEntity(false)` drops the SELECT TypeORM otherwise issues
 * after each INSERT to reload the generated columns (id, timestamps), which no
 * caller reads. One upsert per branch was therefore two statements per branch:
 * 446 for a repository of 223 branches.
 *
 * Runs on the given manager, so inside the caller's transaction.
 *
 * @returns the number of statements issued.
 */
export async function upsertBranches(
  manager: EntityManager,
  target: EntityTarget<BranchUpsertRow>,
  rows: BranchUpsertRow[],
): Promise<number> {
  let statements = 0;
  for (let start = 0; start < rows.length; start += BRANCH_UPSERT_CHUNK_SIZE) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(target)
      .values(rows.slice(start, start + BRANCH_UPSERT_CHUNK_SIZE))
      .orUpdate(
        ['repositoryId', 'name', 'isProtected'],
        ['repositoryId', 'name'],
      )
      .updateEntity(false)
      .execute();
    statements++;
  }
  return statements;
}

/**
 * Orphan reconciliation of a branch sync: drops the
 * repository's branch rows whose name is not in `keepNames` — every row of
 * the repository when the list is empty. Runs on the given manager, so
 * inside the caller's transaction.
 *
 * @returns the delete result (`affected` = the rows dropped).
 */
export async function deleteStaleBranches(
  manager: EntityManager,
  target: EntityTarget<BranchUpsertRow>,
  repositoryId: string,
  keepNames: readonly string[],
): Promise<DeleteResult> {
  // `repositoryId` is quoted: PostgreSQL folds a bare camelCase identifier to
  // lower case and the column would not be found.
  const idColumn = ident('repositoryId').text;
  const qb = manager
    .getRepository(target)
    .createQueryBuilder()
    .delete()
    .from(target);
  if (keepNames.length > 0) {
    return qb
      .where(`${idColumn} = :id AND name NOT IN (:...names)`, {
        id: repositoryId,
        names: keepNames,
      })
      .execute();
  }
  // Empty branch list — drop every row for this repo.
  return qb.where(`${idColumn} = :id`, { id: repositoryId }).execute();
}
