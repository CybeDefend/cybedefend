import type { QueryRunner } from 'typeorm';
import { Dialect, runnerDialect } from './dialect';
import { buildSql } from './sql';
import { run } from './run';

export class AdvisoryLockTimeoutError extends Error {
  readonly code = 'ADVISORY_LOCK_TIMEOUT' as const;
  constructor(message = 'ADVISORY_LOCK_TIMEOUT: the advisory lock was not granted in time') {
    super(message);
    this.name = 'AdvisoryLockTimeoutError';
  }
}

const POLL_MS = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function acquiredOf(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const v = rows[0].acquired;
  return v === true || Number(v) === 1;
}

/**
 * MySQL: GET_LOCK / RELEASE_LOCK. PostgreSQL: pg_try_advisory_lock polled until
 * the timeout, pg_advisory_unlock in finally. Throws AdvisoryLockTimeoutError
 * when the lock is never granted; fn never runs then.
 */
export async function withAdvisoryLock<T>(
  runner: QueryRunner,
  name: string,
  timeoutS: number,
  fn: () => Promise<T>,
): Promise<T> {
  const dialect: Dialect = runnerDialect(runner);
  if (dialect === 'mysql') {
    const probe = await run(
      runner,
      buildSql(dialect, ['SELECT GET_LOCK(', { value: name }, ', ', { value: timeoutS }, ') AS acquired']),
    );
    try {
      if (!acquiredOf(probe.rows)) throw new AdvisoryLockTimeoutError();
      return await fn();
    } finally {
      await run(runner, buildSql(dialect, ['SELECT RELEASE_LOCK(', { value: name }, ')']));
    }
  }
  const deadline = Date.now() + timeoutS * 1000;
  try {
    for (;;) {
      const probe = await run(
        runner,
        buildSql(dialect, [
          'SELECT pg_try_advisory_lock(hashtextextended(',
          { value: name },
          ', 0)) AS acquired',
        ]),
      );
      if (acquiredOf(probe.rows)) break;
      if (Date.now() >= deadline) throw new AdvisoryLockTimeoutError();
      await sleep(POLL_MS);
    }
    return await fn();
  } finally {
    await run(
      runner,
      buildSql(dialect, ['SELECT pg_advisory_unlock(hashtextextended(', { value: name }, ', 0))']),
    );
  }
}
