import { currentDialect, dialectApi, run } from '@cybedefend/db-dialect';
import type { Dialect, Sql } from '@cybedefend/db-dialect';
import { DataSource } from 'typeorm';
import { rawSql } from 'src/core/db/raw-sql';

/** Rows per DELETE statement, so a cascade under a parent stays bounded. */
export const PURGE_BATCH_SIZE = 1000;

/** A purge call starts no new statement after this budget and answers `complete: false`. */
export const PURGE_CALL_BUDGET_MS = 60_000;

/** How the purged value is matched against the key column. */
export type PurgeMatch = 'equals' | 'find_in_set';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function checkIdentifier(name: string): void {
  // Table and column names come from the constant lists of purge-tables.ts,
  // never from a request; refuse anything else rather than escape it.
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
}

/**
 * One bounded DELETE of the rows of `table` whose `column` matches `value`
 * (`DELETE … LIMIT n` on MySQL, `DELETE … WHERE ctid IN (SELECT ctid … LIMIT
 * n)` on PostgreSQL, through `deleteBatch`). `match: 'find_in_set'` matches
 * `value` as one item of a comma-separated `column` (`inCsv`); `extraWhere` is
 * a constant condition from purge-tables.ts, written for the same dialect. The
 * value and the limit are always parameters.
 */
export function purgeDeleteSql(
  table: string,
  column: string,
  value: string,
  batchSize: number,
  extraWhere?: string,
  match: PurgeMatch = 'equals',
  dialect: Dialect = currentDialect(),
): Sql {
  checkIdentifier(table);
  checkIdentifier(column);
  const d = dialectApi(dialect);
  const col = d.ident(column);
  let key: Sql;
  if (match === 'find_in_set') {
    const item = d.inCsv(d.param(value), col);
    // FIND_IN_SET is a position: `> 0` keeps the cloud's statement as it
    // was. PostgreSQL's form is already a boolean.
    key = dialect === 'mysql' ? d.sql`${item} > 0` : item;
  } else {
    key = d.sql`${col} = ${value}`;
  }
  const where = extraWhere
    ? d.sql`${key} AND ${rawSql(extraWhere, dialect)}`
    : key;
  return d.deleteBatch(table, where, batchSize);
}

/**
 * Deletes the rows of `table` whose `column` equals `value`, `batchSize` rows per
 * statement, until a statement deletes fewer than `batchSize` rows (complete)
 * or `deadline` (epoch ms) is reached (not complete). Always runs at least one
 * statement. `extraWhere` is an extra constant condition from purge-tables.ts.
 * `match: 'find_in_set'` matches `value` as one item of a comma-separated
 * `column` instead of `column = value`; the value is a parameter either way.
 * The deleted rows are read through `run().affected` on both engines.
 */
export async function deleteInBatches(
  dataSource: DataSource,
  table: string,
  column: string,
  value: string,
  deadline: number,
  batchSize: number = PURGE_BATCH_SIZE,
  extraWhere?: string,
  match: PurgeMatch = 'equals',
): Promise<{ deleted: number; complete: boolean }> {
  const statement = purgeDeleteSql(
    table,
    column,
    value,
    batchSize,
    extraWhere,
    match,
  );
  let deleted = 0;
  for (;;) {
    const { affected } = await run(dataSource, statement);
    deleted += affected;
    if (affected < batchSize) return { deleted, complete: true };
    if (Date.now() >= deadline) return { deleted, complete: false };
  }
}
