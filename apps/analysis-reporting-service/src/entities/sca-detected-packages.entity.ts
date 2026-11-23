// sca-detected-packages.entity.ts

import {
  Entity,
  Column,
  BaseEntity,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  ColumnType,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { ciTextColumn } from '../core/db/ci-text-column';

@Entity('sca_detected_packages')
@Unique('UQ_sca_detected_packages_project_name_version_branch', [
  'projectId',
  'packageName',
  'packageVersion',
  'branch',
])
export class ScaDetectedPackages extends BaseEntity {
  @UuidPrimaryColumn()
  id: string;

  @Column({ length: 36 })
  projectId: string;

  @Column(ciTextColumn({ length: 255 }))
  packageName: string;

  @Column(ciTextColumn({ length: 255 }))
  packageVersion: string;

  @Column({ length: 191, default: '' })
  branch: string;

  @Column()
  fileName: string;

  @Column()
  ecosystem: string;

  @Column({
    nullable: true,
  })
  lastScanId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({
    nullable: true,
    type: 'text',
    transformer: {
      to: (value: string[]) => (value ? JSON.stringify(value) : null),
      from: (value: string) => (value ? JSON.parse(value) : []),
    },
  })
  path: string[];

  @Column()
  isTransitive: boolean;

  @Column()
  isDev: boolean;

  @Column({ default: true })
  dependencyInfoAvailable: boolean;

  @Column({ type: 'varchar', length: 32, nullable: true })
  reachability: string | null;

  @Column({
    nullable: true,
    type: 'text',
    transformer: {
      to: (value: { file: string; line: number; content?: string }[]) =>
        value ? JSON.stringify(value) : null,
      from: (value: string) => (value ? JSON.parse(value) : []),
    },
  })
  importLocations: { file: string; line: number; content?: string }[];

  @Column({
    nullable: true,
    type: 'text',
    transformer: {
      to: (value: string[]) =>
        value && value.length > 0 ? JSON.stringify(value) : null,
      from: (value: string) => (value ? JSON.parse(value) : []),
    },
  })
  licenses: string[];

  @Column({ type: 'varchar', length: 512, nullable: true })
  licenseExpression: string | null;

  @Column({ type: columnType('tinyint') as ColumnType, width: 1, default: 0 })
  isLicenseIgnored: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
