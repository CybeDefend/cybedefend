import {
  PolicyResponseDto,
  ViolationDto,
  ViolationStatsDto,
  OrganizationComplianceOverviewResponseDto,
} from '../dto/response';
import { scopeFromProto } from './proto-mappers';
import {
  PolicyViolation,
  SecurityPolicy,
} from '@grpc/policy-management/policy_types';
import {
  PolicyResponse,
  TogglePolicyResponse,
} from '@grpc/policy-management/policy';
import {
  GetViolationStatsResponse,
  GetOrganizationComplianceOverviewResponse,
} from '@grpc/policy-management/violation';

/**
 * Map SecurityPolicy to PolicyResponseDto
 */
export function mapSecurityPolicy(policy: SecurityPolicy): PolicyResponseDto {
  return {
    id: policy.id,
    scope: scopeFromProto(policy.scope),
    organizationId: policy.organizationId,
    projectIds: policy.projectIds || [],
    teamIds: policy.teamIds || [],
    name: policy.name,
    description: policy.description,
    priority: policy.priority,
    config: JSON.parse(policy.configJson || '{}'),
    isEnabled: policy.isEnabled,
    createdAt: new Date(Number(policy.createdAt)).toISOString(),
    updatedAt: new Date(Number(policy.updatedAt)).toISOString(),
    createdBy: policy.createdBy,
    updatedBy: policy.updatedBy,
  };
}

/**
 * Map PolicyResponse (wrapper with policy field) to PolicyResponseDto
 */
export function mapPolicyResponse(response: PolicyResponse): PolicyResponseDto {
  if (!response.policy) {
    throw new Error('Policy not found in response');
  }
  return mapSecurityPolicy(response.policy);
}

/**
 * Map TogglePolicyResponse to PolicyResponseDto
 */
export function mapTogglePolicyResponse(
  response: TogglePolicyResponse,
): PolicyResponseDto {
  if (!response.policy) {
    throw new Error('Policy not found in toggle response');
  }
  return mapSecurityPolicy(response.policy);
}

/**
 * Map action enum to string
 * Handles both numeric values and enum names from proto
 */
function actionFromProto(action: number | string | undefined): string {
  // Handle numeric values
  if (typeof action === 'number') {
    switch (action) {
      case 1:
        return 'WARN';
      case 2:
        return 'BLOCK';
      default:
        return 'UNSPECIFIED';
    }
  }

  // Handle string enum names (e.g., "VIOLATION_ACTION_WARN")
  if (typeof action === 'string') {
    if (action.includes('WARN')) return 'WARN';
    if (action.includes('BLOCK')) return 'BLOCK';
  }

  return 'UNSPECIFIED';
}

/**
 * Safely convert a timestamp to ISO string
 * Returns undefined if timestamp is missing, 0, or invalid
 */
