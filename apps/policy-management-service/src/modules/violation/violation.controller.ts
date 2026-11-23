import { Controller, Logger } from '@nestjs/common';
import { ViolationService } from './violation.service';
import { PolicyViolation } from '@entities/policy-violation.entity';
import {
  PolicyViolationServiceController,
  PolicyViolationServiceControllerMethods,
} from '@core/grpc/policy-management/policy_management';
import {
  GetOrganizationComplianceOverviewRequest,
  GetOrganizationComplianceOverviewResponse,
  GetProjectViolationsRequest,
  GetProjectViolationsResponse,
  GetScanViolationsRequest,
  GetScanViolationsResponse,
  GetViolationStatsRequest,
  GetViolationStatsResponse,
} from '@core/grpc/policy-management/violation';
import { PolicyViolation as PolicyViolationProto } from '@core/grpc/policy-management/policy_types';

/**
 * Map action to proto enum
 */
function actionToProto(action: string): number {
  switch (action) {
    case 'WARN':
      return 1;
    case 'BLOCK':
      return 2;
    default:
      return 0;
  }
}

/**
 * Convert violation entity to proto response format
 */
function violationToResponse(violation: PolicyViolation): PolicyViolationProto {
  const details = violation.violationDetails;
  // Safely extract rule snapshot if it exists
  const ruleSnapshot = details.rule as Record<string, unknown> | undefined;

  // Build rule object with all fields, including criteria for composite rules
  const ruleType = (ruleSnapshot?.type as string) || '';
  const isCompositeRule =
    ruleType === 'composite_and' || ruleType === 'composite_or';

  const ruleObject = details.rule || {
    id: ruleSnapshot?.id || violation.ruleId,
    name: ruleSnapshot?.name || violation.ruleName,
    description: ruleSnapshot?.description || '',
    action: violation.actionTaken,
    type: ruleType,
    // For non-composite rules: include operator and value
    // For composite rules: include criteria (child rules)
    ...(isCompositeRule
      ? { criteria: (ruleSnapshot?.criteria as unknown[]) || [] }
      : {
          operator: ruleSnapshot?.operator || '',
          value: ruleSnapshot?.value ?? '',
        }),
  };

  return {
    id: violation.id,
    policyId: violation.policyId,
    projectId: violation.projectId,
    scanId: violation.scanId,
    organizationId: violation.organizationId,
    ruleId: violation.ruleId || (ruleSnapshot?.id as string) || '',
    ruleName: violation.ruleName || (ruleSnapshot?.name as string) || '',
    actionTaken: actionToProto(violation.actionTaken as string),
    violationDetailsJson: JSON.stringify({
      rule: ruleObject,
      affectedVulnerabilities: details.affectedVulnerabilities || [],
    }),
    affectedVulnerabilitiesCount: violation.affectedVulnerabilitiesCount || 1,
    createdAt: violation.createdAt.getTime(),
    updatedAt: violation.updatedAt.getTime(),
  };
}

/**
 * gRPC controller for policy violation operations
 */
@Controller()
@PolicyViolationServiceControllerMethods()
export class ViolationController implements PolicyViolationServiceController {
  private readonly logger = new Logger(ViolationController.name);

  constructor(private readonly violationService: ViolationService) {}

  /**
   * Get violations for a specific scan
   */
  async getScanViolations(
    data: GetScanViolationsRequest,
  ): Promise<GetScanViolationsResponse> {
    this.logger.log(`GetScanViolations: scan=${data.scanId}`);

    const result = await this.violationService.getScanViolations(
      data.scanId,
      data.projectId,
      data.page || 1,
      data.pageSize || 20,
    );

    return {
      violations: result.violations.map((v) => violationToResponse(v)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * Get all violations for a project
   */
  async getProjectViolations(
    data: GetProjectViolationsRequest,
  ): Promise<GetProjectViolationsResponse> {
    this.logger.log(`GetProjectViolations: project=${data.projectId}`);

    const result = await this.violationService.getProjectViolations(
      data.projectId,
      {
        page: data.page || 1,
        pageSize: data.pageSize || 20,
      },
    );

    const violations = result.violations.map((v) => {
      this.logger.debug(
        `Violation ${v.id}: DB actionTaken="${v.actionTaken}" type=${typeof v.actionTaken}`,
      );
      const response = violationToResponse(v);
      this.logger.debug(
        `Violation ${v.id}: Proto actionTaken=${response.actionTaken}`,
      );
      return response;
    });

    return {
      violations,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * Get violation statistics
   */
  async getViolationStats(
    data: GetViolationStatsRequest,
  ): Promise<GetViolationStatsResponse> {
    this.logger.log(`GetViolationStats: project=${data.projectId}`);

    const stats = await this.violationService.getViolationStats(
      data.projectId,
      {
        organizationId: data.organizationId,
        fromDate: data.fromDate,
        toDate: data.toDate,
      },
    );

    return {
      totalViolations: stats.totalViolations,
      blockedCount: stats.blockedCount,
      warnedCount: stats.warnedCount,
      applicablePoliciesCount: stats.applicablePoliciesCount,
      complianceStatus: stats.complianceStatus,
    };
  }

  /**
   * Get organization-wide compliance overview for CISO dashboard
   */
  async getOrganizationComplianceOverview(
    data: GetOrganizationComplianceOverviewRequest,
  ): Promise<GetOrganizationComplianceOverviewResponse> {
    this.logger.log(
      `GetOrganizationComplianceOverview: org=${data.organizationId}`,
    );

    const result =
      await this.violationService.getOrganizationComplianceOverview({
        organizationId: data.organizationId,
        userId: data.userId,
        page: data.page || 1,
        pageSize: data.pageSize || 20,
        fromDate: data.fromDate,
        toDate: data.toDate,
        complianceStatusFilter: data.complianceStatusFilter,
        search: data.search,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        timeframe: data.timeframe,
      });

    return result;
  }
}
