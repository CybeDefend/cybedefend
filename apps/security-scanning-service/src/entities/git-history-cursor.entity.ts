import { Column, ColumnType, Entity, Index, UpdateDateColumn } from 'typeorm';
import { columnType, UuidPrimaryColumn } from '@cybedefend/db-dialect';

/**
 * How far the git history of one branch of a project has been scanned: the
 * tip the last pass reached, the oldest date covered and the ranges given up
 * (gaps). One row per (project, branch).
 */
@Entity('git_history_cursor')
@Index('UQ_git_history_cursor_project_branch', ['projectId', 'branch'], {
  unique: true,
})
export class GitHistoryCursor {
  @UuidPrimaryColumn()
  id: string;

  @Column({ type: 'varchar', length: 36 })
  projectId: string;

  @Column({ type: 'varchar', length: 255 })
  branch: string;

  // Names the repository the cursor belongs to; a renamed or re-linked
  // repository must not reuse another one's tip.
  @Column({ type: 'varchar', length: 255 })
  repositoryKey: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tipSha: string | null;

  @Column({ type: 'timestamp', precision: 0, nullable: true })
  coveredSince: Date | null;

  @Column({ type: 'boolean', default: false })
  complete: boolean;

  @Column({ type: columnType('json') as ColumnType, nullable: true })
  gaps: { fromSha: string; toSha: string }[] | null;

  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lastPassOutcome: string | null;

  @UpdateDateColumn({ type: 'timestamp', precision: 0 })
  updatedAt: Date;
}
