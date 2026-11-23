import { Entity, Column, ManyToOne, BaseEntity, ColumnType } from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { SastVulnerabilityDetections } from './sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from './iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from './cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from './secret-vulnerability-detections.entity';

@Entity('code_snippet')
export class CodeSnippet extends BaseEntity {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  vulnerableStartLine: number;

  @Column()
  vulnerableEndLine: number;

  @Column()
  startLine: number;

  @Column()
  endLine: number;

  @Column({ type: columnType('json') as ColumnType })
  code: string;

  @Column()
  language: string;

  @Column({ nullable: true })
  fixAnalysis: string;

  @Column({ nullable: true })
  fixAnalysisDescription: string;

  @ManyToOne(
    () => SastVulnerabilityDetections,
    (detection) => detection.codeSnippets,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  sastVulnerabilityDetection: SastVulnerabilityDetections;

  @ManyToOne(
    () => IacVulnerabilityDetections,
    (detection) => detection.codeSnippets,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  iacVulnerabilityDetection: IacVulnerabilityDetections;

  @ManyToOne(
    () => CicdVulnerabilityDetections,
    (detection) => detection.codeSnippets,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  cicdVulnerabilityDetection: CicdVulnerabilityDetections;

  @ManyToOne(
    () => SecretVulnerabilityDetections,
    (detection) => detection.codeSnippets,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  secretVulnerabilityDetection: SecretVulnerabilityDetections;
}
