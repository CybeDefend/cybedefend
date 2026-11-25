import {
  ResultServiceClient,
  RESULT_SERVICE_NAME,
  RevealSecretRequest,
  RevealSecretResponse,
  RotateSecretRequest,
  RotateSecretResponse,
} from '@grpc/analysis-reporting/analysis_reporting';
import {
  GetProjectOverviewRequest,
  GetProjectScaVulnerabilitiesRequest,
  GetProjectSastVulnerabilitiesRequest,
  GetProjectIacVulnerabilitiesRequest,
  GetProjectCicdVulnerabilitiesRequest,
  GetProjectCicdVulnerabilitiesResponse,
  GetProjectSecretVulnerabilitiesRequest,
  GetProjectSecretVulnerabilitiesResponse,
  GetProjectVulnerabilityByIdRequest,
  UpdateResultRequest,
  UpdateProjectVulnerabilityResponse,
  EnqueueBatchUpdateRequest,
  EnqueueBatchUpdateResponse,
  GetProjectOverviewResponse,
  GetOrganizationOverviewRequest,
  GetOrganizationOverviewResponse,
  GetProjectVulnerabilityByIdResponse,
  GetProjectPackagesResponse,
  GetProjectScaVulnerabilitiesResponse,
  GetProjectIacVulnerabilitiesResponse,
  GetProjectSastVulnerabilitiesResponse,
  GetProjectContainerVulnerabilitiesRequest,
  GetProjectContainerVulnerabilitiesResponse,
  GetProjectContainerVulnerabilityByIdRequest,
  GetProjectContainerVulnerabilityByIdResponse,
  GetProjectContainerImagesRequest,
  GetProjectContainerImagesResponse,
  DeleteContainerImageRequest,
  ProjectDeleteResponse,
  GenerateOwaspReportRequest,
  GenerateOwaspReportResponse,
  GenerateCweReportRequest,
  GenerateCweReportResponse,
  GetGeneratedReportResponse,
  GetGeneratedAggregatedReportResponse,
  DeleteGeneratedReportResponse,
  DeleteAggregatedReportResponse,
  ListGeneratedReportsResponse,
  ListAggregatedReportsResponse,
  GetReportUsageResponse,
  GenerateAggregatedReportResponse,
  GenerateBatchReportRequest,
  GenerateOrganizationReportRequest,
  GenerateTeamReportRequest,
  GetProjectBranchesRequest,
  GetProjectBranchesResponse,
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
  // Priority decomposition
  GetPriorityDecompositionRequest,
  GetPriorityDecompositionResponse,
  // Top vulnerabilities
  GetTopVulnerabilitiesRequest,
  GetTopVulnerabilitiesResponse,
  // SCA filter options
  GetScaFilterOptionsRequest,
  GetScaFilterOptionsResponse,
  // Split overview endpoints
  OrganizationOverviewFilter,
  GetOrganizationSeverityDistributionResponse,
  GetOrganizationStateDistributionResponse,
  GetOrganizationVulnerabilitiesOverTimeResponse,
} from '@grpc/analysis-reporting/result';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { ProjectGetRequest } from '@grpc/global-management/project';
import {
  GITHUB_SERVICE_NAME,
  GithubServiceClient,
  GITLAB_SERVICE_NAME,
  GitlabServiceClient,
} from '@grpc/external-integrations/external_integrations';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { GetBranchesListQueryDto } from './dto/query/get-branches-list-query.dto';
import {
  BranchListItemDto,
  GetBranchesListResponseDto,
} from './dto/response/get-branches-list-response.dto';

/**
 * The branch selectors read a project's organizationId, link
 * flags and defaultBranch. The integration status carries the last two; the
 * vulnerability stats (analysis-reporting) and the security context are
 * skipped. A global-management that predates the flags answers the full read.
 */
const projectForBranchesRequest = (projectId: string): ProjectGetRequest => ({
  projectId,
  skipVulnerabilityStats: true,
  skipSecurityContext: true,
});

/** Filter subset shared by the 3 split overview endpoints (mirrors OrganizationOverviewFilterQueryDto). */
export interface OverviewFilterQuery {
  severityFilter?: string[];
  statusFilter?: string[];
  analysisTypes?: string[];
  includeResolved?: boolean;
  dateFrom?: string;
  dateTo?: string;
  branches?: string[];
  projectIds?: string[];
  teamIds?: string[];
}

