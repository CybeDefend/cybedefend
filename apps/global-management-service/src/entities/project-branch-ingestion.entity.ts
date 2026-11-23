import {
  Column,
  Entity,
  ManyToOne,
  CreateDateColumn,
  Unique,
  JoinColumn,
} from 'typeorm';
import { UpdatedAtColumn, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Project } from './project.entity';

/**
 * Status of the branch ingestion in Potpie.
 */
export enum BranchIngestionStatus {
  PARSING = 'parsing',
  PARSED = 'parsed',
  FAILED = 'failed',
}

/**
 * Tracks the ingestion status for each branch of a project in Potpie.
 * This allows multi-branch support where each branch can be independently
 * ingested and used for AI features (code conversations, vulnerability analysis, etc.)
 *
 * Communication with Potpie uses (projectId, branch) as identifiers.
 * Potpie manages its own internal project IDs based on these two fields.
 */
@Entity('project_branch_ingestion')
@Unique(['projectId', 'branch'])
export class ProjectBranchIngestion {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'varchar', length: 255 })
  branch: string;

  /**
   * The scan ID that triggered the last successful parsing.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  lastParsedScanId: string | null;

  /**
   * When the last successful parsing completed.
   */
  @Column({ type: 'timestamp', nullable: true })
  lastParsedAt: Date | null;

  /**
   * Current status of the ingestion for this branch.
   */
  @Column({
    type: 'enum',
    enum: BranchIngestionStatus,
    default: BranchIngestionStatus.PARSING,
  })
  status: BranchIngestionStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;
}
