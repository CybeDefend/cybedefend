import { Controller, Logger } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import {
  PolicyEvaluationServiceController,
  PolicyEvaluationServiceControllerMethods,
} from '@core/grpc/policy-management/policy_management';
import {
  DryRunEvaluationRequest,
  DryRunEvaluationResponse,
  GetComplianceHistoryRequest,
  GetComplianceHistoryResponse,
  GetComplianceResultRequest,
  GetComplianceResultResponse,
  GetEvaluationStatusByScanIdRequest,
  GetEvaluationStatusByScanIdResponse,
  GetEvaluationStatusRequest,
  GetEvaluationStatusResponse,
  TriggerEvaluationRequest,
  TriggerEvaluationResponse,
  TriggerOsvBasedEvaluationRequest,
  TriggerOsvBasedEvaluationResponse,
} from '@core/grpc/policy-management/evaluation';

/**
 * Map entity status to proto enum
 */
function statusToProto(status: string): number {
  switch (status) {
    case 'PENDING':
      return 1;
    case 'IN_PROGRESS':
      return 2;
    case 'COMPLETED':
      return 3;
    case 'FAILED':
      return 4;
    default:
      return 0;
  }
}

/**
 * gRPC controller for policy evaluation operations
 */
@Controller()
@PolicyEvaluationServiceControllerMethods()
export class EvaluationController implements PolicyEvaluationServiceController {
  private readonly logger = new Logger(EvaluationController.name);

  constructor(private readonly evaluationService: EvaluationService) {}

  /**
   * Trigger asynchronous evaluation of a scan
   */
  async triggerEvaluation(
    data: TriggerEvaluationRequest,
  ): Promise<TriggerEvaluationResponse> {
    this.logger.log(
      `TriggerEvaluation: scan=${data.scanId}, project=${data.projectId}`,
    );

    const result = await this.evaluationService.triggerEvaluation({
      scanId: data.scanId,
      projectId: data.projectId,
      organizationId: data.organizationId,
      teamId: data.teamId,
      triggeredBy: data.triggeredBy,
      branch: data.branch,
    });

    return {
      evaluationId: result.evaluationId,
      status: statusToProto(result.status),
      message: result.message,
    };
  }

  /**
   * Get evaluation status
   */
  async getEvaluationStatus(
    data: GetEvaluationStatusRequest,
  ): Promise<GetEvaluationStatusResponse> {
    this.logger.log(`GetEvaluationStatus: ${data.evaluationId}`);

    const result = await this.evaluationService.getEvaluationStatus(
      data.evaluationId,
    );

    return {
      evaluationId: result.evaluationId,
      status: statusToProto(result.status),
      progressPercentage: result.progressPercentage,
      message: result.message,
      startedAt: result.startedAt || 0,
      completedAt: result.completedAt || 0,
    };
  }

  /**
   * Get evaluation status by scan ID (for CLI usage)
   */
  async getEvaluationStatusByScanId(
    data: GetEvaluationStatusByScanIdRequest,
  ): Promise<GetEvaluationStatusByScanIdResponse> {
    this.logger.log(
      `GetEvaluationStatusByScanId: scan=${data.scanId}, project=${data.projectId}`,
    );

    const result = await this.evaluationService.getEvaluationStatusByScanId(
      data.scanId,
      data.projectId,
    );

    this.logger.log(
      `GetEvaluationStatusByScanId result: status=${result.status}, hasEvaluation=${result.hasEvaluation}`,
    );

    // Map status to proto enum (NOT_STARTED = 5)
    let protoStatus: number;
    if (result.status === 'NOT_STARTED') {
      protoStatus = 5; // EVALUATION_STATUS_NOT_STARTED
    } else {
      protoStatus = statusToProto(result.status);
    }

    this.logger.log(`Mapped protoStatus: ${protoStatus}`);

    return {
      hasEvaluation: result.hasEvaluation,
      evaluationId: result.evaluationId || '',
      status: protoStatus,
      progressPercentage: result.progressPercentage,
      message: result.message,
      startedAt: result.startedAt || 0,
      completedAt: result.completedAt || 0,
    };
  }

