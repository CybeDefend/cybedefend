import {
  Column,
  type ColumnType,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { DataPurgeJob } from './data-purge-job.entity';

export type PurgeStepName =
  | 'analysis_reporting'
  | 'security_scanning'
  | 'file_management'
  | 'agent'
  | 'integrations'
  | 'policy'
  | 'billing'
  | 'permify'
  | 'marketing';
export type PurgeStepStatus = 'pending' | 'done';

/**
 * One service's share of a purge job. `(jobId, step)` is the primary key, so
 * a job holds each step once.
 */
@Entity('data_purge_step')
export class DataPurgeStep {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  jobId: string;

  @PrimaryColumn({ type: 'varchar', length: 32 })
  step: PurgeStepName;

  @ManyToOne(() => DataPurgeJob, (job) => job.steps, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'jobId',
    foreignKeyConstraintName: 'FK_data_purge_step_job',
  })
  job: DataPurgeJob;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PurgeStepStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: columnType('datetime') as ColumnType, precision: 3 })
  nextAttemptAt: Date;

  /** A gRPC status name (`UNAVAILABLE`), never an error message. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  lastErrorCode: string | null;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  doneAt: Date | null;

  /** The counts the service answered, per table or bucket. */
  @Column({ type: columnType('json') as ColumnType, nullable: true })
  deleted: Record<string, number> | null;
}
