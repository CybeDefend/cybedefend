import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import {
  PolicyEvaluation,
  EvaluationStatus,
  ComplianceResultDetails,
} from '@entities/policy-evaluation.entity';
import {
  EvaluationQueueService,
  PolicyEvaluationJobData,
} from '@modules/evaluation-queue/evaluation-queue.service';
import { PolicyService } from '@modules/policy/policy.service';
import { countViolatedRules } from './violation-counts';

/**
 * Request DTO for triggering evaluation
 */
export interface TriggerEvaluationDto {
  scanId: string;
  projectId: string;
  organizationId: string;
  teamId?: string;
  triggeredBy: string;
  branch?: string;
}

/**
 * Service for managing policy evaluations
 */
@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @InjectRepository(PolicyEvaluation)
    private readonly evaluationRepository: Repository<PolicyEvaluation>,
    private readonly queueService: EvaluationQueueService,
    private readonly policyService: PolicyService,
  ) {}

  /**
   * The policy_evaluations.triggeredBy column is `uuid NULL`. Callers may
   * pass system identifiers (e.g. cron labels) that the proto contract
   * accepts as a generic string. Coerce anything that is not a valid UUID
   * to null so the INSERT cannot crash with 22P02.
   */
  private coerceTriggeredBy(value: string | null | undefined): string | null {
    return value && isUuid(value) ? value : null;
  }

  /**
   * Trigger a new policy evaluation for a scan
   */
  async triggerEvaluation(dto: TriggerEvaluationDto): Promise<{
    evaluationId: string;
    status: EvaluationStatus;
    message: string;
  }> {
    this.logger.log(
      `Triggering evaluation for scan=${dto.scanId}, project=${dto.projectId}`,
    );

    // Check if an evaluation already exists for this scan
    const existing = await this.evaluationRepository.findOne({
      where: { scanId: dto.scanId, projectId: dto.projectId },
    });

    if (existing) {
      // If completed or failed, return existing
      if (
        existing.status === EvaluationStatus.COMPLETED ||
        existing.status === EvaluationStatus.FAILED
      ) {
        return {
          evaluationId: existing.id,
          status: existing.status,
          message: `Evaluation already ${existing.status.toLowerCase()}`,
        };
      }

      // If in progress, return status
      return {
        evaluationId: existing.id,
        status: existing.status,
        message: 'Evaluation already in progress',
      };
    }

    // Check if any policies apply to this project. This resolves the project's
    // hierarchy in global-management, which the job carries to the processor.
    const { appliedPolicies, hierarchy } =
      await this.policyService.getEffectivePolicy(dto.projectId);

    if (appliedPolicies.length === 0) {
      // Create a completed evaluation with no violations
      const evaluation = this.evaluationRepository.create({
        scanId: dto.scanId,
        projectId: dto.projectId,
        organizationId: dto.organizationId,
        teamId: dto.teamId || null,
        status: EvaluationStatus.COMPLETED,
        progressPercentage: 100,
        compliant: true,
        action: null,
        resultDetails: {
          violationCount: 0,
          action: null as never,
          violations: [],
        },
        triggeredBy: this.coerceTriggeredBy(dto.triggeredBy),
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const saved = await this.evaluationRepository.save(evaluation);
      return {
        evaluationId: saved.id,
        status: EvaluationStatus.COMPLETED,
        message: 'No policies apply to this project',
      };
    }

    // Create pending evaluation record
    const evaluation = this.evaluationRepository.create({
      scanId: dto.scanId,
      projectId: dto.projectId,
      organizationId: dto.organizationId,
      teamId: dto.teamId || null,
      status: EvaluationStatus.PENDING,
      progressPercentage: 0,
      triggeredBy: this.coerceTriggeredBy(dto.triggeredBy),
    });

    const saved = await this.evaluationRepository.save(evaluation);

    // Add job to queue
    const jobData: PolicyEvaluationJobData = {
      evaluationId: saved.id,
      scanId: dto.scanId,
      projectId: dto.projectId,
      organizationId: dto.organizationId,
      teamId: dto.teamId,
      triggeredBy: dto.triggeredBy,
      branch: dto.branch,
      hierarchy,
    };

    await this.queueService.addEvaluationJob(jobData);

    return {
      evaluationId: saved.id,
      status: EvaluationStatus.PENDING,
      message: 'Evaluation queued for processing',
    };
  }

  /**
   * Get evaluation status
   */
  async getEvaluationStatus(evaluationId: string): Promise<{
    evaluationId: string;
    status: EvaluationStatus;
    progressPercentage: number;
    message: string;
    startedAt: number | null;
    completedAt: number | null;
  }> {
    const evaluation = await this.evaluationRepository.findOne({
      where: { id: evaluationId },
    });

    if (!evaluation) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Evaluation not found: ${evaluationId}`,
      });
    }

    let message = '';
    switch (evaluation.status) {
      case EvaluationStatus.PENDING:
        message = 'Evaluation is queued';
        break;
      case EvaluationStatus.IN_PROGRESS:
        message = `Evaluation in progress (${evaluation.progressPercentage}%)`;
        break;
      case EvaluationStatus.COMPLETED:
        message = evaluation.compliant
          ? 'Project is compliant'
          : `Found ${this.violationCountOf(evaluation)} violations`;
        break;
      case EvaluationStatus.FAILED:
        message = evaluation.errorMessage || 'Evaluation failed';
        break;
    }

    return {
      evaluationId: evaluation.id,
      status: evaluation.status,
      progressPercentage: evaluation.progressPercentage,
      message,
      startedAt: evaluation.startedAt?.getTime() || null,
      completedAt: evaluation.completedAt?.getTime() || null,
    };
  }

  /**
   * Get evaluation status by scan ID (for CLI usage)
   */
  async getEvaluationStatusByScanId(
    scanId: string,
    projectId: string,
  ): Promise<{
    hasEvaluation: boolean;
    evaluationId: string | null;
    status: EvaluationStatus | 'NOT_STARTED';
    progressPercentage: number;
    message: string;
    startedAt: number | null;
    completedAt: number | null;
  }> {
    const evaluation = await this.evaluationRepository.findOne({
      where: { scanId, projectId },
    });

    if (!evaluation) {
      return {
        hasEvaluation: false,
        evaluationId: null,
        status: 'NOT_STARTED',
        progressPercentage: 0,
        message: 'No evaluation has been triggered for this scan yet',
        startedAt: null,
        completedAt: null,
      };
    }

    let message = '';
    switch (evaluation.status) {
      case EvaluationStatus.PENDING:
        message = 'Evaluation is queued';
        break;
      case EvaluationStatus.IN_PROGRESS:
        message = `Evaluation in progress (${evaluation.progressPercentage}%)`;
        break;
      case EvaluationStatus.COMPLETED:
        message = evaluation.compliant
          ? 'Project is compliant'
          : `Found ${this.violationCountOf(evaluation)} violations`;
        break;
      case EvaluationStatus.FAILED:
        message = evaluation.errorMessage || 'Evaluation failed';
        break;
    }

    return {
      hasEvaluation: true,
      evaluationId: evaluation.id,
      status: evaluation.status,
      progressPercentage: evaluation.progressPercentage,
      message,
      startedAt: evaluation.startedAt?.getTime() || null,
      completedAt: evaluation.completedAt?.getTime() || null,
    };
  }

  /**
   * Number of violations of an evaluation: its broken rules, counted from
   * the stored matches so evaluations saved before this rule agree too.
   */
  private violationCountOf(evaluation: PolicyEvaluation): number {
    return countViolatedRules(
      (evaluation.resultDetails as ComplianceResultDetails)?.violations || [],
    ).total;
  }

  /**
   * Get compliance result for a scan
   */
  async getComplianceResult(
    scanId: string,
    projectId: string,
  ): Promise<{
    projectId: string;
    scanId: string;
    compliant: boolean;
    action: string | null;
    violationCount: number;
    blockingViolationsCount: number;
    warningViolationsCount: number;
    violations: Array<{
      policyId: string;
      ruleId: string;
      ruleName: string;
      action: string;
      details: Record<string, unknown>;
      affectedVulnerabilityIds: string[];
    }>;
    evaluatedAt: number;
    breakingRulesCount: number;
    status: EvaluationStatus;
  }> {
    const evaluation = await this.evaluationRepository.findOne({
      where: { scanId, projectId },
    });

    if (!evaluation) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `No evaluation found for scan=${scanId}, project=${projectId}`,
      });
    }

    const violations =
      (evaluation.resultDetails as ComplianceResultDetails)?.violations || [];
    const counts = countViolatedRules(violations);
    return {
      projectId: evaluation.projectId,
      scanId: evaluation.scanId,
      compliant: evaluation.compliant ?? true,
      action: evaluation.action,
      violationCount: counts.total,
      blockingViolationsCount: counts.blocking,
      warningViolationsCount: counts.warning,
      breakingRulesCount: counts.total,
      violations,
      evaluatedAt:
        evaluation.completedAt?.getTime() || evaluation.createdAt.getTime(),
      status: evaluation.status,
    };
  }

  /**
   * Get compliance history for a project
   */
  async getComplianceHistory(
    projectId: string,
    page: number = 1,
    pageSize: number = 20,
    fromDate?: number,
    toDate?: number,
  ): Promise<{
    results: Array<{
      scanId: string;
      compliant: boolean;
      action: string | null;
      violationCount: number;
      breakingRulesCount: number;
      blockingViolationsCount: number;
      warningViolationsCount: number;
      evaluatedAt: number;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Record<string, unknown> = {
      projectId,
      status: EvaluationStatus.COMPLETED,
    };

    if (fromDate && toDate) {
      where.completedAt = Between(new Date(fromDate), new Date(toDate));
    }

    const [evaluations, total] = await this.evaluationRepository.findAndCount({
      where,
      order: { completedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      results: evaluations.map((e) => {
        const details = e.resultDetails as ComplianceResultDetails;
        const counts = countViolatedRules(details?.violations || []);
        return {
          scanId: e.scanId,
          compliant: e.compliant ?? true,
          action: e.action,
          violationCount: counts.total,
          breakingRulesCount: counts.total,
          blockingViolationsCount: counts.blocking,
          warningViolationsCount: counts.warning,
          evaluatedAt: e.completedAt?.getTime() || e.createdAt.getTime(),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Dry-run evaluation (preview without storing results)
   */
  async dryRunEvaluation(
    projectId: string,
    scanId: string,
  ): Promise<{
    compliant: boolean;
    action: string | null;
    violationCount: number;
    violations: Array<{
      policyId: string;
      ruleId: string;
      ruleName: string;
      severity: string;
      action: string;
      details: Record<string, unknown>;
    }>;
  }> {
    // For dry-run, we would need to evaluate without storing
    // This is a simplified implementation - full implementation
    // would fetch vulnerabilities and evaluate like the processor

    this.logger.log(
      `Dry-run evaluation for project=${projectId}, scan=${scanId}`,
    );

    // Return empty result for now - actual implementation would
    // call the evaluation logic directly
    return {
      compliant: true,
      action: null,
      violationCount: 0,
      violations: [],
    };
  }

  /**
   * Trigger OSV-based policy evaluations for projects affected by new vulnerabilities.
   * Called when new OSV vulnerabilities are synced from the database.
   *
   * For each project:
   * 1. Find the last completed evaluation to get context (scanId, orgId, teamId)
   * 2. Create a new evaluation with a synthetic OSV scan ID
   * 3. Queue the evaluation job
   */
  async triggerOsvBasedEvaluation(
    projectIds: string[],
    triggeredBy: string,
  ): Promise<{
    affectedProjectsCount: number;
    evaluationsTriggered: number;
    message: string;
  }> {
    this.logger.log(
      `Triggering OSV-based evaluations for ${projectIds.length} projects, triggeredBy=${triggeredBy}`,
    );

    if (projectIds.length === 0) {
      return {
        affectedProjectsCount: 0,
        evaluationsTriggered: 0,
        message: 'No projects to evaluate',
      };
    }

    let evaluationsTriggered = 0;
    const errors: string[] = [];

    for (const projectId of projectIds) {
      try {
        // Find the last completed evaluation for this project to get context
        const lastEvaluation = await this.evaluationRepository.findOne({
          where: {
            projectId,
            status: EvaluationStatus.COMPLETED,
          },
          order: { completedAt: 'DESC' },
        });

        if (!lastEvaluation) {
          this.logger.debug(
            `No previous evaluation found for project=${projectId}, skipping`,
          );
          continue;
        }

        // Generate a proper UUID for the synthetic scan ID
        // OSV-triggered evaluations need a valid UUID since scanId column is uuid type
        const syntheticScanId = uuidv4();

        // For OSV evaluations, we always create a new evaluation since each sync is unique
        // No need to check for existing since we generate a fresh UUID each time

        // Create new evaluation record
        const evaluation = this.evaluationRepository.create({
          scanId: syntheticScanId,
          projectId,
          organizationId: lastEvaluation.organizationId,
          teamId: lastEvaluation.teamId,
          status: EvaluationStatus.PENDING,
          progressPercentage: 0,
          triggeredBy: this.coerceTriggeredBy(triggeredBy),
        });

        const saved = await this.evaluationRepository.save(evaluation);

        // Add job to queue
        await this.queueService.addEvaluationJob({
          evaluationId: saved.id,
          scanId: syntheticScanId,
          projectId,
          organizationId: lastEvaluation.organizationId,
          teamId: lastEvaluation.teamId || undefined,
          triggeredBy,
        });

        evaluationsTriggered++;
        this.logger.log(
          `Queued OSV-based evaluation for project=${projectId}, evaluationId=${saved.id}`,
        );
      } catch (error) {
        const errorMsg = `Failed to trigger evaluation for project=${projectId}: ${(error as Error).message}`;
        this.logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    const message =
      errors.length > 0
        ? `Triggered ${evaluationsTriggered} evaluations with ${errors.length} errors`
        : `Successfully triggered ${evaluationsTriggered} evaluations`;

    return {
      affectedProjectsCount: projectIds.length,
      evaluationsTriggered,
      message,
    };
  }
}
