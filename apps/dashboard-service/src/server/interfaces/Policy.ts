// ============================================================================
// Policy Management TypeScript Interfaces
// ============================================================================

// Enums
export enum PolicyScope {
  ORGANIZATION = 'ORGANIZATION',
  TEAM = 'TEAM',
  PROJECT = 'PROJECT',
}

// Rule types matching backend YAML spec
export enum RuleType {
  SEVERITY = 'severity',
  CVSS_SCORE = 'cvss_score',
  CWE_CHECK = 'cwe_check',
  OWASP_CATEGORY = 'owasp_category',
  SCANNER_TYPE = 'scanner_type',
  VULNERABILITY_AGE_DAYS = 'vulnerability_age_days',
  BRANCH = 'branch',
  LICENSE_CHECK = 'license_check',
  LICENSE_NAME_CHECK = 'license_name_check',
  COMPOSITE_AND = 'composite_and',
  COMPOSITE_OR = 'composite_or',
}

export enum RuleOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  IN = 'in',
  NOT_IN = 'not_in',
}

export enum ViolationAction {
  WARN = 'WARN',
  BLOCK = 'BLOCK',
}

export enum EvaluationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// ============================================================================
// Policy Configuration Interfaces
// ============================================================================

// Criteria for composite rules
export interface RuleCriterion {
  id?: string;
  name?: string;
  type: Exclude<RuleType, RuleType.COMPOSITE_AND | RuleType.COMPOSITE_OR>;
  operator: RuleOperator;
  value: string | number | string[];
  action?: ViolationAction;
  isEnabled?: boolean;
}

// Policy Rule matching backend YAML spec
export interface PolicyRule {
  // Generated/returned by API
  id?: string;
  // Required fields
  name: string;
  type: RuleType;
  action: ViolationAction;
  // For non-composite rules
  operator?: RuleOperator;
  value?: string | number | string[];
  // For composite rules
  criteria?: RuleCriterion[];
  // Optional fields
  description?: string;
  isEnabled?: boolean;
}

// Policy Exclusion matching backend YAML spec
export interface PolicyExclusion {
  pattern: string;
  reason: string;
  expirationDate?: string; // ISO date string
}

export interface PolicyConfig {
  rules: PolicyRule[];
  exclusions?: PolicyExclusion[];
}

// ============================================================================
// Policy Entity Interfaces
// ============================================================================

export interface Policy {
  id: string;
  scope: PolicyScope;
  targetId?: string;
  organizationId?: string;
  teamIds?: string[];
  projectIds?: string[];
  name: string;
  description?: string;
  priority: number;
  config: PolicyConfig;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

export interface PolicyListResponse {
  policies: Policy[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EffectivePolicyResponse {
  effectiveConfig: PolicyConfig;
  appliedPolicies: Policy[];
}

export interface PolicyValidationResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Violation Interfaces
// ============================================================================

export interface ViolationAcknowledgedBy {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

export interface ViolationRuleCriterion {
  id: string;
  name: string;
  type: string;
  operator: string;
  value: string | number | string[];
  action: string;
}

export interface ViolationRule {
  id: string;
  name: string;
  description: string;
  type: string; // "severity", "cvss_score", "composite_and", "composite_or", etc.
  value?: string | number | string[]; // Not present for composite rules
  action: string; // "WARN" | "BLOCK"
  operator?: string; // "equals" | "gt" | "in" etc. - Not present for composite rules
  criteria?: ViolationRuleCriterion[]; // Present only for composite rules
}

export interface AffectedVulnerability {
  id: string;
  name: string;
  severity: string;
  cvssScore: number;
  filePath: string;
  startLine?: number;
  endLine?: number;
  branch?: string;
  cwe?: string[];
  owaspTop10?: string[];
  vulnerabilityType: 'sast' | 'sca' | 'iac' | 'secret' | 'cicd';
  packageName?: string;
  packageVersion?: string;
}

export interface PolicyViolation {
  id: string;
  policyId: string;
  projectId: string;
  scanId: string;
  organizationId: string;
  teamId?: string;
  actionTaken: string; // "WARN" | "BLOCK"
  affectedVulnerabilitiesCount: number;
  affectedVulnerabilities?: AffectedVulnerability[];
  rule: ViolationRule;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

export interface ViolationListResponse {
  violations: PolicyViolation[];
  total: number;
  page: number;
}

export interface ViolationStats {
  totalViolations: number;
  blockedCount: number;
  warnedCount: number;
  applicablePoliciesCount: number;
  complianceStatus?: 'Compliant' | 'Non-Compliant' | 'Pending';
}

// ============================================================================
// Compliance Interfaces
// ============================================================================

export interface ComplianceResult {
  evaluationId: string;
  scanId: string;
  projectId: string;
  status: EvaluationStatus;
  result?: {
    compliant: boolean;
    exitCode: number;
    summary: string;
    blockingViolationsCount: number;
    warningViolationsCount: number;
    totalViolationsCount: number;
    evaluatedAt: string;
    evaluatedPoliciesCount: number;
  };
  violations: PolicyViolation[];
  error?: string;
}

export interface ComplianceHistoryEntry {
  evaluationId: string;
  scanId: string;
  compliant: boolean;
  blockingViolationsCount: number;
  warningViolationsCount: number;
  evaluatedAt: string;
  breakingRulesCount: number;
}

export interface ComplianceHistoryResponse {
  entries: ComplianceHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// DTO Interfaces
// ============================================================================

export interface CreatePolicyDto {
  yamlContent: string;
}

export interface UpdatePolicyDto {
  yamlContent?: string;
  isEnabled?: boolean;
}

// ============================================================================
// Evaluation Interfaces
// ============================================================================

export interface TriggerEvaluationResponse {
  evaluationId: string;
  message: string;
  queuedAt: string;
}

export interface EvaluationStatusResponse {
  evaluationId: string;
  status: EvaluationStatus;
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
}
