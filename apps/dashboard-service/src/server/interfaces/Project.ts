import { Team } from "./Team";
import { User } from "./User";

export interface ProjectSecurityContext {
  id: string;
  projectId: string;
  environment: string;
  internetExposure: string;
  deploymentType: string;
  dataClassification: string;
  handlesPii: boolean;
  handlesPaymentData: boolean;
  businessCriticality: string;
  userBaseSize: string;
  complianceFrameworks: string[];
  safetyCritical: boolean;
  networkSegmentation: string;
  isCustomized: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where the last scan came from: global-management's `ScanSourceType`. Name it
 * through `scanSourceLabelKey` (utils/scanSource.ts), which also reads a value
 * added on the backend later as « Other source ».
 */
export type ScanSourceType = 'manual' | 'cli' | 'github' | 'gitlab' | 'jetbrains' | 'vscode';

/**
 * Parsing status for parsed branches (string values from backend)
 */
export type ParsedBranchStatus = 
  | 'BRANCH_INGESTION_STATUS_UNSPECIFIED'
  | 'BRANCH_INGESTION_STATUS_PARSING'
  | 'BRANCH_INGESTION_STATUS_PARSED'
  | 'BRANCH_INGESTION_STATUS_FAILED';

/**
 * Represents a parsed branch for the AI features
 */
export interface ParsedBranch {
  id: string;
  projectId: string;
  branch: string;
  potpieProjectId: string;
  status: ParsedBranchStatus;
  lastParsedScanId?: string;
  lastParsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssuesCount {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface AnalysisType {
  type: string;
  lastScan: string | null;
  source: string;
  issuesCount: IssuesCount;
}

export interface ProjectAnalysis {
  projectId: string;
  teamId: string;
  teamName: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  issuesCount: IssuesCount;
  /**
   * CybeRisk level derived from the unbounded CybeRisk score (sum of
   * per-vuln CVSS-based points, branch-scoped).
   */
  cyberRiskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** CybeRisk score (unbounded). */
  cyberRiskScore?: number;
  /** ISO 8601 timestamp of when the CybeRisk score was last computed. */
  cyberRiskComputedAt?: string;
  analyses: AnalysisType[];
  /** @deprecated Use parsedBranches instead */
  ingestionProjectId?: string;
  securityChampionEnabled?: boolean;
  lastScanSourceType: ScanSourceType;
  isScanning: boolean;
  /** Array of parsed branches for AI features - replaces ingestionProjectId */
  parsedBranches?: ParsedBranch[];
  /**
   * Indicates if the project is linked to a GitHub repository.
   * Provided by backend to simplify SCM connection checks.
   */
  isGithubLinked?: boolean;
  /**
   * Indicates if the project is linked to a GitLab repository.
   * Provided by backend to simplify SCM connection checks.
   */
  isGitlabLinked?: boolean;
  /**
   * True when the organization has a Jira installation. Org-scoped, same for
   * every project in the same org. Lets the dashboard skip the per-page
   * jira/installation request.
   */
  isJiraLinked?: boolean;
  /**
   * True when the organization has a Linear installation. Org-scoped, same for
   * every project in the same org, like `isJiraLinked`.
   */
  isLinearLinked?: boolean;
}

export interface PaginatedProjectHome {
  projects: ProjectAnalysis[];
  totalProjects: number;
  totalPages: number;
}

export interface ProjectLinkedRepository {
  provider: 'github' | 'gitlab';
  /** Stored repository id, as the repository branches routes take it. */
  repositoryId: string;
}

export interface Project {
  projectId: string;
  name: string;
  teamId: string;
  teamName: string;
  createdAt: string;
  updatedAt: string;
  applicationType?: string;
  analysisFrequency?: string;
  emailAlertEnabled?: boolean;
  monthlyReportEnabled?: boolean;
  weeklyReportEnabled?: boolean;
  sastEnabled?: boolean;
  dastEnabled?: boolean;
  scaEnabled?: boolean;
  containerEnabled?: boolean;
  apiEnabled?: boolean;
  iacEnabled?: boolean;
  secretEnabled?: boolean;
  aibomEnabled?: boolean;
  sastFastScanEnabled?: boolean;
  /** Default minimum severity for diff scans (info/low/medium/high/critical). */
  diffScanMinSeverity?: string;
  sastSeverities?: string[];
  iacSeverities?: string[];
  scaSeverities?: string[];
  containerSeverities?: string[];
  secretSeverities?: string[];
  incidentCreationOption?: string;
  aiMergeRequestEnabled?: boolean;
  improvingResultsEnabled?: boolean;
  scaTransitiveDependenciesEnabled?: boolean;
  scaDevelopmentDependenciesEnabled?: boolean;
  scaReachabilityPriorityEnabled?: boolean;
  scaReachabilityStatusEnabled?: boolean;
  sortsVulnerabilitiesEnabled?: boolean;
  securityChampionEnabled?: boolean;
  /** @deprecated Use parsedBranches instead */
  ingestionProjectId?: string;
  /** Array of parsed branches for AI features - replaces ingestionProjectId */
  parsedBranches?: ParsedBranch[];
  /**
   * List of enabled SAST agent vulnerability categories identifiers (UPPER_SNAKE_CASE on backend side).
   * If undefined or absent, UI should interpret as "all active categories" for backward compatibility.
   */
  agentCategoriesSast?: string[];
  /**
   * List of enabled IAC agent vulnerability categories identifiers (UPPER_SNAKE_CASE on backend side).
   * If undefined or absent, UI should interpret as "all active categories" for backward compatibility.
   */
  agentCategoriesIac?: string[];
  /**
   * List of enabled CI/CD agent vulnerability categories identifiers (UPPER_SNAKE_CASE on backend side).
   * If undefined or absent, UI should interpret as "all active categories" for backward compatibility.
   */
  agentCategoriesCicd?: string[];
  /**
   * Enable automatic GitHub Issue creation for vulnerabilities.
   */
  githubIssueEnabled?: boolean;
  /**
   * Enable automatic GitLab Issue creation for vulnerabilities.
   */
  gitlabIssueEnabled?: boolean;
  /**
   * Issue creation mode: 'per_vulnerability_type' | 'per_vulnerability' | 'per_file'
   */
  issueCreationMode?: string;
  /**
   * List of branches on which issues should be created.
   * Empty array means all branches.
   */
  issueCreationBranches?: string[];
  /**
   * Indicates if the project is linked to a GitHub repository.
   * Provided by backend to avoid separate repository fetch calls.
   */
  isGithubLinked?: boolean;
  /**
   * Indicates if the project is linked to a GitLab repository.
   * Provided by backend to avoid separate repository fetch calls.
   */
  isGitlabLinked?: boolean;
  /**
   * The repository the project is linked to (GitHub preferred, then GitLab).
   * null when it has none; undefined from a gateway that predates the field.
   * Lets the results pages read its branches without listing every
   * repository of the organization to find it.
   */
  linkedRepository?: ProjectLinkedRepository | null;
  /**
   * True when the organization has a Jira installation. Org-scoped, same for
   * every project in the same org. Lets the dashboard skip the per-page
   * jira/installation request.
   */
  isJiraLinked?: boolean;
  /**
   * True when the organization has a Linear installation. Org-scoped, same for
   * every project in the same org, like `isJiraLinked`.
   */
  isLinearLinked?: boolean;
  /**
   * Reference branch for filtering vulnerability statistics.
   * When set, only vulnerabilities from this branch are counted in dashboards.
   */
  referenceBranch?: string | null;

  securityContext?: ProjectSecurityContext;

  /** Resolved default branch for AI code graph — derived from parsedBranches by the gateway */
  defaultBranch?: string;

  // Notification preferences
  notifSeverityThreshold?: string[];
  notifScannerTypes?: string[];
  zeroDayEmailEnabled?: boolean;
  zeroDaySlackEnabled?: boolean;
  zeroDaySeverityThreshold?: string[];
  scanCompleteEmailEnabled?: boolean;
  scanCompleteSlackEnabled?: boolean;
  weeklyReportSlackEnabled?: boolean;
  monthlyReportSlackEnabled?: boolean;
  /**
   * Distinct programming languages detected in the project
   * (from the backend project payload). Empty/undefined until a scan ran.
   */
  detectedLanguages?: string[];
  /**
   * Backend-derived flag: the code graph and what reads it are available
   * (project uses ≥1 supported language; optimistic true when none detected).
   */
  codeGraphSupported?: boolean;
  /**
   * Whether the agents' CLI linking is enabled for this project. Defaults to
   * `true` when the backend payload omits it (backend support ships later).
   */
  vibedefendEnabled?: boolean;

  /** Trigger an automatic scan on every commit pushed to the monitored branch
   *  of the linked GitHub/GitLab repository. Defaults to true. */
  scanOnCommitEnabled?: boolean;
}

export interface PaginatedProject {
  projects: Project[];
  totalProjects: number;
  totalPages: number;
}

export interface ProjectStatistics {
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  newIssues: number;
  newIssuesInLast7Days: number;
  solvedIssues: number;
  solvedIssuesInLast7Days: number;
  highRiskProjects: number;
  highRiskProjectsInLast7Days: number;
  criticalRiskProjects: number;
  criticalRiskProjectsInLast7Days: number;
  // Agent KPIs
  agentAnalysesCount: number;
  agentAutofixCount: number;
  agentTriageCount: number;
  agentFalsePositiveCount: number;
}

export interface PaginatedProjectAalysis {
  mainStatistics: ProjectStatistics;
  projects: ProjectAnalysis[];
  totalProjects: number;
  totalPages: number;
}
export interface ProjectCreateResponseDto {
  success: boolean;
  message: string;
}

export interface ProjectUpdateResponseDto {
  success: boolean;
  message: string;
  projectInformations: Project;
}

export interface ProjectDeleteResponseDto {
  success: boolean;
  message: string;
}
export interface ScanType {
  sast: boolean;
  dast: boolean;
  sca: boolean;
  container: boolean;
  api: boolean;
  iac: boolean;
}

export interface Integration {
  name: string;
  imgSrc: string;
  category: string;
  available: boolean;
  link?: string;
  /**
   * Set when the integration is not a CybeDefend connector of its own but is
   * wired by another CybeDefend product space (its id): the card carries that
   * space's mark and the badge `poweredByLabelKey`.
   */
  poweredBy?: string;
  /** Key of the badge's words, with `poweredBy`. */
  poweredByLabelKey?: string;
}