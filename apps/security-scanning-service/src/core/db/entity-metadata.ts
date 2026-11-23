import type { DataSource, EntityMetadata } from 'typeorm';

type ColumnMetadata = EntityMetadata['columns'][number];
type IndexMetadata = EntityMetadata['indices'][number];
type ForeignKeyMetadata = EntityMetadata['foreignKeys'][number];

/**
 * A JSON-serialisable snapshot of the core entities' metadata, built without
 * connecting (buildMetadatas()). entity-metadata.mysql.spec.ts pins it to the
 * committed __snapshots__/entity-metadata.mysql.json, so a refactor that
 * silently moves the MySQL metadata fails; entity-metadata.postgres.spec.ts
 * asserts the portable shape on the postgres dialect.
 */

export interface EntityColumnSnapshot {
  table: string;
  property: string;
  column: string;
  /** a function type by its name */
  type: string;
  length: string | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  primary: boolean;
  generationStrategy: string | null;
  /** a function default by its result */
  default: string | null;
  onUpdate: string | null;
  enum: (string | number)[] | null;
  unsigned: boolean;
  width: number | null;
}

export interface EntityIndexSnapshot {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
}

export interface EntityForeignKeySnapshot {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
}

export interface EntityMetadataSnapshot {
  columns: EntityColumnSnapshot[];
  indices: EntityIndexSnapshot[];
  foreignKeys: EntityForeignKeySnapshot[];
}

const columnSnapshot = (
  metadata: EntityMetadata,
  column: ColumnMetadata,
): EntityColumnSnapshot => ({
  table: metadata.tableName,
  property: column.propertyName,
  column: column.databaseName,
  type:
    typeof column.type === 'function'
      ? (column.type as { name: string }).name
      : String(column.type),
  length:
    column.length === undefined || column.length === ''
      ? null
      : String(column.length),
  precision: column.precision ?? null,
  scale: column.scale ?? null,
  nullable: column.isNullable,
  primary: column.isPrimary,
  generationStrategy: column.generationStrategy ?? null,
  default:
    typeof column.default === 'function'
      ? String(column.default())
      : column.default === undefined || column.default === null
        ? null
        : String(column.default),
  onUpdate: column.onUpdate ?? null,
  enum: column.enum ? [...column.enum] : null,
  unsigned: column.unsigned,
  width: column.width ?? null,
});

const indexSnapshot = (
  metadata: EntityMetadata,
  index: IndexMetadata,
): EntityIndexSnapshot => ({
  table: metadata.tableName,
  name: index.name,
  columns: index.columns.map((c) => c.databaseName),
  unique: index.isUnique,
});

const foreignKeySnapshot = (
  metadata: EntityMetadata,
  fk: ForeignKeyMetadata,
): EntityForeignKeySnapshot => ({
  table: metadata.tableName,
  columns: fk.columns.map((c) => c.databaseName),
  refTable: fk.referencedTablePath,
  refColumns: fk.referencedColumns.map((c) => c.databaseName),
  onDelete: fk.onDelete ?? null,
});

export async function entityMetadataSnapshot(
  dataSource: DataSource,
): Promise<EntityMetadataSnapshot> {
  // Builds the entity metadata; never connects.
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();

  const metadatas = [...dataSource.entityMetadatas];
  const columns = metadatas
    .flatMap((m) => m.columns.map((c) => columnSnapshot(m, c)))
    .sort((a, b) =>
      a.table === b.table
        ? a.column.localeCompare(b.column)
        : a.table.localeCompare(b.table),
    );
  const indices = metadatas
    .flatMap((m) => m.indices.map((i) => indexSnapshot(m, i)))
    .sort((a, b) =>
      a.table === b.table
        ? a.name.localeCompare(b.name)
        : a.table.localeCompare(b.table),
    );
  const foreignKeys = metadatas
    .flatMap((m) => m.foreignKeys.map((f) => foreignKeySnapshot(m, f)))
    .sort((a, b) =>
      a.table === b.table
        ? a.columns.join(',').localeCompare(b.columns.join(','))
        : a.table.localeCompare(b.table),
    );

  return { columns, indices, foreignKeys };
}
