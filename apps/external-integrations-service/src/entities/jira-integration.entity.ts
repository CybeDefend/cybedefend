import { Entity, Column, OneToMany, Unique } from 'typeorm';
import { UuidPrimaryColumn, UpdatedAtColumn } from '@cybedefend/db-dialect';
import { JiraProjectMapping } from './jira-project-mapping.entity';

@Entity('jira_integrations')
@Unique('UQ_jira_integrations_organizationId', ['organizationId'])
export class JiraIntegration {
  @UuidPrimaryColumn()
  id: string;

  @Column({ length: 36 })
  organizationId: string;

  @Column({ length: 255 })
  cloudId: string; // Jira Cloud site ID

  @Column({ length: 255 })
  siteName: string; // e.g. "mycompany.atlassian.net"

  @Column({ length: 512 })
  siteUrl: string; // Full URL to Jira instance

  @Column({ type: 'text' })
  accessToken: string; // Encrypted OAuth access token

  @Column({ type: 'text', nullable: true })
  refreshToken: string; // Encrypted OAuth refresh token

  @Column({ type: 'timestamp', nullable: true })
  tokenExpiresAt: Date; // Jira tokens expire in ~1 hour

  @Column({ type: 'varchar', length: 64, nullable: true })
  webhookSecret: string;

  @Column({ type: 'int', nullable: true })
  webhookId: number; // Dynamic webhook ID returned by Jira (for refresh)

  @Column({ length: 36, nullable: true })
  installedByUserId: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => JiraProjectMapping, (mapping) => mapping.integration, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  projectMappings: JiraProjectMapping[];
}
