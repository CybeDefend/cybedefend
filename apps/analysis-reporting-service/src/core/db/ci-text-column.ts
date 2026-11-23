import type { ColumnOptions, ColumnType } from 'typeorm';
import { ciText, currentDialect } from '@cybedefend/db-dialect';

/**
 * The options of a column the code compares case-insensitively. On MySQL they are the column's options of today,
 * unchanged, so the entity metadata does not move (the type stays the one
 * TypeORM infers, the collation compares case-insensitively). On PostgreSQL
 * the column is `citext`, which takes no length.
 */
export function ciTextColumn(mysqlOptions: ColumnOptions = {}): ColumnOptions {
  if (currentDialect() === 'mysql') return mysqlOptions;
  const rest: ColumnOptions = { ...mysqlOptions };
  delete rest.length;
  return { ...rest, type: ciText() as ColumnType };
}
