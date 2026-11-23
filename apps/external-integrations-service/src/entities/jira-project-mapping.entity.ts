import { Entity, Column, ManyToOne, Unique, JoinColumn } from 'typeorm';
import {
  UuidPrimaryColumn,
  columnType,
  UpdatedAtColumn,
} from '@cybedefend/db-dialect';
import { JiraIntegration } from './jira-integration.entity';

@Entity('jira_project_mappings')
@Unique('UQ_jira_project_mappings_projectId', ['projectId'])
export class JiraProjectMapping {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(
    () => JiraIntegration,
    (integration) => integration.projectMappings,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'integrationId' })
  integration: JiraIntegration;

  @Column({ length: 36 })
  integrationId: string;

  @Column({ length: 36 })
  projectId: string; // CybeDefend project ID

  @Column({ length: 255 })
  jiraProjectId: string; // Jira project ID

  @Column({ length: 50 })
  jiraProjectKey: string; // e.g. "TRI"

  @Column({ length: 255 })
  jiraProjectName: string; // e.g. "Triage"

  @Column({ type: 'text', nullable: true })
  allowedBranches: string; // JSON array of branch names, null = all branches

  @Column({ type: columnType('tinyint'), default: 0 })
  autoCreateEnabled: boolean; // Whether to auto-create Jira tickets after scans

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
