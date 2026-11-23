import {
  Entity,
  Column,
  ManyToOne,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  ColumnType,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { SastVulnerabilityDetections } from './sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from './iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from './cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from './secret-vulnerability-detections.entity';

@Entity('autofix_records')
@Index('IDX_autofix_proj_vulntype', ['projectId', 'vulnerabilityType'])
export class AutoFixRecord {
  @UuidPrimaryColumn()
  id: string;

  @Index()
  @Column()
  projectId: string;

  @Index()
  @Column()
  vulnerabilityId: string; // UUID of logical vulnerability (links to Vulnerability.id)

  @Index()
  @Column()
  detectionId: string; // Detection ID for the snapshot fixed (can be SAST, IAC, CICD, or Secret)

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'sast' })
  vulnerabilityType: string; // sast | iac | cicd | secret

  @Column({ type: 'text' })
  branch: string;

  @Column({ type: 'text', nullable: true })
  prUrl: string | null;

  @Column({ type: columnType('json') as ColumnType })
  edits: any; // raw edits JSON returned by LLM (for audit)

  @Column({ type: 'text' })
  commitMessage: string;

  @Column({ type: 'text' })
  prTitle: string;

  @Column({ type: columnType('longtext') as ColumnType })
  prBody: string;

  @Column({ type: columnType('longtext') as ColumnType, nullable: true })
  diff: string | null; // unified diff applied

  @Column({ type: 'varchar', length: 32 })
  status: string; // in_progress | ok | noop | error

  @Column({ type: 'text', nullable: true })
  reason: string | null; // error code or NO_CHANGES

  // Async correlation ID returned by the AI agent enqueue. Set when the
  // autofix is dispatched asynchronously; used by FinalizeAutoFix to locate
  // the in-progress record when the worker reports the result. Null for
  // legacy synchronous records.
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  taskId: string | null;

  // Triggering user id, captured at enqueue. Used by FinalizeAutoFix to credit
  // back the pre-consumed billing unit to the SAME user that consumed it (the
  // per-user quota must be reversed symmetrically). Null for legacy records.
  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations to different vulnerability detection types (only one will be set based on vulnerabilityType)
  @ManyToOne(() => SastVulnerabilityDetections, (det) => det.autofixRecords, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  sastDetection: SastVulnerabilityDetections | null;

  @ManyToOne(() => IacVulnerabilityDetections, (det) => det.autofixRecords, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  iacDetection: IacVulnerabilityDetections | null;

  @ManyToOne(() => CicdVulnerabilityDetections, (det) => det.autofixRecords, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  cicdDetection: CicdVulnerabilityDetections | null;

  @ManyToOne(() => SecretVulnerabilityDetections, (det) => det.autofixRecords, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  secretDetection: SecretVulnerabilityDetections | null;

  // Legacy getter for backwards compatibility
  get detection():
    | SastVulnerabilityDetections
    | IacVulnerabilityDetections
    | CicdVulnerabilityDetections
    | SecretVulnerabilityDetections
    | null {
    return (
      this.sastDetection ||
      this.iacDetection ||
      this.cicdDetection ||
      this.secretDetection
    );
  }
}
