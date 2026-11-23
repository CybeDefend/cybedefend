import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ColumnType,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';

@Entity('owasp_reports')
@Index(['projectId', 'createdAt'])
export class OwaspReport {
  @UuidPrimaryColumn()
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  projectId: string;

  @Column({ type: columnType('longtext') as ColumnType })
  reportJson: string;

  @Column({ type: 'varchar', length: 50, default: 'json' })
  format: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
