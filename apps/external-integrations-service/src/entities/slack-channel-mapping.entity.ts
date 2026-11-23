import { Entity, Column, ManyToOne, Unique, JoinColumn } from 'typeorm';
import { UuidPrimaryColumn, UpdatedAtColumn } from '@cybedefend/db-dialect';
import { SlackIntegration } from './slack-integration.entity';

@Entity('slack_channel_mappings')
@Unique('UQ_slack_channel_mappings_projectId', ['projectId'])
export class SlackChannelMapping {
  @UuidPrimaryColumn()
  id: string;

  @ManyToOne(
    () => SlackIntegration,
    (integration) => integration.channelMappings,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'integrationId' })
  integration: SlackIntegration;

  @Column({ length: 36 })
  integrationId: string;

  @Column({ length: 36 })
  projectId: string; // CybeDefend project ID

  @Column({ length: 255 })
  channelId: string; // Slack channel ID

  @Column({ length: 255 })
  channelName: string; // Slack channel name (for display)

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdatedAtColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
