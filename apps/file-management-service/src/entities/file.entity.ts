import {
  Entity,
  Index,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';

export enum FileStatus {
  PENDING_UPLOAD = 'PENDING_UPLOAD',
  PROCESSING = 'PROCESSING',
  UPLOADED = 'UPLOADED',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

@Entity()
@Index('IDX_file_scan_status_createdAt', ['status', 'createdAt'])
@Index('IDX_file_scan_status_updatedAt', ['status', 'updatedAt'])
@Index('IDX_file_scan_scanId', ['scanId'])
@Index('IDX_file_scan_projectId', ['projectId'])
export class FileScan {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  scanId: string;

  @Column()
  fileName: string;

  @Column()
  typeScan: string;

  @Column()
  projectId: string;

  @Column({
    type: 'enum',
    enum: FileStatus,
    default: FileStatus.PENDING_UPLOAD,
  })
  status: FileStatus;

  @Column({ nullable: true })
  objectPath: string;

  // A diff-scan upload carries an untrusted, agent-built ZIP. When
  // true, the cron applies the strict diff guards (path traversal / .git /
  // caps / exclusions) to the uploaded archive before scanning. Normal scans
  // (false) skip those guards — a full-repo ZIP legitimately exceeds the caps
  // and keeps `.git` for gitleaks.
  @Column({ type: 'boolean', default: false })
  isDiffScan: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  constructor(
    scanId: string,
    fileName: string,
    typeScan: string,
    projectId: string,
    status: FileStatus = FileStatus.PENDING_UPLOAD,
  ) {
    this.scanId = scanId;
    this.fileName = fileName;
    this.typeScan = typeScan;
    this.projectId = projectId;
    this.status = status;
  }
}
