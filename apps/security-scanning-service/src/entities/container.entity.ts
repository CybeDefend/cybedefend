import {
  Entity,
  Column,
  ColumnType,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { columnType, UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { Scan } from './scan.entity';
import { Scanner } from './scanner.entity';

@Entity()
@Index('IDX_container_scanId_status', ['scanId', 'status'])
@Index('IDX_container_podName_scanId', ['podName', 'scanId'])
@Index('IDX_container_status_createdAt', ['status', 'createdAt'])
export class Container {
  @UuidPrimaryColumn()
  id: string;

  @Column({ nullable: true })
  clusterId: string;

  @Column({ nullable: true })
  clusterName: string;

  @Column({ nullable: true })
  clusterEndpoint: string;

  @Column()
  podName: string;

  @Column({ nullable: true })
  podUid: string;

  @Column()
  image: string;

  @Column({ nullable: true })
  version: string;

  @Column()
  status: string;

  // `disable`: saving a scan whose `containers` were loaded before another
  // container was inserted must not detach that row. The default `nullify`
  // planned `SET scanId = NULL` on the NOT NULL column and failed the whole
  // UpdateScan. No code removes a container by
  // dropping it from `scan.containers`.
  @ManyToOne(() => Scan, (scan) => scan.containers, {
    onDelete: 'CASCADE',
    orphanedRowAction: 'disable',
  })
  @JoinColumn({ name: 'scanId' })
  scan: Scan;

  @ManyToOne(() => Scanner, (scanner) => scanner.containers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'scannerId' })
  scanner: Scanner;

  @Column()
  scanId: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ nullable: true })
  startedAt: Date;

  @Column({ nullable: true })
  finishedAt: Date;

  @Column({ nullable: true })
  totalVulnerabilities: number;

  @Column({ nullable: true })
  processedVulnerabilities: number;

  @Column({ nullable: true })
  step: string;

  /**
   * Agent container only: when the
   * agent became eligible for an AI slot, and when its analysis started.
   * Written from the application clock (`new Date()`), never SQL `NOW()`:
   * the budgets compare them with the application's `now`.
   */
  @Column({ type: columnType('datetime') as ColumnType, nullable: true })
  analysisQueuedAt: Date | null;

  @Column({ type: columnType('datetime') as ColumnType, nullable: true })
  analysisStartedAt: Date | null;

  /**
   * Why the container ended, from a closed vocabulary:
   * `parse_timeout`, `analysis_failed`, `scanner_timeout`, ...
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  outcomeReason: string | null;

  /**
   * What the secret scanner reported about its git history pass on this
   * container: `ok` | `failed`. Null until it reports.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  historyOutcome: string | null;

  /**
   * Number of times this container's pod has been recreated due to network issues
   * (e.g., Calico stuck in ContainerCreating state).
   * After 3 retries, the container is marked as failed.
   */
  @Column({ default: 0 })
  podRetryCount: number;
}
