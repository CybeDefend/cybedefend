export type Dialect = 'mysql' | 'postgres';

export function parseDialect(value: string | undefined): Dialect {
  if (value === undefined || value === '') return 'mysql';
  if (value === 'mysql' || value === 'postgres') return value;
  throw new Error('DB_TYPE_NOT_SUPPORTED: DB_TYPE must be mysql or postgres');
}

// read once when the module loads, like the entity decorators read it
const CURRENT_DIALECT: Dialect = parseDialect(process.env.DB_TYPE);

export function currentDialect(): Dialect {
  return CURRENT_DIALECT;
}

/**
 * The dialect of a TypeORM QueryRunner, read by walking its properties:
 * runner.manager.connection.options.type. No instanceof, so the library can
 * sit beside another copy of typeorm.
 */
export function runnerDialect(runner: unknown): Dialect {
  const type = (
    runner as {
      manager?: { connection?: { options?: { type?: string } } };
    } | null
  )?.manager?.connection?.options?.type;
  return parseDialect(type);
}
