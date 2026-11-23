import { Entity, Column, ManyToOne, Unique, JoinColumn } from 'typeorm';
import {
  UuidPrimaryColumn,
  UpdatedAtColumn,
  columnType,
} from '@cybedefend/db-dialect';
import { LinearIntegration } from './linear-integration.entity';

@Entity('linear_project_mappings')
@Unique('UQ_linear_project_mappings_projectId', ['projectId'])
export class LinearProjectMapping {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(
    () => LinearIntegration,
    (integration) => integration.projectMappings,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'integrationId' })
  integration: LinearIntegration;

  @Column({ length: 36 })
  integrationId: string;

  @Column({ length: 36 })
  projectId: string; // CybeDefend project ID

  @Column({ length: 64 })
  teamId: string; // Linear team ID

  @Column({ length: 16 })
  teamKey: string; // e.g. "ENG"

  @Column({ length: 255 })
  teamName: string; // e.g. "Engineering"

  @Column({ type: 'varchar', length: 64, nullable: true })
  linearProjectId: string; // Optional Linear project ID tickets are added to

  @Column({ type: 'varchar', length: 255, nullable: true })
  linearProjectName: string;

  @Column({ type: 'text', nullable: true })
  labels: string; // JSON array of {id, name}, null = no label

  @Column({ type: 'text', nullable: true })
  allowedBranches: string; // JSON array of branch names, null = all branches

  @Column({ type: columnType('tinyint'), default: 0 })
  autoCreateEnabled: boolean; // Whether to auto-create Linear tickets after scans

  @Column({ type: columnType('datetime'), default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
