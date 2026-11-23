import type { EntityManager } from 'typeorm';
import { withSavepoint } from '@cybedefend/db-dialect';

/**
 * « Try, catch the duplicate, go on » through a repository's manager. On
 * PostgreSQL a failed statement aborts the whole transaction (25P02), so when
 * the manager carries an active transaction the call runs inside a savepoint,
 * rolled back to on failure. Without one (the injected repositories of the
 * cloud, a mocked repository), `fn` runs as is: nothing changes on MySQL.
 */
export function withinSavepoint<T>(
  manager: EntityManager | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const runner = manager?.queryRunner;
  return runner ? withSavepoint(runner, fn) : fn();
}
