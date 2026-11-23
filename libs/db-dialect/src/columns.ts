import { Column, ColumnOptions, ColumnType, PrimaryGeneratedColumn } from 'typeorm';
import { Dialect } from './dialect';

// The return type is ColumnType (not string) so the helpers can be used
// directly in a @Column({ type: ... }) decorator.
export function columnTypeFor(dialect: Dialect, t: string): ColumnType {
  if (dialect === 'mysql') return t as ColumnType;
  switch (t) {
    case 'datetime':
      return 'timestamp';
    case 'longtext':
    case 'mediumtext':
      return 'text';
    case 'tinyint':
      return 'smallint';
    case 'mediumblob':
      return 'bytea';
    case 'json':
      return 'jsonb';
    case 'float':
    case 'double':
      return 'double precision';
    default:
      return t as ColumnType;
  }
}

export function ciTextFor(dialect: Dialect): ColumnType {
  return dialect === 'mysql' ? 'varchar' : 'citext';
}

export function UuidPrimaryColumnFor(
  dialect: Dialect,
  options?: { name?: string },
): PropertyDecorator {
  if (dialect === 'mysql') {
    // exactly PrimaryGeneratedColumn('uuid'): today's metadata, unchanged
    return PrimaryGeneratedColumn('uuid', options);
  }
  return Column({
    name: options?.name,
    type: 'varchar',
    length: 36,
    primary: true,
    default: () => 'gen_random_uuid()::text',
  });
}

export function UpdatedAtColumnFor(dialect: Dialect, options: ColumnOptions): PropertyDecorator {
  const type = columnTypeFor(dialect, (options.type as string | undefined) ?? 'datetime');
  const onUpdate =
    dialect === 'mysql'
      ? options.precision !== undefined
        ? `CURRENT_TIMESTAMP(${options.precision})`
        : 'CURRENT_TIMESTAMP'
      : undefined;
  return Column({ ...options, type: type as ColumnType, onUpdate });
}