  /**
   * Get compliance result for a scan
   */
  async getComplianceResult(
    data: GetComplianceResultRequest,
  ): Promise<GetComplianceResultResponse> {
    this.logger.log(
      `GetComplianceResult: scan=${data.scanId}, project=${data.projectId}`,
    );

    const result = await this.evaluationService.getComplianceResult(
      data.scanId,
      data.projectId,
    );

    return {
      result: {
        projectId: result.projectId,
        scanId: result.scanId,
        compliant: result.compliant,
        action:
          result.action === 'BLOCK' ? 2 : result.action === 'WARN' ? 1 : 0,
        violationCount: result.violationCount,
        violations: result.violations.map((v) => ({
          policyId: v.policyId,
          ruleId: v.ruleId,
          ruleName: v.ruleName,
          action: v.action === 'BLOCK' ? 2 : v.action === 'WARN' ? 1 : 0,
          detailsJson: JSON.stringify(v.details),
          affectedVulnerabilityIds: v.affectedVulnerabilityIds,
        })),
        evaluatedAt: result.evaluatedAt,
        breakingRulesCount: result.breakingRulesCount,
        blockingViolationsCount: result.blockingViolationsCount,
        warningViolationsCount: result.warningViolationsCount,
      },
      status: statusToProto(result.status),
    };
  }

  /**
   * Get compliance history for a project
   */
  async getComplianceHistory(
    data: GetComplianceHistoryRequest,
  ): Promise<GetComplianceHistoryResponse> {
    this.logger.log(`GetComplianceHistory: project=${data.projectId}`);

    const result = await this.evaluationService.getComplianceHistory(
      data.projectId,
      data.page || 1,
      data.pageSize || 20,
      data.fromDate,
      data.toDate,
    );

    return {
      results: result.results.map((r) => ({
        projectId: data.projectId,
        scanId: r.scanId,
        compliant: r.compliant,
        action: r.action === 'BLOCK' ? 2 : r.action === 'WARN' ? 1 : 0,
        violationCount: r.violationCount,
        violations: [],
        evaluatedAt: r.evaluatedAt,
        breakingRulesCount: r.breakingRulesCount,
        blockingViolationsCount: r.blockingViolationsCount,
        warningViolationsCount: r.warningViolationsCount,
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * Dry-run evaluation
   */
  async dryRunEvaluation(
    data: DryRunEvaluationRequest,
  ): Promise<DryRunEvaluationResponse> {
    this.logger.log(
      `DryRunEvaluation: project=${data.projectId}, scan=${data.scanId}`,
    );

    const result = await this.evaluationService.dryRunEvaluation(
      data.projectId,
      data.scanId,
    );

    return {
      result: {
        projectId: data.projectId,
        scanId: data.scanId,
        compliant: result.compliant,
        action:
          result.action === 'BLOCK' ? 2 : result.action === 'WARN' ? 1 : 0,
        violationCount: result.violationCount,
        violations: [],
        evaluatedAt: Date.now(),
        breakingRulesCount: 0,
        blockingViolationsCount: 0,
        warningViolationsCount: 0,
      },
    };
  }

  /**
   * Trigger OSV-based policy evaluations for projects affected by new vulnerabilities
   * Called by analysis-reporting-service when new OSV vulnerabilities are detected
   */
  async triggerOsvBasedEvaluation(
    data: TriggerOsvBasedEvaluationRequest,
  ): Promise<TriggerOsvBasedEvaluationResponse> {
    this.logger.log(
      `TriggerOsvBasedEvaluation: ${data.projectIds.length} projects, triggeredBy=${data.triggeredBy}`,
    );

    const result = await this.evaluationService.triggerOsvBasedEvaluation(
      data.projectIds,
      data.triggeredBy,
    );

    return {
      affectedProjectsCount: result.affectedProjectsCount,
      evaluationsTriggered: result.evaluationsTriggered,
      message: result.message,
    };
  }
}
