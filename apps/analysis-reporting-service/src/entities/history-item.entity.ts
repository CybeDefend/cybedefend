import { Entity, Column, ManyToOne, BaseEntity, ColumnType } from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { SastVulnerabilityDetections } from './sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from './iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from './cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from './secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from './sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from './container_vulnerability_detections.entity';

@Entity('history_item')
export class HistoryItem extends BaseEntity {
  @UuidPrimaryColumn()
  id: string;

  @Column()
  type: string;

  // Use longtext to store large AI / agent generated comments (previously varchar(512))
  @Column({ type: columnType('longtext') as ColumnType })
  value: string;

  @Column()
  date: Date;

  @Column({ nullable: true })
  userId: string;

  /**
   * Origin of this history item:
   *   - 'dashboard_manual'    direct human action via the Dashboard UI
   *   - 'chat_agent_assisted' confirmed write tool call from the chat
   *   - 'system' / 'cron'     automated re-evaluation
   *   - null                  legacy rows
   */
  @Column({ name: 'source', type: 'varchar', length: 64, nullable: true })
  source?: string | null;

  /**
   * Tool call id forwarded by the MCP write tool when source is
   * 'chat_agent_assisted'. Lets the gateway pivot from a vulnerability
   * history row back to the chat conversation that triggered the change.
   */
  @Column({
    name: 'agent_tool_call_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  agentToolCallId?: string | null;

  @Column({
    name: 'agent_conversation_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  agentConversationId?: string | null;

  @Column({
    name: 'agent_stream_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  agentStreamId?: string | null;

  @ManyToOne(
    () => SastVulnerabilityDetections,
    (detection) => detection.historyItems,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  sastVulnerabilityDetection: SastVulnerabilityDetections;

  @ManyToOne(
    () => IacVulnerabilityDetections,
    (detection) => detection.historyItems,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  iacVulnerabilityDetection: IacVulnerabilityDetections;

  @ManyToOne(
    () => CicdVulnerabilityDetections,
    (detection) => detection.historyItems,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  cicdVulnerabilityDetection: CicdVulnerabilityDetections;

  @ManyToOne(
    () => SecretVulnerabilityDetections,
    (detection) => detection.historyItems,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  secretVulnerabilityDetection: SecretVulnerabilityDetections;

  @ManyToOne(
    () => ScaVulnerabilityDetections,
    (detection) => detection.historyItems,
    {
      nullable: true,
      onDelete: 'CASCADE',
    },
  )
  scaVulnerabilityDetection: ScaVulnerabilityDetections;

  @ManyToOne(
    () => VulnerabilityDetectionsContainer,
    (det) => det.historyItems,
    { onDelete: 'CASCADE', nullable: true },
  )
  containerVulnerabilityDetection?: VulnerabilityDetectionsContainer;
}
