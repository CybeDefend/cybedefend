import {
  Entity,
  Column,
  ManyToOne,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  ColumnType,
} from 'typeorm';
import { UuidPrimaryColumn, columnType } from '@cybedefend/db-dialect';
import { ScaVulnerabilityDetections } from './sca-vulnerability-detections.entity';

/**
 * Records SCA AutoFix analysis results from the closed autofix library for transitive dependency fixes.
 * Stores the recommended fix and all candidates for a given SCA vulnerability.
 */
@Entity('sca_autofix_records')
export class ScaAutoFixRecord {
  @UuidPrimaryColumn()
  id: string;

  @Index()
  @Column({ length: 36 })
  projectId: string;

  @Index()
  @Column({ length: 36 })
  scaVulnerabilityDetectionId: string;

  @ManyToOne(() => ScaVulnerabilityDetections, { onDelete: 'CASCADE' })
  scaVulnerabilityDetection: ScaVulnerabilityDetections;

  /** CVE/GHSA identifier */
  @Column({ length: 64 })
  cveId: string;

  /** Severity level: CRITICAL | HIGH | MEDIUM | LOW */
  @Column({ length: 16 })
  severity: string;

  /** Vulnerability summary from OSV */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** Name of the vulnerable package */
  @Column({ length: 255 })
  vulnerablePackage: string;

  /** Current vulnerable version */
  @Column({ length: 64 })
  vulnerableVersion: string;

  /** Dependency path from root to vulnerable package as JSON array */
  @Column({ type: columnType('json') as ColumnType })
  dependencyPath: string[];

  /** Package ecosystem: npm, maven, pip, etc. */
  @Column({ length: 32 })
  ecosystem: string;

  /** Whether this is a transitive dependency */
  @Column({ default: false })
  isTransitive: boolean;

  /** Lockfile path (for monorepo support) */
  @Column({ length: 512, nullable: true })
  fileName: string | null;

  // --- Recommended Fix ---

  /** Parent package to update (the direct dependency) */
  @Column({ length: 255, nullable: true })
  recommendedParentPackage: string | null;

  /** Current version of parent */
  @Column({ length: 64, nullable: true })
  recommendedCurrentVersion: string | null;

  /** Recommended version to upgrade to */
  @Column({ length: 64, nullable: true })
  recommendedProposedVersion: string | null;

  /** Version of child after parent upgrade */
  @Column({ length: 64, nullable: true })
  recommendedFixedChildVersion: string | null;

  /** Minimum version required to fix */
  @Column({ length: 64, nullable: true })
  recommendedRequiredChildVersion: string | null;

  /** Type of update: patch | minor | major */
  @Column({ length: 16, nullable: true })
  recommendedUpdateType: string | null;

  /** Whether the recommended fix is valid */
  @Column({ default: false })
  recommendedFixIsValid: boolean;

  /** Command to apply the fix (e.g., "npm install mkdirp@0.5.5") */
  @Column({ length: 512, nullable: true })
  installCommand: string | null;

  // --- PR Information (when createPr is requested) ---

  /** Branch name where the fix was applied */
  @Column({ length: 255, nullable: true })
  branch: string | null;

  /** URL of the Pull Request created for this fix */
  @Column({ length: 512, nullable: true })
  prUrl: string | null;

  /** PR number if a PR was created */
  @Column({ nullable: true })
  prNumber: number | null;

  // --- All Fix Candidates (stored as JSON for flexibility) ---

  /** All fix candidates found during analysis */
  @Column({ type: columnType('json') as ColumnType, nullable: true })
  fixCandidates: ScaFixCandidateJson[] | null;

  // --- Analysis Status ---

  /** Status: ok | no_fix | error | direct_update */
  @Column({ length: 32, default: 'pending' })
  status: string;

  /** Error message if status is "error" */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /** Number of versions tested during analysis */
  @Column({ default: 0 })
  testedVersionsCount: number;

  /** Whether a fix is available */
  @Column({ default: false })
  hasFixAvailable: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * Interface for fix candidate stored in JSON column
 */
export interface ScaFixCandidateJson {
  parentPackage: string;
  currentVersion: string;
  proposedVersion: string;
  vulnerableChild: string;
  vulnerableChildVersion: string;
  fixedChildVersion: string | null;
  requiredChildVersion: string;
  updateType: string;
  isValid: boolean;
}
