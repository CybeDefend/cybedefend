import { Controller, UseGuards } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { DataPurgeService } from '../data-purge/data-purge.service';
import { ScaService } from '../sca/sca.service';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import { GeneratedReport } from '../../entities/generated-report.entity';
import { AggregatedReport } from '../../entities/aggregated-report.entity';
import {
  BackfillCyberRiskRequest,
  BackfillCyberRiskResponse,
  RecomputeCyberRiskRequest,
  RecomputeCyberRiskResponse,
  ResultServiceController,
  RevealSecretRequest,
  RevealSecretResponse,
  RotateSecretRequest,
  RotateSecretResponse,
} from '@grpc/analysis-reporting/analysis_reporting';
import {
  DeleteContainerImageRequest,
  GetMainStatisticsRequest,
  GetMainStatisticsResponse,
  GetProjectContainerImagesRequest,
  GetProjectContainerImagesResponse,
  GetProjectContainerVulnerabilitiesRequest,
  GetProjectContainerVulnerabilitiesResponse,
  GetProjectContainerVulnerabilityByIdRequest,
  GetProjectContainerVulnerabilityByIdResponse,
  GetProjectIacVulnerabilitiesRequest,
  GetProjectIacVulnerabilitiesResponse,
  GetProjectCicdVulnerabilitiesRequest,
  GetProjectCicdVulnerabilitiesResponse,
  GetProjectSecretVulnerabilitiesRequest,
  GetProjectSecretVulnerabilitiesResponse,
  GetProjectOverviewRequest,
  GetProjectOverviewResponse,
  GetOrganizationOverviewRequest,
  GetOrganizationOverviewResponse,
  GetOrganizationSeverityDistributionRequest,
  GetOrganizationSeverityDistributionResponse,
  GetOrganizationStateDistributionRequest,
  GetOrganizationStateDistributionResponse,
  GetOrganizationVulnerabilitiesOverTimeRequest,
  GetOrganizationVulnerabilitiesOverTimeResponse,
  GetProjectPackagesResponse,
  GetProjectSastVulnerabilitiesRequest,
  GetProjectSastVulnerabilitiesResponse,
  GetProjectScaVulnerabilitiesRequest,
  GetProjectScaVulnerabilitiesResponse,
  GetProjectRiskSummaryRequest,
  GetProjectRiskSummaryResponse,
  GetProjectVulnerabilitiesCountResponse,
  GetBatchVulnerabilitiesCountRequest,
  GetBatchVulnerabilitiesCountResponse,
  GetProjectVulnerabilityByIdRequest,
  GetProjectVulnerabilityByIdResponse,
  ProjectGetRequest,
  ScanAddContainerResultRequest,
  ScanAddContainerResultResponse,
  ScanAddResultRequest,
  ScanAddResultResponse,
  ScanAddScaResultRequest,
  ScanAddScaResultResponse,
  UpdateProjectVulnerabilityResponse,
  UpdateResultRequest,
  // Batch update
  BatchUpdateResultRequest,
  BatchUpdateResultResponse,
  // Grouped vulnerabilities
  GetGroupedSastVulnerabilitiesRequest,
  GetGroupedSastVulnerabilitiesResponse,
  GetGroupedIacVulnerabilitiesRequest,
  GetGroupedIacVulnerabilitiesResponse,
  GetGroupedCicdVulnerabilitiesRequest,
  GetGroupedCicdVulnerabilitiesResponse,
  GetGroupedSecretVulnerabilitiesRequest,
  GetGroupedSecretVulnerabilitiesResponse,
  GetGroupedScaVulnerabilitiesRequest,
  GetGroupedScaVulnerabilitiesResponse,
  GetGroupedContainerVulnerabilitiesRequest,
  GetGroupedContainerVulnerabilitiesResponse,
  GetVulnerabilityWithSimilarRequest,
  GetVulnerabilityWithSimilarResponse,
  // Grouped container images
  GetGroupedContainerImagesRequest,
  GetGroupedContainerImagesResponse,
  // Top vulnerabilities
  GetTopVulnerabilitiesRequest,
  GetTopVulnerabilitiesResponse,
} from '@grpc/analysis-reporting/result';
import { ContainerService } from '../container/container.service';
import { ResultService } from './result.service';
import { ScannerCallGuard } from '../../core/scanner-auth/scanner-call.guard';
// ReanalyzeService and the three re-analysis RPCs are served by a closed
// controller (ReanalysisResultController).
import { OwaspReportService } from '../reports/owasp-report/owasp-report.service';
import { CweReportService } from '../reports/cwe-report/cwe-report.service';
import { AggregatedReportsService } from '../reports/aggregated-reports/aggregated-reports.service';
import { ReportUploadService } from '../reports/shared/report-upload.service';
import { ReportRetentionService } from '../reports/retention/report-retention.service';
import { ReportQuotaService } from '../reports/retention/report-quota.service';
import { ProjectReportEnqueuer } from '../reports/shared/project-report-enqueuer.service';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
// NOTE: the DeleteProjectVulnerabilityDetections RPC is declared in
// analysis_reporting.proto against result.proto's ProjectDeleteRequest (which
// carries organizationId ), NOT global-management's same-named
// message. They used to be structurally identical, masking the wrong import.
import {
  ProjectDeleteRequest,
  ProjectDeleteResponse,
} from '@grpc/analysis-reporting/result';
import {
  GenerateOwaspReportRequest,
  GenerateOwaspReportResponse,
  GenerateCweReportRequest,
  GenerateCweReportResponse,
  GetGeneratedReportRequest,
  GetGeneratedReportResponse,
  GetGeneratedAggregatedReportRequest,
  GetGeneratedAggregatedReportResponse,
  DeleteGeneratedReportRequest,
  DeleteGeneratedReportResponse,
  DeleteAggregatedReportRequest,
  DeleteAggregatedReportResponse,
  ListGeneratedReportsRequest,
  ListGeneratedReportsResponse,
  ListAggregatedReportsRequest,
  ListAggregatedReportsResponse,
  GetReportUsageRequest,
  GetReportUsageResponse,
  GenerateAggregatedReportResponse,
  GetProjectBranchesRequest,
  GetProjectBranchesResponse,
  CreateIssuesForScanRequest,
  CreateIssuesForScanResponse,
  NotifyScanCompleteRequest,
  NotifyScanCompleteResponse,
  NotifyScanEndedRequest,
  NotifyScanEndedResponse,
  GetScanVulnerabilitiesForPolicyRequest,
  GetScanVulnerabilitiesForPolicyResponse,
  GetScanQueueStatusRequest,
  GetScanQueueStatusResponse,
  NotifySecurityContextUpdatedRequest,
  NotifySecurityContextUpdatedResponse,
  GetPriorityDecompositionRequest,
  GetPriorityDecompositionResponse,
  GetScaFilterOptionsRequest,
  GetScaFilterOptionsResponse,
  // Async tasks
  AsyncTask,
  AsyncTaskList,
  EnqueueBatchUpdateRequest,
  EnqueueBatchUpdateResponse,
  GetAsyncTaskRequest,
  ListAsyncTasksRequest,
  DeleteAsyncTaskRequest,
  DeleteAsyncTaskResponse,
} from '@grpc/analysis-reporting/result';
import { GroupedVulnerabilityService } from '../grouped-vulnerability/grouped-vulnerability.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { ScanCompleteNotificationService } from '../scan-queue/scan-complete-notification.service';
import { PolicyVulnerabilityService } from './policy-vulnerability.service';
import { SecretService } from 'src/modules/secret/secret.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import {
  OrganizationStatisticsService,
  statsRecordFromMainStatistics,
  mainStatisticsFromRecord,
} from '../organization-statistics/organization-statistics.service';
import { GetOrganizationStatisticsRequest } from '@grpc/analysis-reporting/result';
import { OrganizationOverviewService } from './organization-overview.service';
import { CyberiskRecomputeTrigger } from '../cyber-risk/cyberisk-recompute.types';
import {
  AsyncTaskStore,
  AsyncTaskRecord,
} from 'src/core/realtime/async-task-store.service';

// SCA_AUTOFIX_MAX_VULNERABILITIES moved to the closed SCA autofix module
// with the SCA autofix RPCs.

/**
 * The gRPC status code of a failure: a grpc-js ServiceError (what a gRPC
 * client call rejects with) carries it as `code`, an RpcException in
 * `getError().code`. Undefined for any other error.
 */
