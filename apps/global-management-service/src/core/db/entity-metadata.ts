import type { DataSource, EntityMetadata } from 'typeorm';

type ColumnMetadata = EntityMetadata['columns'][number];

/**
 * A serialisable snapshot of the entity metadata: what the MySQL snapshot spec
 * commits (the cloud's entities must not drift silently) and what the
 * PostgreSQL spec checks (no MySQL-only type, no onUpdate, varchar(36) ids,
 * citext where the code compares case-insensitively).
 *
 * Built with `buildMetadatas()`, which resolves the metadata without opening a
 * connection, the way analysis-reporting's results-live-db.ts does.
 */

export interface SnapshotColumn {
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
  unsigned: boolean | null;
  width: number | null;
}

export interface SnapshotIndex {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
}

export interface SnapshotForeignKey {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
}

export interface EntityMetadataSnapshot {
  columns: SnapshotColumn[];
  indexes: SnapshotIndex[];
  foreignKeys: SnapshotForeignKey[];
}

function columnTypeOf(dataSource: DataSource, column: ColumnMetadata): string {
  if (typeof column.type === 'function') {
    // A reflected type (String, Date, …): record what the driver makes of it,
    // so `@Column()` and `@Column({ type: 'varchar' })` compare equal on mysql.
    const driver = dataSource.driver as unknown as {
      normalizeType: (c: ColumnMetadata) => string;
    };
    return driver.normalizeType(column);
  }
  // An explicit type string is recorded raw, so the postgres spec sees the
  // mysql-only types an entity edit forgot to route through columnType().
  return String(column.type);
}

function columnDefaultOf(column: ColumnMetadata): string | null {
  if (typeof column.default === 'function') {
    return String((column.default as () => unknown)());
  }
  return column.default != null ? String(column.default) : null;
}

function columnOf(
  dataSource: DataSource,
  metadata: EntityMetadata,
  column: ColumnMetadata,
): SnapshotColumn {
  const raw = column as unknown as Record<string, unknown>;
  return {
    table: metadata.tableName,
    property: column.propertyName,
    column: column.databaseName,
    type: columnTypeOf(dataSource, column),
    length: column.length ?? null,
    precision: column.precision ?? null,
    scale: column.scale ?? null,
    nullable: column.isNullable,
    primary: column.isPrimary,
    generationStrategy: column.generationStrategy ?? null,
    default: columnDefaultOf(column),
    onUpdate: column.onUpdate ?? null,
    enum: column.enum ? [...column.enum] : null,
    unsigned: (raw.unsigned as boolean | undefined) ?? null,
    width: column.width ?? null,
  };
}

export async function entityMetadataSnapshot(
  dataSource: DataSource,
): Promise<EntityMetadataSnapshot> {
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();

  const columns: SnapshotColumn[] = [];
  const indexes: SnapshotIndex[] = [];
  const foreignKeys: SnapshotForeignKey[] = [];

  for (const metadata of dataSource.entityMetadatas) {
    for (const column of metadata.columns) {
      columns.push(columnOf(dataSource, metadata, column));
    }
    for (const index of [...metadata.indices, ...metadata.uniques]) {
      indexes.push({
        table: metadata.tableName,
        name: index.name,
        columns: index.columns.map((c) => c.databaseName),
        unique: 'isUnique' in index ? Boolean(index.isUnique) : true,
      });
    }
    for (const fk of metadata.foreignKeys) {
      foreignKeys.push({
        table: metadata.tableName,
        columns: fk.columns.map((c) => c.databaseName),
        refTable: fk.referencedTablePath,
        refColumns: fk.referencedColumns.map((c) => c.databaseName),
        onDelete: fk.onDelete ?? null,
      });
    }
  }

  columns.sort(
    (a, b) =>
      a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );
  indexes.sort(
    (a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name),
  );
  foreignKeys.sort(
    (a, b) =>
      a.table.localeCompare(b.table) ||
      a.columns.join(',').localeCompare(b.columns.join(',')),
  );

  return { columns, indexes, foreignKeys };
}
