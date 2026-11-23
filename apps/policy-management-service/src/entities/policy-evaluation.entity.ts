import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ViolationAction } from './security-policy.entity';

/**
 * Evaluation status enumeration
 */
export enum EvaluationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Compliance result structure (stored in JSONB)
 */
export interface ComplianceResultDetails {
  violationCount: number;
  action: ViolationAction;
  violations: {
    policyId: string;
    ruleId: string;
    ruleName: string;
    action: string;
    details: Record<string, unknown>;
    affectedVulnerabilityIds: string[];
  }[];
}

/**
 * Policy Evaluation entity
 *
 * Tracks the status and results of asynchronous policy evaluations.
 * Used to provide status updates and store compliance results.
 */
@Entity('policy_evaluations')
@Index(['scanId', 'projectId'], { unique: true })
@Index(['status'])
@Index('IDX_policy_evaluations_projectId_status', ['projectId', 'status'])
export class PolicyEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Scan being evaluated
   */
  @Column({ type: 'uuid' })
  @Index()
  scanId: string;

  /**
   * Project the scan belongs to
   */
  @Column({ type: 'uuid' })
  @Index()
  projectId: string;

  /**
   * Organization ID for filtering
   */
  @Column({ type: 'uuid' })
  @Index()
  organizationId: string;

  /**
   * Team ID for filtering (optional)
   */
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  /**
   * Current evaluation status
   */
  @Column({
    type: 'enum',
    enum: EvaluationStatus,
    default: EvaluationStatus.PENDING,
  })
  status: EvaluationStatus;

  /**
   * Evaluation progress percentage (0-100)
   */
  @Column({ type: 'int', default: 0 })
  progressPercentage: number;

  /**
   * Whether the project is compliant
   */
  @Column({ type: 'boolean', nullable: true })
  compliant: boolean | null;

  /**
   * Overall action (WARN or BLOCK)
   */
  @Column({
    type: 'enum',
    enum: ViolationAction,
    nullable: true,
  })
  action: ViolationAction | null;

  /**
   * Compliance result details (JSONB)
   */
  @Column({ type: 'jsonb', nullable: true })
  resultDetails: ComplianceResultDetails | null;

  /**
   * Error message if evaluation failed
   */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * User who triggered the evaluation
   */
  @Column({ type: 'uuid', nullable: true })
  triggeredBy: string | null;

  /**
   * When the evaluation started
   */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /**
   * When the evaluation completed
   */
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
