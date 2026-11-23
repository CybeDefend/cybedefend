// ============================================================================
// Organization Compliance Overview TypeScript Interfaces
// ============================================================================

/**
 * Compliance status for a project
 */
export type ComplianceStatus = 'Compliant' | 'Non-Compliant' | 'Pending';

/**
 * Sort options for compliance overview
 */
export type ComplianceOverviewSortBy =
  | 'blockedCount'
  | 'warnedCount'
  | 'totalViolations'
  | 'lastEvaluatedAt'
  | 'projectName';

export type SortOrder = 'asc' | 'desc';

/**
 * Timeframe for trend aggregation
 */
export type TrendTimeframe = 'day' | 'week' | 'month';

// ============================================================================
// Stats Interfaces
// ============================================================================

/**
 * Organization compliance statistics
 */
export interface OrganizationComplianceStats {
  /** Total projects in the organization */
  totalProjects: number;
  /** Projects with no BLOCK violations */
  compliantProjects: number;
  /** Projects with BLOCK violations */
  nonCompliantProjects: number;
  /** Projects without evaluation */
  pendingProjects: number;
  /** Total violation count */
  totalViolations: number;
  /** Total BLOCK violations */
  totalBlocked: number;
  /** Total WARN violations */
  totalWarned: number;
  /** Active policies in org */
  activePoliciesCount: number;
  /** Percentage (0-100) */
  complianceRate: number;
}

// ============================================================================
// Project Compliance Interfaces
// ============================================================================

/**
 * Individual project compliance data
 */
export interface ProjectComplianceData {
  projectId: string;
  projectName: string;
  complianceStatus: ComplianceStatus;
  totalViolations: number;
  blockedCount: number;
  warnedCount: number;
  applicablePoliciesCount: number;
  /** ISO 8601 timestamp */
  lastEvaluatedAt?: string;
  lastScanId?: string;
  teamIds: string[];
}

// ============================================================================
// Violation Breakdown Interfaces
// ============================================================================

/**
 * Violation breakdown by rule type
 */
export interface ViolationBreakdownItem {
  /** Rule name (e.g., "Critical Severity Check") */
  ruleType: string;
  count: number;
  blockedCount: number;
  warnedCount: number;
}

// ============================================================================
// Trend Interfaces
// ============================================================================

/**
 * Compliance trend data point
 */
export interface ComplianceTrendData {
  /** ISO 8601 date */
  date: string;
  compliantCount: number;
  nonCompliantCount: number;
  pendingCount: number;
  complianceRate: number;
}

// ============================================================================
// API Response Interface
// ============================================================================

/**
 * Complete response from the compliance overview endpoint
 */
export interface OrganizationComplianceOverviewResponse {
  stats: OrganizationComplianceStats;
  projects: ProjectComplianceData[];
  violationBreakdown: ViolationBreakdownItem[];
  trend: ComplianceTrendData[];
  /** Total projects for pagination */
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// Request Parameters Interface
// ============================================================================

/**
 * Parameters for fetching compliance overview
 */
export interface GetComplianceOverviewParams {
  organizationId: string;
  page?: number;
  pageSize?: number;
  /** ISO 8601 date string */
  startDate?: string;
  /** ISO 8601 date string */
  endDate?: string;
  complianceStatus?: ComplianceStatus;
  search?: string;
  sortBy?: ComplianceOverviewSortBy;
  sortOrder?: SortOrder;
  /** Timeframe for trend aggregation */
  timeframe?: TrendTimeframe;
}
