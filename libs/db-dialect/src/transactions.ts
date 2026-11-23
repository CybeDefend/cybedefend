import type { QueryRunner } from 'typeorm';

let savepointCounter = 0;

/**
 * On PostgreSQL a failed statement aborts the whole transaction (25P02), so a
 * « try, catch the duplicate, go on » inside one transaction goes through this.
 * Outside a transaction fn runs as is.
 */
export async function withSavepoint<T>(
  runner: QueryRunner,
  fn: () => Promise<T>,
): Promise<T> {
  if (!runner.isTransactionActive) return fn();
  savepointCounter += 1;
  const name = `cd_sp_${savepointCounter}`;
  await runner.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await runner.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (e) {
    await runner.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
}
