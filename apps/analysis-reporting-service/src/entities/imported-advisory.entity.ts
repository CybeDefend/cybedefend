import { Column, ColumnType, Entity, Index, PrimaryColumn } from 'typeorm';
import type { ValueTransformer } from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

/** One fixed version of one package, as an import declared it. */
export interface ImportedAdvisoryFix {
  ecosystem: string;
  packageName: string;
  fixed: string;
}

/**
 * A JSON array kept in a long text column: the same column type on both
 * engines (longtext on MySQL, text on PostgreSQL), never a json/jsonb pair.
 */
const jsonArray: ValueTransformer = {
  to: (value: unknown): string | null =>
    value === undefined || value === null ? null : JSON.stringify(value),
  from: (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || value === '') return [];
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
};

/**
 * The advisory content a results import declared, owned by the project it
 * was imported into. One row per (project, advisory): the latest import into
 * that project replaces it, the batches of one import add to it.
 *
 * The shared advisory catalogue (`vulnerability_osv` and its children) never
 * receives this content: an import only makes sure the catalogue has a root
 * row with the advisory id, so a detection can reference it. The reads of a
 * project's findings take the text, aliases, references, fixed versions and
 * severity rows of an imported advisory from here.
 */
@Entity('imported_advisory')
@Index('IDX_imported_advisory_org', ['organizationId'])
export class ImportedAdvisory {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  projectId: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  advisoryId: string;

  /** The project's organization, for the organization purge. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  organizationId: string | null;

  /** The import (scan) that last wrote the row. */
  @Column({ type: 'varchar', length: 36 })
  scanId: string;

  @Column({ type: 'varchar', length: 255 })
  toolName: string;

  @Column({ type: columnType('longtext') as ColumnType, nullable: true })
  summary: string | null;

  @Column({ type: columnType('longtext') as ColumnType, nullable: true })
  details: string | null;

  /** critical | high | medium | low, as the import declared it. */
  @Column({ type: 'varchar', length: 16 })
  severity: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cvssV3Vector: string | null;

  @Column({
    type: columnType('longtext') as ColumnType,
    nullable: true,
    transformer: jsonArray,
  })
  cweIds: string[];

  @Column({
    type: columnType('longtext') as ColumnType,
    nullable: true,
    transformer: jsonArray,
  })
  aliases: string[];

  /** https URLs only. */
  @Column({
    type: columnType('longtext') as ColumnType,
    nullable: true,
    transformer: jsonArray,
  })
  referenceUrls: string[];

  @Column({
    type: columnType('longtext') as ColumnType,
    nullable: true,
    transformer: jsonArray,
  })
  fixes: ImportedAdvisoryFix[];

  @Column({
    type: 'timestamp',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  updatedAt: Date;
}
