import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, SelectQueryBuilder } from 'typeorm';
import { Span } from 'nestjs-otel';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { AutoFixRecord } from 'src/entities/autofix-record.entity';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { getLicenseInfo } from 'src/modules/sca/license.utils';
import { effectiveSeveritySql } from 'src/modules/cvss/effective-severity-sql';
import {
  anyValue,
  dateBucket,
  diffDays,
  inList,
  sql,
} from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';
import { joinSql, rawIdent, rawSql } from 'src/core/db/raw-sql';
import {
  accumulateCreatedOverTime,
  accumulateOpenOverTime,
} from './over-time.util';
import {
  GetOrganizationOverviewRequest,
  GetOrganizationOverviewResponse,
  PaginationMeta,
  ProjectOverviewSummary,
  TeamOverviewSummary,
  TopVulnerableProject,
  TotalByAnalysisType,
  TotalBySeverity,
  TotalByState,
  VulnerabilitiesOverTime,
  AppliedFilters,
  BranchVulnerabilityCount,
  LanguageDistribution,
  PeriodComparison,
  SeverityComparison,
} from 'src/core/grpc/analysis-reporting/result';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { OverviewCacheService } from './overview-cache.service';
import {
  GetOrganizationSeverityDistributionRequest,
  GetOrganizationSeverityDistributionResponse,
  GetOrganizationStateDistributionRequest,
  GetOrganizationStateDistributionResponse,
  GetOrganizationVulnerabilitiesOverTimeRequest,
  GetOrganizationVulnerabilitiesOverTimeResponse,
} from 'src/core/grpc/analysis-reporting/result';

/**
 * Interface for project-level vulnerability statistics with enhanced metrics.
 */
interface ProjectStats {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  sast: number;
  sca: number;
  iac: number;
  container: number;
  cicd: number;
  secret: number;
  open: number;
  resolved: number;
  newLast7Days: number;
  resolvedLast7Days: number;
  autofixAvailable: number;
  languages: Set<string>;
  lastScanDate?: Date;
}

/**
 * Interface for trend statistics.
 */
export interface TrendStatistics {
  newIssues: number;
  newIssuesLastPeriod: number;
  solvedIssues: number;
  solvedIssuesLastPeriod: number;
  newIssuesPreviousPeriod: number;
  solvedIssuesPreviousPeriod: number;
}

/**
 * Interface for filter context used throughout the service.
 * Simplified for organization-level overview.
 */
interface FilterContext {
  projectIds: string[];
  teamIds: string[];
  severityFilter: string[];
  statusFilter: string[];
  analysisTypes: string[];
  dateFrom?: Date;
  dateTo?: Date;
  branches: string[];
  /** Per-project branch selections (projectId → branch names). When set, takes precedence over branches. */
  projectBranchMap: Map<string, string[]>;
  includeResolved: boolean;
  trendPeriodDays: number;
}

/**
 * Default empty project stats.
 */
const EMPTY_PROJECT_STATS: ProjectStats = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  total: 0,
  sast: 0,
  sca: 0,
  iac: 0,
  container: 0,
  cicd: 0,
  secret: 0,
  open: 0,
  resolved: 0,
  newLast7Days: 0,
  resolvedLast7Days: 0,
  autofixAvailable: 0,
  languages: new Set(),
  lastScanDate: undefined,
};

/**
 * `<alias>.<column>` in a raw statement: as written on MySQL, quoted on
 * PostgreSQL (where an unquoted camelCase name folds to lower case).
 */
const col = (alias: string, column: string): Sql =>
  rawSql(rawIdent(`${alias}.${column}`));

/** The live severity band of a raw statement, upper-cased. */
const upperBand = (alias: string): Sql =>
  rawSql(`UPPER(${effectiveSeveritySql(alias)})`);

/** Valid analysis types */
const VALID_ANALYSIS_TYPES = [
  'SAST',
  'SCA',
  'IAC',
  'CONTAINER',
  'CICD',
  'SECRET',
];

/** Valid severity levels */
const VALID_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Valid status values */
const VALID_STATUSES = [
  'to_verify',
  'confirmed',
  'in_review',
  'resolved',
  'not_exploitable',
  'ignored',
];

/** Valid sort fields */
const VALID_SORT_FIELDS = [
  'total_vulnerabilities',
  'critical_count',
  'risk_level',
  'name',
];

/** Valid sort orders */
const VALID_SORT_ORDERS = ['ASC', 'DESC'];

/**
 * Service responsible for generating organization-wide overview statistics.
 * Aggregates vulnerability data from all projects within an organization.
 * Supports comprehensive filtering, pagination, sorting, and comparison features.
 */
@Injectable()
export class OrganizationOverviewService {
  private projectServiceClient!: ProjectServiceClient;

  constructor(
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastVulnDetectRepository: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacVulnDetectRepository: Repository<IacVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaVulnDetectRepository: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerVulnDetectRepository: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdVulnDetectRepository: Repository<CicdVulnerabilityDetections>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretVulnDetectRepository: Repository<SecretVulnerabilityDetections>,
    @InjectRepository(AutoFixRecord)
    private readonly autofixRecordRepository: Repository<AutoFixRecord>,
    @InjectRepository(ScaDetectedPackages)
    private readonly scaDetectedPackagesRepository: Repository<ScaDetectedPackages>,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    private readonly projectCyberRiskRepo: ProjectCyberRiskRepository,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    private readonly overviewCache: OverviewCacheService,
  ) {}

  onModuleInit() {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
  }

  /**
   * Get organization-wide overview statistics aggregating all projects.
   * Supports comprehensive filtering, pagination, sorting, and comparison features.
   *
   * @param request - The organization overview request with filters.
   * @returns Aggregated statistics for the entire organization.
   */
  @Span()
  async getOrganizationOverview(
    request: GetOrganizationOverviewRequest,
  ): Promise<GetOrganizationOverviewResponse> {
    const { organizationId, userId } = request;

    this.validateRequest(organizationId, userId);

    // Build filter context from request
    const filterContext = this.buildFilterContext(request);

    // Fetch all projects from the organization via GlobalManagement gRPC
    let projects = await this.fetchOrganizationProjects(organizationId, userId);

    // Apply project and team filters
    projects = this.applyProjectFilters(projects, request);

    const projectIds = projects.map((p) => p.projectId);

    if (projectIds.length === 0) {
      return this.buildEmptyOrganizationResponse(organizationId, request);
    }

    // Update filter context with final project IDs
    filterContext.projectIds = projectIds;

    // Determine which sections to include (default: all)
    const includeProjectsSummary = request.includeProjectsSummary !== false;
    const includeTeamsSummary = request.includeTeamsSummary !== false;

    // Parallel execution for maximum performance
    // NOTE: stateAggregation and overTimeData removed from this path —
    // they are now served by the dedicated split endpoints
    // (getOrganizationStateDistribution / getOrganizationVulnerabilitiesOverTime).
    const [
      severityAggregation,
      analysisTypeAggregation,
      projectStats,
      trendStats,
      languageDistribution,
      branchData,
      meanTimeToRemediate,
      licenseDistribution,
    ] = await Promise.all([
      this.aggregateSeverityByProjects(filterContext),
      this.aggregateAnalysisTypeByProjects(filterContext),
      this.getProjectLevelStats(filterContext),
      this.getTrendStatistics(filterContext),
      this.getLanguageDistribution(filterContext),
      this.getVulnerabilitiesByBranch(filterContext),
      this.calculateMeanTimeToRemediate(filterContext),
      this.aggregateLicenseDistribution(filterContext),
    ]);

    // Read the persisted all-time CybeRisk score for every project in
    // one query. We need it whether or not we surface the projects summary,
    // because the top vulnerable projects + risk distribution also derive from
    // it. Missing rows trigger a fire-and-forget backfill recompute.
    const cyberRiskRows =
      await this.projectCyberRiskRepo.findByProjectIds(projectIds);
    const cyberRiskMap = new Map(
      cyberRiskRows.map((r) => [
        r.projectId,
        { score: r.score, level: r.level },
      ]),
    );
    for (const projectId of projectIds) {
      if (!cyberRiskMap.has(projectId)) {
        void this.cyberiskEnqueuer
          .enqueue(projectId, 'backfill')
          .catch(() => undefined);
      }
    }

    // Build project summaries with team information
    let projectsSummary = includeProjectsSummary
      ? this.buildProjectsSummary(
          this.orderLikeProjectList(projects, cyberRiskMap),
          projectStats,
          cyberRiskMap,
        )
      : [];

    // Apply sorting to project summaries
    projectsSummary = this.sortProjectsSummary(
      projectsSummary,
      request.sortBy,
      request.sortOrder,
    );

    // Apply pagination to project summaries
    const projectsPage = request.projectsPage || 1;
    const projectsPageSize = request.projectsPageSize || 50;
    const totalProjectItems = projectsSummary.length;
    const paginatedProjectsSummary = this.paginateArray(
      projectsSummary,
      projectsPage,
      projectsPageSize,
    );

    // Build team summaries by aggregating project data
    let teamsSummary = includeTeamsSummary
      ? this.buildTeamSummaries(projectsSummary)
      : [];

    // Apply sorting to team summaries
    teamsSummary = this.sortTeamsSummary(
      teamsSummary,
      request.sortBy,
      request.sortOrder,
    );

    // Apply pagination to team summaries
    const teamsPage = request.teamsPage || 1;
    const teamsPageSize = request.teamsPageSize || 50;
    const totalTeamItems = teamsSummary.length;
    const paginatedTeamsSummary = this.paginateArray(
      teamsSummary,
      teamsPage,
      teamsPageSize,
    );

    // Get top N most vulnerable projects
    const topVulnerableLimit = Math.min(request.topVulnerableLimit || 10, 50);
    const topVulnerableProjects = this.buildTopVulnerableProjects(
      projectsSummary,
      topVulnerableLimit,
    );

    // Calculate risk distribution
    const riskDistribution = this.calculateRiskDistribution(projectsSummary);

    // Calculate totals from severity aggregation
    const severityCounts =
      this.extractSeverityCountsFromAggregation(severityAggregation);

    // Calculate analysis type totals
    const analysisTypeTotals = this.extractAnalysisTypeTotals(
      analysisTypeAggregation,
    );

    // Build applied filters for client reference
    const appliedFilters = this.buildAppliedFilters(filterContext);

    // Calculate totals
    const totalVulnerabilities =
      severityCounts.critical +
      severityCounts.high +
      severityCounts.medium +
      severityCounts.low;
    const openVulnerabilities = projectsSummary.reduce(
      (sum, p) => sum + p.openCount,
      0,
    );
    const autofixAvailableCount = projectsSummary.reduce(
      (sum, p) => sum + p.autofixAvailableCount,
      0,
    );

    return {
      organizationId,
      totalProjects: projects.length,
      totalTeams: new Set(projects.map((p) => p.teamId).filter(Boolean)).size,
      totalByAnalysisType: analysisTypeAggregation,
      projectsSummary: paginatedProjectsSummary,
      teamsSummary: paginatedTeamsSummary,
      topVulnerableProjects,
      criticalRiskProjects: riskDistribution.criticalRisk,
      highRiskProjects: riskDistribution.highRisk,
      mediumRiskProjects: riskDistribution.mediumRisk,
      lowRiskProjects: riskDistribution.lowRisk,
      newIssuesLast7Days: trendStats.newIssuesLastPeriod,
      solvedIssuesLast7Days: trendStats.solvedIssuesLastPeriod,
      solvedIssues: trendStats.solvedIssues,
      newIssues: trendStats.newIssues,
      criticalIssues: severityCounts.critical,
      highIssues: severityCounts.high,
      mediumIssues: severityCounts.medium,
      lowIssues: severityCounts.low,
      // New enhanced fields
      languageDistribution,
      projectsPagination: this.buildPaginationMeta(
        projectsPage,
        projectsPageSize,
        totalProjectItems,
      ),
      teamsPagination: this.buildPaginationMeta(
        teamsPage,
        teamsPageSize,
        totalTeamItems,
      ),
      appliedFilters,
      totalVulnerabilities,
      openVulnerabilities,
      autofixAvailableCount,
      sastTotal: analysisTypeTotals.sast,
      scaTotal: analysisTypeTotals.sca,
      iacTotal: analysisTypeTotals.iac,
      containerTotal: analysisTypeTotals.container,
      cicdTotal: analysisTypeTotals.cicd,
      secretTotal: analysisTypeTotals.secret,
      trendPeriodDays: filterContext.trendPeriodDays,
      meanTimeToRemediate,
      vulnerabilitiesByBranch: branchData,
      licenseTotalPackages: licenseDistribution.totalPackages,
      licensePackagesWithLicenses: licenseDistribution.packagesWithLicenses,
      licensePermissiveCount: licenseDistribution.permissiveCount,
      licenseWeakCopyleftCount: licenseDistribution.weakCopyleftCount,
      licenseStrongCopyleftCount: licenseDistribution.strongCopyleftCount,
      licenseUnknownCount: licenseDistribution.unknownCount,
    };
  }

