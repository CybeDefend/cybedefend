import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SecurityPolicy, PolicyRule } from './security-policy.entity';
import { ViolationAction } from './policy-enums';

/**
 * Affected vulnerability structure within a violation
 */
export interface AffectedVulnerability {
  id: string;
  name: string;
  severity: string;
  cvssScore?: number;
  cwe?: string[];
  owaspTop10?: string[];
  filePath?: string;
  startLine?: number;
  endLine?: number;
  vulnerabilityType: string; // sast, iac, sca, secret, cicd, container
  branch?: string;
  // SCA-specific fields
  packageName?: string;
  packageVersion?: string;
  // Container-specific fields
  artifactName?: string;
}

/**
 * Violation details structure (stored in JSONB)
 * Contains snapshot of why the violation occurred
 */
export interface ViolationDetails {
  /**
   * Snapshot of the rule that was violated
   */
  rule: Partial<PolicyRule>;
  /**
   * List of all vulnerabilities that triggered this violation
   */
  affectedVulnerabilities: AffectedVulnerability[];
}

/**
 * Policy Violation entity
 *
 * Records each instance where a scan violated a policy rule.
 * Used for audit trails and compliance reporting.
 */
@Entity('policy_violations')
@Index(['policyId', 'scanId'])
@Index(['projectId', 'createdAt'])
@Index(['organizationId', 'createdAt'])
@Index('IDX_policy_violations_org_action_createdAt', [
  'organizationId',
  'actionTaken',
  'createdAt',
])
export class PolicyViolation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Reference to the policy that was violated
   */
  @Column({ type: 'uuid' })
  @Index()
  policyId: string;

  @ManyToOne(() => SecurityPolicy, (policy) => policy.violations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'policyId' })
  policy: SecurityPolicy;

  /**
   * Project where the violation occurred
   */
  @Column({ type: 'uuid' })
  @Index()
  projectId: string;

  /**
   * Scan that triggered the violation
   */
  @Column({ type: 'uuid' })
  @Index()
  scanId: string;

  /**
   * Organization ID for filtering
   */
  @Column({ type: 'uuid' })
  @Index()
  organizationId: string;

  /**
   * Specific rule ID that was violated
   */
  @Column({ type: 'varchar', length: 255 })
  ruleId: string;

  /**
   * Rule name for display
   */
  @Column({ type: 'varchar', length: 255 })
  ruleName: string;

  /**
   * Action taken when the violation was detected
   */
  @Column({
    type: 'enum',
    enum: ViolationAction,
    default: ViolationAction.WARN,
  })
  actionTaken: ViolationAction;

  /**
   * Detailed snapshot of why the violation occurred (JSONB)
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  violationDetails: ViolationDetails;

  /**
   * Number of vulnerabilities that triggered this violation
   */
  @Column({ type: 'int', default: 1 })
  affectedVulnerabilitiesCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
