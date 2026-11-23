import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { Sql } from './sql';

export interface QueryTarget {
  query(text: string, params?: unknown[], structured?: boolean): Promise<unknown>;
}

export interface RunResult {
  rows: Record<string, unknown>[];
  affected: number;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function toRunResult(result: unknown): RunResult {
  let records: unknown = result;
  let affected: number | undefined;
  if (isObject(result) && 'records' in result) {
    records = result.records;
    if (typeof result.affected === 'number') affected = result.affected;
  }
  if (Array.isArray(records)) {
    return { rows: records as Record<string, unknown>[], affected: affected ?? 0 };
  }
  if (isObject(records) && typeof records.affectedRows === 'number') {
    return { rows: [], affected: records.affectedRows };
  }
  return { rows: [], affected: affected ?? 0 };
}

/**
 * Executes a built Sql statement. `affected` is the rows matched by an UPDATE
 * or DELETE on both engines (mysql2 affectedRows, pg rowCount).
 * A DataSource gets its own query runner, opened and released here; an
 * EntityManager with a transaction runner runs on it, without releasing it;
 * one without goes through its connection, like a DataSource.
 */
export async function run(
  target: QueryRunner | DataSource | EntityManager,
  q: Sql,
): Promise<RunResult> {
  const t = target as unknown as Record<string, unknown>;
  const txRunner = t.queryRunner as QueryRunner | undefined;
  const connection = t.connection as Record<string, unknown> | undefined;
  if (
    !txRunner &&
    typeof t.createQueryRunner !== 'function' &&
    typeof t.release !== 'function' &&
    typeof t.query === 'function' &&
    connection &&
    typeof connection.createQueryRunner === 'function'
  ) {
    // An EntityManager outside a transaction (a QueryRunner has `release`): EntityManager.query drops the
    // `structured` argument, so go through its DataSource instead.
    return run(connection as unknown as DataSource, q);
  }
  if (typeof t.createQueryRunner === 'function') {
    const runner = (t.createQueryRunner as () => QueryRunner)();
    const connect = (runner as unknown as Record<string, unknown>).connect;
    if (typeof connect === 'function') await (connect as () => Promise<void>).call(runner);
    try {
      return toRunResult(await runner.query(q.text, q.params, true));
    } finally {
      await runner.release();
    }
  }
  if (txRunner && typeof (txRunner as unknown as Record<string, unknown>).query === 'function') {
    return toRunResult(await txRunner.query(q.text, q.params, true));
  }
  return toRunResult(await (t.query as QueryTarget['query']).call(target, q.text, q.params, true));
}
