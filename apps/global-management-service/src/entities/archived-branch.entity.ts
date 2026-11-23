import {
  Column,
  Entity,
  ManyToOne,
  CreateDateColumn,
  Unique,
  JoinColumn,
} from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Project } from './project.entity';

/**
 * Tracks archived branches per project.
 * An archived branch is hidden from branch selectors by default
 * but can be revealed with a toggle.
 */
@Entity('archived_branch')
@Unique(['projectId', 'branchName'])
export class ArchivedBranch {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'varchar', length: 36 })
  projectId: string;

  @Column({ type: 'varchar', length: 255 })
  branchName: string;

  @CreateDateColumn()
  archivedAt: Date;
}