@Injectable()
export class ResultService implements OnModuleInit {
  private resultServiceClient!: ResultServiceClient;
  private projectServiceClient!: ProjectServiceClient;
  private githubServiceClient!: GithubServiceClient;
  private gitlabServiceClient!: GitlabServiceClient;
  private scanServiceClient!: ScanServiceClient;

  constructor(
    @Inject('ANALYSIS_REPORTING_SERVICE') private readonly client: ClientGrpc,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly externalIntegrationsClient: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.resultServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<ResultServiceClient>(RESULT_SERVICE_NAME),
    );
    this.projectServiceClient = wrapGrpcClientWithTracing(
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      ),
    );
    this.githubServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<GithubServiceClient>(
        GITHUB_SERVICE_NAME,
      ),
    );
    this.gitlabServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationsClient.getService<GitlabServiceClient>(
        GITLAB_SERVICE_NAME,
      ),
    );
    this.scanServiceClient = wrapGrpcClientWithTracing(
      this.securityScanningClient.getService<ScanServiceClient>(
        SCAN_SERVICE_NAME,
      ),
    );
  }

  @Span()
  findAllContainer(
    q: GetProjectContainerVulnerabilitiesRequest,
  ): Promise<GetProjectContainerVulnerabilitiesResponse> {
    if (!q.page) q.page = 1;
    if (!q.limit) q.limit = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectContainerVulnerabilities(q),
    );
  }

  @Span()
  findAllContainerPackages(
    q: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectPackagesResponse> {
    if (!q.page) q.page = 1;
    if (!q.limit) q.limit = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectContainerPackages(q),
    );
  }

  @Span()
  findAllContainerImages(
    q: GetProjectContainerImagesRequest,
  ): Promise<GetProjectContainerImagesResponse> {
    if (!q.page) q.page = 1;
    if (!q.limit) q.limit = 20;
    return safeGrpcCall(this.resultServiceClient.getProjectContainerImages(q));
  }

  /**
   * Get container images grouped by repository name.
   * Groups images with same base repository and shows all tags within each group.
   *
   * @param q - The request with pagination, filters, and sorting options.
   * @returns Grouped container images with their tags and aggregated vulnerability counts.
   */
  @Span()
  getGroupedContainerImages(
    q: GetGroupedContainerImagesRequest,
  ): Promise<GetGroupedContainerImagesResponse> {
    return safeGrpcCall(this.resultServiceClient.getGroupedContainerImages(q));
  }

  @Span()
  findOneContainer(
    q: GetProjectContainerVulnerabilityByIdRequest,
  ): Promise<GetProjectContainerVulnerabilityByIdResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getContainerVulnerabilityById(q),
    );
  }

  @Span()
  findAllSast(
    query: GetProjectSastVulnerabilitiesRequest,
  ): Promise<GetProjectSastVulnerabilitiesResponse> {
    if (!query.pageNumber) query.pageNumber = 1;
    if (!query.pageSizeNumber) query.pageSizeNumber = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectSastVulnerabilities(query),
    );
  }

  @Span()
  findAllIac(
    query: GetProjectIacVulnerabilitiesRequest,
  ): Promise<GetProjectIacVulnerabilitiesResponse> {
    if (!query.pageNumber) query.pageNumber = 1;
    if (!query.pageSizeNumber) query.pageSizeNumber = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectIacVulnerabilities(query),
    );
  }

  @Span()
  findAllCicd(
    query: GetProjectCicdVulnerabilitiesRequest,
  ): Promise<GetProjectCicdVulnerabilitiesResponse> {
    if (!query.pageNumber) query.pageNumber = 1;
    if (!query.pageSizeNumber) query.pageSizeNumber = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectCicdVulnerabilities(query),
    );
  }

  @Span()
  findAllSca(
    query: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectScaVulnerabilitiesResponse> {
    // analysis-reporting paginates this list on pageNumber/pageSizeNumber
    // only: an absent pair reaches it as 0/0 and loads every detection. Fold
    // in page/limit, the names Swagger documents first.
    query.pageNumber = query.pageNumber || query.page || 1;
    query.pageSizeNumber = query.pageSizeNumber || query.limit || 10;
    if (!query.page) query.page = 1;
    if (!query.limit) query.limit = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectScaVulnerabilities(query),
    );
  }

  @Span()
  findAllScaPackages(
    query: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectPackagesResponse> {
    if (!query.page) query.page = 1;
    if (!query.limit) query.limit = 10;
    return safeGrpcCall(this.resultServiceClient.getProjectScaPackages(query));
  }

  @Span()
  getProjectLicenseSummary(
    projectId: string,
    branch?: string,
    packageType?: string | string[],
  ): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.getProjectLicenseSummary({
        projectId,
        branch,
        packageType: packageType
          ? Array.isArray(packageType)
            ? packageType
            : [packageType]
          : [],
      }),
    );
  }

  @Span()
  getPackagesByLicense(
    projectId: string,
    spdxId: string,
    branch?: string,
    packageType?: string | string[],
  ): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.getPackagesByLicense({
        projectId,
        spdxId,
        branch,
        packageType: packageType
          ? Array.isArray(packageType)
            ? packageType
            : [packageType]
          : [],
      }),
    );
  }

  @Span()
  getLicenseClassifications(organizationId: string): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.getLicenseClassifications({ organizationId }),
    );
  }

  @Span()
  updateLicenseClassifications(
    organizationId: string,
    overrides: Array<{ spdxId: string; category: string }>,
  ): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.updateLicenseClassifications({
        organizationId,
        overrides,
      }),
    );
  }

  @Span()
  resetLicenseClassifications(organizationId: string): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.resetLicenseClassifications({ organizationId }),
    );
  }

  @Span()
  deleteLicenseOverride(organizationId: string, spdxId: string): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.deleteLicenseOverride({
        organizationId,
        spdxId,
      }),
    );
  }

  @Span()
  assignPackageLicense(
    projectId: string,
    packageId: string,
    spdxId: string,
  ): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.assignPackageLicense({
        projectId,
        packageId,
        spdxId,
      }),
    );
  }

  @Span()
  setPackageLicenseIgnored(
    projectId: string,
    packageId: string,
    ignored: boolean,
  ): Promise<any> {
    return safeGrpcCall(
      this.resultServiceClient.setPackageLicenseIgnored({
        projectId,
        packageId,
        ignored,
      }),
    );
  }

  @Span()
  findOneSca(
    query: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getScaVulnerabilityById(query),
    );
  }

  @Span()
  findOneSast(
    query: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getSastVulnerabilityById(query),
    );
  }

  @Span()
  findOneIac(
    query: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getIacVulnerabilityById(query),
    );
  }

  @Span()
  findOneCicd(
    query: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getCicdVulnerabilityById(query),
    );
  }

  @Span()
  findAllSecret(
    query: GetProjectSecretVulnerabilitiesRequest,
  ): Promise<GetProjectSecretVulnerabilitiesResponse> {
    if (!query.pageNumber) query.pageNumber = 1;
    if (!query.pageSizeNumber) query.pageSizeNumber = 10;
    return safeGrpcCall(
      this.resultServiceClient.getProjectSecretVulnerabilities(query),
    );
  }

  @Span()
  findOneSecret(
    query: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getSecretVulnerabilityById(query),
    );
  }

  @Span()
  update(
    updateDto: UpdateResultRequest,
  ): Promise<UpdateProjectVulnerabilityResponse> {
    return safeGrpcCall(this.resultServiceClient.updateScanResult(updateDto));
  }

  @Span()
  async batchUpdate(
    projectId: string,
    items: Array<{
      vulnerabilityId: string;
      status?: string;
      priority?: string;
      comment?: string;
      dismissalReason?: string;
    }>,
    userId: string,
  ): Promise<{ taskId: string; status: 'queued'; total: number }> {
    const request: EnqueueBatchUpdateRequest = {
      projectId,
      userId,
      items: items.map((item) => ({
        vulnerabilityId: item.vulnerabilityId,
        status: item.status,
        priority: item.priority,
        comment: item.comment,
        // Per-item justification. Dropping it here would
        // make bulk dismissal impossible once `assertDismissalReason` lands: the
        // async worker rebuilds every UpdateResultRequest from these items alone.
        dismissalReason: item.dismissalReason,
      })),
      // The batch is the caller's triage (`userId`), never the assistant's.
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
    };
    const res: EnqueueBatchUpdateResponse = await safeGrpcCall(
      this.resultServiceClient.enqueueBatchUpdate(request),
    );
    return { taskId: res.taskId, status: 'queued', total: res.total };
  }

  @Span()
  getProjectOverview(
    query: GetProjectOverviewRequest,
  ): Promise<GetProjectOverviewResponse> {
    return safeGrpcCall(this.resultServiceClient.getProjectOverview(query));
  }

  @Span()
  async getOrganizationOverview(
    organizationId: string,
    userId: string,
    query?: {
      // Vulnerability filters
      severityFilter?: string[];
      statusFilter?: string[];
      analysisTypes?: string[];
      includeResolved?: boolean;
      // Date range
      dateFrom?: string;
      dateTo?: string;
      // Branch filter (supports multiple branches)
      branches?: string[];
      // Project filter
      projectIds?: string[];
      // Team filter
      teamIds?: string[];
      // Trend & Comparison
      trendPeriodDays?: number;
      comparisonPeriod?: string;
      // Pagination
      projectsPage?: number;
      projectsPageSize?: number;
      teamsPage?: number;
      teamsPageSize?: number;
      // Sorting
      sortBy?: string;
      sortOrder?: string;
      // Output options
      includeProjectsSummary?: boolean;
      includeTeamsSummary?: boolean;
      includeOverTimeData?: boolean;
      topVulnerableLimit?: number;
    },
  ): Promise<GetOrganizationOverviewResponse> {
    const request: GetOrganizationOverviewRequest = {
      organizationId,
      userId,
      // Vulnerability filters
      severityFilter: query?.severityFilter || [],
      statusFilter: query?.statusFilter || [],
      analysisTypes: query?.analysisTypes || [],
      includeResolved: query?.includeResolved,
      // Date range
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
      // Branch filter (supports multiple branches)
      branches: query?.branches || [],
      // Team filter
      teamIds: query?.teamIds || [],
      // Legacy fields (empty - not used anymore)
      projectIds: query?.projectIds || [],
      projectNameSearch: '',
      teamNameSearch: '',
      priorityFilter: [],
      cyberRiskLevels: [],
      languages: [],
      groupBy: undefined,
      hasAutofix: undefined,
      // Trend & Comparison
      trendPeriodDays: query?.trendPeriodDays,
      comparisonPeriod: query?.comparisonPeriod,
      // Pagination
      projectsPage: query?.projectsPage,
      projectsPageSize: query?.projectsPageSize,
      teamsPage: query?.teamsPage,
      teamsPageSize: query?.teamsPageSize,
      // Sorting
      sortBy: query?.sortBy,
      sortOrder: query?.sortOrder,
      // Output options
      includeProjectsSummary: query?.includeProjectsSummary,
      includeTeamsSummary: query?.includeTeamsSummary,
      includeOverTimeData: query?.includeOverTimeData,
      topVulnerableLimit: query?.topVulnerableLimit,
    };
    return safeGrpcCall(
      this.resultServiceClient.getOrganizationOverview(request),
    );
  }

  private toOverviewFilter(
    organizationId: string,
    userId: string,
    query?: OverviewFilterQuery,
  ): OrganizationOverviewFilter {
    return {
      organizationId,
      userId,
      projectIds: query?.projectIds || [],
      teamIds: query?.teamIds || [],
      severityFilter: query?.severityFilter || [],
      statusFilter: query?.statusFilter || [],
      analysisTypes: query?.analysisTypes || [],
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
      branches: query?.branches || [],
      includeResolved: query?.includeResolved,
    };
  }

  @Span()
  async getOrganizationSeverityDistribution(
    organizationId: string,
    userId: string,
    query?: OverviewFilterQuery,
  ): Promise<GetOrganizationSeverityDistributionResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getOrganizationSeverityDistribution({
        filter: this.toOverviewFilter(organizationId, userId, query),
      }),
    );
  }

  @Span()
  async getOrganizationStateDistribution(
    organizationId: string,
    userId: string,
    query?: OverviewFilterQuery,
  ): Promise<GetOrganizationStateDistributionResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getOrganizationStateDistribution({
        filter: this.toOverviewFilter(organizationId, userId, query),
      }),
    );
  }

  @Span()
  async getOrganizationVulnerabilitiesOverTime(
    organizationId: string,
    userId: string,
    query?: OverviewFilterQuery & {
      trendPeriodDays?: number;
      comparisonPeriod?: string;
    },
  ): Promise<GetOrganizationVulnerabilitiesOverTimeResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getOrganizationVulnerabilitiesOverTime({
        filter: this.toOverviewFilter(organizationId, userId, query),
        trendPeriodDays: query?.trendPeriodDays,
        comparisonPeriod: query?.comparisonPeriod,
      }),
    );
  }

  @Span()
  deleteContainerImage(
    query: DeleteContainerImageRequest,
  ): Promise<ProjectDeleteResponse> {
    return safeGrpcCall(this.resultServiceClient.deleteContainerImage(query));
  }

  @Span()
  generateOwaspReport(
    projectId: string,
    format: string,
    detailed?: boolean,
    branch?: string,
    userId?: string,
  ): Promise<GenerateOwaspReportResponse> {
    const request: GenerateOwaspReportRequest = {
      projectId,
      format,
      detailed: detailed !== undefined ? detailed : true,
      branch,
      userId: userId ?? '',
    };
    return safeGrpcCall(this.resultServiceClient.generateOwaspReport(request));
  }

  @Span()
  generateCweReport(
    projectId: string,
    format: string,
    detailed?: boolean,
    branch?: string,
    userId?: string,
  ): Promise<GenerateCweReportResponse> {
    const request: GenerateCweReportRequest = {
      projectId,
      format,
      detailed: detailed !== undefined ? detailed : true,
      branch,
      userId: userId ?? '',
    };
    return safeGrpcCall(this.resultServiceClient.generateCweReport(request));
  }

  /**
   * Fetch the status of an async-generated report and, when ready, a freshly
   * signed download URL minted from the persisted storage object path.
   */
  @Span()
  getGeneratedReport(
    projectId: string,
    reportId: string,
  ): Promise<GetGeneratedReportResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGeneratedReport({ projectId, reportId }),
    );
  }

  @Span()
  getGeneratedAggregatedReport(
    scopeType: string,
    scopeId: string,
    reportId: string,
    organizationId: string,
  ): Promise<GetGeneratedAggregatedReportResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGeneratedAggregatedReport({
        scopeType,
        scopeId,
        reportId,
        organizationId,
      }),
    );
  }

  // Delete a stored report (frees a quota slot + removes the stored object).
  @Span()
  deleteGeneratedReport(
    projectId: string,
    reportId: string,
  ): Promise<DeleteGeneratedReportResponse> {
    return safeGrpcCall(
      this.resultServiceClient.deleteGeneratedReport({ projectId, reportId }),
    );
  }

  @Span()
  deleteAggregatedReport(
    scopeType: string,
    scopeId: string,
    organizationId: string,
    reportId: string,
  ): Promise<DeleteAggregatedReportResponse> {
    return safeGrpcCall(
      this.resultServiceClient.deleteAggregatedReport({
        scopeType,
        scopeId,
        organizationId,
        reportId,
      }),
    );
  }

  // Paginated stored-report history.
  @Span()
  listGeneratedReports(
    projectId: string,
    page: number,
    pageSize: number,
  ): Promise<ListGeneratedReportsResponse> {
    return safeGrpcCall(
      this.resultServiceClient.listGeneratedReports({
        projectId,
        page,
        pageSize,
      }),
    );
  }

  @Span()
  listAggregatedReports(
    scopeType: string,
    scopeId: string,
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<ListAggregatedReportsResponse> {
    return safeGrpcCall(
      this.resultServiceClient.listAggregatedReports({
        scopeType,
        scopeId,
        organizationId,
        page,
        pageSize,
      }),
    );
  }

  /**
   * Org-wide shared stored-report usage (project + org reports count
   * against one common pool). Either organizationId or projectId identifies the
   * org (projectId resolved server-side).
   */
  @Span()
  getReportUsage(args: {
    organizationId?: string;
    projectId?: string;
  }): Promise<GetReportUsageResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getReportUsage({
        organizationId: args.organizationId ?? '',
        projectId: args.projectId ?? '',
      }),
    );
  }

  @Span()
  generateOrganizationReport(
    organizationId: string,
    userId: string,
    reportType: string,
    format: string,
    detailed: boolean,
    branchFilter: string = 'all',
    projectBranchSelections: { projectId: string; branches: string[] }[] = [],
  ): Promise<GenerateAggregatedReportResponse> {
    const request: GenerateOrganizationReportRequest = {
      organizationId,
      userId,
      reportType,
      format,
      detailed,
      branchFilter,
      projectBranchSelections,
    };
    return safeGrpcCall(
      this.resultServiceClient.generateOrganizationReport(request),
    );
  }

  @Span()
  generateTeamReport(
    teamId: string,
    userId: string,
    reportType: string,
    format: string,
    detailed: boolean,
    branchFilter: string = 'all',
    projectBranchSelections: { projectId: string; branches: string[] }[] = [],
    organizationId?: string,
  ): Promise<GenerateAggregatedReportResponse> {
    const request: GenerateTeamReportRequest = {
      teamId,
      userId,
      reportType,
      format,
      detailed,
      branchFilter,
      projectBranchSelections,
      organizationId: organizationId || '',
    };
    return safeGrpcCall(this.resultServiceClient.generateTeamReport(request));
  }

  @Span()
  generateBatchReport(
    projectIds: string[],
    userId: string,
    reportType: string,
    format: string,
    detailed: boolean,
    branchFilter: string = 'all',
    projectBranchSelections: { projectId: string; branches: string[] }[] = [],
    organizationId?: string,
  ): Promise<GenerateAggregatedReportResponse> {
    const request: GenerateBatchReportRequest = {
      projectIds,
      userId,
      reportType,
      format,
      detailed,
      branchFilter,
      projectBranchSelections,
      organizationId: organizationId || '',
    };
    return safeGrpcCall(this.resultServiceClient.generateBatchReport(request));
  }

  /**
   * Get distinct branches from vulnerability detections (SAST, SCA, IAC) for a project.
   * Useful for projects not linked to external integrations (GitHub/GitLab).
   *
   * @param projectId - The project identifier.
   * @returns List of distinct branch names found across all vulnerability types.
   */
  @Span()
  getProjectBranches(projectId: string): Promise<GetProjectBranchesResponse> {
    const request: GetProjectBranchesRequest = { projectId };
    return safeGrpcCall(this.resultServiceClient.getProjectBranches(request));
  }

  @Span()
  getScaFilterOptions(
    projectId: string,
    branch?: string,
  ): Promise<GetScaFilterOptionsResponse> {
    const request: GetScaFilterOptionsRequest = { projectId, branch };
    return safeGrpcCall(this.resultServiceClient.getScaFilterOptions(request));
  }

  /**
   * Unified, paginated branch list for a project. Routes server-side by the
   * project's provider:
   *   - GitHub-linked → external-integrations GithubService
   *   - GitLab-linked → external-integrations GitlabService
   *   - native (no integration) → security-scanning ScanService (branches
   *     derived from past scans)
   *
   * The project's `defaultBranch` + link flags come from global-management
   * (single ProjectService.get), and the set of archived branch names is
   * fetched from global-management and passed down so each provider can mark
   * (and optionally filter) archived branches consistently. The authenticated
   * organization id is derived from the project itself — the route is
   * project-scoped (no organizationId path param), so there is no other clean
   * source and the project's org is the authoritative one.
   *
   * @param projectId - The project identifier.
   * @param query - Pagination / search / archived options.
   * @returns Paginated branches with pagination metadata + default/scan branch.
   */
  @Span()
  async getProjectBranchesList(
    projectId: string,
    query: GetBranchesListQueryDto,
  ): Promise<GetBranchesListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const search = query.search ?? '';
    const includeArchived = query.includeArchived ?? false;

    // Both calls are independent — fetch in parallel (mirrors
    // getBatchProjectsBranches) to avoid an extra serial round-trip.
    const [project, archived] = await Promise.all([
      safeGrpcCall(
        this.projectServiceClient.get(projectForBranchesRequest(projectId)),
      ),
      safeGrpcCall(
        this.projectServiceClient.getArchivedBranches({ projectId }),
      ),
    ]);
    const archivedNames = archived?.branches ?? [];
    const organizationId = project.organizationId;

    let branches: BranchListItemDto[];
    let total: number;
    let defaultBranch = project.defaultBranch ?? '';
    let scanBranch = '';

    if (project.isGithubLinked) {
      const r = await safeGrpcCall(
        this.githubServiceClient.getRepositoryBranchesPaginated({
          organizationId,
          projectId,
          search,
          page,
          pageSize,
          includeArchived,
          archivedNames,
        }),
      );
      branches = r.branches.map((b) => ({
        name: b.name,
        isDefault: b.isDefault,
        isProtected: b.isProtected,
        archived: b.archived,
      }));
      total = r.total;
      defaultBranch = r.defaultBranch || defaultBranch;
      scanBranch = r.scanBranch || '';
    } else if (project.isGitlabLinked) {
      const r = await safeGrpcCall(
        this.gitlabServiceClient.getGitlabRepositoryBranchesPaginated({
          organizationId,
          projectId,
          search,
          page,
          pageSize,
          includeArchived,
          archivedNames,
        }),
      );
      branches = r.branches.map((b) => ({
        name: b.name,
        isDefault: b.isDefault,
        isProtected: b.isProtected,
        archived: b.archived,
      }));
      total = r.total;
      defaultBranch = r.defaultBranch || defaultBranch;
      scanBranch = r.scanBranch || '';
    } else {
      const r = await safeGrpcCall(
        this.scanServiceClient.getProjectBranchesFromScansPaginated({
          projectId,
          search,
          page,
          pageSize,
          includeArchived,
          archivedNames,
          defaultBranch,
        }),
      );
      branches = r.branches.map((b) => ({
        name: b.name,
        isDefault: b.isDefault,
        isProtected: false,
        archived: b.archived,
      }));
      total = r.total;
    }

    return {
      branches,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: page * pageSize < total,
      },
      defaultBranch,
      scanBranch,
    };
  }

  /**
   * Server-side fan-out for the organization-scoped branch selectors
   * (OrganizationOverview filter + the Reports page per-project selector).
   *
   * The frontend used to issue one GET /project/:id/branches AND one
   * GET /project/:id/branches/archived per project (40+ requests on a
   * typical org). It now sends the project id list in a single request and
   * we fan out internally over the existing per-project gRPCs:
   *   - active branches   → analysis-reporting (resultServiceClient)
   *   - archived branches → global-management   (projectServiceClient)
   * A failure on any single call degrades to an empty array for that volet
   * so the rest of the batch still renders.
   *
   * The route authorises only organization:read on the path organisation, and
   * the project ids come from the body, which no guard reads. Every id must be
   * a project the caller may read in that organisation, as global-management
   * decides it for the project list (one query for the whole set, rather than
   * one Permify check per id). Any other id refuses the whole request, with a
   * message that names no id: these ids select data to read.
   */
  @Span()
  async getBatchProjectsBranches(
    organizationId: string,
    userId: string,
    projectIds: string[],
  ): Promise<{
    projects: {
      projectId: string;
      branches: string[];
      archivedBranches: string[];
      defaultBranch: string;
    }[];
  }> {
    if (!projectIds || projectIds.length === 0) {
      return { projects: [] };
    }
    if (!userId) {
      throw new ForbiddenException(
        'You do not have access to one or more requested projects',
      );
    }

    // Fails closed: an error here propagates and nothing is fanned out.
    const readable = await safeGrpcCall(
      this.projectServiceClient.getReadableProjectsInOrganization({
        organizationId,
        userId,
      }),
    );
    const readableIds = new Set(
      (readable?.projects ?? []).map((p) => p.projectId),
    );
    if (projectIds.some((id) => !readableIds.has(id))) {
      throw new ForbiddenException(
        'You do not have access to one or more requested projects',
      );
    }
    const allowedIds = projectIds;

    // Two parallel fan-outs over the same allow-list: active branches from
    // analysis-reporting, archived branches from global-management. Both are
    // indexed by `allowedIds` position so the per-project entry can stitch
    // them back together while preserving request order.
    // The org selector checks each project's REFERENCE branch by
    // default — the branch the project is configured on (`defaultBranch`,
    // e.g. `develop` on a GitFlow repo), which only global-management knows —
    // and falls back to main/master naming only when a project has none.
    const [activeResults, archivedResults, projectResults] = await Promise.all([
      Promise.allSettled(
        allowedIds.map((projectId) =>
          safeGrpcCall(
            this.resultServiceClient.getProjectBranches({ projectId }),
          ),
        ),
      ),
      Promise.allSettled(
        allowedIds.map((projectId) =>
          safeGrpcCall(
            this.projectServiceClient.getArchivedBranches({ projectId }),
          ),
        ),
      ),
      Promise.allSettled(
        allowedIds.map((projectId) =>
          safeGrpcCall(
            this.projectServiceClient.get(projectForBranchesRequest(projectId)),
          ),
        ),
      ),
    ]);

    return {
      projects: allowedIds.map((projectId, index) => {
        const active = activeResults[index];
        const archived = archivedResults[index];
        const project = projectResults[index];
        return {
          projectId,
          branches:
            active.status === 'fulfilled' ? (active.value?.branches ?? []) : [],
          archivedBranches:
            archived.status === 'fulfilled'
              ? (archived.value?.branches ?? [])
              : [],
          defaultBranch:
            project.status === 'fulfilled'
              ? (project.value?.defaultBranch ?? '')
              : '',
        };
      }),
    };
  }

  // ===================================================================
  // GROUPED VULNERABILITIES - New endpoints for consolidated view
  // ===================================================================

  /**
   * Get SAST vulnerabilities grouped by rule ID.
   */
  @Span()
  getGroupedSastVulnerabilities(
    request: GetGroupedSastVulnerabilitiesRequest,
  ): Promise<GetGroupedSastVulnerabilitiesResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGroupedSastVulnerabilities(request),
    );
  }

  /**
   * Get IAC vulnerabilities grouped by rule ID.
   */
  @Span()
  getGroupedIacVulnerabilities(
    request: GetGroupedIacVulnerabilitiesRequest,
  ): Promise<GetGroupedIacVulnerabilitiesResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGroupedIacVulnerabilities(request),
    );
  }

  /**
   * Get CICD vulnerabilities grouped by rule ID.
   */
  @Span()
  getGroupedCicdVulnerabilities(
    request: GetGroupedCicdVulnerabilitiesRequest,
  ): Promise<GetGroupedCicdVulnerabilitiesResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGroupedCicdVulnerabilities(request),
    );
  }

  /**
   * Get Secret vulnerabilities grouped by rule ID.
   */
  @Span()
  getGroupedSecretVulnerabilities(
    request: GetGroupedSecretVulnerabilitiesRequest,
  ): Promise<GetGroupedSecretVulnerabilitiesResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGroupedSecretVulnerabilities(request),
    );
  }

  /**
   * Get SCA vulnerabilities grouped by CVE + package name.
   */
  @Span()
  getGroupedScaVulnerabilities(
    request: GetGroupedScaVulnerabilitiesRequest,
  ): Promise<GetGroupedScaVulnerabilitiesResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getGroupedScaVulnerabilities(request),
    );
  }

  /**
   * Get container vulnerabilities grouped by package (name + version).
   */
  @Span()
  getGroupedContainerVulnerabilities(
    request: GetGroupedContainerVulnerabilitiesRequest,
  ): Promise<GetGroupedContainerVulnerabilitiesResponse> {
    if (!request.pageNumber) request.pageNumber = 1;
    if (!request.pageSize) request.pageSize = 10;
    return safeGrpcCall(
      this.resultServiceClient.getGroupedContainerVulnerabilities(request),
    );
  }

  /**
   * Get a vulnerability by ID with similar occurrences.
   */
  @Span()
  getVulnerabilityWithSimilar(
    request: GetVulnerabilityWithSimilarRequest,
  ): Promise<GetVulnerabilityWithSimilarResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getVulnerabilityWithSimilar(request),
    );
  }

  /**
   * Get priority decomposition for a vulnerability.
   * Returns how the algorithmic priority was computed, showing the contribution
   * of each signal (CVSS4, EPSS, exploitability, context).
   */
  @Span()
  getPriorityDecomposition(
    request: GetPriorityDecompositionRequest,
  ): Promise<GetPriorityDecompositionResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getPriorityDecomposition(request),
    );
  }

  /**
   * Get top N vulnerabilities across all types, ranked by composite priority score.
   */
  @Span()
  getTopVulnerabilities(
    request: GetTopVulnerabilitiesRequest,
  ): Promise<GetTopVulnerabilitiesResponse> {
    return safeGrpcCall(
      this.resultServiceClient.getTopVulnerabilities(request),
    );
  }

  @Span()
  revealSecret(request: RevealSecretRequest): Promise<RevealSecretResponse> {
    return safeGrpcCall(this.resultServiceClient.revealSecret(request));
  }

  @Span()
  rotateSecret(request: RotateSecretRequest): Promise<RotateSecretResponse> {
    return safeGrpcCall(this.resultServiceClient.rotateSecret(request));
  }
}
