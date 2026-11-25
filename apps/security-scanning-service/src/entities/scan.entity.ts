import {
  Entity,
  Column,
  ColumnType,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { columnType, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Container } from './container.entity';
import type { UploadFilterSummary } from '@grpc/security-scanning/scan';

@Entity()
@Index('IDX_scan_projectId_state', ['projectId', 'state'])
@Index('IDX_scan_projectId_createAt', ['projectId', 'createAt'])
@Index('IDX_scan_projectId_branch', ['projectId', 'branch'])
@Index('IDX_scan_organizationId_state', ['organizationId', 'state'])
@Index('IDX_scan_state_createAt', ['state', 'createAt'])
// Lets "last scan"/scan-list queries cheaply exclude diff scans.
@Index('IDX_scan_projectId_isDiffScan', ['projectId', 'isDiffScan'])
// Per-user parallel diff-scan quota count (org + user + isDiffScan).
@Index('IDX_scan_orgId_userId_isDiffScan', [
  'organizationId',
  'initializerUserId',
  'isDiffScan',
])
export class Scan {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: [
      'waiting_for_file',
      'queued',
      'running',
      'completed',
      'completed_degraded',
      'failed',
      'cancelled',
    ],
    default: 'waiting_for_file',
  })
  state: string;

  @Column('simple-array')
  language: string[];

  @Column()
  projectId: string;

  @Column()
  organizationId: string;

  @Column({ default: false })
  private: boolean;

  @Column({ nullable: true })
  initializerUserId?: string;

  @CreateDateColumn()
  createAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  scanType?: string;

  @Column({ type: 'timestamp', nullable: true })
  startTime?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endTime?: Date;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ default: 0 })
  totalLOC: number;

  @Column({ default: '0Mo' })
  totalSize: string;

  @Column({ type: columnType('json') as ColumnType, nullable: true })
  metadata: Record<string, any>;

  @Column({ nullable: true })
  branch?: string;

  // True when this scan is a diff scan (SAST/IaC/secret on changed
  // files only, agent/MCP path). Diff scans never auto-resolve out-of-scope
  // vulns, are excluded from "last scan"/posture, and skip Cybe analysis.
  @Column({ default: false })
  isDiffScan: boolean;

  // A graph-only scan (closed extension): no scanner pod, no entitlement
  // gate, no counter: only the agent ingestion (code graph, then rule
  // mining), never Cybe analysis.
  // Hidden from the AppSec scan lists. No explicit `type`: TypeORM then
  // hydrates the TINYINT(1) as a boolean (an explicit tinyint comes back as
  // 0/1); read it by truthiness anyway.
  @Column({ default: false })
  isGraphOnly: boolean;

  // Closed extension: set once, by the conditional UPDATE that claims a diff
  // scan's settle / release on its terminal transition (`DiffScanUnitCloser`). Not selected, so a `save()`
  // of a loaded scan never writes it back.
  @Column({ default: false, select: false, insert: false })
  vibedefendUnitClosed: boolean;

  @OneToMany(() => Container, (container) => container.scan)
  containers: Container[];

  @Column({ nullable: true })
  errorMessage?: string;

  @Column({ type: 'int', nullable: true })
  errorCode?: number;

  @Column({ nullable: true })
  errorCategory?: string;

  // Import scans: `importFormat IS NOT NULL`
  // is the one definition of an import scan. `importTool` is the
  // comma-separated tool list `CompleteImportScan.tool_name` reports.
  @Column({ type: 'varchar', length: 16, nullable: true })
  importFormat?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  importTool?: string | null;

  // When analysis-reporting reported every scanner of the scan finalized.
  // Null until then, and on rows older than this column.
  @Column({ type: 'timestamp', nullable: true })
  resultsFinalizedAt?: Date | null;

  // What the upload filter left out of the archive the scanners read
  // (counts by reason, at most 20 excluded folders), bounded when stored.
  // Null on a scan with no upload and on rows older than this column.
  // Written only by its own targeted UPDATE (ScanService.startScan): left
  // out of the update set, so a save() of a copy of the scan loaded before
  // that write never puts null back over it.
  @Column({
    type: columnType('json') as ColumnType,
    nullable: true,
    update: false,
  })
  uploadFilterSummary?: UploadFilterSummary | null;

  // The highest progress already served for the scan, shared by every pod so
  // it never goes down.
  @Column({ type: 'int', default: 0 })
  progressHighWater: number;

  // Policy evaluation results (populated after scan completion)
  @Column({ type: 'boolean', nullable: true })
  policyPassed?: boolean;

  @Column({ type: 'int', default: 0 })
  policyBlockingCount: number;

  @Column({ type: 'int', default: 0 })
  policyWarningCount: number;
}
