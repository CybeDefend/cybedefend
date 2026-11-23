import { Entity, Column, ManyToOne, BaseEntity, ColumnType } from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { SastVulnerabilityDetections } from './sast-vulnerability-detections.entity';

@Entity('data_flow_item')
export class DataFlowItem extends BaseEntity {
  @UuidPrimaryColumn()
  id: string;

  // TEXT (not the default varchar(255)): scanner-provided highlighted lines can
  // exceed 255 chars (long/minified code, markup) and would otherwise overflow
  // with "Data too long for column 'nameHighlight'".
  @Column('text')
  nameHighlight: string;

  @Column()
  line: number;

  @Column()
  language: string;

  @Column({ type: columnType('json') as ColumnType })
  code: string;

  @Column()
  type: string;

  @Column()
  order: number;

  @ManyToOne(
    () => SastVulnerabilityDetections,
    (detection) => detection.dataFlowItems,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  sastVulnerabilityDetection: SastVulnerabilityDetections;
}
