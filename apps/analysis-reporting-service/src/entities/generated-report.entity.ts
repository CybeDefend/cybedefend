// generated-report.entity.ts
//
// Premium report (OWASP / CWE / EU AI Act / scanner-type) generated
// asynchronously by the analysis worker. The gRPC handler inserts one row
// (status="queued") and enqueues a BullMQ job; the worker builds the PDF/HTML,
// uploads it to object storage, then stores `objectPath` and flips status to "ready"
// (or "failed" + error). The signed download URL is NOT persisted — it is
// re-minted on demand from `objectPath` so it survives URL expiry.

import {
  Entity,
  PrimaryColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ColumnType,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

export type GeneratedReportKind =
  | 'owasp'
  | 'cwe'
  | 'eu_ai_act'
  | 'scanner_type';

export type GeneratedReportStatus = 'queued' | 'ready' | 'failed';

@Entity('generated_reports')
@Index('IDX_generated_reports_project', ['projectId'])
// Org-scoped quota counting + retention purge.
@Index('IDX_generated_reports_org_status_expires', [
  'organizationId',
  'status',
  'expiresAt',
])
@Index('IDX_generated_reports_expires_at', ['expiresAt'])
export class GeneratedReport extends BaseEntity {
  // ULID minted by the gRPC handler (not auto-generated) so the same id is
  // returned to the caller and carried through the queue + realtime event.
  @PrimaryColumn({ length: 36 })
  id: string;

  @Column({ length: 36 })
  projectId: string;

  // Owning organization, denormalized at creation (resolved from
  // projectId) so quota counting / LIST / purge are org-scoped without a
  // per-request round-trip to global-management. NULL only for legacy rows.
  @Column({ length: 36, nullable: true })
  organizationId: string | null;

  @Column({ length: 32 })
  kind: GeneratedReportKind;

  @Column({ length: 16 })
  format: string; // json | html | pdf | md

  @Column({ default: true })
  detailed: boolean;

  @Column({ length: 191, nullable: true })
  branch: string | null;

  // scanner-type only: subset of {sast,iac,cicd,sca,container,secret}.
  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      to: (v: string[] | null) => (v && v.length ? JSON.stringify(v) : null),
      from: (v: string | null) => (v ? (JSON.parse(v) as string[]) : null),
    },
  })
  scannerTypes: string[] | null;

  @Column({ length: 255, nullable: true })
  filename: string | null;

  @Column({ length: 128, nullable: true })
  contentType: string | null;

  // storage object key, set once the worker has uploaded the artifact.
  @Column({ length: 512, nullable: true })
  objectPath: string | null;

  @Column({ length: 16, default: 'queued' })
  status: GeneratedReportStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  // Instant at which this report is purged (storage object + row).
  // Computed at creation = createdAt + plan retentionDays. NULL = never expire
  // (enterprise/unlimited) or legacy rows created before retention existed.
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
