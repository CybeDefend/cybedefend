import { DataSource } from 'typeorm';
import type { DataSourceOptions, EntityMetadata } from 'typeorm';
import { join } from 'node:path';
import type { Dialect } from '@cybedefend/db-dialect';

/** The service root (`src/` under ts-node, `dist/` once built). */
const ROOT = join(__dirname, '..', '..');

export interface ColumnSnapshot {
  table: string;
  property: string;
  column: string;
  type: string | null;
  length: string | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  primary: boolean;
  generationStrategy: string | null;
  default: string | null;
  onUpdate: string | null;
  enum: string[] | null;
  unsigned: boolean;
  width: number | null;
}

export interface IndexSnapshot {
  table: string;
  name: string | null;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeySnapshot {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
}

export interface EntityMetadataSnapshot {
  columns: ColumnSnapshot[];
  indexes: IndexSnapshot[];
  foreignKeys: ForeignKeySnapshot[];
}

/**
 * A DataSource that only builds entity metadata: `buildMetadatas()` never
 * connects, so the driver's host/port are placeholders.
 */
export function metadataDataSource(
  dialect: Dialect,
  entities?: DataSourceOptions['entities'],
): DataSource {
  return new DataSource({
    type: dialect,
    database: 'unused',
    entities: entities ?? [join(ROOT, 'entities/*.entity{.ts,.js}')],
  } as DataSourceOptions);
}

type ColumnMetadata = EntityMetadata['columns'][number];

function columnTypeOf(column: ColumnMetadata): string | null {
  const type = column.type;
  if (type === undefined || type === null) return null;
  return typeof type === 'function' ? type.name : String(type);
}

function defaultOf(column: ColumnMetadata): string | null {
  const d = column.default;
  if (d === undefined || d === null) return null;
  return String(typeof d === 'function' ? d() : d);
}

function enumOf(column: ColumnMetadata): string[] | null {
  const e = column.enum;
  if (e === undefined || e === null) return null;
  if (Array.isArray(e)) return e.map(String);
  return Object.values(e as Record<string, unknown>).map(String);
}

/**
 * A JSON-serialisable snapshot of the core entities' metadata, sorted by
 * table then column, so a refactor that silently changes a column type, a
 * default or an index fails the committed snapshot instead of production.
 */
export async function entityMetadataSnapshot(
  dataSource: DataSource,
): Promise<EntityMetadataSnapshot> {
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  const metadatas = (
    dataSource as unknown as { entityMetadatas: EntityMetadata[] }
  ).entityMetadatas;

  const columns: ColumnSnapshot[] = [];
  const indexes: IndexSnapshot[] = [];
  const foreignKeys: ForeignKeySnapshot[] = [];

  for (const metadata of metadatas) {
    for (const column of metadata.columns) {
      columns.push({
        table: metadata.tableName,
        property: column.propertyName,
        column: column.databaseName,
        type: columnTypeOf(column),
        length: column.length ?? null,
        precision: column.precision ?? null,
        scale: column.scale ?? null,
        nullable: column.isNullable,
        primary: column.isPrimary,
        generationStrategy: column.generationStrategy ?? null,
        default: defaultOf(column),
        onUpdate: column.onUpdate ?? null,
        enum: enumOf(column),
        unsigned: column.unsigned,
        width: column.width ?? null,
      });
    }
    for (const index of metadata.indices) {
      indexes.push({
        table: metadata.tableName,
        name: index.name ?? null,
        columns: index.columns.map((c) => c.databaseName),
        unique: index.isUnique,
      });
    }
    for (const unique of metadata.uniques) {
      indexes.push({
        table: metadata.tableName,
        name: unique.name ?? null,
        columns: unique.columns.map((c) => c.databaseName),
        unique: true,
      });
    }
    for (const fk of metadata.foreignKeys) {
      foreignKeys.push({
        table: metadata.tableName,
        columns: fk.columnNames,
        refTable: fk.referencedTablePath,
        refColumns: fk.referencedColumnNames,
        onDelete: fk.onDelete ?? null,
      });
    }
  }

  columns.sort((a, b) =>
    a.table === b.table
      ? a.column.localeCompare(b.column)
      : a.table.localeCompare(b.table),
  );
  indexes.sort((a, b) =>
    a.table === b.table
      ? String(a.name).localeCompare(String(b.name))
      : a.table.localeCompare(b.table),
  );
  foreignKeys.sort((a, b) =>
    a.table === b.table
      ? a.columns.join(',').localeCompare(b.columns.join(','))
      : a.table.localeCompare(b.table),
  );

  return { columns, indexes, foreignKeys };
}
