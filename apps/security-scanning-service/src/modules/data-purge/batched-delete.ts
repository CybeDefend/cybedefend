import { DataSource } from 'typeorm';
import type { Sql } from '@cybedefend/db-dialect';
import { deleteBatch, ident, run, sql } from '@cybedefend/db-dialect';

/** Rows per DELETE statement: a parent's FK cascade stays bounded. */
export const PURGE_BATCH_SIZE = 1000;

/** A purge call starts no new statement past this budget. */
export const PURGE_CALL_BUDGET_MS = 60_000;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Deletes up to `limit` rows of `table` whose `column` equals `value` in ONE
 * statement and returns how many rows it removed (matched rows on both
 * engines). `DELETE … LIMIT` is MySQL-only, so this goes through
 * libs/db-dialect, whose PostgreSQL branch selects the victims by `ctid`.
 * `table` and `column` come from the purge lists, never from a request; they
 * are checked all the same. `where` is an extra, constant condition from
 * those lists (no value in it).
 */
export async function deleteBatchFor(
  dataSource: DataSource,
  table: string,
  column: string,
  value: string,
  limit: number,
  where?: Sql,
): Promise<number> {
  if (!IDENTIFIER.test(table) || !IDENTIFIER.test(column)) {
    throw new Error('deleteBatchFor: invalid identifier');
  }
  const condition = where
    ? sql`${ident(column)} = ${value} AND ${where}`
    : sql`${ident(column)} = ${value}`;
  const { affected } = await run(
    dataSource,
    deleteBatch(table, condition, limit),
  );
  return affected;
}

/**
 * Deletes the rows of `table` whose `column` equals `value`, `batchSize` at a
 * time, until a batch comes back short (nothing left) or the deadline is
 * reached. Always runs at least one statement, so a call made past its
 * deadline still progresses by one batch. `table` and `column` come from the
 * purge lists, never from a request; they are checked all the same. `where`
 * is an extra, constant condition from those lists (no value in it).
 */
export async function deleteInBatches(
  dataSource: DataSource,
  table: string,
  column: string,
  value: string,
  deadline: number,
  batchSize = PURGE_BATCH_SIZE,
  where?: Sql,
): Promise<{ deleted: number; complete: boolean }> {
  if (!IDENTIFIER.test(table) || !IDENTIFIER.test(column)) {
    throw new Error('deleteInBatches: invalid identifier');
  }
  let deleted = 0;
  for (;;) {
    const affected = await deleteBatchFor(
      dataSource,
      table,
      column,
      value,
      batchSize,
      where,
    );
    deleted += affected;
    if (affected < batchSize) return { deleted, complete: true };
    if (Date.now() >= deadline) return { deleted, complete: false };
  }
}
