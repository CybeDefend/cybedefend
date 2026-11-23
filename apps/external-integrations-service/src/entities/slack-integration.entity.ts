import { Entity, Column, OneToMany, Unique } from 'typeorm';
import { UuidPrimaryColumn, UpdatedAtColumn } from '@cybedefend/db-dialect';
import { SlackChannelMapping } from './slack-channel-mapping.entity';

@Entity('slack_integrations')
@Unique('UQ_slack_integrations_organizationId', ['organizationId'])
export class SlackIntegration {
  @UuidPrimaryColumn()
  id: string;

  @Column({ length: 36 })
  organizationId: string;

  @Column({ length: 255 })
  teamId: string; // Slack workspace ID

  @Column({ length: 255 })
  teamName: string; // Slack workspace name

  @Column({ type: 'text' })
  accessToken: string; // Encrypted bot token

  @Column({ type: 'text', nullable: true })
  refreshToken: string; // Encrypted refresh token (if applicable)

  @Column({ length: 36, nullable: true })
  installedByUserId: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => SlackChannelMapping, (mapping) => mapping.integration, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  channelMappings: SlackChannelMapping[];
}
