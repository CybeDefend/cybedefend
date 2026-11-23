import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { ulid } from 'ulid';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { AggregatedReport } from '../../../entities/aggregated-report.entity';
import { ReportAggregationService } from './services/report-aggregation.service';
import { ReportBuilderService } from './services/report-builder.service';
import { ReportUploadService } from '../shared/report-upload.service';
import { AggregatedReportJobData } from '../../scan-queue/scan-queue.service';
import {
  GetGeneratedAggregatedReportRequest,
  GetGeneratedAggregatedReportResponse,
} from '@grpc/analysis-reporting/result';
import {
  AGGREGATED_REPORT_KINDS,
  AggregatedReportKind,
} from '../../../edition/ports/aggregated-report-kinds.port';

export interface AggregatedReportData {
  scopeType: string;
  scopeName: string;
  scopeId: string;
  reportType: string;
  generatedAt: string;
  projectsCount: number;
  projectIds: string[];
  summary: any;
  categories: any[];
  vulnerabilities: any[];
  projectsMetadata: any[];
  projectBranchesMetadata: any[];
  /** Branch selection mode ('all' | 'reference' | 'selected'), for the cover. */
  branchFilter: string;
  /** License report: one entry per distinct package, and per-project rows. */
  packages?: any[];
  projectRows?: any[];
  /** EU AI Act report: inventory and transverse obligations. */
  inventory?: any[];
  obligations?: any[];
}

/**
 * Main service for generating aggregated security reports.
 *
 * Async migration — report generation is now off the gRPC request path.
 * The gRPC handler (result.controller) inserts a queued AggregatedReport row +
 * enqueues a job; this service's runAggregatedReport() is the worker body that
 * resolves the scope, builds + uploads the artifact and publishes an
 * AGGREGATED_REPORT_READY realtime event. getGeneratedAggregatedReport() is the
 * poll path that re-mints a signed download URL from the persisted objectPath.
 */
@Injectable()
export class AggregatedReportsService {
  constructor(
    @InjectRepository(AggregatedReport)
    private readonly aggregatedReportRepository: Repository<AggregatedReport>,
    private readonly reportAggregationService: ReportAggregationService,
    private readonly reportBuilderService: ReportBuilderService,
    private readonly reportUpload: ReportUploadService,
    private readonly logger: Logger,
    private readonly realtime: RealtimeEventPublisher,
    // The closed report types (EU AI Act), registered by an ee
    // module; absent in the Community Edition.
    @Optional()
    @Inject(AGGREGATED_REPORT_KINDS)
    registeredKinds?: AggregatedReportKind[],
  ) {
    this.kinds = new Map((registeredKinds ?? []).map((k) => [k.reportType, k]));
  }

  private readonly kinds: Map<string, AggregatedReportKind>;

  /**
   * Defense-in-depth batch ownership check exposed to the controller so the
   * batch handler can fail fast (PERMISSION_DENIED) BEFORE enqueueing a job.
   * Delegates to ReportAggregationService.validateUserAccess, which rejects if
   * any projectId does not belong to the requested organization (anti-IDOR).
   */
  async validateBatchAccess(
    projectIds: string[],
    organizationId: string,
    userId: string,
  ): Promise<void> {
    await this.reportAggregationService.validateUserAccess(
      userId,
      projectIds,
      organizationId,
    );
  }

  /**
   * Anti-IDOR for team reports — the owning org is client-supplied, so
   * verify the team actually belongs to it before the report is enqueued and
   * tagged (quota/retention/listing) to that org. Rejects PERMISSION_DENIED
   * otherwise. Mirrors validateBatchAccess for the batch path.
   */
  async validateTeamAccess(
    teamId: string,
    organizationId: string,
  ): Promise<void> {
    await this.reportAggregationService.assertTeamInOrg(teamId, organizationId);
  }

