import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ColumnType,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

export type AggregatedReportScopeType = 'organization' | 'team' | 'batch';
export type AggregatedReportStatus = 'queued' | 'ready' | 'failed';

/**
 * Status row for an async-generated aggregated security report
 * (organization / team / batch × owasp|cwe|license|ai-act).
 *
 * Mirrors GeneratedReport (per-project): the binary lives in object storage only —
 * `objectPath` is persisted so the download URL can be re-minted on demand
 * via ReportUploadService.signExisting(). No report content is stored here.
 */
@Entity('aggregated_reports')
@Index(['scopeType', 'scopeId', 'createdAt'])
// Org-scoped quota counting + retention purge.
@Index('IDX_aggregated_reports_org_status_expires', [
  'organizationId',
  'status',
  'expiresAt',
])
@Index('IDX_aggregated_reports_expires_at', ['expiresAt'])
export class AggregatedReport {
  // App-assigned ULID (client-visible reportId), same convention as
  // GeneratedReport. NOT DB-generated so the id flows into the queue job and
  // realtime event without a round-trip.
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 50 })
  @Index()
  scopeType: AggregatedReportScopeType;

  @Column({ name: 'scope_id', type: 'varchar', length: 255 })
  @Index()
  scopeId: string; // organizationId, teamId, or comma-separated projectIds (batch)

  // Owning organization — used for batch/team channel routing and for the
  // org poll route's ownership check. For org scope, equals scopeId.
  @Column({
    name: 'organization_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Index()
  organizationId: string | null;

  @Column({ name: 'report_type', type: 'varchar', length: 50 })
  @Index()
  reportType: string; // 'owasp' | 'cwe' | 'license' | 'ai-act'

  @Column({ type: 'varchar', length: 20, default: 'json' })
  format: string; // 'json' | 'html' | 'pdf'

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  @Index()
  status: AggregatedReportStatus;

  @Column({
    name: 'object_path',
    type: 'varchar',
    length: 1024,
    nullable: true,
  })
  objectPath: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  filename: string | null;

  @Column({
    name: 'content_type',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  contentType: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  error: string | null;

  // Instant at which this report is purged (storage object + row).
  // Computed at creation = createdAt + plan retentionDays. NULL = never expire.
  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 6,
    nullable: true,
  })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
