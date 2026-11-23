import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  UpdateDateColumn,
} from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { ContainerDetectedImage } from './container-detected-image.entity';

@Entity('container_detected_packages')
export class ContainerDetectedPackage extends BaseEntity {
  @UuidPrimaryColumn() id: string;

  @ManyToOne(() => ContainerDetectedImage, (i) => i.packages, {
    onDelete: 'CASCADE',
  })
  detectedImage: ContainerDetectedImage;

  @Column() projectId: string;

  @Column() packageName: string;
  @Column() packageVersion: string;
  @Column({ nullable: true }) arch: string;

  @Column({ nullable: true }) srcName: string;
  @Column({ nullable: true }) srcVersion: string;
  /**
   * Complete distribution versions `[epoch:]version[-release]` as
   * the scanner sends them. `packageVersion` keeps Trivy's split
   * form; these are what the OSV zero-day retro-match compares later.
   */
  @Column({ nullable: true }) fullVersion: string | null;
  @Column({ nullable: true }) srcFullVersion: string | null;
  @Column({ nullable: true }) digest: string;

  @Column({ nullable: true })
  target: string;

  @Column({ nullable: true })
  class: string;

  @Column({ type: 'text', nullable: true })
  licenses: string;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      to: (v: string[]) => (v ? JSON.stringify(v) : null),
      from: (v: string) => (v ? JSON.parse(v) : []),
    },
  })
  dependsOn: string[];

  @Column({ nullable: true })
  lastScanId: string;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
