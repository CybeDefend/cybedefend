import { QueryFailedError } from 'typeorm';

/** Identifier-like driver fields, safe to log (never a value). */
const DRIVER_SAFE_FIELDS = [
  'code',
  'errno',
  'sqlState',
  'constraint',
  'table',
] as const;

/**
 * Whether `err` comes from the database driver, directly (mysql2, pg) or
 * wrapped by TypeORM. Its message, parameters, statement and detail can quote
 * the values of the statement: a duplicate-key message quotes the duplicated
 * value on MySQL (`Duplicate entry '<value>'`) and in PostgreSQL's `detail`
 * (`Key (token_hash)=(<value>)`), and an invalid-input message quotes the
 * input on PostgreSQL.
 */
export function isDriverError(err: Record<string, unknown>): boolean {
  return (
    err instanceof QueryFailedError ||
    'driverError' in err ||
    'sqlMessage' in err ||
    'sqlState' in err ||
    typeof err.sql === 'string' ||
    ('severity' in err && 'code' in err)
  );
}

/** The identifier-like fields of a driver error, each cut to 64 safe characters. */
export function safeDriverFields(
  err: Record<string, unknown>,
): Record<string, string> {
  const source =
    (err.driverError as Record<string, unknown> | undefined) ?? err;
  const out: Record<string, string> = {};
  for (const field of DRIVER_SAFE_FIELDS) {
    const value = source[field] ?? err[field];
    if (typeof value === 'string' || typeof value === 'number') {
      out[field] = String(value)
        .replace(/[^\w.-]/g, '_')
        .slice(0, 64);
    }
  }
  return out;
}

/** The stack frames only: the first lines repeat the message. */
export function framesOf(err: Error): string {
  return (err.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
}
