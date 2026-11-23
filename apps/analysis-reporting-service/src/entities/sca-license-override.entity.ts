import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sca_license_overrides')
export class ScaLicenseOverride {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  organizationId: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  spdxId: string;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
