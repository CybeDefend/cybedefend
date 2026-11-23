import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { UuidPrimaryColumn } from '@cybedefend/db-dialect';
import { ciTextColumn } from '../core/db/ci-text-column';
import { VulnerabilityDetectionsContainer } from './container_vulnerability_detections.entity';

@Entity('container_detected_images')
@Unique('UQ_container_detected_images_project_artifact_branch', [
  'projectId',
  'artifactName',
  'branch',
])
export class ContainerDetectedImage extends BaseEntity {
  @UuidPrimaryColumn() id: string;

  /** Project owner */
  @Column() projectId: string;

  /** Scan identifier (one scan → many chunks) */
  @Column() scanId: string;

  @Column(ciTextColumn()) artifactName: string;
  @Column() imageId: string;

  /* Distribution */
  @Column() osFamily: string;
  @Column() osName: string;

  /**
   * The base OS is end-of-support-life (Trivy `EOSL`). The
   * distribution no longer publishes advisories, so a scan reporting zero
   * vulnerabilities means "detection impossible", not "clean". Refreshed on
   * every scan so a rebuild onto a supported base clears it.
   */
  @Column({ default: false })
  osEosl: boolean;

  /** Branch that was scanned when this image was detected */
  @Column({ default: '' })
  branch: string;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  @OneToMany(() => VulnerabilityDetectionsContainer, (p) => p.detectedImage)
  packages: VulnerabilityDetectionsContainer[];

  @OneToMany(() => VulnerabilityDetectionsContainer, (d) => d.detectedImage)
  detections: VulnerabilityDetectionsContainer[];
}
