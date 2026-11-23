import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  ColumnType,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';

/**
 * Persisted org-wide home KPI cards (the `getMainStatistics` payload),
 * computed over EVERY project in the organization.
 *
 * Written by the org-statistics recompute worker (debounced — see
 * organization-statistics-debounce.ts), read O(1) by the gRPC read path so the
 * `GET /organization/:id/main-statistics` endpoint no longer pays the ~3s
 * org-wide aggregation on the request. `stats` is the full MainStatistics
 * payload as JSON; the three timestamps drive the distributed debounce policy.
 */
@Entity('organization_statistics')
export class OrganizationStatisticsEntity {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'organization_id' })
  organizationId: string;

  // The computed MainStatistics payload (16 int KPIs). JSON keeps the schema
  // flexible if the card set evolves; null until the first compute.
  @Column({ type: columnType('json') as ColumnType, nullable: true })
  stats: Record<string, number> | null;

  // Last successful compute; null when never computed. Drives the 30s floor.
  @Index('idx_org_statistics_computed_at')
  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'computed_at',
    nullable: true,
  })
  computedAt: Date | null;

  // Advances on every markDirty event. Drives the 3s trailing debounce.
  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'last_event_at',
    nullable: true,
  })
  lastEventAt: Date | null;

  // Start of the current dirty cycle (set on the first event after a compute,
  // cleared on recompute). Drives the 60s maxWait; null = clean.
  @Index('idx_org_statistics_dirty_since')
  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'dirty_since',
    nullable: true,
  })
  dirtySince: Date | null;

  @UpdateDateColumn({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'updated_at',
  })
  updatedAt: Date;
}