  @Span()
  async getOrganizationSeverityDistribution(
    request: GetOrganizationSeverityDistributionRequest,
  ): Promise<GetOrganizationSeverityDistributionResponse> {
    const f = request.filter;
    const ctx = await this.buildScopedFilterContext(
      f.organizationId,
      f.userId,
      this.filterAsOverviewRequest(f),
    );
    if (!ctx) return { totalBySeverity: [] };
    const totalBySeverity = await this.overviewCache.getOrSet(
      'sev',
      f.organizationId,
      f.userId,
      f,
      () => this.aggregateSeverityByProjects(ctx),
    );
    return { totalBySeverity };
  }

  @Span()
  async getOrganizationStateDistribution(
    request: GetOrganizationStateDistributionRequest,
  ): Promise<GetOrganizationStateDistributionResponse> {
    const f = request.filter;
    const ctx = await this.buildScopedFilterContext(
      f.organizationId,
      f.userId,
      this.filterAsOverviewRequest(f),
    );
    if (!ctx) return { totalByState: [] };
    const totalByState = await this.overviewCache.getOrSet(
      'state',
      f.organizationId,
      f.userId,
      f,
      () => this.aggregateStateByProjects(ctx),
    );
    return { totalByState };
  }

  @Span()
  async getOrganizationVulnerabilitiesOverTime(
    request: GetOrganizationVulnerabilitiesOverTimeRequest,
  ): Promise<GetOrganizationVulnerabilitiesOverTimeResponse> {
    const f = request.filter;
    const ctx = await this.buildScopedFilterContext(
      f.organizationId,
      f.userId,
      {
        ...this.filterAsOverviewRequest(f),
        trendPeriodDays: request.trendPeriodDays,
        comparisonPeriod: request.comparisonPeriod,
      },
    );
    if (!ctx)
      return {
        vulnerabilitiesOverTime: [],
        severityComparison: [],
        totalComparison: undefined,
      };
    const cacheKeyFilter = {
      ...f,
      trendPeriodDays: request.trendPeriodDays,
      comparisonPeriod: request.comparisonPeriod,
    };
    const vulnerabilitiesOverTime = await this.overviewCache.getOrSet(
      'time',
      f.organizationId,
      f.userId,
      cacheKeyFilter,
      () => this.aggregateVulnerabilitiesOverTime(ctx),
    );
    const severityComparison = request.comparisonPeriod
      ? await this.buildSeverityComparison(ctx, request.comparisonPeriod)
      : [];
    const totalComparison = request.comparisonPeriod
      ? this.buildTotalComparison(await this.getTrendStatistics(ctx))
      : undefined;
    return { vulnerabilitiesOverTime, severityComparison, totalComparison };
  }

  /**
   * Build filter context from request parameters.
   * Only includes filters relevant for organization-level overview.
   */
  private buildFilterContext(
    request: GetOrganizationOverviewRequest,
  ): FilterContext {
    // Parse branches: support composite keys (projectId::branchName) for per-project filtering
    const rawBranches: string[] = (request.branches || [])
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    const projectBranchMap = new Map<string, string[]>();
    const plainBranches: string[] = [];

    for (const b of rawBranches) {
      const sepIdx = b.indexOf('::');
      if (sepIdx > 0) {
        const projectId = b.substring(0, sepIdx);
        const branchName = b.substring(sepIdx + 2);
        if (branchName.length > 0) {
          const existing = projectBranchMap.get(projectId) || [];
          existing.push(branchName);
          projectBranchMap.set(projectId, existing);
        }
      } else {
        plainBranches.push(b);
      }
    }

    return {
      projectIds: [], // Will be populated after fetching projects
      teamIds: request.teamIds || [],
      severityFilter: this.normalizeAndValidateArray(
        request.severityFilter,
        VALID_SEVERITIES,
      ),
      statusFilter: this.normalizeAndValidateArray(
        request.statusFilter,
        VALID_STATUSES,
      ),
      analysisTypes: this.normalizeAndValidateArray(
        request.analysisTypes,
        VALID_ANALYSIS_TYPES,
      ),
      dateFrom: request.dateFrom ? new Date(request.dateFrom) : undefined,
      dateTo: request.dateTo ? new Date(request.dateTo) : undefined,
      branches: plainBranches,
      projectBranchMap,
      includeResolved: request.includeResolved || false,
      trendPeriodDays: request.trendPeriodDays || 7,
    };
  }

  /**
   * Normalize and validate array values against allowed values.
   */
  private normalizeAndValidateArray(
    values: string[] | undefined,
    allowedValues: string[],
  ): string[] {
    if (!values || values.length === 0) return [];
    return values
      .map((v) => v.toUpperCase())
      .filter((v) => allowedValues.includes(v));
  }

  /**
   * Check whether the filter context has any branch filter active.
   */
  private hasBranchFilter(filterContext: FilterContext): boolean {
    return (
      filterContext.projectBranchMap.size > 0 ||
      filterContext.branches.length > 0
    );
  }

