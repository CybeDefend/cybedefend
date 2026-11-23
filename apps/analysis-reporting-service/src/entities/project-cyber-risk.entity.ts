import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  ColumnType,
} from 'typeorm';
import { columnType } from '@cybedefend/db-dialect';
import { CyberRiskLevel } from '../modules/cyber-risk/cyber-risk.constants';

/**
 * Persisted CybeRisk Score per project.
 *
 * Single source of truth — written by CyberiskRecomputeQueueProcessor in
 * the worker process, read by gRPC endpoints with no compute on the read
 * path. Recomputed on these triggers (see CyberiskRecomputeTrigger): scan
 * complete, vuln state/severity/CVSS update, CVSS environmental recalc
 * completion, admin manual recompute, and backfill (lazy fill of a missing
 * row + worker-boot self-heal).
 */
@Entity('project_cyber_risk')
export class ProjectCyberRiskEntity {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'project_id' })
  projectId: string;

  @Index('idx_project_cyber_risk_score')
  @Column({ type: 'int', default: 0 })
  score: number;

  @Index('idx_project_cyber_risk_level')
  @Column({ type: 'varchar', length: 16, default: 'none' })
  level: CyberRiskLevel;

  // Persisted 7-day (sliding-window) level — CybeRisk level computed from vulns
  // created in the last 7 days, refreshed on every recompute. Read on the
  // project-list hot path instead of recomputing it live (BACK: project-list
  // perf). Same "briefly stale between recomputes" guarantee as `level`.
  @Column({ type: 'varchar', length: 16, name: 'level_7d', default: 'none' })
  level7Days: CyberRiskLevel;

  @Column({ type: 'int', name: 'vuln_count', default: 0 })
  vulnCount: number;

  @Column({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'computed_at',
  })
  computedAt: Date;

  @CreateDateColumn({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: columnType('datetime') as ColumnType,
    precision: 3,
    name: 'updated_at',
  })
  updatedAt: Date;
}
