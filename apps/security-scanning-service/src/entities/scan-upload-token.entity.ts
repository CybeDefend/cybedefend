import {
  Column,
  ColumnType,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { columnType, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Scan } from './scan.entity';
import { Container } from './container.entity';

/**
 * The upload token of one scanner container of a Community cluster scan.
 * The pod receives the token through its Secret;
 * only the SHA-256 hex of the whole `cdst_…` string is stored. It is spent
 * once (`usedAt`), by SubmitScanResults. Both foreign keys cascade, so
 * deleting a scan (or one of its containers) deletes its tokens.
 *
 * Migration: core/migrations-common/1778500000000-AddScanUploadToken.ts.
 */
@Entity('scan_upload_token')
@Index('IDX_scan_upload_token_scanId', ['scanId'])
@Index('UQ_scan_upload_token_containerId', ['containerId'], { unique: true })
@Index('UQ_scan_upload_token_tokenHash', ['tokenHash'], { unique: true })
export class ScanUploadToken {
  @UuidPrimaryColumn()
  id: string;

  @Column({ type: 'varchar', length: 36 })
  scanId: string;

  @ManyToOne(() => Scan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scanId' })
  scan?: Scan;

  @Column({ type: 'varchar', length: 36 })
  containerId: string;

  @ManyToOne(() => Container, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'containerId' })
  container?: Container;

  /** SHA-256 hex of the token. */
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  /** The import category of the container's results (sast, cicd, secret, iac, sca). */
  @Column({ type: 'varchar', length: 16 })
  category: string;

  /** Comma-separated severities kept by the import (critical,high,medium,low). */
  @Column({ type: 'varchar', length: 64 })
  severities: string;

  @Column({ type: columnType('datetime') as ColumnType, precision: 3 })
  expiresAt: Date;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    nullable: true,
  })
  usedAt: Date | null;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  createdAt: Date;
}