function grpcCodeOf(error: unknown): number | undefined {
  if (error instanceof RpcException) {
    const inner = error.getError();
    const code =
      typeof inner === 'object' && inner !== null
        ? (inner as { code?: unknown }).code
        : undefined;
    return typeof code === 'number' ? code : undefined;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

// Every handler below declares its own
// @GrpcMethod('ResultService', '<camelCase>') instead of the generated
// @ResultServiceControllerMethods(), so the core controller still compiles
// against the exported, stripped proto; Partial<> because the closed RPCs
// are served by the closed controllers.
@Controller()
export class ResultController implements Partial<ResultServiceController> {
  constructor(
    private readonly sastIacService: SastIacService,
    private readonly scaService: ScaService,
    private readonly resultService: ResultService,
    private readonly containerService: ContainerService,
    private readonly owaspReportService: OwaspReportService,
    private readonly cweReportService: CweReportService,
    private readonly aggregatedReportsService: AggregatedReportsService,
    private readonly reportUpload: ReportUploadService,
    private readonly groupedVulnerabilityService: GroupedVulnerabilityService,
    // ScaAutoFixService left with the SCA autofix RPCs (closed SCA autofix
    // module).
    private readonly scanQueueService: ScanQueueService,
    private readonly scanCompleteNotificationService: ScanCompleteNotificationService,
    private readonly policyVulnerabilityService: PolicyVulnerabilityService,
    @InjectQueue(QUEUE_NAMES.CVSS_RECALCULATION)
    private readonly cvssRecalcQueue: Queue,
    private readonly secretService: SecretService,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    private readonly organizationStatisticsService: OrganizationStatisticsService,
    // Resolves the projects a caller may read, for the home KPI cards.
    private readonly organizationOverviewService: OrganizationOverviewService,
    @InjectRepository(GeneratedReport)
    private readonly generatedReportRepo: Repository<GeneratedReport>,
    @InjectRepository(AggregatedReport)
    private readonly aggregatedReportRepo: Repository<AggregatedReport>,
    private readonly logger: Logger,
    private readonly asyncTaskStore: AsyncTaskStore,
    private readonly reportRetention: ReportRetentionService,
    private readonly reportQuota: ReportQuotaService,
    // ProjectOrgResolver (the AutoFix cap) left with
    // startScaAutoFix.
    // Complete data deletion: the legacy project delete runs the full purge.
    private readonly dataPurgeService: DataPurgeService,
    // The premium-report enqueue, shared with the ee handlers.
    private readonly projectReportEnqueuer: ProjectReportEnqueuer,
    // A team's organization, for team reports.
    private readonly projectOrgResolver: ProjectOrgResolver,
  ) {}

  /**
   * Insert a queued AggregatedReport row and enqueue its async generation job
   * (org/team/batch). Returns immediately with reportId + status="queued"; the
   * worker publishes AGGREGATED_REPORT_READY when done. Mirrors
   * ProjectReportEnqueuer.enqueue() (per-project) — including the M2
   * orphan-row rollback on enqueue failure.
   *
   * Enqueue lives here (not in AggregatedReportsService) to avoid a circular
   * DI cycle: ScanQueueModule imports AggregatedReportsModule for the worker
   * processor, so AggregatedReportsService must not depend on ScanQueueService.
   */
  private async enqueueAggregatedReport(input: {
    scopeType: 'organization' | 'team' | 'batch';
    scopeId: string;
    organizationId: string;
    reportType: string;
    format: string;
    detailed: boolean;
    branchFilter: string;
    projectBranchSelections: { projectId: string; branches: string[] }[];
    userId: string;
    projectIds?: string[];
  }): Promise<GenerateAggregatedReportResponse> {
    // Org-scoped stored-report quota guard (soft, fail-open).
    await this.reportQuota.assertWithinQuotaForOrg(
      input.organizationId || null,
    );
    // Plan-derived expiry from the owning org (already known here).
    const expiresAt = await this.reportRetention.computeExpiresAtForOrg(
      input.organizationId || null,
    );
    // At most a few reports of one org wait or render at once: the report
    // worker is shared by every org of the instance.
    const reportId = await this.reportQuota.admitQueuedReport(
      input.organizationId || null,
      async (reportId) => {
        await this.aggregatedReportRepo.save(
          this.aggregatedReportRepo.create({
            id: reportId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            organizationId: input.organizationId || null,
            reportType: input.reportType,
            format: input.format,
            status: 'queued',
            expiresAt,
          }),
        );
      },
      async (reportId) => {
        await this.aggregatedReportRepo.delete({ id: reportId });
      },
    );

    // Surface the generation in the background-tasks widget.
    const taskId = input.userId ? ulid() : undefined;
    if (taskId && input.userId) {
      const nowMs = Date.now();
      await this.asyncTaskStore.create({
        taskId,
        type: 'report_generation',
        status: 'queued',
        total: 1,
        processed: 0,
        succeeded: 0,
        failed: 0,
        organizationId: input.organizationId || undefined,
        userId: input.userId,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
    }

    try {
      await this.scanQueueService.addAggregatedReportJob({
        reportId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        organizationId: input.organizationId,
        reportType: input.reportType,
        format: input.format,
        detailed: input.detailed,
        branchFilter: input.branchFilter,
        projectBranchSelections: input.projectBranchSelections,
        userId: input.userId,
        projectIds: input.projectIds,
        taskId,
      });
    } catch (err) {
      try {
        await this.aggregatedReportRepo.delete({ id: reportId });
      } catch (deleteErr) {
        this.logger.warn(
          `[agg-reports] failed to clean up orphan ${reportId}: ${(deleteErr as Error).message}`,
        );
      }
      if (taskId) {
        try {
          await this.asyncTaskStore.delete(taskId);
        } catch {
          // best-effort rollback of the widget task
        }
      }
      // The queue's error is logged; the caller gets a stable message.
      this.logger.error({
        err,
        msg: 'Failed to enqueue aggregated report job',
      });
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Failed to enqueue aggregated report job',
      });
    }
    return {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      reportType: input.reportType,
      format: input.format,
      content: '',
      filename: '',
      contentType: '',
      projectsCount: 0,
      projectIds: [],
      downloadUrl: '',
      expiresAtMs: 0,
      reportId,
      status: 'queued',
    };
  }

  /**
   * Add SCA scan result to the database.
   * Processing is done asynchronously via BullMQ queue to avoid blocking the event loop.
   *
   * @param request The SCA scan result request.
   * @returns The response containing the result of the operation.
   */
  @GrpcMethod('ResultService', 'addScaScanResult')
  @UseGuards(ScannerCallGuard)
  @Span()
  async addScaScanResult(
    request: ScanAddScaResultRequest,
  ): Promise<ScanAddScaResultResponse> {
    try {
      if (!request) {
        this.logger.error(`Error adding SCA scan result - no data provided`);
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'Bad request - missing data',
        });
      }

      const { projectId, scanId, packages, isLastRequest } = request;
      this.logger.log(
        `Received SCA results for project=${projectId}, scan=${scanId}, packages=${packages.length}, isLast=${isLastRequest}. Adding to queue...`,
      );

      // Add to BullMQ queue for async processing
      // batchIndex is auto-generated by the queue service
      await this.scanQueueService.addScaJob(request);

      // Return immediately to avoid scanner timeout
      return {
        projectId,
        scanId,
        message: `SCA results queued (${packages.length} packages). Processing asynchronously.`,
      };
    } catch (error) {
      this.logger.error(`Error adding SCA scan result - ${error.message}`);
      throw error;
    }
  }

  /**
   * Add scan result SAST and IAC to the database.
   * Processing is done asynchronously via BullMQ queue.
   *
   * @param request The scan result request.
   * @returns The response containing the result of the operation.
   */
  @GrpcMethod('ResultService', 'addScanResult')
  @UseGuards(ScannerCallGuard)
  @Span()
  async addScanResult(
    request: ScanAddResultRequest,
  ): Promise<ScanAddResultResponse> {
    if (!request) {
      this.logger.error(`Error adding scan result - no data provided`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing data',
      });
    }

    const { projectId, scanId, vulnerabilities, isLastRequest } = request;
    this.logger.log(
      `Received SAST/IAC results for project=${projectId}, scan=${scanId}, vulns=${vulnerabilities?.length || 0}, isLast=${isLastRequest}. Adding to queue...`,
    );

    // Add to BullMQ queue for async processing
    // batchIndex is auto-generated by the queue service
    await this.scanQueueService.addSastIacJob(request);

    return {
      projectId,
      scanId,
      message: `SAST/IAC results queued (${vulnerabilities?.length || 0} vulnerabilities). Processing asynchronously.`,
      success: true,
    };
  }

  // ImportResults is served by ResultsImportController
  // (modules/results-import), on the same ResultService.

  /**
   * Add container scan result to the database.
   * Processing is done asynchronously via BullMQ queue.
   */
  @GrpcMethod('ResultService', 'addContainerScanResult')
  @UseGuards(ScannerCallGuard)
  @Span()
  async addContainerScanResult(
    request: ScanAddContainerResultRequest,
  ): Promise<ScanAddContainerResultResponse> {
    if (!request) {
      this.logger.error('Error adding container scan result - no data');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing data',
      });
    }

    const { projectId, scanId, chunk } = request;
    this.logger.log(
      `Received Container results for project=${projectId}, scan=${scanId}, chunk=${chunk?.index || 0}, isLast=${chunk?.isLast}. Adding to queue...`,
    );

    // Add to BullMQ queue for async processing
    // batchIndex is auto-generated by the queue service
    await this.scanQueueService.addContainerJob(request);

    return {
      projectId,
      scanId,
      success: true,
      message: `Container results queued (chunk ${chunk?.index || 0}). Processing asynchronously.`,
    };
  }

  @GrpcMethod('ResultService', 'getProjectContainerVulnerabilities')
  @Span()
  async getProjectContainerVulnerabilities(
    req: GetProjectContainerVulnerabilitiesRequest,
  ): Promise<GetProjectContainerVulnerabilitiesResponse> {
    return this.containerService.getProjectContainerVulnerabilities(req);
  }

  @GrpcMethod('ResultService', 'getContainerVulnerabilityById')
  @Span()
  async getContainerVulnerabilityById(
    req: GetProjectContainerVulnerabilityByIdRequest,
  ): Promise<GetProjectContainerVulnerabilityByIdResponse> {
    return this.containerService.getContainerVulnerabilityById(req);
  }

  /**
   * Get the number of vulnerabilities for a project by severity.
   *
   * @param request The project request.
   * @returns The response containing the number of vulnerabilities.
   */
  @GrpcMethod('ResultService', 'getVulnerabilitiesCount')
  @Span()
  async getVulnerabilitiesCount(
    request: ProjectGetRequest,
  ): Promise<GetProjectVulnerabilitiesCountResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error getting vulnerabilities count - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.resultService.getVulnerabilitiesCount(request);
  }

  /**
   * The persisted CybeRisk score and the detected languages of a
   * project, read by global-management's ProjectService/Get.
   *
   * @param request The project request.
   * @returns The project's score and languages.
   */
  @GrpcMethod('ResultService', 'getProjectRiskSummary')
  @Span()
  async getProjectRiskSummary(
    request: GetProjectRiskSummaryRequest,
  ): Promise<GetProjectRiskSummaryResponse> {
    if (!request?.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.resultService.getProjectRiskSummary(request);
  }

  /**
   * Get vulnerabilities count for multiple projects in a single batch request.
   * Optimized for performance when listing many projects.
   *
   * @param request The batch request containing project IDs.
   * @returns The response containing counts for all projects.
   */
  @GrpcMethod('ResultService', 'getBatchVulnerabilitiesCount')
  @Span()
  async getBatchVulnerabilitiesCount(
    request: GetBatchVulnerabilitiesCountRequest,
  ): Promise<GetBatchVulnerabilitiesCountResponse> {
    if (!request.projectIds || request.projectIds.length === 0) {
      return { counts: [] };
    }
    return this.resultService.getBatchVulnerabilitiesCount(request);
  }

  /**
   * Get the overview of a project: totalBySeverity, totalByState, totalByAnalysisType and vulnerabilitiesOverTime.
   *
   * @param request The project overview request.
   * @returns The response containing the overview of the project.
   */
  @GrpcMethod('ResultService', 'getProjectOverview')
  @Span()
  async getProjectOverview(
    request: GetProjectOverviewRequest,
  ): Promise<GetProjectOverviewResponse> {
    if (!request.projectId) {
      this.logger.error(`Error getting project overview - missing projectId`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.resultService.getProjectOverview(request);
  }

  /**
   * Get organization-wide overview aggregating statistics from all projects.
   *
   * @param request The organization overview request with organizationId and userId.
   * @returns The aggregated overview response for the entire organization.
   */
  @GrpcMethod('ResultService', 'getOrganizationOverview')
  @Span()
  async getOrganizationOverview(
    request: GetOrganizationOverviewRequest,
  ): Promise<GetOrganizationOverviewResponse> {
    if (!request.organizationId) {
      this.logger.error(
        `Error getting organization overview - missing organizationId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    if (!request.userId) {
      this.logger.error(`Error getting organization overview - missing userId`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing userId',
      });
    }
    return this.resultService.getOrganizationOverview(request);
  }

  @GrpcMethod('ResultService', 'getOrganizationSeverityDistribution')
  @Span()
  async getOrganizationSeverityDistribution(
    request: GetOrganizationSeverityDistributionRequest,
  ): Promise<GetOrganizationSeverityDistributionResponse> {
    if (!request.filter?.organizationId) {
      this.logger.error(
        `Error getting organization severity distribution - missing organizationId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    if (!request.filter?.userId) {
      this.logger.error(
        `Error getting organization severity distribution - missing userId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing userId',
      });
    }
    return this.resultService.getOrganizationSeverityDistribution(request);
  }

  @GrpcMethod('ResultService', 'getOrganizationStateDistribution')
  @Span()
  async getOrganizationStateDistribution(
    request: GetOrganizationStateDistributionRequest,
  ): Promise<GetOrganizationStateDistributionResponse> {
    if (!request.filter?.organizationId) {
      this.logger.error(
        `Error getting organization state distribution - missing organizationId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    if (!request.filter?.userId) {
      this.logger.error(
        `Error getting organization state distribution - missing userId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing userId',
      });
    }
    return this.resultService.getOrganizationStateDistribution(request);
  }

  @GrpcMethod('ResultService', 'getOrganizationVulnerabilitiesOverTime')
  @Span()
  async getOrganizationVulnerabilitiesOverTime(
    request: GetOrganizationVulnerabilitiesOverTimeRequest,
  ): Promise<GetOrganizationVulnerabilitiesOverTimeResponse> {
    if (!request.filter?.organizationId) {
      this.logger.error(
        `Error getting organization vulnerabilities over time - missing organizationId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    if (!request.filter?.userId) {
      this.logger.error(
        `Error getting organization vulnerabilities over time - missing userId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing userId',
      });
    }
    return this.resultService.getOrganizationVulnerabilitiesOverTime(request);
  }

  /**
   * Get the main statistics of a project.
   *
   * @param request The main statistics request.
   * @returns The response containing the main statistics.
   */
  @GrpcMethod('ResultService', 'getMainStatistics')
  @Span()
  async getMainStatistics(
    request: GetMainStatisticsRequest,
  ): Promise<GetMainStatisticsResponse> {
    if (!request.projectIds || request.projectIds.length === 0) {
      this.logger.error(`Error getting main statistics - missing projectIds`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectIds',
      });
    }
    return this.resultService.getMainStatistics(request);
  }

  /**
   * Home KPI cards of an organization, scoped to what the caller may read.
   *
   * Any member of the organization reaches this route, and a member reads
   * only the projects of their teams. The persisted organization_statistics
   * row (kept fresh by the debounced recompute worker) covers every project,
   * so it is served only to a caller who reads every project of the
   * organization; anyone else gets figures computed over their own readable
   * projects, which are never persisted into the organization row.
   *
   * A request without a user id comes from a gateway older than this
   * contract: it still gets the organization row, as it did before.
   */
  @GrpcMethod('ResultService', 'getOrganizationStatistics')
  @Span()
  async getOrganizationStatistics(
    request: GetOrganizationStatisticsRequest,
  ): Promise<GetMainStatisticsResponse> {
    const { organizationId, userId } = request;
    if (!organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    if (!userId) {
      this.logger.warn(
        `getOrganizationStatistics without a userId for org=${organizationId}: serving the organization-wide row`,
      );
      return this.organizationWideStatistics(organizationId);
    }
    // global-management decides what the caller reads (every project for the
    // creator and administrators, the projects of their teams otherwise) and
    // answers only the list, so "reads everything" is that list covering
    // every project of the organization. Both are fetched at once.
    const [readableProjectIds, organizationProjectIds] = await Promise.all([
      this.organizationOverviewService.getReadableProjectIds(
        organizationId,
        userId,
      ),
      this.organizationStatisticsService.resolveProjectIds(organizationId),
    ]);
    const readable = new Set(readableProjectIds);
    if (organizationProjectIds.every((id) => readable.has(id))) {
      return this.organizationWideStatistics(
        organizationId,
        organizationProjectIds,
      );
    }
    if (readableProjectIds.length === 0) {
      return mainStatisticsFromRecord(null);
    }
    const dto = await this.resultService.getMainStatistics({
      projectIds: readableProjectIds,
    });
    return mainStatisticsFromRecord(statsRecordFromMainStatistics(dto));
  }

  /**
   * The organization-wide KPI cards, read O(1) from the persisted row. On a
   * cold row (organization never computed) they are computed once over every
   * project and persisted.
   */
  private async organizationWideStatistics(
    organizationId: string,
    knownProjectIds?: string[],
  ): Promise<GetMainStatisticsResponse> {
    const persisted =
      await this.organizationStatisticsService.readPersisted(organizationId);
    if (persisted) {
      // O(1) hot path: serve the persisted KPI row verbatim, no
      // global-management round-trip. Freshness on project deletion is handled
      // on the write path — deleteProjectVulnerabilityDetections marks the org
      // dirty, and the debounced recompute re-scopes to the live projects
      // (writing zeros once the last project is gone).
      return persisted;
    }
    // Cold row: compute once synchronously so a brand-new org isn't blank, and
    // persist it so subsequent reads are O(1).
    const projectIds =
      knownProjectIds ??
      (await this.organizationStatisticsService.resolveProjectIds(
        organizationId,
      ));
    const dto = projectIds.length
      ? await this.resultService.getMainStatistics({ projectIds })
      : null;
    const stats = statsRecordFromMainStatistics(dto);
    await this.organizationStatisticsService.saveInitial(organizationId, stats);
    return mainStatisticsFromRecord(stats);
  }

  /**
   * Get the vulnerabilities of a project for SAST.
   *
   * @param request The SAST vulnerabilities request.
   * @returns The response containing the vulnerabilities.
   */
  @GrpcMethod('ResultService', 'getProjectSastVulnerabilities')
  @Span()
  async getProjectSastVulnerabilities(
    request: GetProjectSastVulnerabilitiesRequest,
  ): Promise<GetProjectSastVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error getting SAST vulnerabilities - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.sastIacService.getProjectSastVulnerabilities(request);
  }

  /**
   * Get the vulnerabilities of a project for IAC.
   *
   * @param request The IAC vulnerabilities request.
   * @returns The response containing the vulnerabilities.
   */
  @GrpcMethod('ResultService', 'getProjectIacVulnerabilities')
  @Span()
  async getProjectIacVulnerabilities(
    request: GetProjectIacVulnerabilitiesRequest,
  ): Promise<GetProjectIacVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error getting IAC vulnerabilities - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.sastIacService.getProjectIacVulnerabilities(request);
  }

  /**
   * Get the vulnerabilities of a project for CICD.
   *
   * @param request The CICD vulnerabilities request.
   * @returns The response containing the vulnerabilities.
   */
  @GrpcMethod('ResultService', 'getProjectCicdVulnerabilities')
  @Span()
  async getProjectCicdVulnerabilities(
    request: GetProjectCicdVulnerabilitiesRequest,
  ): Promise<GetProjectCicdVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error getting CICD vulnerabilities - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.sastIacService.getProjectCicdVulnerabilities(request);
  }

  /**
   * Get the vulnerabilities of a project for SCA.
   *
   * @param request The SCA vulnerabilities request.
   * @returns The response containing the vulnerabilities.
   */
  @GrpcMethod('ResultService', 'getProjectScaVulnerabilities')
  @Span()
  async getProjectScaVulnerabilities(
    request: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectScaVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error getting SCA vulnerabilities - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scaService.getProjectScaVulnerabilities(request);
  }

  /**
   * Get the available filter options (ecosystems, file names, …) for SCA vulnerabilities.
   *
   * @param request The SCA filter options request.
   * @returns The response containing the available filter values.
   */
  @GrpcMethod('ResultService', 'getScaFilterOptions')
  @Span()
  async getScaFilterOptions(
    request: GetScaFilterOptionsRequest,
  ): Promise<GetScaFilterOptionsResponse> {
    if (!request.projectId) {
      this.logger.error(`Error getting SCA filter options - missing projectId`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scaService.getScaFilterOptions(request);
  }

  /**
   * Get the packages of a project for SCA.
   *
   * @param request The SCA packages request.
   * @returns The response containing the packages.
   */
  @GrpcMethod('ResultService', 'getProjectScaPackages')
  @Span()
  async getProjectScaPackages(
    request: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectPackagesResponse> {
    if (!request.projectId) {
      this.logger.error(`Error getting SCA packages - missing projectId`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scaService.getProjectScaPackages(request);
  }

  /**
   * Get license summary for SCA packages across a project.
   */
  @GrpcMethod('ResultService', 'getProjectLicenseSummary')
  @Span()
  async getProjectLicenseSummary(request: {
    projectId: string;
    branch?: string;
    packageType?: string[];
  }): Promise<any> {
    if (!request.projectId) {
      this.logger.error(`Error getting license summary - missing projectId`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.scaService.getProjectLicenseSummary(request);
  }

  /**
   * Get packages that use a specific license.
   */
  @GrpcMethod('ResultService', 'getPackagesByLicense')
  @Span()
  async getPackagesByLicense(request: {
    projectId: string;
    spdxId: string;
    branch?: string;
    packageType?: string[];
  }): Promise<any> {
    if (!request.projectId || !request.spdxId) {
      this.logger.error(
        `Error getting packages by license - missing projectId or spdxId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or spdxId',
      });
    }
    return this.scaService.getPackagesByLicense(request);
  }

  /**
   * Get all license classifications for an organization.
   */
  @GrpcMethod('ResultService', 'getLicenseClassifications')
  @Span()
  async getLicenseClassifications(request: {
    organizationId: string;
  }): Promise<any> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    return this.scaService.getLicenseClassifications(request);
  }

  /**
   * Update license classification overrides for an organization.
   */
  @GrpcMethod('ResultService', 'updateLicenseClassifications')
  @Span()
  async updateLicenseClassifications(request: {
    organizationId: string;
    overrides: Array<{ spdxId: string; category: string }>;
  }): Promise<any> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    return this.scaService.updateLicenseClassifications(request);
  }

  /**
   * Reset all license classification overrides for an organization.
   */
  @GrpcMethod('ResultService', 'resetLicenseClassifications')
  @Span()
  async resetLicenseClassifications(request: {
    organizationId: string;
  }): Promise<any> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId',
      });
    }
    return this.scaService.resetLicenseClassifications(request);
  }

  /**
   * Delete a single custom license override for an organization.
   */
  @GrpcMethod('ResultService', 'deleteLicenseOverride')
  @Span()
  async deleteLicenseOverride(request: {
    organizationId: string;
    spdxId: string;
  }): Promise<any> {
    if (!request.organizationId || !request.spdxId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing organizationId or spdxId',
      });
    }
    return this.scaService.deleteLicenseOverride(request);
  }

  /**
   * Manually assign a license SPDX ID to a specific package.
   */
  @GrpcMethod('ResultService', 'assignPackageLicense')
  @Span()
  async assignPackageLicense(request: {
    projectId: string;
    packageId: string;
    spdxId: string;
  }): Promise<any> {
    if (!request.projectId || !request.packageId || !request.spdxId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId, packageId, or spdxId',
      });
    }
    return this.scaService.assignPackageLicense(request);
  }

  /**
   * Toggle ignore status for a package in license analysis.
   */
  @GrpcMethod('ResultService', 'setPackageLicenseIgnored')
  @Span()
  async setPackageLicenseIgnored(request: {
    projectId: string;
    packageId: string;
    ignored: boolean;
  }): Promise<any> {
    if (!request.projectId || !request.packageId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or packageId',
      });
    }
    return this.scaService.setPackageLicenseIgnored(request);
  }

  /**
   * Get a vulnerability of a project for SAST by id.
   *
   * @param request The vulnerability by id request.
   * @returns The response containing the vulnerability.
   */
  @GrpcMethod('ResultService', 'getSastVulnerabilityById')
  @Span()
  async getSastVulnerabilityById(
    request: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    if (!request.projectId || !request.vulnerabilityId) {
      this.logger.error(
        `Error getting SAST vulnerability - missing projectId or vulnerabilityId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or vulnerabilityId',
      });
    }
    return this.sastIacService.getSastVulnerabilityByIdInProject(request);
  }

  /**
   * Get a vulnerability of a project for IAC by id.
   *
   * @param request The vulnerability by id request.
   * @returns The response containing the vulnerability.
   */
  @GrpcMethod('ResultService', 'getIacVulnerabilityById')
  @Span()
  async getIacVulnerabilityById(
    request: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    if (!request.projectId || !request.vulnerabilityId) {
      this.logger.error(
        `Error getting IAC vulnerability - missing projectId or vulnerabilityId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or vulnerabilityId',
      });
    }
    return this.sastIacService.getIacVulnerabilityByIdInProject(request);
  }

  /**
   * Get a vulnerability of a project for CICD by id.
   *
   * @param request The vulnerability by id request.
   * @returns The response containing the vulnerability.
   */
  @GrpcMethod('ResultService', 'getCicdVulnerabilityById')
  @Span()
  async getCicdVulnerabilityById(
    request: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    if (!request.projectId || !request.vulnerabilityId) {
      this.logger.error(
        `Error getting CICD vulnerability - missing projectId or vulnerabilityId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or vulnerabilityId',
      });
    }
    return this.sastIacService.getCicdVulnerabilityByIdInProject(request);
  }

  /**
   * Get the vulnerabilities of a project for Secret.
   *
   * @param request The Secret vulnerabilities request.
   * @returns The response containing the vulnerabilities.
   */
  @GrpcMethod('ResultService', 'getProjectSecretVulnerabilities')
  @Span()
  async getProjectSecretVulnerabilities(
    request: GetProjectSecretVulnerabilitiesRequest,
  ): Promise<GetProjectSecretVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error getting Secret vulnerabilities - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.sastIacService.getProjectSecretVulnerabilities(request);
  }

  /**
   * Get a vulnerability of a project for Secret by id.
   *
   * @param request The vulnerability by id request.
   * @returns The response containing the vulnerability.
   */
  @GrpcMethod('ResultService', 'getSecretVulnerabilityById')
  @Span()
  async getSecretVulnerabilityById(
    request: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    if (!request.projectId || !request.vulnerabilityId) {
      this.logger.error(
        `Error getting Secret vulnerability - missing projectId or vulnerabilityId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or vulnerabilityId',
      });
    }
    return this.sastIacService.getSecretVulnerabilityByIdInProject(request);
  }

  /**
   * Get a vulnerability of a project for SCA by id.
   *
   * @param request The vulnerability by id request.
   * @returns The response containing the vulnerability.
   */
  @GrpcMethod('ResultService', 'getScaVulnerabilityById')
  @Span()
  async getScaVulnerabilityById(
    request: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    if (!request.projectId || !request.vulnerabilityId) {
      this.logger.error(
        `Error getting SCA vulnerability - missing projectId or vulnerabilityId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or vulnerabilityId',
      });
    }
    return this.scaService.getScaVulnerabilityByIdInProject(request);
  }

  /**
   * Update a vulnerability of a project.
   *
   * @param request The update request.
   * @returns The response containing the result of the operation.
   */
  @GrpcMethod('ResultService', 'updateScanResult')
  @Span()
  async updateScanResult(
    request: UpdateResultRequest,
  ): Promise<UpdateProjectVulnerabilityResponse> {
    if (!request.vulnerabilityId || !request.projectId) {
      this.logger.error(`Error updating scan result - missing data`);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing required fields',
      });
    }
    return this.resultService.updateScanResult(request);
  }

  /**
   * Batch update multiple vulnerabilities at once.
   * Allows updating status, priority, and/or comment for multiple vulnerabilities in a single request.
   *
   * @param request The batch update request.
   * @returns The response containing results for each vulnerability update.
   */
  @GrpcMethod('ResultService', 'batchUpdateScanResults')
  @Span()
  async batchUpdateScanResults(
    request: BatchUpdateResultRequest,
  ): Promise<BatchUpdateResultResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error batch updating scan results - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    if (!request.items || request.items.length === 0) {
      this.logger.error(
        `Error batch updating scan results - no items provided`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - at least one item is required',
      });
    }
    if (request.items.length > 100) {
      this.logger.error(
        `Error batch updating scan results - too many items (${request.items.length})`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Bad request - cannot update more than 100 vulnerabilities at once',
      });
    }
    return this.resultService.batchUpdateScanResults(request);
  }

  // ---------------------------------------------------------------------------
  // Async task RPCs — Task 1.5 implementations
  // ---------------------------------------------------------------------------

  /**
   * Map an AsyncTaskRecord to its gRPC AsyncTask proto shape.
   * Optional string fields default to '' per proto3 zero-values.
   */
  private toProto(record: AsyncTaskRecord): AsyncTask {
    return {
      taskId: record.taskId,
      type: record.type,
      status: record.status,
      total: record.total,
      processed: record.processed,
      succeeded: record.succeeded,
      failed: record.failed,
      projectId: record.projectId ?? '',
      organizationId: record.organizationId ?? '',
      userId: record.userId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      error: record.error ?? '',
      resultUrl: record.resultUrl ?? '',
    };
  }

  @GrpcMethod('ResultService', 'enqueueBatchUpdate')
  @Span()
  async enqueueBatchUpdate(
    request: EnqueueBatchUpdateRequest,
  ): Promise<EnqueueBatchUpdateResponse> {
    if (!request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    if (!request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing userId',
      });
    }
    if (!request.items || request.items.length === 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - at least one item is required',
      });
    }
    if (request.items.length > 100) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Bad request - cannot update more than 100 vulnerabilities at once',
      });
    }

    const taskId = ulid();
    const now = Date.now();

    await this.asyncTaskStore.create({
      taskId,
      type: 'vuln_batch_update',
      status: 'queued',
      total: request.items.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      projectId: request.projectId,
      userId: request.userId,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.scanQueueService.addVulnBatchUpdateJob({
        taskId,
        projectId: request.projectId,
        userId: request.userId,
        items: request.items.map((i) => ({
          vulnerabilityId: i.vulnerabilityId,
          status: i.status,
          priority: i.priority,
          comment: i.comment,
          // Dropping it here would strand the justification at the
          // queue boundary — the worker rebuilds UpdateResultRequest from this
          // payload alone, and assertDismissalReason would then reject every
          // queued dismissal.
          dismissalReason: i.dismissalReason,
        })),
        agentToolCallId: request.agentToolCallId || undefined,
        agentConversationId: request.agentConversationId || undefined,
        agentStreamId: request.agentStreamId || undefined,
      });
    } catch (err) {
      await this.asyncTaskStore.delete(taskId);
      // The queue's error is logged; the caller gets a stable message.
      this.logger.error({ err, msg: 'Failed to enqueue batch update job' });
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Failed to enqueue batch update job',
      });
    }

    return { taskId, total: request.items.length };
  }

  @GrpcMethod('ResultService', 'getAsyncTask')
  @Span()
  async getAsyncTask(request: GetAsyncTaskRequest): Promise<AsyncTask> {
    const record = await this.asyncTaskStore.get(request.taskId);
    if (!record) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Async task not found',
      });
    }
    return this.toProto(record);
  }

  @GrpcMethod('ResultService', 'listAsyncTasks')
  @Span()
  async listAsyncTasks(request: ListAsyncTasksRequest): Promise<AsyncTaskList> {
    const records = await this.asyncTaskStore.list(request.userId);
    return { tasks: records.map((r) => this.toProto(r)) };
  }

  /**
   * Persisted dismiss of a background task. Removes the record + the
   * per-user index entry so it does not reappear on the next /me/async-tasks
   * rehydration (e.g. after a page reload). Owner-checked and idempotent.
   */
  @GrpcMethod('ResultService', 'deleteAsyncTask')
  @Span()
  async deleteAsyncTask(
    request: DeleteAsyncTaskRequest,
  ): Promise<DeleteAsyncTaskResponse> {
    if (!request?.taskId || !request?.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing taskId or userId',
      });
    }
    const record = await this.asyncTaskStore.get(request.taskId);
    // Idempotent: already gone (e.g. TTL expired) → success.
    if (!record) return { success: true };
    // Never let a user dismiss another user's task.
    if (record.userId !== request.userId) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Not allowed to delete this task',
      });
    }
    await this.asyncTaskStore.delete(request.taskId);
    return { success: true };
  }

  @GrpcMethod('ResultService', 'deleteProjectVulnerabilityDetections')
  @Span()
  async deleteProjectVulnerabilityDetections(
    request: ProjectDeleteRequest,
  ): Promise<ProjectDeleteResponse> {
    if (!request.projectId) {
      this.logger.error(
        `Error deleting vulnerability detections - missing projectId`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    // Complete data deletion: an older global-management still
    // calls this on project delete. Run the whole purge (every detection table,
    // secrets and CI/CD included, reports, inventories, diff scans, Redis keys)
    // until it is complete, with no deadline: this caller makes one call.
    try {
      let result = await this.dataPurgeService.purgeProject(
        request.projectId,
        request.organizationId,
        Number.POSITIVE_INFINITY,
      );
      while (!result.complete) {
        result = await this.dataPurgeService.purgeProject(
          request.projectId,
          request.organizationId,
          Number.POSITIVE_INFINITY,
        );
      }
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(
        `Error deleting vulnerability detections of project ${request.projectId}: ${error?.name ?? 'Error'} ${error?.code ?? ''}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error deleting project vulnerability detections`,
      });
    }
    const response: ProjectDeleteResponse = {
      message: 'Project vulnerability detections deleted successfully',
    };
    // The purge marks the organization statistics dirty itself when
    // it completes; marking here as well would mark twice.
    return response;
  }

  @GrpcMethod('ResultService', 'getProjectContainerPackages')
  @Span()
  async getProjectContainerPackages(
    req: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectPackagesResponse> {
    return this.containerService.getProjectContainerPackages(req);
  }

  @GrpcMethod('ResultService', 'getProjectContainerImages')
  @Span()
  async getProjectContainerImages(
    req: GetProjectContainerImagesRequest,
  ): Promise<GetProjectContainerImagesResponse> {
    return this.containerService.getProjectContainerImages(req);
  }

  /**
   * Get container images grouped by repository name.
   * Each grouped image contains all its different tags with their vulnerability counts.
   *
   * @param req - The request containing projectId, pagination, filters, and sorting options.
   * @returns A grouped response with repositories and their tags.
   */
  @GrpcMethod('ResultService', 'getGroupedContainerImages')
  @Span()
  async getGroupedContainerImages(
    req: GetGroupedContainerImagesRequest,
  ): Promise<GetGroupedContainerImagesResponse> {
    return this.containerService.getGroupedContainerImages(req);
  }

  @GrpcMethod('ResultService', 'deleteContainerImage')
  @Span()
  async deleteContainerImage(
    req: DeleteContainerImageRequest,
  ): Promise<ProjectDeleteResponse> {
    return this.containerService.deleteContainerImage(req);
  }

  // startAutoFix, startBatchAutoFix and finalizeAutoFix moved to the closed
  // autofix module (CybeAutofixResultController).

  // generateScannerReport moved to ee/reports/
  // premium-reports-result.controller.ts (PremiumReportsResultController).

  /**
   * Generate OWASP Top 10 report for a project.
   */
  @GrpcMethod('ResultService', 'generateOwaspReport')
  @Span()
  async generateOwaspReport(
    request: GenerateOwaspReportRequest,
  ): Promise<GenerateOwaspReportResponse> {
    if (!request.projectId || !request.format) {
      this.logger.error(
        'Error generating OWASP report - missing required fields',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or format',
      });
    }

    // Default detailed to true if not specified
    const detailed = request.detailed !== undefined ? request.detailed : true;
    // Branch is optional: undefined / empty means "all branches" (backward compat).
    const branch =
      request.branch && request.branch.length > 0 ? request.branch : undefined;

    const reportId = await this.projectReportEnqueuer.enqueue({
      kind: 'owasp',
      projectId: request.projectId,
      format: request.format,
      detailed,
      branch,
      userId: request.userId,
    });
    return {
      projectId: request.projectId,
      format: request.format,
      content: '',
      filename: '',
      contentType: '',
      downloadUrl: '',
      expiresAtMs: 0,
      reportId,
      status: 'queued',
    };
  }

  /**
   * Generate CWE Top 25 report for a project.
   */
  @GrpcMethod('ResultService', 'generateCweReport')
  @Span()
  async generateCweReport(
    request: GenerateCweReportRequest,
  ): Promise<GenerateCweReportResponse> {
    if (!request.projectId || !request.format) {
      this.logger.error(
        'Error generating CWE report - missing required fields',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or format',
      });
    }

    // Default detailed to true if not specified
    const detailed = request.detailed !== undefined ? request.detailed : true;
    // Branch is optional: undefined / empty means "all branches" (backward compat).
    const branch =
      request.branch && request.branch.length > 0 ? request.branch : undefined;

    const reportId = await this.projectReportEnqueuer.enqueue({
      kind: 'cwe',
      projectId: request.projectId,
      format: request.format,
      detailed,
      branch,
      userId: request.userId,
    });
    return {
      projectId: request.projectId,
      format: request.format,
      content: '',
      filename: '',
      contentType: '',
      downloadUrl: '',
      expiresAtMs: 0,
      reportId,
      status: 'queued',
    };
  }

  // generateEuAiActReport moved to ee/reports/
  // premium-reports-result.controller.ts (PremiumReportsResultController).

  /**
   * Fetch the status of an async-generated report and, when ready, a freshly
   * signed download URL minted from the persisted storage object path.
   */
  @GrpcMethod('ResultService', 'getGeneratedReport')
  @Span()
  async getGeneratedReport(
    request: GetGeneratedReportRequest,
  ): Promise<GetGeneratedReportResponse> {
    if (!request?.projectId || !request?.reportId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or reportId',
      });
    }

    const report = await this.generatedReportRepo.findOne({
      where: { id: request.reportId, projectId: request.projectId },
    });
    if (!report) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Report not found',
      });
    }

    const base: GetGeneratedReportResponse = {
      reportId: report.id,
      status: report.status,
      reportKind: report.kind,
      format: report.format,
      filename: report.filename ?? '',
      contentType: report.contentType ?? '',
      downloadUrl: '',
      expiresAtMs: 0,
      error: '',
    };

    if (report.status === 'failed') {
      return { ...base, error: report.error ?? 'Report generation failed' };
    }
    if (report.status !== 'ready' || !report.objectPath) {
      // Still queued / in-flight.
      return base;
    }

    // Defense in depth: the row is already scoped to projectId by the
    // findOne above, but the objectPath is what we ultimately sign. If it
    // ever doesn't match the request's projectId (data corruption, bad
    // migration, internal misuse), refuse to mint a cross-tenant download
    // URL and surface INTERNAL so the bug is loud, not silent.
    const expectedPrefix = `reports/${request.projectId}/`;
    if (!report.objectPath.startsWith(expectedPrefix)) {
      this.logger.error(
        `[reports] getGeneratedReport: refusing to sign cross-project objectPath ` +
          `reportId=${request.reportId} projectId=${request.projectId}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Report storage path mismatch — please contact support',
      });
    }

    const signed = await this.reportUpload.signExisting({
      projectId: request.projectId,
      objectPath: report.objectPath,
      filename: report.filename ?? 'report',
    });
    return {
      ...base,
      downloadUrl: signed.downloadUrl,
      expiresAtMs: signed.expiresAtMs as unknown as number,
    };
  }

  /**
   * Generate organization aggregated report.
   */
  @GrpcMethod('ResultService', 'generateOrganizationReport')
  @Span()
  async generateOrganizationReport(
    request: any, // GenerateOrganizationReportRequest
  ): Promise<any> {
    // GenerateAggregatedReportResponse
    if (
      !request.organizationId ||
      !request.userId ||
      !request.reportType ||
      !request.format
    ) {
      this.logger.error(
        'Error generating organization report - missing required fields',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Bad request - missing organizationId, userId, reportType, or format',
      });
    }

    const detailed = request.detailed !== undefined ? request.detailed : true;

    return this.enqueueAggregatedReport({
      scopeType: 'organization',
      scopeId: request.organizationId,
      organizationId: request.organizationId,
      reportType: request.reportType,
      format: request.format,
      detailed,
      branchFilter: request.branchFilter || 'all',
      projectBranchSelections: request.projectBranchSelections || [],
      userId: request.userId,
    });
  }

  /**
   * Generate team aggregated report.
   */
  @GrpcMethod('ResultService', 'generateTeamReport')
  @Span()
  async generateTeamReport(
    request: any, // GenerateTeamReportRequest
  ): Promise<any> {
    // GenerateAggregatedReportResponse
    if (
      !request.teamId ||
      !request.userId ||
      !request.reportType ||
      !request.format
    ) {
      this.logger.error(
        'Error generating team report - missing required fields',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing teamId, userId, reportType, or format',
      });
    }

    const detailed = request.detailed !== undefined ? request.detailed : true;

    // The report is counted, capped and stored under the team's own
    // organization, resolved here from the team, never taken from the
    // caller: without it the report would escape the per-organization
    // bounds. A caller's organizationId must name that same organization
    // (anti-IDOR: a manager of a team must not tag its report to another
    // org), and global-management confirms the team belongs to it.
    const organizationId = await this.resolveTeamOrganization(
      request.teamId,
      request.userId,
    );
    if (!organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'TEAM_ORGANIZATION_UNRESOLVED',
      });
    }
    if (request.organizationId && request.organizationId !== organizationId) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Team does not belong to the specified organization',
      });
    }
    await this.aggregatedReportsService.validateTeamAccess(
      request.teamId,
      organizationId,
    );

    return this.enqueueAggregatedReport({
      scopeType: 'team',
      scopeId: request.teamId,
      organizationId,
      reportType: request.reportType,
      format: request.format,
      detailed,
      branchFilter: request.branchFilter || 'all',
      projectBranchSelections: request.projectBranchSelections || [],
      userId: request.userId,
    });
  }

  /**
   * The organization a team belongs to, from the team's projects (a team
   * lives in one organization). Null when it has no project the caller can
   * see, or when global-management answers that the team is missing or not
   * readable: a team report of such a team has nothing to render anyway.
   * Any other failure to read the list, or a list none of whose projects
   * resolves to an organization, is a lookup failure the caller may retry:
   * UNAVAILABLE, never a bad request.
   */
  private async resolveTeamOrganization(
    teamId: string,
    userId: string,
  ): Promise<string | null> {
    let projectIds: string[];
    try {
      projectIds = await this.aggregatedReportsService.teamProjectIds(
        teamId,
        userId,
      );
    } catch (error) {
      const code = grpcCodeOf((error as { cause?: unknown })?.cause ?? error);
      if (code === status.NOT_FOUND || code === status.PERMISSION_DENIED) {
        return null;
      }
      this.logger.warn(
        { err: error, teamId },
        "Team report: the team's projects could not be read",
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'TEAM_ORGANIZATION_LOOKUP_UNAVAILABLE',
      });
    }
    for (const projectId of projectIds) {
      const orgId = await this.projectOrgResolver.resolveOrgId(projectId);
      if (orgId) return orgId;
    }
    if (projectIds.length === 0) return null;
    this.logger.warn(
      { teamId, projects: projectIds.length },
      "Team report: none of the team's projects resolved to an organization",
    );
    throw new RpcException({
      code: status.UNAVAILABLE,
      message: 'TEAM_ORGANIZATION_LOOKUP_UNAVAILABLE',
    });
  }

  /**
   * Generate batch projects aggregated report.
   */
  @GrpcMethod('ResultService', 'generateBatchReport')
  @Span()
  async generateBatchReport(
    request: any, // GenerateBatchReportRequest
  ): Promise<any> {
    // GenerateAggregatedReportResponse
    if (
      !request.projectIds ||
      request.projectIds.length === 0 ||
      !request.userId ||
      !request.reportType ||
      !request.format
    ) {
      this.logger.error(
        'Error generating batch report - missing required fields',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Bad request - missing projectIds, userId, reportType, or format',
      });
    }

    const detailed = request.detailed !== undefined ? request.detailed : true;

    // Security fail-fast: every projectId must belong to the org (anti-IDOR).
    // Runs synchronously BEFORE enqueue so an unauthorized request is rejected
    // (PERMISSION_DENIED) without ever queueing a job.
    await this.aggregatedReportsService.validateBatchAccess(
      request.projectIds,
      request.organizationId,
      request.userId,
    );

    return this.enqueueAggregatedReport({
      scopeType: 'batch',
      scopeId: request.projectIds.join(','),
      organizationId: request.organizationId,
      reportType: request.reportType,
      format: request.format,
      detailed,
      branchFilter: request.branchFilter || 'all',
      projectBranchSelections: request.projectBranchSelections || [],
      userId: request.userId,
      projectIds: request.projectIds,
    });
  }

  /**
   * Poll the status of an async-generated aggregated report and, when ready, a
   * freshly signed download URL. Delegates to AggregatedReportsService (which
   * enforces scope ownership + objectPath/tenant defense in depth).
   */
  @GrpcMethod('ResultService', 'getGeneratedAggregatedReport')
  @Span()
  async getGeneratedAggregatedReport(
    request: GetGeneratedAggregatedReportRequest,
  ): Promise<GetGeneratedAggregatedReportResponse> {
    return this.aggregatedReportsService.getGeneratedAggregatedReport(request);
  }

  /**
   * Delete a stored per-project report: remove the stored object FIRST
   * then the DB row (frees a quota slot). Scoped to projectId (same cross-tenant
   * guard as getGeneratedReport); NOT_FOUND for an unknown or other-project id.
   */
  @GrpcMethod('ResultService', 'deleteGeneratedReport')
  @Span()
  async deleteGeneratedReport(
    request: DeleteGeneratedReportRequest,
  ): Promise<DeleteGeneratedReportResponse> {
    if (!request?.projectId || !request?.reportId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or reportId',
      });
    }
    const report = await this.generatedReportRepo.findOne({
      where: { id: request.reportId, projectId: request.projectId },
    });
    if (!report) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Report not found',
      });
    }
    if (report.objectPath) {
      await this.reportUpload.deleteReport(
        report.objectPath,
        request.projectId,
      );
    }
    await this.generatedReportRepo.delete({
      id: report.id,
      projectId: request.projectId,
    });
    // A queued report's job goes too: deleting must not leave work behind
    // that still uses the shared worker (and its in-flight slot is freed).
    await this.removeQueueJob(() =>
      this.scanQueueService.removeReportJob(report.id),
    );
    return { success: true };
  }

  /**
   * Delete a stored aggregated (org/team/batch) report. Ownership is
   * verified against EVERY identifier supplied on the path (organizationId
   * and/or scopeType+scopeId): a report must match all of them, never the
   * reportId alone, so an org cannot delete another scope's report.
   */
  @GrpcMethod('ResultService', 'deleteAggregatedReport')
  @Span()
  async deleteAggregatedReport(
    request: DeleteAggregatedReportRequest,
  ): Promise<DeleteAggregatedReportResponse> {
    if (!request?.reportId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing reportId',
      });
    }
    const report = await this.aggregatedReportRepo.findOne({
      where: { id: request.reportId },
    });
    const checks: boolean[] = [];
    if (report) {
      if (request.organizationId) {
        checks.push(report.organizationId === request.organizationId);
      }
      if (request.scopeType && request.scopeId) {
        checks.push(
          report.scopeType === request.scopeType &&
            report.scopeId === request.scopeId,
        );
      }
    }
    if (!report || checks.length === 0 || checks.some((ok) => !ok)) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Report not found',
      });
    }
    if (report.objectPath) {
      // tenant segment of reports/<tenant>/<id>: organizationId for aggregated.
      const tenant =
        report.objectPath.split('/')[1] ?? report.organizationId ?? '';
      await this.reportUpload.deleteReport(report.objectPath, tenant);
    }
    await this.aggregatedReportRepo.delete({ id: report.id });
    await this.removeQueueJob(() =>
      this.scanQueueService.removeAggregatedReportJob(report.id),
    );
    return { success: true };
  }

  /** Best effort: a job already rendering stops at its next re-read. */
  private async removeQueueJob(remove: () => Promise<void>): Promise<void> {
    try {
      await remove();
    } catch (err) {
      this.logger.warn(
        `[reports] could not remove the job of a deleted report: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Paginated history of a project's stored reports, newest first.
   * Excludes expired rows (consistent with the quota). No download_url — the
   * caller re-signs on demand via GetGeneratedReport.
   */
  @GrpcMethod('ResultService', 'listGeneratedReports')
  @Span()
  async listGeneratedReports(
    request: ListGeneratedReportsRequest,
  ): Promise<ListGeneratedReportsResponse> {
    if (!request?.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(100, Math.max(1, request.pageSize || 20));
    const now = new Date();
    const where = [
      { projectId: request.projectId, expiresAt: IsNull() },
      { projectId: request.projectId, expiresAt: MoreThan(now) },
    ];
    const [rows, total] = await this.generatedReportRepo.findAndCount({
      where: where as any,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((r) => ({
        reportId: r.id,
        kind: r.kind,
        format: r.format,
        status: r.status,
        filename: r.filename ?? '',
        branch: r.branch ?? '',
        createdAtMs: r.createdAt ? r.createdAt.getTime() : 0,
        expiresAtMs: r.expiresAt ? r.expiresAt.getTime() : 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Paginated history of aggregated (org/team/batch) reports. The org
   * route filters by organizationId (every scope owned by the org); the team
   * route filters by scopeType+scopeId. Excludes expired rows.
   */
  @GrpcMethod('ResultService', 'listAggregatedReports')
  @Span()
  async listAggregatedReports(
    request: ListAggregatedReportsRequest,
  ): Promise<ListAggregatedReportsResponse> {
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(100, Math.max(1, request.pageSize || 20));
    const now = new Date();
    const base: Record<string, unknown> = {};
    if (request.organizationId) {
      base.organizationId = request.organizationId;
    } else if (request.scopeType && request.scopeId) {
      base.scopeType = request.scopeType;
      base.scopeId = request.scopeId;
    } else {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Bad request - missing scope (organizationId or scopeType+scopeId)',
      });
    }
    const where = [
      { ...base, expiresAt: IsNull() },
      { ...base, expiresAt: MoreThan(now) },
    ];
    const [rows, total] = await this.aggregatedReportRepo.findAndCount({
      where: where as any,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((r) => ({
        reportId: r.id,
        reportType: r.reportType,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        format: r.format,
        status: r.status,
        filename: r.filename ?? '',
        createdAtMs: r.createdAt ? r.createdAt.getTime() : 0,
        expiresAtMs: r.expiresAt ? r.expiresAt.getTime() : 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Org-wide shared stored-report usage for the banner. Returns the
   * SAME count enforcement uses (project + org/team/batch reports owned by the
   * org), so project and org drawers display one common pool. Accepts either an
   * organizationId or a projectId (resolved to its org server-side).
   */
  @GrpcMethod('ResultService', 'getReportUsage')
  @Span()
  async getReportUsage(
    request: GetReportUsageRequest,
  ): Promise<GetReportUsageResponse> {
    if (request?.organizationId) {
      return this.reportQuota.getUsageForOrg(request.organizationId);
    }
    if (request?.projectId) {
      return this.reportQuota.getUsageForProject(request.projectId);
    }
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'Bad request - missing organizationId or projectId',
    });
  }

  /**
   * Get distinct branches from vulnerability detections (SAST, SCA, IAC) for a project.
   * Useful for projects not linked to external integrations (GitHub/GitLab).
   *
   * @param request - The request containing the project ID.
   * @returns List of distinct branch names found across all vulnerability types.
   */
  @GrpcMethod('ResultService', 'getProjectBranches')
  @Span()
  async getProjectBranches(
    request: GetProjectBranchesRequest,
  ): Promise<GetProjectBranchesResponse> {
    if (!request.projectId) {
      this.logger.error('Error getting project branches - missing projectId');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    const branches = await this.resultService.getProjectBranches(
      request.projectId,
    );

    return {
      projectId: request.projectId,
      branches,
    };
  }

  /**
   * Deprecated: what security-scanning pods older than
   * NotifyScanEnded call when a scan's containers are all closed.
   * analysis-reporting alone creates a scan's issues now, once its results
   * are final, so this is that same word: creating the issues here, as soon
   * as the containers stopped, read results still being ingested, and the
   * claim on the issue creation would then have kept the complete ones from
   * being created. Remove once every security-scanning pod calls
   * NotifyScanEnded.
   *
   * @param request - The request containing projectId, scanId, and organizationId.
   * @returns No issue count: the creation, if any, is analysis-reporting's.
   */
  @GrpcMethod('ResultService', 'createIssuesForScan')
  @Span()
  async createIssuesForScan(
    request: CreateIssuesForScanRequest,
  ): Promise<CreateIssuesForScanResponse> {
    if (!request.projectId || !request.scanId) {
      this.logger.error(
        'Error creating issues for scan - missing projectId or scanId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or scanId',
      });
    }

    this.logger.log(
      `Scan ${request.scanId} of project ${request.projectId} ended (legacy CreateIssuesForScan)`,
    );

    try {
      const outcome = await this.scanCompleteNotificationService.onScanEnded(
        request.scanId,
        request.projectId,
      );
      return {
        success: true,
        message: `Scan end evaluated (${outcome}): analysis-reporting creates the issues once the results are final`,
        githubIssuesCreated: 0,
        gitlabIssuesCreated: 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error evaluating the end of scan ${request.scanId}: ${message}`,
      );
      return {
        success: false,
        message,
        githubIssuesCreated: 0,
        gitlabIssuesCreated: 0,
      };
    }
  }

  // ===================================================================
  // GROUPED VULNERABILITIES - New endpoints for consolidated view
  // ===================================================================

  /**
   * Get SAST vulnerabilities grouped by rule ID.
   * Returns vulnerabilities consolidated by rule with occurrence counts.
   */
  @GrpcMethod('ResultService', 'getGroupedSastVulnerabilities')
  @Span()
  async getGroupedSastVulnerabilities(
    request: GetGroupedSastVulnerabilitiesRequest,
  ): Promise<GetGroupedSastVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        'Error getting grouped SAST vulnerabilities - missing projectId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    return this.groupedVulnerabilityService.getGroupedSastVulnerabilities(
      request,
    );
  }

  /**
   * Get IAC vulnerabilities grouped by rule ID.
   * Returns vulnerabilities consolidated by rule with occurrence counts.
   */
  @GrpcMethod('ResultService', 'getGroupedIacVulnerabilities')
  @Span()
  async getGroupedIacVulnerabilities(
    request: GetGroupedIacVulnerabilitiesRequest,
  ): Promise<GetGroupedIacVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        'Error getting grouped IAC vulnerabilities - missing projectId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    return this.groupedVulnerabilityService.getGroupedIacVulnerabilities(
      request,
    );
  }

  /**
   * Get CICD vulnerabilities grouped by rule ID.
   * Returns vulnerabilities consolidated by rule with occurrence counts.
   */
  @GrpcMethod('ResultService', 'getGroupedCicdVulnerabilities')
  @Span()
  async getGroupedCicdVulnerabilities(
    request: GetGroupedCicdVulnerabilitiesRequest,
  ): Promise<GetGroupedCicdVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        'Error getting grouped CICD vulnerabilities - missing projectId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    return this.groupedVulnerabilityService.getGroupedCicdVulnerabilities(
      request,
    );
  }

  /**
   * Get Secret vulnerabilities grouped by rule ID.
   * Returns vulnerabilities consolidated by rule with occurrence counts.
   */
  @GrpcMethod('ResultService', 'getGroupedSecretVulnerabilities')
  @Span()
  async getGroupedSecretVulnerabilities(
    request: GetGroupedSecretVulnerabilitiesRequest,
  ): Promise<GetGroupedSecretVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        'Error getting grouped Secret vulnerabilities - missing projectId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    return this.groupedVulnerabilityService.getGroupedSecretVulnerabilities(
      request,
    );
  }

  /**
   * Get SCA vulnerabilities grouped by CVE + package name.
   * Returns vulnerabilities consolidated by CVE and package with occurrence counts.
   */
  @GrpcMethod('ResultService', 'getGroupedScaVulnerabilities')
  @Span()
  async getGroupedScaVulnerabilities(
    request: GetGroupedScaVulnerabilitiesRequest,
  ): Promise<GetGroupedScaVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        'Error getting grouped SCA vulnerabilities - missing projectId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    return this.groupedVulnerabilityService.getGroupedScaVulnerabilities(
      request,
    );
  }

  /**
   * Get container vulnerabilities grouped by package (name + version).
   * Returns vulnerabilities consolidated per package with occurrence counts.
   */
  @GrpcMethod('ResultService', 'getGroupedContainerVulnerabilities')
  @Span()
  async getGroupedContainerVulnerabilities(
    request: GetGroupedContainerVulnerabilitiesRequest,
  ): Promise<GetGroupedContainerVulnerabilitiesResponse> {
    if (!request.projectId) {
      this.logger.error(
        'Error getting grouped container vulnerabilities - missing projectId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    return this.groupedVulnerabilityService.getGroupedContainerVulnerabilities(
      request,
    );
  }

  /**
   * Get a vulnerability by ID with similar occurrences.
   * Returns the vulnerability and all other occurrences of the same rule/CVE.
   */
  @GrpcMethod('ResultService', 'getVulnerabilityWithSimilar')
  @Span()
  async getVulnerabilityWithSimilar(
    request: GetVulnerabilityWithSimilarRequest,
  ): Promise<GetVulnerabilityWithSimilarResponse> {
    if (!request.projectId || !request.vulnerabilityId) {
      this.logger.error(
        'Error getting vulnerability with similar - missing projectId or vulnerabilityId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or vulnerabilityId',
      });
    }

    return this.groupedVulnerabilityService.getVulnerabilityWithSimilar(
      request,
    );
  }

  // startScaAutoFix, getScaAutoFixJobStatus and
  // getScaAutoFixJobResult are served by ScaAutoFixResultController (closed
  // SCA autofix module).

  // ===================================================================
  // POLICY EVALUATION - Get vulnerabilities for policy evaluation
  // ===================================================================

  /**
   * Get all vulnerabilities for a scan for policy evaluation.
   * Returns a unified list across all scanner types (SAST, SCA, IAC, Container, etc.)
   * Used by the Policy Management Service to evaluate scans against security policies.
   */
  @GrpcMethod('ResultService', 'getScanVulnerabilitiesForPolicy')
  @Span()
  async getScanVulnerabilitiesForPolicy(
    request: GetScanVulnerabilitiesForPolicyRequest,
  ): Promise<GetScanVulnerabilitiesForPolicyResponse> {
    if (!request.projectId || !request.scanId) {
      this.logger.error(
        'Error getting scan vulnerabilities for policy - missing projectId or scanId',
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId or scanId',
      });
    }

    return this.policyVulnerabilityService.getScanVulnerabilitiesForPolicy(
      request.projectId,
      request.scanId,
    );
  }

  /**
   * Get the processing status of a scan's vulnerability queue.
   * Used by the Policy Management Service to wait for all vulnerability processing
   * to complete before evaluating the scan against security policies.
   */
  @GrpcMethod('ResultService', 'getScanQueueStatus')
  @Span()
  async getScanQueueStatus(
    request: GetScanQueueStatusRequest,
  ): Promise<GetScanQueueStatusResponse> {
    if (!request.scanId) {
      this.logger.error('Error getting scan queue status - missing scanId');
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId',
      });
    }

    const queueStatus = await this.scanQueueService.getScanQueueStatus(
      request.scanId,
    );

    return {
      scanId: queueStatus.scanId,
      isProcessingComplete: queueStatus.isProcessingComplete,
      pendingJobs: queueStatus.pendingJobs,
      activeJobs: queueStatus.activeJobs,
      completedJobs: queueStatus.completedJobs,
      failedJobs: queueStatus.failedJobs,
      scaPending: queueStatus.scaPending,
      sastIacPending: queueStatus.sastIacPending,
      containerPending: queueStatus.containerPending,
    };
  }

  /**
   * Trigger deferred scan completion notification.
   * Called by security-scanning-service when the agent container completes,
   * to dispatch notifications that were deferred while waiting for the agent.
   */
  @GrpcMethod('ResultService', 'notifyScanComplete')
  @Span()
  async notifyScanComplete(
    request: NotifyScanCompleteRequest,
  ): Promise<NotifyScanCompleteResponse> {
    if (!request.scanId || !request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId or projectId',
      });
    }

    try {
      await this.scanCompleteNotificationService.notifyScanComplete(
        request.scanId,
      );
      return { success: true, message: 'Deferred notification dispatched' };
    } catch (error: any) {
      this.logger.error(
        `Error dispatching deferred notification for scan ${request.scanId}: ${error?.message || error}`,
      );
      return {
        success: false,
        message: error?.message || 'Failed to dispatch deferred notification',
      };
    }
  }

  /**
   * security-scanning: every container of the scan is closed.
   * The end of the scan is evaluated once more, the failed scanners out of
   * the count, and dispatched when its results are final (notifications,
   * issues, cyber-risk recompute). UNAVAILABLE when it could not be
   * evaluated: the caller retries, and the evaluation is idempotent (the
   * scan-complete lock, the claim on the issue creation).
   */
  @GrpcMethod('ResultService', 'notifyScanEnded')
  @Span()
  async notifyScanEnded(
    request: NotifyScanEndedRequest,
  ): Promise<NotifyScanEndedResponse> {
    if (!request.scanId || !request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scanId or projectId',
      });
    }

    try {
      const outcome = await this.scanCompleteNotificationService.onScanEnded(
        request.scanId,
        request.projectId,
      );
      return { success: true, message: outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `End of scan ${request.scanId} not evaluated, security-scanning retries: ${message}`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: `Scan end not evaluated: ${message}`,
      });
    }
  }

  @GrpcMethod('ResultService', 'notifySecurityContextUpdated')
  async notifySecurityContextUpdated(
    request: NotifySecurityContextUpdatedRequest,
  ): Promise<NotifySecurityContextUpdatedResponse> {
    this.logger.log(
      `notifySecurityContextUpdated received for project ${request.projectId}`,
    );
    this.resultService.invalidateSecurityContextCache(request.projectId);
    // Deterministic jobId so spam-clicks of "Save security context"
    // collapse to a single in-flight job instead of stacking N parallel
    // recalculations. Mirrors enqueueAgentReanalysis (ee/agent-reanalysis).
    await this.cvssRecalcQueue.add(
      'recalculate',
      { projectId: request.projectId, trigger: 'context_change' },
      {
        jobId: `cvss-recalc:${request.projectId}:context-change`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { count: 500 },
      },
    );
    // Enqueue the cyberisk recompute directly (best-effort, never throws) so it
    // does NOT depend on the CVSS worker job being consumed successfully — that
    // job early-returns on a null security context and re-throws on a recalc
    // error, either of which would otherwise silently drop the recompute. The
    // CVSS processor still enqueues a (deduplicated) recompute of its own once
    // the environmental scores are rewritten; this one guarantees the score is
    // refreshed even if the CVSS job is skipped/aborted. Mirrors scan_complete.
    await this.cyberiskEnqueuer.enqueue(
      request.projectId,
      'security_context_update',
    );
    return { accepted: true };
  }

  // reanalyzeVulnerability, reanalyzeStaleVulnerabilities and
  // getExploitabilityStaleSummary moved to ReanalysisResultController
  // (closed extension).

  @GrpcMethod('ResultService', 'getPriorityDecomposition')
  async getPriorityDecomposition(
    request: GetPriorityDecompositionRequest,
  ): Promise<GetPriorityDecompositionResponse> {
    return this.resultService.getPriorityDecomposition(request);
  }

  @GrpcMethod('ResultService', 'getTopVulnerabilities')
  @Span()
  async getTopVulnerabilities(
    request: GetTopVulnerabilitiesRequest,
  ): Promise<GetTopVulnerabilitiesResponse> {
    if (!request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }
    return this.resultService.getTopVulnerabilities(request);
  }

  @GrpcMethod('ResultService', 'revealSecret')
  @Span()
  async revealSecret(
    request: RevealSecretRequest,
  ): Promise<RevealSecretResponse> {
    const result = await this.secretService.revealSecret(
      request.projectId,
      request.vulnerabilityId,
      request.userId,
    );
    return {
      secret: result.secret,
      revealedAt: result.revealedAt.toISOString(),
    };
  }

  /**
   * Mark a secret as rotated, which resolves it outside updateScanResult:
   * reported to Linear as fixed once written, without waiting.
   */
  @GrpcMethod('ResultService', 'rotateSecret')
  @Span()
  async rotateSecret(
    request: RotateSecretRequest,
  ): Promise<RotateSecretResponse> {
    const result = await this.secretService.rotateSecret(
      request.projectId,
      request.vulnerabilityId,
      request.userId,
    );
    this.resultService.reportHandledFindings(
      request.projectId,
      [request.vulnerabilityId],
      'fixed',
    );
    return result;
  }

  /**
   * Enqueue an asynchronous recomputation of a project's CyberRisk score.
   * "backfill" is the bulk post-deploy path; "reference_branch_update" is fired
   * by global-management when a project's reference branch changes; anything
   * else defaults to "manual" (admin single-project trigger). Known triggers are
   * forwarded verbatim so logs/metrics can attribute the recompute to its cause.
   */
  @GrpcMethod('ResultService', 'recomputeCyberRisk')
  @Span()
  async recomputeCyberRisk(
    data: RecomputeCyberRiskRequest,
  ): Promise<RecomputeCyberRiskResponse> {
    const passthrough: CyberiskRecomputeTrigger[] = [
      'backfill',
      'reference_branch_update',
    ];
    const trigger: CyberiskRecomputeTrigger = passthrough.includes(
      data.trigger as CyberiskRecomputeTrigger,
    )
      ? (data.trigger as CyberiskRecomputeTrigger)
      : 'manual';
    await this.cyberiskEnqueuer.enqueue(data.projectId, trigger);
    return { enqueued: true };
  }

  /**
   * Enqueue a CyberRisk backfill recompute for a batch of projects in a single
   * gRPC round-trip. The gateway authorizes each project (Permify) before
   * calling this; here we only fan out the enqueues (bounded parallel chunks,
   * best-effort — enqueue never throws).
   */
  @GrpcMethod('ResultService', 'backfillCyberRisk')
  @Span()
  async backfillCyberRisk(
    data: BackfillCyberRiskRequest,
  ): Promise<BackfillCyberRiskResponse> {
    const projectIds = data.projectIds ?? [];
    const CHUNK = 50;
    for (let i = 0; i < projectIds.length; i += CHUNK) {
      await Promise.all(
        projectIds
          .slice(i, i + CHUNK)
          .map((projectId) =>
            this.cyberiskEnqueuer.enqueue(projectId, 'backfill'),
          ),
      );
    }
    return { enqueued: projectIds.length };
  }
}