export function safeToISOString(
  timestamp: number | undefined | null,
): string | undefined {
  if (!timestamp || timestamp <= 0) {
    return undefined;
  }
  try {
    const date = new Date(Number(timestamp));
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Map PolicyViolation from gRPC response to ViolationDto
 */
export function mapViolation(v: PolicyViolation): ViolationDto {
  // Parse violationDetailsJson if it's a string
  let details: {
    ruleId?: string;
    ruleName?: string;
    ruleDescription?: string;
    condition?: string;
    rule?: {
      id?: string;
      name?: string;
      description?: string;
      type?: string;
      value?: unknown;
      action?: string;
      operator?: string;
      criteria?: Array<{
        id?: string;
        name?: string;
        description?: string;
        type?: string;
        value?: unknown;
        operator?: string;
      }>;
    };
    affectedVulnerabilities?: Array<{
      id: string;
      name: string;
      severity: string;
      cvssScore?: number;
      cwe?: string[];
      owaspTop10?: string[];
      filePath?: string;
      startLine?: number;
      endLine?: number;
      vulnerabilityType: string;
      branch?: string;
      packageName?: string;
      packageVersion?: string;
      artifactName?: string;
    }>;
  } = {};
  if (v.violationDetailsJson) {
    try {
      details = JSON.parse(v.violationDetailsJson);
    } catch {
      details = {};
    }
  }

  const mappedAction = actionFromProto(v.actionTaken);

  // Construct rule object from details.rule or fallback to basic info
  const rule = details.rule || {};
  const isCompositeRule =
    rule.type === 'composite_and' || rule.type === 'composite_or';

  // Build base rule object
  const mappedRule: {
    id: string;
    name: string;
    description: string;
    type: string;
    value?: unknown;
    action: string;
    operator?: string;
    criteria?: Array<{
      id: string;
      name: string;
      description?: string;
      type: string;
      value?: unknown;
      operator?: string;
    }>;
  } = {
    id: rule.id || details.ruleId || v.ruleId || '',
    name: rule.name || details.ruleName || v.ruleName || '',
    description: rule.description || details.ruleDescription || '',
    type:
      rule.type || (details.condition ? details.condition.split(' ')[0] : ''),
    action: rule.action || mappedAction,
  };

  // For composite rules: include criteria (child rules)
  // For non-composite rules: include value and operator
  if (isCompositeRule && rule.criteria && Array.isArray(rule.criteria)) {
    mappedRule.criteria = rule.criteria.map((c) => ({
      id: c.id || '',
      name: c.name || '',
      description: c.description,
      type: c.type || '',
      value: c.value,
      operator: c.operator,
    }));
  } else {
    mappedRule.value =
      rule.value !== undefined
        ? rule.value
        : details.condition
          ? details.condition.split(' ').slice(2).join(' ').replace(/"/g, '')
          : undefined;
    mappedRule.operator =
      rule.operator ||
      (details.condition ? details.condition.split(' ')[1] : '');
  }

  return {
    id: v.id,
    policyId: v.policyId,
    projectId: v.projectId,
    scanId: v.scanId,
    organizationId: v.organizationId,
    actionTaken: mappedAction,
    affectedVulnerabilitiesCount: v.affectedVulnerabilitiesCount,
    rule: mappedRule,
    affectedVulnerabilities: details.affectedVulnerabilities || [],
    createdAt: safeToISOString(v.createdAt) || new Date().toISOString(),
    updatedAt: safeToISOString(v.updatedAt) || new Date().toISOString(),
  };
}

/**
 * Map ViolationStatsResponse to ViolationStatsDto
 */
export function mapViolationStats(
  response: GetViolationStatsResponse,
): ViolationStatsDto {
  return {
    totalViolations: response.totalViolations,
    blockedCount: response.blockedCount,
    warnedCount: response.warnedCount,
    applicablePoliciesCount: response.applicablePoliciesCount,
    complianceStatus: response.complianceStatus,
  };
}

/**
 * Map GetOrganizationComplianceOverviewResponse to OrganizationComplianceOverviewResponseDto
 */
export function mapOrganizationComplianceOverview(
  response: GetOrganizationComplianceOverviewResponse,
): OrganizationComplianceOverviewResponseDto {
  return {
    stats: {
      totalProjects: response.stats?.totalProjects ?? 0,
      compliantProjects: response.stats?.compliantProjects ?? 0,
      nonCompliantProjects: response.stats?.nonCompliantProjects ?? 0,
      pendingProjects: response.stats?.pendingProjects ?? 0,
      totalViolations: response.stats?.totalViolations ?? 0,
      totalBlocked: response.stats?.totalBlocked ?? 0,
      totalWarned: response.stats?.totalWarned ?? 0,
      activePoliciesCount: response.stats?.activePoliciesCount ?? 0,
      complianceRate: response.stats?.complianceRate ?? 0,
    },
    projects: (response.projects || []).map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      complianceStatus: p.complianceStatus,
      totalViolations: p.totalViolations,
      blockedCount: p.blockedCount,
      warnedCount: p.warnedCount,
      applicablePoliciesCount: p.applicablePoliciesCount,
      lastEvaluatedAt: safeToISOString(p.lastEvaluatedAt),
      lastScanId: p.lastScanId || undefined,
      teamIds: p.teamIds || [],
    })),
    violationBreakdown: (response.violationBreakdown || []).map((v) => ({
      ruleType: v.ruleType,
      count: v.count,
      blockedCount: v.blockedCount,
      warnedCount: v.warnedCount,
    })),
    trend: (response.trend || []).map((t) => ({
      date: safeToISOString(t.date) || new Date().toISOString(),
      compliantCount: t.compliantCount,
      nonCompliantCount: t.nonCompliantCount,
      pendingCount: t.pendingCount,
      complianceRate: t.complianceRate,
    })),
    total: response.total,
    page: response.page,
    pageSize: response.pageSize,
  };
}
