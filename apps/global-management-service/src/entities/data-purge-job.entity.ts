import {
  Column,
  type ColumnType,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { DataPurgeStep } from './data-purge-step.entity';

export type PurgeKind = 'project' | 'team' | 'organization';
export type PurgeJobStatus = 'pending' | 'done' | 'halted';

/**
 * One deleted project, team or organization whose data the other services
 * still have to delete. Written in the transaction that
 * deletes the subject's global-management rows, and kept once done as the
 * evidence of the erasure: ids, dates and counts only, never a name.
 */
@Entity('data_purge_job')
@Index('IDX_data_purge_job_status_next_attempt', ['status', 'nextAttemptAt'])
@Index('IDX_data_purge_job_subject', ['subjectId'])
export class DataPurgeJob {
  /** Set by the ledger, never by the database (no re-select after a bulk insert). */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: PurgeKind;

  /** The project, team or organization id. */
  @Column({ type: 'varchar', length: 36 })
  subjectId: string;

  /** Always set: a project and a team job name their organization too. */
  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  /** Organization jobs only: the team ids read before the delete cascaded them. */
  @Column({ type: columnType('json') as ColumnType, nullable: true })
  teamIds: string[] | null;

  @Column({ type: columnType('datetime') as ColumnType, precision: 3 })
  deletedAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PurgeJobStatus;

  /** 1, then 2 for the second pass 24 h after the first one completed. */
  @Column({ type: 'int', default: 1 })
  pass: number;

  @Column({ type: columnType('datetime') as ColumnType, precision: 3 })
  nextAttemptAt: Date;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  leaseUntil: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  leaseToken: string | null;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  completedAt: Date | null;

  @OneToMany(() => DataPurgeStep, (step) => step.job)
  steps: DataPurgeStep[];
}
