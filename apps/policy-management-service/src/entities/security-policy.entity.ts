import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { PolicyViolation } from './policy-violation.entity';
import {
  PolicyScope,
  ViolationAction,
  RuleType,
  RuleOperator,
} from './policy-enums';

// Re-export enums for backward compatibility
export {
  PolicyScope,
  ViolationAction,
  RuleType,
  RuleOperator,
} from './policy-enums';

/**
 * Policy rule structure (stored in JSONB)
 */
export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  action: ViolationAction;
  type: RuleType;
  operator?: RuleOperator;
  value?: string | number | boolean | string[] | number[];
  criteria?: PolicyRule[]; // For composite rules (AND/OR)
}

/**
 * Exclusion pattern structure (stored in JSONB)
 */
export interface PolicyExclusion {
  id?: string;
  pattern: string; // Glob pattern (e.g., "tests/**", "**/*.test.js")
  reason: string;
  expirationDate?: string; // ISO 8601 format, optional
  cweIds?: string[]; // Specific CWE IDs to exclude
  owaspCategories?: string[]; // OWASP categories to exclude
}

/**
 * Complete policy configuration structure (stored in JSONB)
 */
export interface PolicyConfig {
  rules: PolicyRule[];
  exclusions?: PolicyExclusion[];
}

/**
 * Security Policy entity
 *
 * Represents a security policy that can be applied at organization, team, or project level.
 * All policies are stored per organization with target IDs (projectIds/teamIds) in the entity itself.
 * Uses PostgreSQL JSONB for flexible rule storage and evaluation.
 */
@Entity('security_policies')
@Index(['organizationId'])
@Index(['scope', 'organizationId'])
@Index(['isEnabled'])
export class SecurityPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Policy scope level (ORGANIZATION, TEAM, PROJECT)
   */
  @Column({
    type: 'enum',
    enum: PolicyScope,
    default: PolicyScope.PROJECT,
  })
  scope: PolicyScope;

  /**
   * Organization ID - all policies belong to an organization
   */
  @Column({ type: 'uuid' })
  @Index()
  organizationId: string;

  /**
   * Project IDs this policy applies to (only used when scope = PROJECT)
   * Stored as JSONB array of UUIDs
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  projectIds: string[];

  /**
   * Team IDs this policy applies to (only used when scope = TEAM)
   * Stored as JSONB array of UUIDs
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  teamIds: string[];

  /**
   * Human-readable policy name
   */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /**
   * Policy description
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * Priority for rule ordering within the same scope
   * Lower values = higher priority (evaluated first)
   */
  @Column({ type: 'int', default: 50 })
  priority: number;

  /**
   * Policy rules stored as JSONB for flexible querying
   * Contains rules, exclusions, and notification settings
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  rules: PolicyConfig;

  /**
   * Global exclusions that apply to all rules (stored as JSONB)
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  exclusions: PolicyExclusion[];

  /**
   * Whether this policy is currently active
   */
  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  /**
   * User who created this policy
   */
  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  /**
   * User who last updated this policy
   */
  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /**
   * Related violations
   */
  @OneToMany(() => PolicyViolation, (violation) => violation.policy)
  violations: PolicyViolation[];
}