  /**
   * Apply branch filter to a QueryBuilder.
   * Supports per-project branch selections (projectBranchMap) and global branch names.
   */
  private applyBranchFilterQB<T>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    filterContext: FilterContext,
  ): void {
    if (filterContext.projectBranchMap.size > 0) {
      const conditions: string[] = [];
      const params: Record<string, any> = {};
      let idx = 0;
      for (const [projectId, branchNames] of filterContext.projectBranchMap) {
        const pidKey = `pb_pid_${idx}`;
        const brKey = `pb_br_${idx}`;
        conditions.push(
          `(${alias}.projectId = :${pidKey} AND ${alias}.branch IN (:...${brKey}))`,
        );
        params[pidKey] = projectId;
        params[brKey] = branchNames;
        idx++;
      }
      qb.andWhere(`(${conditions.join(' OR ')})`, params);
      return;
    }
    if (filterContext.branches.length > 0) {
      qb.andWhere(`${alias}.branch IN (:...branches)`, {
        branches: filterContext.branches,
      });
    }
  }

  /**
   * Build branch filter SQL condition for raw queries.
   * Returns the SQL condition with its parameters, or null if no branch
   * filter is active.
   */
  private buildBranchFilterSQL(
    alias: string,
    filterContext: FilterContext,
  ): Sql | null {
    if (filterContext.projectBranchMap.size > 0) {
      const parts: Sql[] = [];
      for (const [projectId, branchNames] of filterContext.projectBranchMap) {
        parts.push(
          sql`(${col(alias, 'projectId')} = ${projectId} AND ${col(alias, 'branch')} IN ${inList(branchNames)})`,
        );
      }
      return sql`(${joinSql(parts, ' OR ')})`;
    }
    if (filterContext.branches.length > 0) {
      return sql`${col(alias, 'branch')} IN ${inList(filterContext.branches)}`;
    }
    return null;
  }

  /**
   * Apply project and team filters to the projects list.
   */
  private applyProjectFilters(
    projects: Array<{
      projectId: string;
      name: string;
      teamId: string;
      teamName: string;
    }>,
    request: GetOrganizationOverviewRequest,
  ): Array<{
    projectId: string;
    name: string;
    teamId: string;
    teamName: string;
  }> {
    let filtered = projects;

    // Filter by specific project IDs
    if (request.projectIds && request.projectIds.length > 0) {
      filtered = filtered.filter((p) =>
        request.projectIds.includes(p.projectId),
      );
    }

    // Filter by specific team IDs
    if (request.teamIds && request.teamIds.length > 0) {
      filtered = filtered.filter((p) => request.teamIds.includes(p.teamId));
    }

    // Filter by project name search
    if (request.projectNameSearch) {
      const searchLower = request.projectNameSearch.toLowerCase();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(searchLower),
      );
    }

    // Filter by team name search
    if (request.teamNameSearch) {
      const searchLower = request.teamNameSearch.toLowerCase();
      filtered = filtered.filter((p) =>
        p.teamName.toLowerCase().includes(searchLower),
      );
    }

    return filtered;
  }

  /**
   * Validate the organization overview request.
   */
  private validateRequest(organizationId: string, userId: string): void {
    if (!organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId is required',
      });
    }

    if (!userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'userId is required',
      });
    }
  }

  /**
   * Shared scoping prelude used by the main overview and the 3
   * dedicated split endpoints. Validates, resolves the user's accessible
   * projects, applies project/team filters, and returns a ready FilterContext.
   * Returns null when the user can see no projects (callers return empty).
   */
  /**
   * The lazy-distribution endpoints carry their filters in
   * `OrganizationOverviewFilter`, which is a structural subset of
   * `GetOrganizationOverviewRequest` (identical field names for
   * organizationId / userId / projectIds / teamIds / severityFilter /
   * statusFilter / analysisTypes / dateFrom / dateTo / branches /
   * includeResolved). `buildScopedFilterContext` only reads those shared filter
   * fields, so reinterpreting the filter as a request is safe. Centralised and
   * documented here so the name-parity invariant lives in one place (covered by
   * the split-endpoint specs); a future rename on either proto message must
   * update this single helper.
   */
  private filterAsOverviewRequest(
    filter: GetOrganizationSeverityDistributionRequest['filter'],
  ): GetOrganizationOverviewRequest {
    return filter as unknown as GetOrganizationOverviewRequest;
  }

  private async buildScopedFilterContext(
    organizationId: string,
    userId: string,
    request: GetOrganizationOverviewRequest,
  ): Promise<FilterContext | null> {
    this.validateRequest(organizationId, userId);
    const filterContext = this.buildFilterContext(request);
    let projects = await this.fetchOrganizationProjects(organizationId, userId);
    projects = this.applyProjectFilters(projects, request);
    const projectIds = projects.map((p) => p.projectId);
    if (projectIds.length === 0) return null;
    filterContext.projectIds = projectIds;
    return filterContext;
  }

  /**
   * Paginate an array.
   */
  private paginateArray<T>(array: T[], page: number, pageSize: number): T[] {
    const startIndex = (page - 1) * pageSize;
    return array.slice(startIndex, startIndex + pageSize);
  }

  /**
   * Build pagination metadata.
   */
  private buildPaginationMeta(
    page: number,
    pageSize: number,
    totalItems: number,
  ): PaginationMeta {
    return {
      currentPage: page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  /**
   * Sort project summaries by the specified field and order.
   */
  private sortProjectsSummary(
    summaries: ProjectOverviewSummary[],
    sortBy?: string,
    sortOrder?: string,
  ): ProjectOverviewSummary[] {
    const field =
      sortBy && VALID_SORT_FIELDS.includes(sortBy)
        ? sortBy
        : 'total_vulnerabilities';
    const order =
      sortOrder && VALID_SORT_ORDERS.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : 'DESC';

    return [...summaries].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (field) {
        case 'total_vulnerabilities':
          aVal = a.totalVulnerabilities;
          bVal = b.totalVulnerabilities;
          break;
        case 'critical_count':
          aVal = a.criticalCount;
          bVal = b.criticalCount;
          break;
        case 'risk_level':
        case 'cyber_risk_level':
          aVal = this.riskLevelToNumber(a.cyberRiskLevel);
          bVal = this.riskLevelToNumber(b.cyberRiskLevel);
          break;
        case 'name':
          aVal = a.projectName.toLowerCase();
          bVal = b.projectName.toLowerCase();
          break;
        default:
          aVal = a.totalVulnerabilities;
          bVal = b.totalVulnerabilities;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return order === 'ASC'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return order === 'ASC'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }

  /**
   * Sort team summaries by the specified field and order.
   */
  private sortTeamsSummary(
    summaries: TeamOverviewSummary[],
    sortBy?: string,
    sortOrder?: string,
  ): TeamOverviewSummary[] {
    const field =
      sortBy && VALID_SORT_FIELDS.includes(sortBy)
        ? sortBy
        : 'total_vulnerabilities';
    const order =
      sortOrder && VALID_SORT_ORDERS.includes(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : 'DESC';

    return [...summaries].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (field) {
        case 'total_vulnerabilities':
          aVal = a.totalVulnerabilities;
          bVal = b.totalVulnerabilities;
          break;
        case 'critical_count':
          aVal = a.criticalCount;
          bVal = b.criticalCount;
          break;
        case 'name':
          aVal = a.teamName.toLowerCase();
          bVal = b.teamName.toLowerCase();
          break;
        default:
          aVal = a.totalVulnerabilities;
          bVal = b.totalVulnerabilities;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return order === 'ASC'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return order === 'ASC'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }

  /**
   * Order the projects as the home-page loader returned them: CybeRisk score
   * descending, then name, then id. The summary sorts are stable, so this
   * order is what breaks their ties (equal totals, equal names) and keeps the
   * pages of the projects summary stable. The readable-projects projection is
   * unordered, and this service holds the scores the loader sorted on (its
   * column is a copy of them).
   */
  private orderLikeProjectList<T extends { projectId: string; name: string }>(
    projects: T[],
    cyberRiskMap: Map<string, { score: number; level: string }>,
  ): T[] {
    const score = (p: T) => cyberRiskMap.get(p.projectId)?.score ?? 0;
    return [...projects].sort(
      (a, b) =>
        score(b) - score(a) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.projectId.localeCompare(b.projectId),
    );
  }

  /**
   * Convert risk level string to numeric value for sorting.
   */
  private riskLevelToNumber(riskLevel: string): number {
    const levels: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
    };
    return levels[riskLevel.toLowerCase()] || 0;
  }

  /**
   * The ids of the projects of the organization the caller may read, resolved
   * by the same projection as every block of the overview.
   */
  async getReadableProjectIds(
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    const projects = await this.fetchOrganizationProjects(
      organizationId,
      userId,
    );
    return projects.map((p) => p.projectId);
  }

  /**
   * The projects of the organization the caller may read, with their team.
   *
   * GetReadableProjectsInOrganization applies the same principal filter as
   * the home-page loader (GetAllFromOrganization: creator/administrator see
   * every project, everyone else the projects of their teams) as one
   * projection SELECT, without that loader's page ceiling and four-way
   * fan-out (scan status, branch ingestion, batch counts back into this
   * service, integration link status). Every block of the overview resolves
   * its scope here, so it is paid once per block. The projection is
   * unordered: see {@link orderLikeProjectList}.
   */
  private async fetchOrganizationProjects(
    organizationId: string,
    userId: string,
  ): Promise<
    Array<{ projectId: string; name: string; teamId: string; teamName: string }>
  > {
    try {
      const projectsResponse = await safeGrpcCall(
        this.projectServiceClient.getReadableProjectsInOrganization({
          organizationId,
          userId,
        }),
      );

      return (projectsResponse?.projects || []).map((p) => ({
        projectId: p.projectId,
        name: p.name || '',
        teamId: p.teamId || '',
        teamName: p.teamName || '',
      }));
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error fetching organization projects`,
      });
    }
  }

  /**
   * Build an empty organization response when no projects exist.
   */
  private buildEmptyOrganizationResponse(
    organizationId: string,
    request?: GetOrganizationOverviewRequest,
  ): GetOrganizationOverviewResponse {
    return {
      organizationId,
      totalProjects: 0,
      totalTeams: 0,
      totalByAnalysisType: [],
      projectsSummary: [],
      teamsSummary: [],
      topVulnerableProjects: [],
      criticalRiskProjects: 0,
      highRiskProjects: 0,
      mediumRiskProjects: 0,
      lowRiskProjects: 0,
      newIssuesLast7Days: 0,
      solvedIssuesLast7Days: 0,
      solvedIssues: 0,
      newIssues: 0,
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      lowIssues: 0,
      // Enhanced fields
      languageDistribution: [],
      projectsPagination: this.buildPaginationMeta(1, 50, 0),
      teamsPagination: this.buildPaginationMeta(1, 50, 0),
      appliedFilters: request
        ? this.buildAppliedFilters({
            projectIds: [],
            teamIds: [],
            severityFilter: [],
            statusFilter: [],
            analysisTypes: [],
            branches: [],
            projectBranchMap: new Map(),
            includeResolved: false,
            trendPeriodDays: 7,
          })
        : undefined,
      totalVulnerabilities: 0,
      openVulnerabilities: 0,
      autofixAvailableCount: 0,
      sastTotal: 0,
      scaTotal: 0,
      iacTotal: 0,
      containerTotal: 0,
      cicdTotal: 0,
      secretTotal: 0,
      trendPeriodDays: request?.trendPeriodDays || 7,
      meanTimeToRemediate: undefined,
      vulnerabilitiesByBranch: [],
      licenseTotalPackages: 0,
      licensePackagesWithLicenses: 0,
      licensePermissiveCount: 0,
      licenseWeakCopyleftCount: 0,
      licenseStrongCopyleftCount: 0,
      licenseUnknownCount: 0,
    };
  }

  /**
   * Aggregate severity counts across all projects using a single UNION ALL query.
   * OPTIMIZED: Replaces 6 separate queries with 1 consolidated query.
   */
  private async aggregateSeverityByProjects(
    filterContext: FilterContext,
  ): Promise<TotalBySeverity[]> {
    const { projectIds, includeResolved, severityFilter, analysisTypes } =
      filterContext;
    if (projectIds.length === 0) return [];

    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];
    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    // Build UNION ALL query for all vulnerability types
    const unionParts: Sql[] = [];

    const buildSelectForType = (tableName: string, alias: string) => {
      const conditions: Sql[] = [];

      // projectIds condition
      conditions.push(sql`${col(alias, 'projectId')} IN ${inList(projectIds)}`);

      if (excludedStates.length > 0) {
        conditions.push(
          sql`${col(alias, 'currentState')} NOT IN ${inList(excludedStates)}`,
        );
      }
      if (filterContext.statusFilter.length > 0) {
        conditions.push(
          sql`${col(alias, 'currentState')} IN ${inList(filterContext.statusFilter.map((s) => s.toLowerCase()))}`,
        );
      }
      if (severityFilter.length > 0) {
        conditions.push(sql`${upperBand(alias)} IN ${inList(severityFilter)}`);
      }
      if (filterContext.dateFrom) {
        conditions.push(
          sql`${col(alias, 'createdAt')} >= ${filterContext.dateFrom}`,
        );
      }
      if (filterContext.dateTo) {
        conditions.push(
          sql`${col(alias, 'createdAt')} <= ${filterContext.dateTo}`,
        );
      }
      const branchCond1 = this.buildBranchFilterSQL(alias, filterContext);
      if (branchCond1) conditions.push(branchCond1);

      return sql`SELECT ${upperBand(alias)} as severity, COUNT(*) as cnt FROM ${rawSql(`${tableName} ${alias}`)} WHERE ${joinSql(conditions, ' AND ')} GROUP BY ${upperBand(alias)}`;
    };

    if (shouldIncludeType('SAST'))
      unionParts.push(buildSelectForType('vulnerability_detections_sast', 's'));
    if (shouldIncludeType('IAC'))
      unionParts.push(buildSelectForType('vulnerability_detections_iac', 'i'));
    if (shouldIncludeType('SCA'))
      unionParts.push(buildSelectForType('vulnerability_detections_sca', 'sc'));
    if (shouldIncludeType('CONTAINER'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_container', 'c'),
      );
    if (shouldIncludeType('CICD'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_cicd', 'ci'),
      );
    if (shouldIncludeType('SECRET'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_secret', 'se'),
      );

    if (unionParts.length === 0) return [];

    const query = sql`SELECT severity, SUM(cnt) as count FROM (${joinSql(unionParts, ' UNION ALL ')}) AS combined GROUP BY severity`;

    const results = await this.sastVulnDetectRepository.query(
      query.text,
      query.params,
    );

    return results.map((r: any) => ({
      severity: r.severity || 'UNKNOWN',
      count: Number(r.count),
    }));
  }

  /**
   * Build a severity aggregation query with filters.
   */
  private async buildSeverityQuery<T>(
    repository: Repository<T>,
    alias: string,
    projectIds: string[],
    excludedStates: string[],
    filterContext: FilterContext,
  ): Promise<{ severity: string; count: string }[]> {
    const qb = repository
      .createQueryBuilder(alias)
      .select(effectiveSeveritySql(alias), 'severity')
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.projectId IN (:...projectIds)`, { projectIds });

    this.applyCommonFilters(qb, alias, excludedStates, filterContext);

    return qb
      .groupBy(effectiveSeveritySql(alias))
      .getRawMany<{ severity: string; count: string }>();
  }

  /**
   * Apply common filters to a query builder.
   * Simplified for organization-level overview - severity, status, date, and branch filters.
   */
  private applyCommonFilters<T>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    excludedStates: string[],
    filterContext: FilterContext,
  ): void {
    if (excludedStates.length > 0) {
      qb.andWhere(`${alias}.currentState NOT IN (:...excludedStates)`, {
        excludedStates,
      });
    }

    if (filterContext.statusFilter.length > 0) {
      qb.andWhere(`${alias}.currentState IN (:...statusFilter)`, {
        statusFilter: filterContext.statusFilter.map((s) => s.toLowerCase()),
      });
    }

    if (filterContext.severityFilter.length > 0) {
      qb.andWhere(
        `UPPER(${effectiveSeveritySql(alias)}) IN (:...severityFilter)`,
        { severityFilter: filterContext.severityFilter },
      );
    }

    if (filterContext.dateFrom) {
      qb.andWhere(`${alias}.createdAt >= :dateFrom`, {
        dateFrom: filterContext.dateFrom,
      });
    }

    if (filterContext.dateTo) {
      qb.andWhere(`${alias}.createdAt <= :dateTo`, {
        dateTo: filterContext.dateTo,
      });
    }

    this.applyBranchFilterQB(qb, alias, filterContext);
  }

  /**
   * Aggregate state counts across all projects using a single UNION ALL query.
   * OPTIMIZED: Replaces 6 separate queries with 1 consolidated query.
   */
  private async aggregateStateByProjects(
    filterContext: FilterContext,
  ): Promise<TotalByState[]> {
    const { projectIds, analysisTypes } = filterContext;
    if (projectIds.length === 0) return [];

    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    const unionParts: Sql[] = [];

    const buildSelectForType = (tableName: string, alias: string) => {
      const conditions: Sql[] = [];
      conditions.push(sql`${col(alias, 'projectId')} IN ${inList(projectIds)}`);

      // Apply severity filter
      if (filterContext.severityFilter.length > 0) {
        conditions.push(
          sql`${upperBand(alias)} IN ${inList(filterContext.severityFilter)}`,
        );
      }
      if (filterContext.dateFrom) {
        conditions.push(
          sql`${col(alias, 'createdAt')} >= ${filterContext.dateFrom}`,
        );
      }
      if (filterContext.dateTo) {
        conditions.push(
          sql`${col(alias, 'createdAt')} <= ${filterContext.dateTo}`,
        );
      }
      const branchCond2 = this.buildBranchFilterSQL(alias, filterContext);
      if (branchCond2) conditions.push(branchCond2);

      return sql`SELECT ${col(alias, 'currentState')} as state, COUNT(*) as cnt FROM ${rawSql(`${tableName} ${alias}`)} WHERE ${joinSql(conditions, ' AND ')} GROUP BY ${col(alias, 'currentState')}`;
    };

    if (shouldIncludeType('SAST'))
      unionParts.push(buildSelectForType('vulnerability_detections_sast', 's'));
    if (shouldIncludeType('IAC'))
      unionParts.push(buildSelectForType('vulnerability_detections_iac', 'i'));
    if (shouldIncludeType('SCA'))
      unionParts.push(buildSelectForType('vulnerability_detections_sca', 'sc'));
    if (shouldIncludeType('CONTAINER'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_container', 'c'),
      );
    if (shouldIncludeType('CICD'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_cicd', 'ci'),
      );
    if (shouldIncludeType('SECRET'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_secret', 'se'),
      );

    if (unionParts.length === 0) return [];

    const query = sql`SELECT state, SUM(cnt) as count FROM (${joinSql(unionParts, ' UNION ALL ')}) AS combined GROUP BY state`;
    const results = await this.sastVulnDetectRepository.query(
      query.text,
      query.params,
    );

    return results.map((r: any) => ({
      state: r.state,
      count: Number(r.count),
    }));
  }

  /**
   * Aggregate analysis type counts across all projects using a single UNION ALL query.
   * OPTIMIZED: Replaces 6 separate COUNT queries with 1 consolidated query.
   */
  private async aggregateAnalysisTypeByProjects(
    filterContext: FilterContext,
  ): Promise<TotalByAnalysisType[]> {
    const { projectIds, analysisTypes, includeResolved } = filterContext;
    if (projectIds.length === 0) return [];

    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];
    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    const unionParts: Sql[] = [];

    const buildSelectForType = (
      tableName: string,
      alias: string,
      typeName: string,
    ) => {
      const conditions: Sql[] = [];
      conditions.push(sql`${col(alias, 'projectId')} IN ${inList(projectIds)}`);

      if (excludedStates.length > 0) {
        conditions.push(
          sql`${col(alias, 'currentState')} NOT IN ${inList(excludedStates)}`,
        );
      }
      if (filterContext.statusFilter.length > 0) {
        conditions.push(
          sql`${col(alias, 'currentState')} IN ${inList(filterContext.statusFilter.map((s) => s.toLowerCase()))}`,
        );
      }
      if (filterContext.severityFilter.length > 0) {
        conditions.push(
          sql`${upperBand(alias)} IN ${inList(filterContext.severityFilter)}`,
        );
      }
      if (filterContext.dateFrom) {
        conditions.push(
          sql`${col(alias, 'createdAt')} >= ${filterContext.dateFrom}`,
        );
      }
      if (filterContext.dateTo) {
        conditions.push(
          sql`${col(alias, 'createdAt')} <= ${filterContext.dateTo}`,
        );
      }
      const branchCond3 = this.buildBranchFilterSQL(alias, filterContext);
      if (branchCond3) conditions.push(branchCond3);

      return sql`SELECT ${rawSql(`'${typeName}' as ${rawIdent('analysisType')}`)}, COUNT(*) as cnt FROM ${rawSql(`${tableName} ${alias}`)} WHERE ${joinSql(conditions, ' AND ')}`;
    };

    if (shouldIncludeType('SAST'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_sast', 's', 'SAST'),
      );
    if (shouldIncludeType('IAC'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_iac', 'i', 'IAC'),
      );
    if (shouldIncludeType('SCA'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_sca', 'sc', 'SCA'),
      );
    if (shouldIncludeType('CONTAINER'))
      unionParts.push(
        buildSelectForType(
          'vulnerability_detections_container',
          'c',
          'CONTAINER',
        ),
      );
    if (shouldIncludeType('CICD'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_cicd', 'ci', 'CICD'),
      );
    if (shouldIncludeType('SECRET'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_secret', 'se', 'SECRET'),
      );

    if (unionParts.length === 0) return [];

    const analysisType = rawSql(rawIdent('analysisType'));
    const query = sql`SELECT ${analysisType}, SUM(cnt) as count FROM (${joinSql(unionParts, ' UNION ALL ')}) AS combined GROUP BY ${analysisType}`;
    const results = await this.sastVulnDetectRepository.query(
      query.text,
      query.params,
    );

    return results.map((r: any) => ({
      analysisType: r.analysisType,
      count: Number(r.count),
    }));
  }

  /**
   * Count vulnerabilities by type with filters.
   */
  private async countByTypeWithFilters<T>(
    repository: Repository<T>,
    alias: string,
    projectIds: string[],
    excludedStates: string[],
    filterContext: FilterContext,
  ): Promise<number> {
    const qb = repository
      .createQueryBuilder(alias)
      .where(`${alias}.projectId IN (:...projectIds)`, { projectIds });

    this.applyCommonFilters(qb, alias, excludedStates, filterContext);

    return qb.getCount();
  }

  /**
   * Aggregate vulnerabilities over time across all projects with filters.
   * Returns cumulative counts per date and severity.
   */
  private async aggregateVulnerabilitiesOverTime(
    filterContext: FilterContext,
  ): Promise<VulnerabilitiesOverTime[]> {
    const { projectIds, analysisTypes } = filterContext;
    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    const types = (
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'] as const
    ).filter((t) => shouldIncludeType(t.toUpperCase()));

    // the "Vulnerability Trends" line shows what was
    // OPEN at the end of each day. Every detection ever created adds to the
    // balance on its creation day and a closing (resolved / ignored /
    // not_exploitable, dated by resolved_at / triaged_at) subtracts from it on
    // its closing day. A resolved finding therefore leaves the CURRENT point —
    // the last point equals the dashboard cards — while it stays on every date
    // it was actually open. With includeResolved the caller wants the
    // discovered total instead: created series only, never
    // decreasing.
    const createdResults = await Promise.all(
      types.map((t) => this.fetchCreatedOverTime(t, projectIds, filterContext)),
    );
    const combinedOverTimeRaw: {
      date: string;
      severity: string;
      count: string;
      action: 'created' | 'closed';
    }[] = createdResults.flat().map((x) => ({ ...x, action: 'created' }));

    if (filterContext.includeResolved) {
      return combinedOverTimeRaw.length === 0
        ? []
        : accumulateCreatedOverTime(combinedOverTimeRaw);
    }

    const closedResults = await Promise.all(
      types.map((t) => this.fetchClosedOverTime(t, projectIds, filterContext)),
    );
    closedResults.flat().forEach((x) => {
      combinedOverTimeRaw.push({ ...x, action: 'closed' });
    });
    if (combinedOverTimeRaw.length === 0) {
      return [];
    }
    return accumulateOpenOverTime(combinedOverTimeRaw);
  }

  /**
   * Fetch created vulnerabilities over time for a specific type with filters.
   */
  private async fetchCreatedOverTime(
    type: 'sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret',
    projectIds: string[],
    filterContext: FilterContext,
  ): Promise<{ date: string; severity: string; count: string }[]> {
    const repository = this.getRepositoryForType(type);
    const alias = type;

    const qb = repository
      .createQueryBuilder(alias)
      .select(dateBucket(`${alias}.createdAt`, 'day').text, 'date')
      // UPPER() so the over-time severities match the dashboard chart's
      // uppercase bucket set; effectiveSeveritySql() yields lowercase.
      .addSelect(`UPPER(${effectiveSeveritySql(alias)})`, 'severity')
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.projectId IN (:...projectIds)`, { projectIds });

    // Every state is kept here — a closing is SUBTRACTED on its own
    // day by fetchClosedOverTime() / accumulateOpenOverTime(), not filtered out
    // of the history. Only an explicit statusFilter narrows the series.
    if (filterContext.statusFilter.length > 0) {
      qb.andWhere(`${alias}.currentState IN (:...statusFilter)`, {
        statusFilter: filterContext.statusFilter.map((s) => s.toLowerCase()),
      });
    }

    // Apply date filters if specified
    if (filterContext.dateFrom) {
      qb.andWhere(`${alias}.createdAt >= :dateFrom`, {
        dateFrom: filterContext.dateFrom,
      });
    }
    if (filterContext.dateTo) {
      qb.andWhere(`${alias}.createdAt <= :dateTo`, {
        dateTo: filterContext.dateTo,
      });
    }
    if (filterContext.severityFilter.length > 0) {
      qb.andWhere(
        `UPPER(${effectiveSeveritySql(alias)}) IN (:...severityFilter)`,
        { severityFilter: filterContext.severityFilter },
      );
    }
    this.applyBranchFilterQB(qb, alias, filterContext);

    return qb
      .groupBy(dateBucket(`${alias}.createdAt`, 'day').text)
      .addGroupBy(`UPPER(${effectiveSeveritySql(alias)})`)
      .orderBy(dateBucket(`${alias}.createdAt`, 'day').text, 'ASC')
      .getRawMany<{ date: string; severity: string; count: string }>();
  }

  /**
   * Fetch the CLOSED series for a type: one row per (closing day, severity)
   * for detections that are resolved, ignored or not_exploitable, dated by
   * resolved_at (resolution) / triaged_at (dismissal), with the row's update
   * date as a fallback for rows that predate the lifecycle columns.
   */
  private async fetchClosedOverTime(
    type: 'sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret',
    projectIds: string[],
    filterContext: FilterContext,
  ): Promise<{ date: string; severity: string; count: string }[]> {
    const repository = this.getRepositoryForType(type);
    const alias = type;
    // SAST, IAC, CICD, Secret use updateAt, SCA and Container use updatedAt
    const updateField =
      type === 'sast' || type === 'iac' || type === 'cicd' || type === 'secret'
        ? 'updateAt'
        : 'updatedAt';

    // Mirror the created series. An explicit statusFilter
    // narrows the closings to the same states; a filter that keeps only open
    // states has no closing to subtract at all. Otherwise closings of states
    // absent from the (filtered) created series would be subtracted from
    // nothing and floor the balance to zero for every later date.
    const CLOSED_STATES = ['resolved', 'ignored', 'not_exploitable'];
    const wanted = filterContext.statusFilter.map((s) => s.toLowerCase());
    const states =
      wanted.length > 0
        ? CLOSED_STATES.filter((state) => wanted.includes(state))
        : CLOSED_STATES;
    if (states.length === 0) {
      return [];
    }
    const closedAt = `COALESCE(${alias}.resolvedAt, ${alias}.triagedAt, ${alias}.${updateField})`;
    const qb = repository
      .createQueryBuilder(alias)
      .select(dateBucket(closedAt, 'day').text, 'date')
      // UPPER() so the over-time severities match the dashboard chart's
      // uppercase bucket set; effectiveSeveritySql() yields lowercase.
      .addSelect(`UPPER(${effectiveSeveritySql(alias)})`, 'severity')
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
      .andWhere(`${alias}.currentState IN (:...states)`, { states })
      .andWhere(`${closedAt} IS NOT NULL`);

    // Apply date filters if specified
    if (filterContext.dateFrom) {
      qb.andWhere(`${closedAt} >= :dateFrom`, {
        dateFrom: filterContext.dateFrom,
      });
    }
    if (filterContext.dateTo) {
      qb.andWhere(`${closedAt} <= :dateTo`, {
        dateTo: filterContext.dateTo,
      });
    }
    if (filterContext.severityFilter.length > 0) {
      qb.andWhere(
        `UPPER(${effectiveSeveritySql(alias)}) IN (:...severityFilter)`,
        { severityFilter: filterContext.severityFilter },
      );
    }
    this.applyBranchFilterQB(qb, alias, filterContext);

    return qb
      .groupBy(dateBucket(closedAt, 'day').text)
      .addGroupBy(`UPPER(${effectiveSeveritySql(alias)})`)
      .getRawMany<{ date: string; severity: string; count: string }>();
  }

  /**
   * Get the repository for a specific vulnerability type.
   */
  private getRepositoryForType(
    type: 'sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret',
  ): Repository<any> {
    switch (type) {
      case 'sast':
        return this.sastVulnDetectRepository;
      case 'iac':
        return this.iacVulnDetectRepository;
      case 'sca':
        return this.scaVulnDetectRepository;
      case 'container':
        return this.containerVulnDetectRepository;
      case 'cicd':
        return this.cicdVulnDetectRepository;
      case 'secret':
        return this.secretVulnDetectRepository;
    }
  }

  /**
   * Get project-level statistics for all projects using consolidated queries.
   * ULTRA-OPTIMIZED: Uses 2 main queries instead of 10+ parallel query groups.
   */
  private async getProjectLevelStats(
    filterContext: FilterContext,
  ): Promise<Map<string, ProjectStats>> {
    const { projectIds, analysisTypes, trendPeriodDays, includeResolved } =
      filterContext;

    if (projectIds.length === 0) return new Map();

    const statsMap = new Map<string, ProjectStats>();
    projectIds.forEach((id) => {
      statsMap.set(id, {
        ...EMPTY_PROJECT_STATS,
        languages: new Set<string>(),
      });
    });

    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];
    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    // Build a single UNION ALL query for all vulnerability counts by project, severity, state, type
    const unionParts: Sql[] = [];

    const buildSelectForType = (
      tableName: string,
      alias: string,
      typeName: string,
    ) => {
      const conditions: Sql[] = [];
      conditions.push(sql`${col(alias, 'projectId')} IN ${inList(projectIds)}`);

      if (excludedStates.length > 0) {
        conditions.push(
          sql`${col(alias, 'currentState')} NOT IN ${inList(excludedStates)}`,
        );
      }
      if (filterContext.severityFilter.length > 0) {
        conditions.push(
          sql`${upperBand(alias)} IN ${inList(filterContext.severityFilter)}`,
        );
      }
      if (filterContext.dateFrom) {
        conditions.push(
          sql`${col(alias, 'createdAt')} >= ${filterContext.dateFrom}`,
        );
      }
      if (filterContext.dateTo) {
        conditions.push(
          sql`${col(alias, 'createdAt')} <= ${filterContext.dateTo}`,
        );
      }
      const branchCond4 = this.buildBranchFilterSQL(alias, filterContext);
      if (branchCond4) conditions.push(branchCond4);

      return sql`SELECT ${col(alias, 'projectId')}, ${upperBand(alias)} as severity, ${col(alias, 'currentState')} as state, ${rawSql(`'${typeName}' as ${rawIdent('vulnType')}`)}, COUNT(*) as cnt
            FROM ${rawSql(`${tableName} ${alias}`)}
            WHERE ${joinSql(conditions, ' AND ')}
            GROUP BY ${col(alias, 'projectId')}, ${upperBand(alias)}, ${col(alias, 'currentState')}`;
    };

    if (shouldIncludeType('SAST'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_sast', 's', 'sast'),
      );
    if (shouldIncludeType('IAC'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_iac', 'i', 'iac'),
      );
    if (shouldIncludeType('SCA'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_sca', 'sc', 'sca'),
      );
    if (shouldIncludeType('CONTAINER'))
      unionParts.push(
        buildSelectForType(
          'vulnerability_detections_container',
          'c',
          'container',
        ),
      );
    if (shouldIncludeType('CICD'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_cicd', 'ci', 'cicd'),
      );
    if (shouldIncludeType('SECRET'))
      unionParts.push(
        buildSelectForType('vulnerability_detections_secret', 'se', 'secret'),
      );

    if (unionParts.length > 0) {
      const query = joinSql(unionParts, ' UNION ALL ');
      const results = await this.sastVulnDetectRepository.query(
        query.text,
        query.params,
      );

      // Aggregate results into statsMap
      results.forEach((row: any) => {
        const stats = statsMap.get(row.projectId);
        if (!stats) return;

        const count = Number(row.cnt);
        const severity = (row.severity || '').toLowerCase() as
          | 'critical'
          | 'high'
          | 'medium'
          | 'low';
        const type = row.vulnType as
          | 'sast'
          | 'sca'
          | 'iac'
          | 'container'
          | 'cicd'
          | 'secret';
        const state = row.state || '';

        // Add to type total
        stats[type] += count;
        stats.total += count;

        // Add to severity total
        if (severity && severity in stats) {
          stats[severity] += count;
        }

        // Track open vs resolved
        if (['resolved', 'not_exploitable'].includes(state)) {
          stats.resolved += count;
        } else if (!['ignored'].includes(state)) {
          stats.open += count;
        }
      });
    }

    // Fetch additional data in parallel: languages, autofix, trends
    await Promise.all([
      this.fetchProjectLanguages(filterContext).then((data) =>
        this.addLanguagesToMap(statsMap, data),
      ),
      this.fetchProjectAutofixStats(filterContext).then((data) =>
        this.addAutofixStatsToMap(statsMap, data),
      ),
      this.fetchProjectTrendStatsOptimized(filterContext, trendPeriodDays).then(
        (data) => this.addTrendStatsToMap(statsMap, data),
      ),
    ]);

    return statsMap;
  }

  /**
   * Fetch project stats for a specific vulnerability type with filters.
   */
  private async fetchProjectStatsByType(
    type: 'sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret',
    filterContext: FilterContext,
  ): Promise<
    { projectId: string; severity: string; count: string; state: string }[]
  > {
    const repository = this.getRepositoryForType(type);
    const alias = type;
    const { projectIds, includeResolved } = filterContext;
    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];

    const qb = repository
      .createQueryBuilder(alias)
      .select(`${alias}.projectId`, 'projectId')
      .addSelect(effectiveSeveritySql(alias), 'severity')
      .addSelect(`${alias}.currentState`, 'state')
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.projectId IN (:...projectIds)`, { projectIds });

    if (excludedStates.length > 0) {
      qb.andWhere(`${alias}.currentState NOT IN (:...excludedStates)`, {
        excludedStates,
      });
    }

    // Apply other common filters
    if (filterContext.severityFilter.length > 0) {
      qb.andWhere(
        `UPPER(${effectiveSeveritySql(alias)}) IN (:...severityFilter)`,
        { severityFilter: filterContext.severityFilter },
      );
    }
    if (filterContext.dateFrom) {
      qb.andWhere(`${alias}.createdAt >= :dateFrom`, {
        dateFrom: filterContext.dateFrom,
      });
    }
    if (filterContext.dateTo) {
      qb.andWhere(`${alias}.createdAt <= :dateTo`, {
        dateTo: filterContext.dateTo,
      });
    }
    this.applyBranchFilterQB(qb, alias, filterContext);

    return qb
      .groupBy(`${alias}.projectId`)
      .addGroupBy(effectiveSeveritySql(alias))
      .addGroupBy(`${alias}.currentState`)
      .getRawMany<{
        projectId: string;
        severity: string;
        count: string;
        state: string;
      }>();
  }

  /**
   * Fetch project resolved stats.
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async fetchProjectResolvedStats(
    filterContext: FilterContext,
  ): Promise<{ projectId: string; resolved: number; open: number }[]> {
    const { projectIds } = filterContext;

    // Query all types for open/resolved counts
    const types: ('sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret')[] =
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'];

    const projectCounts = new Map<string, { resolved: number; open: number }>();
    projectIds.forEach((id) => projectCounts.set(id, { resolved: 0, open: 0 }));

    // Execute all queries in parallel
    const queryPromises = types.map((type) => {
      const repository = this.getRepositoryForType(type);
      const alias = type;
      const qb = repository
        .createQueryBuilder(alias)
        .select(`${alias}.projectId`, 'projectId')
        .addSelect(`${alias}.currentState`, 'state')
        .addSelect('COUNT(*)', 'count')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds });

      this.applyBranchFilterQB(qb, alias, filterContext);

      return qb
        .groupBy(`${alias}.projectId`)
        .addGroupBy(`${alias}.currentState`)
        .getRawMany<{ projectId: string; state: string; count: string }>();
    });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results from all types
    allResults.flat().forEach((item) => {
      const counts = projectCounts.get(item.projectId);
      if (counts) {
        if (['resolved', 'not_exploitable'].includes(item.state)) {
          counts.resolved += Number(item.count);
        } else if (!['ignored'].includes(item.state)) {
          counts.open += Number(item.count);
        }
      }
    });

    return Array.from(projectCounts.entries()).map(([projectId, counts]) => ({
      projectId,
      ...counts,
    }));
  }

  /**
   * Fetch project trend stats (new and resolved in period).
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async fetchProjectTrendStats(
    filterContext: FilterContext,
    periodDays: number,
  ): Promise<{ projectId: string; newCount: number; resolvedCount: number }[]> {
    const { projectIds } = filterContext;
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - periodDays);
    periodStart.setHours(0, 0, 0, 0);

    const projectCounts = new Map<
      string,
      { newCount: number; resolvedCount: number }
    >();
    projectIds.forEach((id) =>
      projectCounts.set(id, { newCount: 0, resolvedCount: 0 }),
    );

    const types: ('sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret')[] =
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'];

    // Build all queries in parallel - both new and resolved for each type
    const queryPromises = types.flatMap((type) => {
      const repository = this.getRepositoryForType(type);
      const alias = type;
      const updateField =
        type === 'sast' ||
        type === 'iac' ||
        type === 'cicd' ||
        type === 'secret'
          ? 'updateAt'
          : 'updatedAt';

      // New in period query
      const newQb = repository
        .createQueryBuilder(alias)
        .select(`${alias}.projectId`, 'projectId')
        .addSelect('COUNT(*)', 'count')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.createdAt >= :periodStart`, { periodStart });

      this.applyBranchFilterQB(newQb, alias, filterContext);

      const newPromise = newQb
        .groupBy(`${alias}.projectId`)
        .getRawMany<{ projectId: string; count: string }>()
        .then((data) => ({ type: 'new' as const, data }));

      // Resolved in period query
      const resolvedQb = repository
        .createQueryBuilder(alias)
        .select(`${alias}.projectId`, 'projectId')
        .addSelect('COUNT(*)', 'count')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.currentState IN (:...states)`, {
          states: ['resolved', 'not_exploitable'],
        })
        .andWhere(`${alias}.${updateField} >= :periodStart`, { periodStart });

      this.applyBranchFilterQB(resolvedQb, alias, filterContext);

      const resolvedPromise = resolvedQb
        .groupBy(`${alias}.projectId`)
        .getRawMany<{ projectId: string; count: string }>()
        .then((data) => ({ type: 'resolved' as const, data }));

      return [newPromise, resolvedPromise];
    });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results
    allResults.forEach((result) => {
      result.data.forEach((item) => {
        const counts = projectCounts.get(item.projectId);
        if (counts) {
          if (result.type === 'new') {
            counts.newCount += Number(item.count);
          } else {
            counts.resolvedCount += Number(item.count);
          }
        }
      });
    });

    return Array.from(projectCounts.entries()).map(([projectId, counts]) => ({
      projectId,
      ...counts,
    }));
  }

  /**
   * Fetch project trend stats using optimized UNION ALL query.
   */
  private async fetchProjectTrendStatsOptimized(
    filterContext: FilterContext,
    periodDays: number,
  ): Promise<{ projectId: string; newCount: number; resolvedCount: number }[]> {
    const { projectIds, includeResolved } = filterContext;
    if (projectIds.length === 0) return [];

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - periodDays);
    periodStart.setHours(0, 0, 0, 0);

    // Keep per-project/team "new in period" on the same open-state
    // universe as the total (see aggregateSeverityByProjects), so a project's
    // increase can never exceed its open count. Resolved parts stay unfiltered.
    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];

    // Build UNION ALL for new vulnerabilities
    const newParts: Sql[] = [];
    const tables = [
      { table: 'vulnerability_detections_sast', alias: 's' },
      { table: 'vulnerability_detections_iac', alias: 'i' },
      { table: 'vulnerability_detections_sca', alias: 'sc' },
      { table: 'vulnerability_detections_container', alias: 'c' },
      { table: 'vulnerability_detections_cicd', alias: 'ci' },
      { table: 'vulnerability_detections_secret', alias: 'se' },
    ];

    tables.forEach(({ table, alias }) => {
      const conditions: Sql[] = [
        sql`${col(alias, 'projectId')} IN ${inList(projectIds)}`,
        sql`${col(alias, 'createdAt')} >= ${periodStart}`,
      ];
      const branchCond5 = this.buildBranchFilterSQL(alias, filterContext);
      if (branchCond5) conditions.push(branchCond5);
      if (excludedStates.length > 0) {
        conditions.push(
          sql`${col(alias, 'currentState')} NOT IN ${inList(excludedStates)}`,
        );
      }
      newParts.push(
        sql`SELECT ${col(alias, 'projectId')}, COUNT(*) as cnt FROM ${rawSql(`${table} ${alias}`)} WHERE ${joinSql(conditions, ' AND ')} GROUP BY ${col(alias, 'projectId')}`,
      );
    });

    const projectIdCol = rawSql(rawIdent('projectId'));
    const newQuery = sql`SELECT ${projectIdCol}, SUM(cnt) as ${rawSql(rawIdent('newCount'))} FROM (${joinSql(newParts, ' UNION ALL ')}) AS n GROUP BY ${projectIdCol}`;

    // Build UNION ALL for resolved vulnerabilities
    const resolvedParts: Sql[] = [];
    const updateFields: Record<string, string> = {
      vulnerability_detections_sast: 'updateAt',
      vulnerability_detections_iac: 'updateAt',
      vulnerability_detections_sca: 'updatedAt',
      vulnerability_detections_container: 'updatedAt',
      vulnerability_detections_cicd: 'updateAt',
      vulnerability_detections_secret: 'updateAt',
    };

    tables.forEach(({ table, alias }) => {
      const updateField = updateFields[table];
      const conditions: Sql[] = [
        sql`${col(alias, 'projectId')} IN ${inList(projectIds)}`,
        sql`${col(alias, 'currentState')} IN ('resolved', 'not_exploitable')`,
        sql`${col(alias, updateField)} >= ${periodStart}`,
      ];
      const branchCond6 = this.buildBranchFilterSQL(alias, filterContext);
      if (branchCond6) conditions.push(branchCond6);
      resolvedParts.push(
        sql`SELECT ${col(alias, 'projectId')}, COUNT(*) as cnt FROM ${rawSql(`${table} ${alias}`)} WHERE ${joinSql(conditions, ' AND ')} GROUP BY ${col(alias, 'projectId')}`,
      );
    });

    const resolvedQuery = sql`SELECT ${projectIdCol}, SUM(cnt) as ${rawSql(rawIdent('resolvedCount'))} FROM (${joinSql(resolvedParts, ' UNION ALL ')}) AS r GROUP BY ${projectIdCol}`;

    const [newResults, resolvedResults] = await Promise.all([
      this.sastVulnDetectRepository.query(newQuery.text, newQuery.params),
      this.sastVulnDetectRepository.query(
        resolvedQuery.text,
        resolvedQuery.params,
      ),
    ]);

    const resultMap = new Map<
      string,
      { newCount: number; resolvedCount: number }
    >();
    projectIds.forEach((id) =>
      resultMap.set(id, { newCount: 0, resolvedCount: 0 }),
    );

    newResults.forEach((r: any) => {
      const entry = resultMap.get(r.projectId);
      if (entry) entry.newCount = Number(r.newCount);
    });

    resolvedResults.forEach((r: any) => {
      const entry = resultMap.get(r.projectId);
      if (entry) entry.resolvedCount = Number(r.resolvedCount);
    });

    return Array.from(resultMap.entries()).map(([projectId, counts]) => ({
      projectId,
      ...counts,
    }));
  }

  /**
   * Fetch languages per project.
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async fetchProjectLanguages(
    filterContext: FilterContext,
  ): Promise<{ projectId: string; languages: string[] }[]> {
    const { projectIds } = filterContext;
    const projectLanguages = new Map<string, Set<string>>();
    projectIds.forEach((id) => projectLanguages.set(id, new Set()));

    // Only SAST, IAC, CICD, Secret have language field
    const types: ('sast' | 'iac' | 'cicd' | 'secret')[] = [
      'sast',
      'iac',
      'cicd',
      'secret',
    ];

    // Execute all queries in parallel
    const queryPromises = types.map((type) => {
      const repository = this.getRepositoryForType(type);
      const alias = type;
      const qb = repository
        .createQueryBuilder(alias)
        .select(`${alias}.projectId`, 'projectId')
        .addSelect(`${alias}.language`, 'language')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.language IS NOT NULL`)
        .andWhere(`${alias}.language != ''`);

      this.applyBranchFilterQB(qb, alias, filterContext);

      return qb
        .groupBy(`${alias}.projectId`)
        .addGroupBy(`${alias}.language`)
        .getRawMany<{ projectId: string; language: string }>();
    });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results
    allResults.flat().forEach((item) => {
      const langs = projectLanguages.get(item.projectId);
      if (langs && item.language) langs.add(item.language);
    });

    return Array.from(projectLanguages.entries()).map(([projectId, langs]) => ({
      projectId,
      languages: Array.from(langs),
    }));
  }

  /**
   * Fetch autofix stats per project.
   */
  private async fetchProjectAutofixStats(
    filterContext: FilterContext,
  ): Promise<{ projectId: string; autofixCount: number }[]> {
    const { projectIds } = filterContext;

    // Query autofix records
    const autofixData = await this.autofixRecordRepository
      .createQueryBuilder('autofix')
      .select('autofix.projectId', 'projectId')
      .addSelect('COUNT(DISTINCT autofix.vulnerabilityId)', 'count')
      .where('autofix.projectId IN (:...projectIds)', { projectIds })
      .groupBy('autofix.projectId')
      .getRawMany<{ projectId: string; count: string }>();

    const projectCounts = new Map<string, number>();
    projectIds.forEach((id) => projectCounts.set(id, 0));
    autofixData.forEach((item) =>
      projectCounts.set(item.projectId, Number(item.count)),
    );

    return Array.from(projectCounts.entries()).map(
      ([projectId, autofixCount]) => ({
        projectId,
        autofixCount,
      }),
    );
  }

  /**
   * Add resolved stats to map.
   */
  private addResolvedStatsToMap(
    statsMap: Map<string, ProjectStats>,
    data: { projectId: string; resolved: number; open: number }[],
  ): void {
    data.forEach((item) => {
      const stats = statsMap.get(item.projectId);
      if (stats) {
        stats.resolved = item.resolved;
        stats.open = item.open;
      }
    });
  }

  /**
   * Add trend stats to map.
   */
  private addTrendStatsToMap(
    statsMap: Map<string, ProjectStats>,
    data: { projectId: string; newCount: number; resolvedCount: number }[],
  ): void {
    data.forEach((item) => {
      const stats = statsMap.get(item.projectId);
      if (stats) {
        stats.newLast7Days = item.newCount;
        stats.resolvedLast7Days = item.resolvedCount;
      }
    });
  }

  /**
   * Add languages to map.
   */
  private addLanguagesToMap(
    statsMap: Map<string, ProjectStats>,
    data: { projectId: string; languages: string[] }[],
  ): void {
    data.forEach((item) => {
      const stats = statsMap.get(item.projectId);
      if (stats) {
        item.languages.forEach((lang) => stats.languages.add(lang));
      }
    });
  }

  /**
   * Add autofix stats to map.
   */
  private addAutofixStatsToMap(
    statsMap: Map<string, ProjectStats>,
    data: { projectId: string; autofixCount: number }[],
  ): void {
    data.forEach((item) => {
      const stats = statsMap.get(item.projectId);
      if (stats) {
        stats.autofixAvailable = item.autofixCount;
      }
    });
  }

  /**
   * Add stats to the map for a specific type.
   */
  private addStatsToMap(
    statsMap: Map<string, ProjectStats>,
    data: {
      projectId: string;
      severity: string;
      count: string;
      state?: string;
    }[],
    type: 'sast' | 'sca' | 'iac' | 'container' | 'cicd' | 'secret',
  ): void {
    data.forEach((item) => {
      const stats = statsMap.get(item.projectId);
      if (stats) {
        const count = Number(item.count);
        stats[type] += count;
        stats.total += count;
        const severityKey = item.severity?.toLowerCase() as
          | 'critical'
          | 'high'
          | 'medium'
          | 'low';
        if (severityKey && severityKey in stats) {
          stats[severityKey] += count;
        }
      }
    });
  }

  /**
   * Get trend statistics (new issues and solved issues) for all projects with filters.
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   * Reduces from 36 sequential queries to 6 parallel batches.
   */
  /**
   * New and solved findings of these projects, all time and over the last
   * `periodDays` days, counted exactly as the overview's tiles count them with
   * no filter. The home cards read this, so both pages show the same figures.
   */
  async getIssueTrend(
    projectIds: string[],
    periodDays = 7,
  ): Promise<TrendStatistics> {
    if (projectIds.length === 0) {
      return {
        newIssues: 0,
        newIssuesLastPeriod: 0,
        newIssuesPreviousPeriod: 0,
        solvedIssues: 0,
        solvedIssuesLastPeriod: 0,
        solvedIssuesPreviousPeriod: 0,
      };
    }
    return this.getTrendStatistics({
      projectIds,
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: [],
      branches: [],
      projectBranchMap: new Map(),
      includeResolved: false,
      trendPeriodDays: periodDays,
    });
  }

  private async getTrendStatistics(
    filterContext: FilterContext,
  ): Promise<TrendStatistics> {
    const { projectIds, trendPeriodDays, analysisTypes, includeResolved } =
      filterContext;

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - trendPeriodDays);
    periodStart.setHours(0, 0, 0, 0);

    const previousPeriodStart = new Date(periodStart);
    previousPeriodStart.setDate(
      previousPeriodStart.getDate() - trendPeriodDays,
    );

    // A "new issue" is an OPEN finding. Scope every
    // new-issues count (all-time, current period, previous period) to the same
    // states aggregateSeverityByProjects excludes, so the "New Issues" KPI and
    // the trend badge next to the "Total vulnerabilities" card line up with the
    // open-vulnerability total instead of counting every detection ever
    // created — including ones already resolved, not-exploitable or ignored
    // `solved*`
    // intentionally keeps counting the resolved states. Honour includeResolved
    // so an explicit "show resolved" request still counts them.
    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];

    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    const types: ('sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret')[] =
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'];

    // Build all queries for all types in parallel
    const queryPromises = types
      .filter((type) => shouldIncludeType(type.toUpperCase()))
      .flatMap((type) => {
        const repository = this.getRepositoryForType(type);
        const alias = type;
        const updateField =
          type === 'sast' ||
          type === 'iac' ||
          type === 'cicd' ||
          type === 'secret'
            ? 'updateAt'
            : 'updatedAt';

        // A fresh new-issues query for this type, scoped to the projects and
        // (unless includeResolved) to still-open states only. Each caller adds
        // its own createdAt window on top.
        const newIssuesQuery = () => {
          const qb = repository
            .createQueryBuilder(alias)
            .where(`${alias}.projectId IN (:...projectIds)`, { projectIds });
          if (excludedStates.length > 0) {
            qb.andWhere(`${alias}.currentState NOT IN (:...excludedStates)`, {
              excludedStates,
            });
          }
          return qb;
        };

        return [
          // Total new issues (open unless includeResolved is set)
          newIssuesQuery()
            .getCount()
            .then((count) => ({ metric: 'totalNew' as const, count })),

          // New issues in current period
          newIssuesQuery()
            .andWhere(`${alias}.createdAt >= :periodStart`, { periodStart })
            .getCount()
            .then((count) => ({ metric: 'newInPeriod' as const, count })),

          // New issues in previous period
          newIssuesQuery()
            .andWhere(`${alias}.createdAt >= :previousPeriodStart`, {
              previousPeriodStart,
            })
            .andWhere(`${alias}.createdAt < :periodStart`, { periodStart })
            .getCount()
            .then((count) => ({
              metric: 'newInPreviousPeriod' as const,
              count,
            })),

          // Total solved issues
          repository
            .count({
              where: {
                projectId: In(projectIds),
                currentState: In(['resolved', 'not_exploitable']),
              },
            })
            .then((count) => ({ metric: 'totalSolved' as const, count })),

          // Solved in current period
          repository
            .createQueryBuilder(alias)
            .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
            .andWhere(`${alias}.currentState IN (:...states)`, {
              states: ['resolved', 'not_exploitable'],
            })
            .andWhere(`${alias}.${updateField} >= :periodStart`, {
              periodStart,
            })
            .getCount()
            .then((count) => ({ metric: 'solvedInPeriod' as const, count })),

          // Solved in previous period
          repository
            .createQueryBuilder(alias)
            .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
            .andWhere(`${alias}.currentState IN (:...states)`, {
              states: ['resolved', 'not_exploitable'],
            })
            .andWhere(`${alias}.${updateField} >= :previousPeriodStart`, {
              previousPeriodStart,
            })
            .andWhere(`${alias}.${updateField} < :periodStart`, { periodStart })
            .getCount()
            .then((count) => ({
              metric: 'solvedInPreviousPeriod' as const,
              count,
            })),
        ];
      });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results by metric type
    let newIssues = 0;
    let newIssuesLastPeriod = 0;
    let newIssuesPreviousPeriod = 0;
    let solvedIssues = 0;
    let solvedIssuesLastPeriod = 0;
    let solvedIssuesPreviousPeriod = 0;

    allResults.forEach((result) => {
      switch (result.metric) {
        case 'totalNew':
          newIssues += result.count;
          break;
        case 'newInPeriod':
          newIssuesLastPeriod += result.count;
          break;
        case 'newInPreviousPeriod':
          newIssuesPreviousPeriod += result.count;
          break;
        case 'totalSolved':
          solvedIssues += result.count;
          break;
        case 'solvedInPeriod':
          solvedIssuesLastPeriod += result.count;
          break;
        case 'solvedInPreviousPeriod':
          solvedIssuesPreviousPeriod += result.count;
          break;
      }
    });

    return {
      newIssues,
      newIssuesLastPeriod,
      solvedIssues,
      solvedIssuesLastPeriod,
      newIssuesPreviousPeriod,
      solvedIssuesPreviousPeriod,
    };
  }

  /**
   * Build project summaries with enhanced team information and all stats.
   */
  private buildProjectsSummary(
    projects: Array<{
      projectId: string;
      name: string;
      teamId: string;
      teamName: string;
    }>,
    projectStats: Map<string, ProjectStats>,
    cyberRiskMap: Map<string, { score: number; level: string }>,
  ): ProjectOverviewSummary[] {
    return projects.map((p) => {
      const stats = projectStats.get(p.projectId) || { ...EMPTY_PROJECT_STATS };
      const cyberRisk = cyberRiskMap.get(p.projectId);
      return {
        projectId: p.projectId,
        projectName: p.name,
        teamId: p.teamId,
        teamName: p.teamName,
        cyberRiskLevel: cyberRisk?.level ?? 'low',
        cyberRiskScore: cyberRisk?.score ?? 0,
        criticalCount: stats.critical,
        highCount: stats.high,
        mediumCount: stats.medium,
        lowCount: stats.low,
        totalVulnerabilities: stats.total,
        sastCount: stats.sast,
        scaCount: stats.sca,
        iacCount: stats.iac,
        containerCount: stats.container,
        cicdCount: stats.cicd,
        secretCount: stats.secret,
        resolvedCount: stats.resolved,
        openCount: stats.open,
        newLast7Days: stats.newLast7Days,
        resolvedLast7Days: stats.resolvedLast7Days,
        autofixAvailableCount: stats.autofixAvailable,
        detectedLanguages: Array.from(stats.languages),
        lastScanDate: stats.lastScanDate?.toISOString(),
      };
    });
  }

  /**
   * Build team summaries by aggregating project data with enhanced stats.
   */
  private buildTeamSummaries(
    projectsSummary: ProjectOverviewSummary[],
  ): TeamOverviewSummary[] {
    const teamMap = new Map<
      string,
      {
        teamName: string;
        projectCount: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        total: number;
        criticalRiskProjects: number;
        highRiskProjects: number;
        mediumRiskProjects: number;
        lowRiskProjects: number;
        newLast7Days: number;
        resolvedLast7Days: number;
      }
    >();

    projectsSummary.forEach((project) => {
      if (!project.teamId) return;

      if (!teamMap.has(project.teamId)) {
        teamMap.set(project.teamId, {
          teamName: project.teamName,
          projectCount: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          total: 0,
          criticalRiskProjects: 0,
          highRiskProjects: 0,
          mediumRiskProjects: 0,
          lowRiskProjects: 0,
          newLast7Days: 0,
          resolvedLast7Days: 0,
        });
      }

      const team = teamMap.get(project.teamId)!;
      team.projectCount += 1;
      team.critical += project.criticalCount;
      team.high += project.highCount;
      team.medium += project.mediumCount;
      team.low += project.lowCount;
      team.total += project.totalVulnerabilities;
      team.newLast7Days += project.newLast7Days || 0;
      team.resolvedLast7Days += project.resolvedLast7Days || 0;

      // Calculate risk level for this project (from the CybeRisk score)
      const cyberRiskLevel = project.cyberRiskLevel;
      if (cyberRiskLevel === 'critical') {
        team.criticalRiskProjects += 1;
      } else if (cyberRiskLevel === 'high') {
        team.highRiskProjects += 1;
      } else if (cyberRiskLevel === 'medium') {
        team.mediumRiskProjects += 1;
      } else {
        team.lowRiskProjects += 1;
      }
    });

    return Array.from(teamMap.entries()).map(([teamId, data]) => ({
      teamId,
      teamName: data.teamName,
      projectCount: data.projectCount,
      criticalCount: data.critical,
      highCount: data.high,
      mediumCount: data.medium,
      lowCount: data.low,
      totalVulnerabilities: data.total,
      criticalRiskProjects: data.criticalRiskProjects,
      highRiskProjects: data.highRiskProjects,
      mediumRiskProjects: data.mediumRiskProjects,
      lowRiskProjects: data.lowRiskProjects,
      newLast7Days: data.newLast7Days,
      resolvedLast7Days: data.resolvedLast7Days,
      avgVulnerabilitiesPerProject:
        data.projectCount > 0
          ? Math.round((data.total / data.projectCount) * 100) / 100
          : 0,
    }));
  }

  /**
   * Build top N most vulnerable projects with enhanced data.
   */
  private buildTopVulnerableProjects(
    projectsSummary: ProjectOverviewSummary[],
    limit: number = 10,
  ): TopVulnerableProject[] {
    return projectsSummary
      .sort((a, b) => b.totalVulnerabilities - a.totalVulnerabilities)
      .slice(0, limit)
      .map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        teamName: p.teamName,
        vulnerabilityCount: p.totalVulnerabilities,
        criticalCount: p.criticalCount,
        highCount: p.highCount,
        cyberRiskLevel: p.cyberRiskLevel,
        cyberRiskScore: p.cyberRiskScore,
        openCount: p.openCount,
        newLast7Days: p.newLast7Days,
        teamId: p.teamId,
      }));
  }

  /**
   * Calculate risk distribution from project summaries.
   */
  private calculateRiskDistribution(
    projectsSummary: ProjectOverviewSummary[],
  ): {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    criticalRisk: number;
  } {
    const criticalRisk = projectsSummary.filter(
      (p) => p.cyberRiskLevel === 'critical',
    ).length;
    const highRisk = projectsSummary.filter(
      (p) => p.cyberRiskLevel === 'high',
    ).length;
    const mediumRisk = projectsSummary.filter(
      (p) => p.cyberRiskLevel === 'medium',
    ).length;
    const lowRisk = projectsSummary.filter(
      (p) => p.cyberRiskLevel === 'low',
    ).length;

    return { criticalRisk, highRisk, mediumRisk, lowRisk };
  }

  /**
   * Extract severity counts from the aggregation results.
   */
  private extractSeverityCountsFromAggregation(
    severityAggregation: TotalBySeverity[],
  ): { critical: number; high: number; medium: number; low: number } {
    return {
      critical:
        severityAggregation.find((s) => s.severity.toUpperCase() === 'CRITICAL')
          ?.count || 0,
      high:
        severityAggregation.find((s) => s.severity.toUpperCase() === 'HIGH')
          ?.count || 0,
      medium:
        severityAggregation.find((s) => s.severity.toUpperCase() === 'MEDIUM')
          ?.count || 0,
      low:
        severityAggregation.find((s) => s.severity.toUpperCase() === 'LOW')
          ?.count || 0,
    };
  }

  /**
   * Extract analysis type totals from the aggregation results.
   */
  private extractAnalysisTypeTotals(
    analysisTypeAggregation: TotalByAnalysisType[],
  ): {
    sast: number;
    sca: number;
    iac: number;
    container: number;
    cicd: number;
    secret: number;
  } {
    return {
      sast:
        analysisTypeAggregation.find(
          (a) => a.analysisType.toUpperCase() === 'SAST',
        )?.count || 0,
      sca:
        analysisTypeAggregation.find(
          (a) => a.analysisType.toUpperCase() === 'SCA',
        )?.count || 0,
      iac:
        analysisTypeAggregation.find(
          (a) => a.analysisType.toUpperCase() === 'IAC',
        )?.count || 0,
      container:
        analysisTypeAggregation.find(
          (a) => a.analysisType.toUpperCase() === 'CONTAINER',
        )?.count || 0,
      cicd:
        analysisTypeAggregation.find(
          (a) => a.analysisType.toUpperCase() === 'CICD',
        )?.count || 0,
      secret:
        analysisTypeAggregation.find(
          (a) => a.analysisType.toUpperCase() === 'SECRET',
        )?.count || 0,
    };
  }

  /**
   * Get language distribution across all projects.
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async getLanguageDistribution(
    filterContext: FilterContext,
  ): Promise<LanguageDistribution[]> {
    const { projectIds } = filterContext;
    const languageData = new Map<
      string,
      { vulnCount: number; projects: Set<string> }
    >();

    // Only SAST, IAC, CICD, Secret have language field
    const types: ('sast' | 'iac' | 'cicd' | 'secret')[] = [
      'sast',
      'iac',
      'cicd',
      'secret',
    ];

    const excludedStates = filterContext.includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];

    // Execute all queries in parallel
    const queryPromises = types.map((type) => {
      const repository = this.getRepositoryForType(type);
      const alias = type;

      const qb = repository
        .createQueryBuilder(alias)
        .select(`${alias}.language`, 'language')
        .addSelect(`${alias}.projectId`, 'projectId')
        .addSelect('COUNT(*)', 'count')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.language IS NOT NULL`)
        .andWhere(`${alias}.language != ''`);

      if (excludedStates.length > 0) {
        qb.andWhere(`${alias}.currentState NOT IN (:...excludedStates)`, {
          excludedStates,
        });
      }

      return qb
        .groupBy(`${alias}.language`)
        .addGroupBy(`${alias}.projectId`)
        .getRawMany<{ language: string; projectId: string; count: string }>();
    });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results
    allResults.flat().forEach((item) => {
      if (item.language) {
        if (!languageData.has(item.language)) {
          languageData.set(item.language, {
            vulnCount: 0,
            projects: new Set(),
          });
        }
        const entry = languageData.get(item.language)!;
        entry.vulnCount += Number(item.count);
        entry.projects.add(item.projectId);
      }
    });

    return Array.from(languageData.entries())
      .map(([language, data]) => ({
        language,
        vulnerabilityCount: data.vulnCount,
        projectCount: data.projects.size,
      }))
      .sort((a, b) => b.vulnerabilityCount - a.vulnerabilityCount);
  }

  /**
   * Get vulnerabilities grouped by branch.
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async getVulnerabilitiesByBranch(
    filterContext: FilterContext,
  ): Promise<BranchVulnerabilityCount[]> {
    const { projectIds, includeResolved } = filterContext;
    const branchCounts = new Map<
      string,
      {
        criticalCount: number;
        highCount: number;
        mediumCount: number;
        lowCount: number;
        totalCount: number;
      }
    >();
    const excludedStates = includeResolved
      ? []
      : ['resolved', 'not_exploitable', 'ignored'];

    const types: ('sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret')[] =
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'];

    // Execute all queries in parallel
    const queryPromises = types.map((type) => {
      const repository = this.getRepositoryForType(type);
      const alias = type;
      const qb = repository
        .createQueryBuilder(alias)
        .select(`${alias}.branch`, 'branch')
        .addSelect(effectiveSeveritySql(alias), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.branch IS NOT NULL`)
        .andWhere(`${alias}.branch != ''`);

      if (excludedStates.length > 0) {
        qb.andWhere(`${alias}.currentState NOT IN (:...excludedStates)`, {
          excludedStates,
        });
      }

      return qb
        .groupBy(`${alias}.branch`)
        .addGroupBy(effectiveSeveritySql(alias))
        .getRawMany<{ branch: string; severity: string; count: string }>();
    });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results
    allResults.flat().forEach((item) => {
      if (!item.branch) return;
      if (!branchCounts.has(item.branch)) {
        branchCounts.set(item.branch, {
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          totalCount: 0,
        });
      }
      const counts = branchCounts.get(item.branch)!;
      const count = Number(item.count);
      counts.totalCount += count;
      const severity = item.severity?.toUpperCase();
      if (severity === 'CRITICAL') counts.criticalCount += count;
      else if (severity === 'HIGH') counts.highCount += count;
      else if (severity === 'MEDIUM') counts.mediumCount += count;
      else if (severity === 'LOW') counts.lowCount += count;
    });

    return Array.from(branchCounts.entries())
      .map(([branch, counts]) => ({
        branch,
        ...counts,
      }))
      .sort((a, b) => b.totalCount - a.totalCount);
  }

  /**
   * Calculate mean time to remediate (in days).
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async calculateMeanTimeToRemediate(
    filterContext: FilterContext,
  ): Promise<number> {
    const { projectIds } = filterContext;

    const types: ('sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret')[] =
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'];

    // Execute all queries in parallel
    const queryPromises = types.map((type) => {
      const repository = this.getRepositoryForType(type);
      const alias = type;
      const updateField =
        type === 'sast' ||
        type === 'iac' ||
        type === 'cicd' ||
        type === 'secret'
          ? 'updateAt'
          : 'updatedAt';

      return repository
        .createQueryBuilder(alias)
        .select(
          `AVG(${diffDays(`${alias}.createdAt`, `${alias}.${updateField}`).text})`,
          'avgDays',
        )
        .addSelect('COUNT(*)', 'count')
        .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.currentState IN (:...states)`, {
          states: ['resolved', 'not_exploitable'],
        })
        .getRawOne<{ avgDays: string | null; count: string }>();
    });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results with weighted average
    let totalDays = 0;
    let count = 0;

    allResults.forEach((data) => {
      if (data?.avgDays && Number(data.count) > 0) {
        totalDays += Number(data.avgDays) * Number(data.count);
        count += Number(data.count);
      }
    });

    return count > 0 ? Math.round((totalDays / count) * 10) / 10 : 0;
  }

  /**
   * Build severity comparison between periods (async method that queries data).
   * OPTIMIZED: Uses Promise.all for parallel execution instead of sequential loop.
   */
  private async buildSeverityComparison(
    filterContext: FilterContext,
    comparisonPeriod: string,
  ): Promise<SeverityComparison[]> {
    const { projectIds, analysisTypes } = filterContext;
    const periodDays = this.getPeriodDays(comparisonPeriod);

    const currentEnd = new Date();
    const currentStart = new Date();
    currentStart.setDate(currentStart.getDate() - periodDays);

    const previousEnd = new Date(currentStart);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - periodDays);

    const shouldIncludeType = (type: string) =>
      analysisTypes.length === 0 || analysisTypes.includes(type.toUpperCase());

    const types: ('sast' | 'iac' | 'sca' | 'container' | 'cicd' | 'secret')[] =
      ['sast', 'iac', 'sca', 'container', 'cicd', 'secret'];

    // Build all queries for current and previous periods in parallel
    const queryPromises = types
      .filter((type) => shouldIncludeType(type.toUpperCase()))
      .flatMap((type) => {
        const repository = this.getRepositoryForType(type);
        const alias = type;

        // Current period query
        const currentPromise = repository
          .createQueryBuilder(alias)
          .select(effectiveSeveritySql(alias), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
          .andWhere(`${alias}.createdAt >= :currentStart`, { currentStart })
          .andWhere(`${alias}.createdAt < :currentEnd`, { currentEnd })
          .groupBy(effectiveSeveritySql(alias))
          .getRawMany<{ severity: string; count: string }>()
          .then((data) => ({ period: 'current' as const, data }));

        // Previous period query
        const previousPromise = repository
          .createQueryBuilder(alias)
          .select(effectiveSeveritySql(alias), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where(`${alias}.projectId IN (:...projectIds)`, { projectIds })
          .andWhere(`${alias}.createdAt >= :previousStart`, { previousStart })
          .andWhere(`${alias}.createdAt < :previousEnd`, { previousEnd })
          .groupBy(effectiveSeveritySql(alias))
          .getRawMany<{ severity: string; count: string }>()
          .then((data) => ({ period: 'previous' as const, data }));

        return [currentPromise, previousPromise];
      });

    const allResults = await Promise.all(queryPromises);

    // Aggregate results by period
    const currentCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const previousCounts = { critical: 0, high: 0, medium: 0, low: 0 };

    allResults.forEach((result) => {
      const countsTarget =
        result.period === 'current' ? currentCounts : previousCounts;
      result.data.forEach((item) => {
        const severity = item.severity?.toUpperCase();
        if (severity === 'CRITICAL')
          countsTarget.critical += Number(item.count);
        if (severity === 'HIGH') countsTarget.high += Number(item.count);
        if (severity === 'MEDIUM') countsTarget.medium += Number(item.count);
        if (severity === 'LOW') countsTarget.low += Number(item.count);
      });
    });

    const buildComparison = (
      severity: string,
      current: number,
      previous: number,
    ): SeverityComparison => {
      const changePercentage =
        previous === 0
          ? current > 0
            ? 100
            : 0
          : Math.round(((current - previous) / previous) * 100);
      const trend =
        changePercentage > 0 ? 'up' : changePercentage < 0 ? 'down' : 'stable';
      return {
        severity,
        comparison: {
          currentPeriodCount: current,
          previousPeriodCount: previous,
          changePercentage,
          trend,
        },
      };
    };

    return [
      buildComparison(
        'CRITICAL',
        currentCounts.critical,
        previousCounts.critical,
      ),
      buildComparison('HIGH', currentCounts.high, previousCounts.high),
      buildComparison('MEDIUM', currentCounts.medium, previousCounts.medium),
      buildComparison('LOW', currentCounts.low, previousCounts.low),
    ];
  }

  /**
   * Get period days from comparison period string.
   */
  private getPeriodDays(comparisonPeriod: string): number {
    switch (comparisonPeriod.toLowerCase()) {
      case 'week':
        return 7;
      case 'month':
        return 30;
      case 'quarter':
        return 90;
      default:
        return 7;
    }
  }

  /**
   * Build total comparison between periods.
   */
  private buildTotalComparison(trendStats: TrendStatistics): PeriodComparison {
    const current = trendStats.newIssues;
    const previous = trendStats.newIssuesPreviousPeriod || 0;
    const changePercentage =
      previous === 0
        ? current > 0
          ? 100
          : 0
        : Math.round(((current - previous) / previous) * 100);
    const trend =
      changePercentage > 0 ? 'up' : changePercentage < 0 ? 'down' : 'stable';

    return {
      currentPeriodCount: current,
      previousPeriodCount: previous,
      changePercentage,
      trend,
    };
  }

  /**
   * Build applied filters summary for response.
   */
  private buildAppliedFilters(filterContext: FilterContext): AppliedFilters {
    return {
      projectIds: filterContext.projectIds,
      teamIds: filterContext.teamIds,
      analysisTypes: filterContext.analysisTypes,
      severityFilter: filterContext.severityFilter,
      statusFilter: filterContext.statusFilter,
      dateFrom: filterContext.dateFrom?.toISOString() || '',
      dateTo: filterContext.dateTo?.toISOString() || '',
      languages: [],
      branches:
        filterContext.projectBranchMap.size > 0
          ? Array.from(filterContext.projectBranchMap.entries()).flatMap(
              ([pid, brs]) => brs.map((b) => `${pid}::${b}`),
            )
          : filterContext.branches,
      trendPeriodDays: filterContext.trendPeriodDays,
      includeResolved: filterContext.includeResolved,
    };
  }

  /**
   * Aggregate license distribution across the SCA packages of the scope.
   *
   * One GROUP BY instead of loading every package row: a scope holds tens of
   * thousands of packages but a few dozen distinct license lists (19 009 rows,
   * 68 lists locally). Each distinct list is ranked once, by its riskiest
   * license, and weighted by its count; a NULL or empty list counts as
   * unknown, as before. The branch filter the user picked applies here as in
   * every other block; with none picked, no block filters the branch.
   *
   * The key is MD5(licenses), not the column: the column's collation
   * (utf8mb4_0900_ai_ci) compares case- and accent-insensitively, so a plain
   * GROUP BY would merge ["Ruby"] with ["RUBY"], which rank differently
   * (getLicenseInfo matches the SPDX table exactly, then by pattern). The
   * hash groups byte-exactly, at any length.
   */
  private async aggregateLicenseDistribution(
    filterContext: FilterContext,
  ): Promise<{
    totalPackages: number;
    packagesWithLicenses: number;
    permissiveCount: number;
    weakCopyleftCount: number;
    strongCopyleftCount: number;
    unknownCount: number;
  }> {
    const distribution = {
      totalPackages: 0,
      packagesWithLicenses: 0,
      permissiveCount: 0,
      weakCopyleftCount: 0,
      strongCopyleftCount: 0,
      unknownCount: 0,
    };
    const { projectIds } = filterContext;
    if (projectIds.length === 0) {
      return distribution;
    }

    const qb = this.scaDetectedPackagesRepository
      .createQueryBuilder('pkg')
      .select(anyValue('pkg.licenses').text, 'licenses')
      .addSelect('COUNT(*)', 'cnt')
      .where('pkg.projectId IN (:...projectIds)', { projectIds })
      .groupBy('MD5(pkg.licenses)');
    this.applyBranchFilterQB(qb, 'pkg', filterContext);
    const groups = await qb.getRawMany<{
      licenses: string | null;
      cnt: number | string;
    }>();

    for (const group of groups) {
      // COUNT(*) comes back as a string (bigNumberStrings).
      const count = Number(group.cnt) || 0;
      distribution.totalPackages += count;
      const licenses = this.parseLicenseList(group.licenses);
      if (licenses.length === 0) {
        distribution.unknownCount += count;
        continue;
      }
      distribution.packagesWithLicenses += count;

      switch (this.riskiestLicenseCategory(licenses)) {
        case 'PERMISSIVE':
          distribution.permissiveCount += count;
          break;
        case 'WEAK_COPYLEFT':
          distribution.weakCopyleftCount += count;
          break;
        case 'STRONG_COPYLEFT':
          distribution.strongCopyleftCount += count;
          break;
        default:
          distribution.unknownCount += count;
          break;
      }
    }

    return distribution;
  }

  /**
   * The stored license list, as the entity's transformer reads it: NULL or
   * empty is no license. A value that is not a JSON array of strings (never
   * written by the ingestion) also reads as no license, rather than failing
   * the whole overview.
   */
  private parseLicenseList(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((l): l is string => typeof l === 'string')
        : [];
    } catch {
      return [];
    }
  }

  /** The category of the riskiest license of a package's list. */
  private riskiestLicenseCategory(licenses: string[]): string {
    const categoryOrder = [
      'PERMISSIVE',
      'WEAK_COPYLEFT',
      'STRONG_COPYLEFT',
      'UNKNOWN',
    ];
    let highestCategory = 'PERMISSIVE';
    for (const lic of licenses) {
      const info = getLicenseInfo(lic);
      if (
        categoryOrder.indexOf(info.category) >
        categoryOrder.indexOf(highestCategory)
      ) {
        highestCategory = info.category;
      }
    }
    return highestCategory;
  }
}
