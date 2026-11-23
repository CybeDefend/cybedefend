import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ColumnType,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';

/**
 * Entity representing a generated CWE Top 25 report for a project
 */
@Entity('cwe_reports')
export class CweReport {
  @UuidPrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: columnType('longtext') as ColumnType })
  reportJson: string;

  @Column({ type: 'varchar', length: 50 })
  format: string; // 'json' | 'html' | 'pdf'

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