  /**
   * Worker body: resolve the scope's project list, aggregate + build the
   * report, upload it under the tenant key, persist status="ready" and publish
   * AGGREGATED_REPORT_READY. On any failure, persist status="failed" + the
   * error and publish the failure event — never re-throw (attempts=1).
   */
  @Span()
  async runAggregatedReport(data: AggregatedReportJobData): Promise<void> {
    try {
      const { projectIds, scopeName } = await this.resolveProjectIds(data);
      if (projectIds.length === 0) {
        throw new Error('No projects in scope');
      }
      const reportData = await this.generateReportData({
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        scopeName,
        reportType: data.reportType,
        projectIds,
        organizationId: data.organizationId,
        branchFilter: data.branchFilter,
        projectBranchSelections: data.projectBranchSelections,
      });
      const built = await this.reportBuilderService.buildReport({
        scopeType: data.scopeType,
        scopeName,
        reportType: data.reportType,
        format: data.format,
        detailed: data.detailed,
        aggregatedData: reportData,
        projectIds,
        // metadata.id feeds the download filename (report-builder.service.ts).
        // Batch scopeId is a comma-joined projectIds CSV, so use the literal
        // 'batch' there (matching the previous sync behaviour) instead.
        metadata: {
          id: data.scopeType === 'batch' ? 'batch' : data.scopeId,
          name: scopeName,
        },
      });
      const uploaded = await this.reportUpload.uploadReport({
        projectId: this.tenantKey(data),
        filename: built.filename,
        contentType: built.contentType,
        buffer: built.content,
      });
      await this.aggregatedReportRepository.update(data.reportId, {
        objectPath: uploaded.objectPath,
        filename: uploaded.filename,
        contentType: uploaded.contentType,
        status: 'ready',
      });
      await this.publishReady(data, 'ready');
    } catch (err) {
      const message =
        (err as Error).message ?? 'aggregated report generation failed';
      this.logger.error(
        `[agg-reports] reportId=${data.reportId} failed: ${message}`,
      );
      await this.aggregatedReportRepository.update(data.reportId, {
        status: 'failed',
        error: message.slice(0, 2000),
      });
      await this.publishReady(data, 'failed');
    }
  }

  /**
   * Queue-level failure path (stall after a worker crash): the catch in
   * runAggregatedReport never ran, so the row would stay "queued" forever.
   * Atomically flip queued→failed (a job that stalled after a successful
   * upload keeps its "ready" row) and publish the failure event only when
   * this call actually did the transition.
   */
  async markFailedFromQueue(
    data: AggregatedReportJobData,
    message: string,
  ): Promise<boolean> {
    const res = await this.aggregatedReportRepository.update(
      { id: data.reportId, status: 'queued' },
      { status: 'failed', error: message.slice(0, 2000) },
    );
    const transitioned = (res?.affected ?? 0) > 0;
    if (transitioned) {
      await this.publishReady(data, 'failed');
    }
    return transitioned;
  }

