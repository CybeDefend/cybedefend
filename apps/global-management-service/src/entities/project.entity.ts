import { User } from './user.entity';
import {
  Column,
  type ColumnType,
  Entity,
  Index,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import {
  ciText,
  columnType,
  UpdatedAtColumn,
  UuidPrimaryColumn,
} from '@cybedefend/db-dialect';
import { Team } from './team.entity';
import { ProjectSecurityContext } from './project-security-context.entity';

/**
 * Enum representing the source type of the last scan performed on a project.
 * This helps track whether the scan was triggered manually, via CLI, or through integrations.
 */
export enum ScanSourceType {
  MANUAL = 'manual',
  CLI = 'cli',
  GITHUB = 'github',
  GITLAB = 'gitlab',
  JETBRAINS = 'jetbrains',
  VSCODE = 'vscode',
}

@Entity('project')
// Team-scoped project lookup by name. No UNIQUE(teamId, name) exists; only a
// single-column FK index on teamId, so this composite is NOT redundant.
@Index('IDX_project_team_name', ['team', 'name'])
export class Project {
  @UuidPrimaryColumn()
  id: string;

  // Compared case-insensitively in project.service.ts: citext on postgres.
  @Column({ type: ciText() as ColumnType })
  name: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  creator: User;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;

  @UpdatedAtColumn({ precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  updatedAt: Date;

  @ManyToOne(() => Team, (team) => team.projects, { onDelete: 'CASCADE' })
  team: Team;

  /**
   * Denormalized CybeRisk score, kept in sync by analysis-reporting (best-effort
   * push after each recompute + a worker-boot backfill). It exists ONLY as a SQL
   * sort key for the organization project list, so the page can be ordered and
   * sliced in the database (ORDER BY ... LIMIT) instead of fetching the whole org.
   *
   * The authoritative score lives in analysis-reporting (`project_cyber_risk`);
   * this copy may be briefly stale and is NEVER surfaced as the displayed score
   * (the list still reads the live score per page). Defaults to 0 so unscored or
   * not-yet-synced projects sort to the bottom.
   */
  @Index('idx_project_cyber_risk_score')
  @Column({ type: 'int', default: 0, name: 'cyber_risk_score' })
  cyberRiskScore: number;

  @Column({ nullable: true })
  applicationType: string;

  @Column({ nullable: true })
  analysisFrequency: string;

  @Column({ default: false })
  emailAlertEnabled: boolean;

  @Column({ default: false })
  monthlyReportEnabled: boolean;

  @Column({ default: false })
  weeklyReportEnabled: boolean;

  @Column({ default: false })
  sastEnabled: boolean;

  @Column({ default: false })
  dastEnabled: boolean;

  @Column({ default: false })
  scaEnabled: boolean;

  @Column({ default: false })
  containerEnabled: boolean;

  @Column({ default: false })
  apiEnabled: boolean;

  @Column({ default: false })
  iacEnabled: boolean;

  @Column({ default: true })
  secretEnabled: boolean;

  @Column({ default: false })
  aibomEnabled: boolean;

  @Column({ default: false })
  sastFastScanEnabled: boolean;

  // Minimum severity a diff scan reports by default (info/low/medium/
  // high/critical). Default 'medium' — diff scans drop low/info unless lowered.
  @Column({ default: 'medium' })
  diffScanMinSeverity: string;

  @Column('simple-array', { nullable: true })
  sastSeverities: string[];

  @Column('simple-array', { nullable: true })
  iacSeverities: string[];

  @Column('simple-array', { nullable: true })
  scaSeverities: string[];

  @Column('simple-array', { nullable: true })
  containerSeverities: string[];

  @Column('simple-array', { nullable: true })
  secretSeverities: string[];

  @Column({ nullable: true })
  incidentCreationOption: string;

  @Column({ default: false })
  aiMergeRequestEnabled?: boolean;

  @Column({ default: false })
  improvingResultsEnabled?: boolean;

  @Column({ default: false })
  sortsVulnerabilitiesEnabled?: boolean;

  @Column({ default: false })
  scaTransitiveDependenciesEnabled?: boolean;

  @Column({ default: false })
  scaDevelopmentDependenciesEnabled?: boolean;

  @Column({ default: true })
  scaReachabilityPriorityEnabled: boolean;

  @Column({ default: true })
  scaReachabilityStatusEnabled: boolean;

  @Column({ default: false })
  securityChampionEnabled: boolean;

  /**
   * Second-product dashboard link — whether that product's CLI/agent surface is
   * enabled for this project. Enabled by default for every project.
   */
  @Column({ default: true })
  vibedefendEnabled: boolean;

  /**
   * When the project became an AppSec project, i.e. created from the AppSec
   * space or analysed by its first full scan (MarkProjectAppsec). Null for a
   * project of the closed second product only.
   */
  @Column({
    type: columnType('datetime') as ColumnType,
    name: 'appsec_enabled_at',
    nullable: true,
  })
  appsecEnabledAt: Date | null;

  /**
   * Trigger an automatic scan on every commit pushed to the monitored branch of
   * the linked GitHub/GitLab repository. Enabled by default — turning it off
   * only suppresses the webhook-driven scan; manual scans and the initial scan
   * fired when a repository is linked are unaffected.
   */
  @Column({ default: true })
  scanOnCommitEnabled: boolean;

  // Active agent vulnerability categories for SAST (simple-array of category names)
  @Column('simple-array', { name: 'agent_categories_sast', nullable: true })
  agentCategoriesSast?: string[] | null;

  // Active agent vulnerability categories for IAC (simple-array of category names)
  @Column('simple-array', { name: 'agent_categories_iac', nullable: true })
  agentCategoriesIac?: string[] | null;

  // Active agent vulnerability categories for CICD (simple-array of category names)
  @Column('simple-array', { name: 'agent_categories_cicd', nullable: true })
  agentCategoriesCicd?: string[] | null;

  /**
   * Source type of the last scan performed on this project.
   * Defaults to MANUAL for backward compatibility with existing projects.
   */
  @Column({
    type: 'enum',
    enum: ScanSourceType,
    default: ScanSourceType.MANUAL,
    nullable: true,
  })
  lastScanSourceType: ScanSourceType | null;

  // ========== Issue Integration Settings ==========

  /**
   * Enable GitHub issue creation for vulnerabilities detected in this project.
   * Requires a GitHub repository to be linked to the project.
   */
  @Column({ default: false })
  githubIssueEnabled: boolean;

  /**
   * Enable GitLab issue creation for vulnerabilities detected in this project.
   * Requires a GitLab repository to be linked to the project.
   */
  @Column({ default: false })
  gitlabIssueEnabled: boolean;

  /**
   * Issue creation mode determining how vulnerabilities are grouped into issues.
   * - 'per_vulnerability': One issue per individual vulnerability detection (SCA only)
   * - 'per_vulnerability_type': One issue per vulnerability type (grouped by vulnId)
   * - 'per_file': One issue per affected file
   */
  @Column({
    type: 'enum',
    enum: ['per_vulnerability', 'per_vulnerability_type', 'per_file'],
    default: 'per_vulnerability_type',
    nullable: true,
  })
  issueCreationMode:
    | 'per_vulnerability'
    | 'per_vulnerability_type'
    | 'per_file'
    | null;

  /**
   * List of branches for which issues should be created.
   * If empty or null, issues will be created for all branches.
   * Branch names are stored as comma-separated values.
   */
  @Column('simple-array', { nullable: true })
  issueCreationBranches: string[] | null;

  /**
   * Reference branch used for statistics and vulnerability counts.
   * When set, only vulnerabilities from this branch will be counted in project statistics.
   * If null or empty, vulnerabilities from all branches will be counted.
   */
  @Column({ nullable: true })
  referenceBranch: string | null;

  // ========== Notification Preferences ==========

  @Column('simple-array', { nullable: true })
  notifSeverityThreshold: string[]; // e.g. ["critical","high"]

  @Column('simple-array', { nullable: true })
  notifScannerTypes: string[]; // e.g. ["sast","sca","iac","container"]

  @Column({ default: true })
  zeroDayEmailEnabled: boolean;

  @Column({ default: false })
  zeroDaySlackEnabled: boolean;

  @Column('simple-array', { nullable: true })
  zeroDaySeverityThreshold: string[]; // e.g. ["critical","high"]

  @Column({ default: false })
  weeklyReportSlackEnabled: boolean;

  @Column({ default: false })
  monthlyReportSlackEnabled: boolean;

  @Column({ default: false })
  scanCompleteEmailEnabled: boolean;

  @Column({ default: false })
  scanCompleteSlackEnabled: boolean;

  // ========== Security Context ==========

  @OneToOne(() => ProjectSecurityContext, (ctx) => ctx.project)
  securityContext: ProjectSecurityContext;
}