  /**
   * Poll path: fetch the status of an async aggregated report and, when ready,
   * a freshly signed download URL minted from the persisted storage object path.
   * Mirrors the per-project getGeneratedReport handler.
   */
  @Span()
  async getGeneratedAggregatedReport(
    request: GetGeneratedAggregatedReportRequest,
  ): Promise<GetGeneratedAggregatedReportResponse> {
    if (!request?.scopeId || !request?.reportId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing scopeId or reportId',
      });
    }
    const report = await this.aggregatedReportRepository.findOne({
      where: { id: request.reportId },
    });
    if (!report) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Report not found',
      });
    }
    // Scope ownership check (defense in depth alongside the gateway guard).
    const owns =
      request.scopeType === 'team'
        ? report.scopeType === 'team' && report.scopeId === request.scopeId
        : report.organizationId === request.scopeId; // org + batch are org-owned
    if (!owns) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Report not found',
      });
    }

    const base: GetGeneratedAggregatedReportResponse = {
      reportId: report.id,
      status: report.status,
      reportType: report.reportType,
      scopeType: report.scopeType,
      scopeId: report.scopeId,
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
      return base;
    }
    const tenantKey =
      report.scopeType === 'team'
        ? report.scopeId
        : (report.organizationId ?? '');
    const expectedPrefix = `reports/${tenantKey}/`;
    if (!report.objectPath.startsWith(expectedPrefix)) {
      this.logger.error(
        `[agg-reports] objectPath/tenant mismatch reportId=${report.id}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Report storage path mismatch — please contact support',
      });
    }
    const signed = await this.reportUpload.signExisting({
      projectId: tenantKey,
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
   * tenantKey rule: team reports live under the teamId; org + batch reports
   * live under the owning organizationId. Used for both the storage upload path
   * and the re-signing scope check in getGeneratedAggregatedReport.
   */
  private tenantKey(data: {
    scopeType: string;
    scopeId: string;
    organizationId: string;
  }): string {
    return data.scopeType === 'team' ? data.scopeId : data.organizationId;
  }

  /**
   * Resolve the concrete project list + a human-readable scope name for a job.
   * Batch carries its own explicit list; org/team resolve theirs via gRPC.
   */
  private async resolveProjectIds(
    data: AggregatedReportJobData,
  ): Promise<{ projectIds: string[]; scopeName: string }> {
    if (data.scopeType === 'batch') {
      await this.reportAggregationService.getProjectsMetadata(
        data.projectIds ?? [],
      );
      return {
        projectIds: data.projectIds ?? [],
        scopeName: 'Custom selection',
      };
    }
    if (data.scopeType === 'team') {
      const projectIds = await this.reportAggregationService.getTeamProjects(
        data.scopeId,
        data.userId,
      );
      const meta = await this.reportAggregationService.getTeamMetadata(
        data.scopeId,
      );
      return { projectIds, scopeName: meta.name };
    }
    const projectIds =
      await this.reportAggregationService.getOrganizationProjects(
        data.scopeId,
        data.userId,
      );
    const meta = await this.reportAggregationService.getOrganizationMetadata(
      data.scopeId,
    );
    return { projectIds, scopeName: meta.name };
  }

  /**
   * Publish an AGGREGATED_REPORT_READY realtime event (IDs-only). Team reports
   * route on { teamId, organizationId }; org + batch route on { organizationId }.
   */
  private async publishReady(
    data: AggregatedReportJobData,
    statusValue: 'ready' | 'failed',
  ): Promise<void> {
    const scope =
      data.scopeType === 'team'
        ? {
            teamId: data.scopeId,
            ...(data.organizationId
              ? { organizationId: data.organizationId }
              : {}),
          }
        : { organizationId: data.organizationId };
    await this.realtime.publish({
      eventId: ulid(),
      type: 'AGGREGATED_REPORT_READY',
      scope,
      payload: {
        aggregatedReportReady: {
          reportId: data.reportId,
          scopeType: data.scopeType,
          scopeId: data.scopeId,
          reportType: data.reportType,
          status: statusValue,
        },
      },
    });
  }

  /**
   * Generate report data following OWASP/CWE pattern
   */
  @Span()
  private async generateReportData(options: {
    scopeType: string;
    scopeId: string;
    scopeName: string;
    reportType: string;
    projectIds: string[];
    organizationId?: string;
    branchFilter?: string;
    projectBranchSelections?: { projectId: string; branches: string[] }[];
  }): Promise<AggregatedReportData> {
    const {
      scopeType,
      scopeId,
      scopeName,
      reportType,
      projectIds,
      organizationId,
      branchFilter,
      projectBranchSelections,
    } = options;

    // License reports use a different aggregation path (packages, not vulnerabilities)
    if (reportType === 'license') {
      const licenseData =
        await this.reportAggregationService.aggregateLicenseData(
          projectIds,
          organizationId,
          branchFilter || 'all',
          projectBranchSelections || [],
        );

      return {
        scopeType,
        scopeName,
        scopeId,
        reportType,
        generatedAt: new Date().toISOString(),
        projectsCount: projectIds.length,
        projectIds,
        branchFilter: branchFilter || 'all',
        summary: licenseData.summary,
        categories: licenseData.licenseCategories,
        vulnerabilities: [],
        projectsMetadata: licenseData.projectsMetadata,
        projectBranchesMetadata: [],
        packages: licenseData.packages,
        projectRows: licenseData.projectRows,
      };
    }

    // A closed report type (the EU AI Act report) builds its own data.
    const kind = this.kinds.get(reportType);
    if (kind) {
      return kind.generateData({
        scopeType,
        scopeId,
        scopeName,
        projectIds,
        branchFilter: branchFilter || 'all',
        projectBranchSelections: projectBranchSelections || [],
      });
    }

    // Aggregate vulnerabilities from all projects
    const aggregatedData =
      await this.reportAggregationService.aggregateVulnerabilities(
        projectIds,
        reportType,
        branchFilter || 'all',
        projectBranchSelections || [],
      );

    return {
      scopeType,
      scopeName,
      scopeId,
      reportType,
      generatedAt: new Date().toISOString(),
      projectsCount: projectIds.length,
      projectIds,
      branchFilter: branchFilter || 'all',
      summary: aggregatedData.summary,
      categories: aggregatedData.categories,
      vulnerabilities: aggregatedData.vulnerabilities,
      projectsMetadata: aggregatedData.projectsMetadata,
      projectBranchesMetadata: aggregatedData.projectBranchesMetadata,
    };
  }
}
