import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { firstValueFrom } from 'rxjs';
import { PolicyViolation } from '@entities/policy-violation.entity';
import {
  PolicyEvaluation,
  EvaluationStatus,
} from '@entities/policy-evaluation.entity';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { ViolationAction } from '@entities/policy-enums';
import { PolicyService } from '../policy/policy.service';
import { wrapGrpcClientWithTracing } from '@core/grpc/traced-grpc-client';
import {
  ProjectServiceClient,
  PROJECT_SERVICE_NAME,
} from '@grpc/global-management/global_management';
import { ReadableProjectSummary } from '@grpc/global-management/project';
import {
  GetOrganizationComplianceOverviewRequest,
  GetOrganizationComplianceOverviewResponse,
  ProjectComplianceSummary,
  ViolationBreakdown,
  ComplianceTrendPoint,
} from '@grpc/policy-management/violation';

/**
 * Case- and accent-insensitive form of a project name, for the overview's
 * search. The project list it used to delegate to matched with MySQL's
 * LOWER(name) LIKE under an accent-insensitive collation.
 */
function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * The sort key of the compliance overview table (blockedCount by default).
 */
function compareSummaries(
  sortBy: string,
  a: ProjectComplianceSummary,
  b: ProjectComplianceSummary,
): number {
  switch (sortBy) {
    case 'warnedCount':
      return a.warnedCount - b.warnedCount;
    case 'totalViolations':
      return a.totalViolations - b.totalViolations;
    case 'lastEvaluatedAt':
      return a.lastEvaluatedAt - b.lastEvaluatedAt;
    case 'projectName':
      return a.projectName.localeCompare(b.projectName);
    case 'blockedCount':
    default:
      return a.blockedCount - b.blockedCount;
  }
}

/**
 * Service for managing policy violations
 */
@Injectable()
export class ViolationService implements OnModuleInit {
  private readonly logger = new Logger(ViolationService.name);
  private projectService: ProjectServiceClient;

  constructor(
    @InjectRepository(PolicyViolation)
    private readonly violationRepository: Repository<PolicyViolation>,
    @InjectRepository(PolicyEvaluation)
    private readonly evaluationRepository: Repository<PolicyEvaluation>,
    @InjectRepository(SecurityPolicy)
    private readonly policyRepository: Repository<SecurityPolicy>,
    @Inject(forwardRef(() => PolicyService))
    private readonly policyService: PolicyService,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.projectService = wrapGrpcClientWithTracing(
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      ),
    );
  }

  /**
   * Get violations for a specific scan.
   * Scoped by projectId so a scanId from another tenant cannot be read (BOLA).
   */
  async getScanViolations(
    scanId: string,
    projectId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{
    violations: PolicyViolation[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [violations, total] = await this.violationRepository.findAndCount({
      where: { scanId, projectId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { violations, total, page, pageSize };
  }

  /**
   * Get all violations for a project
   */
  async getProjectViolations(
    projectId: string,
    options?: {
      page?: number;
      pageSize?: number;
    },
  ): Promise<{
    violations: PolicyViolation[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: FindOptionsWhere<PolicyViolation> = { projectId };

    const page = options?.page || 1;
    const pageSize = options?.pageSize || 20;

    const [violations, total] = await this.violationRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { violations, total, page, pageSize };
  }

  /**
   * Get violation statistics for a project
   */
  async getViolationStats(
    projectId: string,
    options?: {
      organizationId?: string;
      fromDate?: number;
      toDate?: number;
    },
  ): Promise<{
    totalViolations: number;
    blockedCount: number;
    warnedCount: number;
    applicablePoliciesCount: number;
    complianceStatus: string;
  }> {
    // Three counters from one GROUP BY, never the violations themselves
    // (each row carries the jsonb snapshot of every affected vulnerability).
    const countQuery = this.violationRepository
      .createQueryBuilder('v')
      .select('v.actionTaken', 'actionTaken')
      .addSelect('COUNT(*)', 'count')
      .where('v.projectId = :projectId', { projectId });
    if (options?.organizationId) {
      countQuery.andWhere('v.organizationId = :organizationId', {
        organizationId: options.organizationId,
      });
    }
    if (options?.fromDate && options?.toDate) {
      countQuery.andWhere('v.createdAt BETWEEN :fromDate AND :toDate', {
        fromDate: new Date(options.fromDate),
        toDate: new Date(options.toDate),
      });
    }
    countQuery.groupBy('v.actionTaken');

    // The compliance status only needs to know whether the project was ever
    // evaluated and whether an evaluation is still running: the distinct
    // statuses of its evaluations, not two whole rows (resultDetails jsonb
    // included). The three reads are independent, so they run together.
    const [counts, evaluationStatuses, applicablePoliciesCount] =
      await Promise.all([
        countQuery.getRawMany<{ actionTaken: string; count: string }>(),
        this.evaluationRepository
          .createQueryBuilder('e')
          .select('e.status', 'status')
          .distinct(true)
          .where('e.projectId = :projectId', { projectId })
          .getRawMany<{ status: EvaluationStatus }>(),
        this.policyService.getEffectivePolicy(projectId).then(
          ({ appliedPolicies }) => appliedPolicies.length,
          (e: Error) => {
            this.logger.error(
              `Failed to get applicable policies for project ${projectId}: ${e.message}`,
            );
            return 0;
          },
        ),
      ]);

    let totalViolations = 0;
    let blockedCount = 0;
    let warnedCount = 0;
    for (const row of counts) {
      const count = parseInt(row.count, 10);
      totalViolations += count;
      if (row.actionTaken === ViolationAction.BLOCK) {
        blockedCount += count;
      } else if (row.actionTaken === ViolationAction.WARN) {
        warnedCount += count;
      }
    }

    // Pending until a first evaluation exists, and while one is queued or
    // running; then non-compliant as soon as a BLOCK violation is recorded.
    let complianceStatus = 'Compliant';
    const isActive = (status: EvaluationStatus) =>
      status === EvaluationStatus.PENDING ||
      status === EvaluationStatus.IN_PROGRESS;
    if (
      evaluationStatuses.length === 0 ||
      evaluationStatuses.some((row) => isActive(row.status))
    ) {
      complianceStatus = 'Pending';
    } else if (blockedCount > 0) {
      complianceStatus = 'Non-Compliant';
    }

    return {
      totalViolations,
      blockedCount,
      warnedCount,
      applicablePoliciesCount,
      complianceStatus,
    };
  }

  /**
   * Get a single violation by ID
   */
  async getViolation(violationId: string): Promise<PolicyViolation> {
    const violation = await this.violationRepository.findOne({
      where: { id: violationId },
      relations: ['policy'],
    });

    if (!violation) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Violation not found: ${violationId}`,
      });
    }

    return violation;
  }

  /**
   * Get organization-wide compliance overview for CISO dashboard.
   * Provides a comprehensive view of all projects with their compliance status,
   * violation statistics, and trends.
   *
   * Every number covers the projects this user may read, as one
   * global-management projection gives them (the principal filter of the
   * project list, without its paging and its fan-out). The per-project
   * aggregates come from SQL over those projects only; the table is then
   * filtered, sorted and paginated as a whole, so its order, its statuses and
   * its total hold past the first page. The trend reads the evaluations of its
   * window and, per project, the last one before it.
   *
   * Scope: the readable projection is project READ, which includes a team's
   * read_only members, while a project's violations require
   * read_policy_violation, which excludes them. This overview stays within
   * what its caller may see only because the gateway route requires
   * manage_policy (org creator/administrator, who read every project and its
   * violations). Opening the route to read_policy or to a manager needs a
   * narrower project set here first; gateway `policy.controller.spec.ts` pins
   * the gate.
   */
  async getOrganizationComplianceOverview(
    options: GetOrganizationComplianceOverviewRequest,
  ): Promise<GetOrganizationComplianceOverviewResponse> {
    this.logger.log(
      `Getting organization compliance overview for org=${options.organizationId}`,
    );

    const {
      organizationId,
      userId,
      page,
      pageSize,
      fromDate,
      toDate,
      complianceStatusFilter,
      search,
      sortBy = 'blockedCount',
      sortOrder = 'desc',
      timeframe = 'day',
    } = options;

    // Build date parameters for queries
    const dateParams =
      fromDate && toDate
        ? { fromDate: new Date(fromDate), toDate: new Date(toDate) }
        : null;

    // -------------------------------------------------------------------------
    // STEP 1: the projects this user may read, and the org's active policies
    // -------------------------------------------------------------------------
    const [readableProjects, activePoliciesCount] = await Promise.all([
      this.getReadableProjects(organizationId, userId),
      this.policyRepository.count({
        where: { organizationId, isEnabled: true },
      }),
    ]);

    // No readable project: nothing to aggregate
    if (readableProjects.length === 0) {
      return {
        stats: {
          totalProjects: 0,
          compliantProjects: 0,
          nonCompliantProjects: 0,
          pendingProjects: 0,
          totalViolations: 0,
          totalBlocked: 0,
          totalWarned: 0,
          activePoliciesCount,
          complianceRate: 100,
        },
        projects: [],
        violationBreakdown: [],
        trend: [],
        total: 0,
        page,
        pageSize,
      };
    }

    // -------------------------------------------------------------------------
    // STEP 2: aggregate in SQL, over the readable projects only
    // -------------------------------------------------------------------------
    const projectIds = readableProjects.map((p) => p.projectId);
    const daysToFetch =
      timeframe === 'month' ? 90 : timeframe === 'week' ? 60 : 30;
    const trendStartDate = new Date();
    trendStartDate.setDate(trendStartDate.getDate() - daysToFetch);

    const [
      violationCounts,
      latestEvaluations,
      breakdownRows,
      trendStartRows,
      trendWindowRows,
    ] = await Promise.all([
      this.countViolationsByProject(organizationId, projectIds, dateParams),
      this.latestEvaluationByProject(organizationId, projectIds),
      this.countViolationsByRule(organizationId, projectIds, dateParams),
      this.trendEvaluations(organizationId, projectIds, trendStartDate, {
        beforeWindow: true,
      }),
      this.trendEvaluations(organizationId, projectIds, trendStartDate, {
        beforeWindow: false,
      }),
    ]);

    // -------------------------------------------------------------------------
    // STEP 3: one summary per readable project, and the org stats from them
    // -------------------------------------------------------------------------
    const countsByProject = new Map<
      string,
      { blocked: number; warned: number; total: number }
    >();
    for (const row of violationCounts) {
      const current = countsByProject.get(row.projectId) || {
        blocked: 0,
        warned: 0,
        total: 0,
      };
      const count = parseInt(row.count, 10);
      current.total += count;
      if (row.actionTaken === ViolationAction.BLOCK) {
        current.blocked += count;
      } else if (row.actionTaken === ViolationAction.WARN) {
        current.warned += count;
      }
      countsByProject.set(row.projectId, current);
    }
    const evaluationByProject = new Map(
      latestEvaluations.map((e) => [e.projectId, e]),
    );

    const projectSummaries: ProjectComplianceSummary[] = readableProjects.map(
      (project) => {
        const stats = countsByProject.get(project.projectId) || {
          blocked: 0,
          warned: 0,
          total: 0,
        };
        const evaluation = evaluationByProject.get(project.projectId);

        // Pending until a first evaluation, and while the latest one is
        // queued or running; then non-compliant on any BLOCK violation.
        let complianceStatus = 'Compliant';
        if (
          !evaluation ||
          evaluation.status === EvaluationStatus.PENDING ||
          evaluation.status === EvaluationStatus.IN_PROGRESS
        ) {
          complianceStatus = 'Pending';
        } else if (stats.blocked > 0) {
          complianceStatus = 'Non-Compliant';
        }

        return {
          projectId: project.projectId,
          projectName: project.name,
          complianceStatus,
          totalViolations: stats.total,
          blockedCount: stats.blocked,
          warnedCount: stats.warned,
          applicablePoliciesCount: activePoliciesCount,
          lastEvaluatedAt: evaluation
            ? new Date(evaluation.createdAt).getTime()
            : 0,
          lastScanId: evaluation?.scanId || '',
          teamIds: project.teamId ? [project.teamId] : [],
        };
      },
    );

    let compliantCount = 0;
    let nonCompliantCount = 0;
    let totalViolations = 0;
    let totalBlocked = 0;
    let totalWarned = 0;
    for (const summary of projectSummaries) {
      if (summary.complianceStatus === 'Compliant') compliantCount++;
      if (summary.complianceStatus === 'Non-Compliant') nonCompliantCount++;
      totalViolations += summary.totalViolations;
      totalBlocked += summary.blockedCount;
      totalWarned += summary.warnedCount;
    }
    const pendingCount =
      projectSummaries.length - compliantCount - nonCompliantCount;

    // -------------------------------------------------------------------------
    // STEP 4: filter, sort and paginate the whole table; total = filtered count
    // -------------------------------------------------------------------------
    const searchKey = search ? foldForSearch(search) : '';
    const filtered = projectSummaries.filter(
      (summary) =>
        (!complianceStatusFilter ||
          summary.complianceStatus === complianceStatusFilter) &&
        (!searchKey || foldForSearch(summary.projectName).includes(searchKey)),
    );

    const direction = sortOrder === 'desc' ? -1 : 1;
    filtered.sort(
      (a, b) =>
        direction * compareSummaries(sortBy, a, b) ||
        // Stable pages: a fixed order among equal keys
        a.projectName.localeCompare(b.projectName) ||
        a.projectId.localeCompare(b.projectId),
    );

    const size = Math.max(1, pageSize || 0);
    const offset = (Math.max(1, page || 0) - 1) * size;
    const projects = filtered.slice(offset, offset + size);

    // -------------------------------------------------------------------------
    // STEP 5: violation breakdown and compliance trend
    // -------------------------------------------------------------------------
    const breakdownMap = new Map<
      string,
      { count: number; blockedCount: number; warnedCount: number }
    >();
    for (const row of breakdownRows) {
      const current = breakdownMap.get(row.ruleType) || {
        count: 0,
        blockedCount: 0,
        warnedCount: 0,
      };
      const count = parseInt(row.count, 10);
      current.count += count;
      if (row.actionTaken === ViolationAction.BLOCK) {
        current.blockedCount += count;
      } else if (row.actionTaken === ViolationAction.WARN) {
        current.warnedCount += count;
      }
      breakdownMap.set(row.ruleType, current);
    }

    const violationBreakdown: ViolationBreakdown[] = Array.from(
      breakdownMap.entries(),
    ).map(([ruleType, data]) => ({
      ruleType,
      count: data.count,
      blockedCount: data.blockedCount,
      warnedCount: data.warnedCount,
    }));

    // Each project's timeline: its last evaluation before the window (its
    // state on the first day of the trend), then those of the window, in order
    const projectComplianceTimeline = new Map<
      string,
      Array<{ date: Date; hasBlockViolation: boolean }>
    >();
    for (const row of [...trendStartRows, ...trendWindowRows]) {
      const timeline = projectComplianceTimeline.get(row.projectId) || [];
      timeline.push({
        date: new Date(row.createdAt),
        hasBlockViolation: Boolean(row.hasBlock),
      });
      projectComplianceTimeline.set(row.projectId, timeline);
    }

    const trend = this.buildComplianceTrend(
      projectComplianceTimeline,
      readableProjects.length,
      trendStartDate,
      timeframe,
    );

    // -------------------------------------------------------------------------
    // STEP 6: Calculate overall compliance rate and return response
    // -------------------------------------------------------------------------
    const evaluatedProjects = compliantCount + nonCompliantCount;
    const complianceRate =
      evaluatedProjects > 0
        ? Math.round((compliantCount / evaluatedProjects) * 10000) / 100
        : 100;

    return {
      stats: {
        totalProjects: readableProjects.length,
        compliantProjects: compliantCount,
        nonCompliantProjects: nonCompliantCount,
        pendingProjects: pendingCount,
        totalViolations,
        totalBlocked,
        totalWarned,
        activePoliciesCount,
        complianceRate,
      },
      projects,
      violationBreakdown,
      trend,
      total: filtered.length,
      page,
      pageSize,
    };
  }

  /**
   * The (id, name, team) of every project this user may read in the
   * organization: the principal filter of the project list (org creator and
   * administrator see every project, anyone else the projects of their
   * teams, read_only members included), in one projection SELECT. That is
   * wider than read_policy_violation: see getOrganizationComplianceOverview.
   */
  private async getReadableProjects(
    organizationId: string,
    userId: string,
  ): Promise<ReadableProjectSummary[]> {
    try {
      const response = await firstValueFrom(
        this.projectService.getReadableProjectsInOrganization({
          organizationId,
          userId,
        }),
      );
      return response.projects || [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch readable projects for org ${organizationId}: ${(error as Error).message}`,
      );
      throw new RpcException({
        code: GrpcStatus.INTERNAL,
        message: 'Failed to fetch organization projects',
      });
    }
  }

  /**
   * Violations of each project, by action taken.
   */
  private countViolationsByProject(
    organizationId: string,
    projectIds: string[],
    dateParams: { fromDate: Date; toDate: Date } | null,
  ) {
    return this.violationRepository
      .createQueryBuilder('v')
      .select('v.projectId', 'projectId')
      .addSelect('v.actionTaken', 'actionTaken')
      .addSelect('COUNT(*)', 'count')
      .where('v.organizationId = :organizationId', { organizationId })
      .andWhere('v.projectId = ANY(CAST(:projectIds AS uuid[]))', {
        projectIds,
      })
      .andWhere(
        dateParams ? 'v.createdAt BETWEEN :fromDate AND :toDate' : '1=1',
        dateParams || {},
      )
      .groupBy('v.projectId')
      .addGroupBy('v.actionTaken')
      .getRawMany<{ projectId: string; actionTaken: string; count: string }>();
  }

  /**
   * Violations of the projects, by rule and action taken.
   */
  private countViolationsByRule(
    organizationId: string,
    projectIds: string[],
    dateParams: { fromDate: Date; toDate: Date } | null,
  ) {
    return this.violationRepository
      .createQueryBuilder('v')
      .select('v.ruleName', 'ruleType')
      .addSelect('v.actionTaken', 'actionTaken')
      .addSelect('COUNT(*)', 'count')
      .where('v.organizationId = :organizationId', { organizationId })
      .andWhere('v.projectId = ANY(CAST(:projectIds AS uuid[]))', {
        projectIds,
      })
      .andWhere(
        dateParams ? 'v.createdAt BETWEEN :fromDate AND :toDate' : '1=1',
        dateParams || {},
      )
      .groupBy('v.ruleName')
      .addGroupBy('v.actionTaken')
      .getRawMany<{ ruleType: string; actionTaken: string; count: string }>();
  }

  /**
   * The latest evaluation of each project, whatever its status.
   */
  private latestEvaluationByProject(
    organizationId: string,
    projectIds: string[],
  ) {
    return this.evaluationRepository
      .createQueryBuilder('e')
      .select('e.projectId', 'projectId')
      .addSelect('e.scanId', 'scanId')
      .addSelect('e.status', 'status')
      .addSelect('e.createdAt', 'createdAt')
      .distinctOn(['e.projectId'])
      .where('e.organizationId = :organizationId', { organizationId })
      .andWhere('e.projectId = ANY(CAST(:projectIds AS uuid[]))', {
        projectIds,
      })
      .orderBy('e.projectId')
      .addOrderBy('e.createdAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .getRawMany<{
        projectId: string;
        scanId: string;
        status: EvaluationStatus;
        createdAt: Date;
      }>();
  }

  /**
   * Completed evaluations of the trend, with whether their scan holds a BLOCK
   * violation. Inside the window: all of them, oldest first. Before it: the
   * last one of each project only, which is that project's state when the
   * window opens (a project evaluated once, long ago, is still compliant on
   * every day of the trend).
   */
  private trendEvaluations(
    organizationId: string,
    projectIds: string[],
    trendStart: Date,
    { beforeWindow }: { beforeWindow: boolean },
  ) {
    const query = this.evaluationRepository
      .createQueryBuilder('e')
      .select('e.projectId', 'projectId')
      .addSelect('e.createdAt', 'createdAt')
      .addSelect(
        'EXISTS (SELECT 1 FROM policy_violations bv WHERE bv."scanId" = e."scanId" AND bv."organizationId" = :organizationId AND bv."actionTaken" = :block)',
        'hasBlock',
      )
      .where('e.organizationId = :organizationId', { organizationId })
      .andWhere('e.projectId = ANY(CAST(:projectIds AS uuid[]))', {
        projectIds,
      })
      .andWhere('e.status = :completed', {
        completed: EvaluationStatus.COMPLETED,
      })
      .setParameter('block', ViolationAction.BLOCK);

    if (beforeWindow) {
      query
        .andWhere('e.createdAt < :trendStart', { trendStart })
        .distinctOn(['e.projectId'])
        .orderBy('e.projectId')
        .addOrderBy('e.createdAt', 'DESC')
        .addOrderBy('e.id', 'DESC');
    } else {
      query
        .andWhere('e.createdAt >= :trendStart', { trendStart })
        .orderBy('e.createdAt', 'ASC')
        .addOrderBy('e.id', 'ASC');
    }

    return query.getRawMany<{
      projectId: string;
      createdAt: Date;
      hasBlock: boolean;
    }>();
  }

  /**
   * Compliance trend - cumulative snapshot of compliance state per day.
   * For each day, we calculate how many projects were compliant/non-compliant
   * based on their latest evaluation AT THAT POINT IN TIME.
   */
  private buildComplianceTrend(
    projectComplianceTimeline: Map<
      string,
      Array<{ date: Date; hasBlockViolation: boolean }>
    >,
    totalProjectCount: number,
    trendStartDate: Date,
    timeframe: string,
  ): ComplianceTrendPoint[] {
    // Generate trend data points
    const trendPoints: ComplianceTrendPoint[] = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Determine step size based on timeframe
    const stepDays = timeframe === 'month' ? 7 : timeframe === 'week' ? 2 : 1;

    for (
      let d = new Date(trendStartDate);
      d <= today;
      d.setDate(d.getDate() + stepDays)
    ) {
      const snapshotDate = new Date(d);
      snapshotDate.setHours(23, 59, 59, 999);

      let compliantAtDate = 0;
      let nonCompliantAtDate = 0;
      let pendingAtDate = 0;

      // For each project that has evaluations, find its state at this date
      for (const [, timeline] of projectComplianceTimeline) {
        // Find the latest evaluation before or at snapshotDate
        let latestBeforeDate: {
          date: Date;
          hasBlockViolation: boolean;
        } | null = null;

        for (const entry of timeline) {
          if (entry.date <= snapshotDate) {
            latestBeforeDate = entry;
          } else {
            break; // Timeline is sorted, so we can stop
          }
        }

        if (latestBeforeDate) {
          if (latestBeforeDate.hasBlockViolation) {
            nonCompliantAtDate++;
          } else {
            compliantAtDate++;
          }
        }
        // Projects with no evaluation before this date are not counted
        // (they didn't exist or weren't evaluated yet)
      }

      // Projects not in timeline at all are pending
      pendingAtDate = Math.max(
        0,
        totalProjectCount - compliantAtDate - nonCompliantAtDate,
      );

      const totalAtDate =
        compliantAtDate + nonCompliantAtDate + pendingAtDate || 1;
      const rateAtDate = (compliantAtDate / totalAtDate) * 100;

      trendPoints.push({
        date: snapshotDate.getTime(),
        compliantCount: compliantAtDate,
        nonCompliantCount: nonCompliantAtDate,
        pendingCount: pendingAtDate,
        complianceRate: Math.round(rateAtDate * 100) / 100,
      });
    }

    // Aggregate by week or month if needed
    if (timeframe !== 'week' && timeframe !== 'month') {
      return trendPoints;
    }

    const periodMap = new Map<
      string,
      {
        compliant: number;
        nonCompliant: number;
        pending: number;
        count: number;
        latestDate: number;
      }
    >();

    for (const point of trendPoints) {
      const pointDate = new Date(point.date);
      let periodKey: string;

      if (timeframe === 'week') {
        const dayOfWeek = pointDate.getDay();
        const monday = new Date(pointDate);
        monday.setDate(
          pointDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1),
        );
        periodKey = monday.toISOString().split('T')[0];
      } else {
        periodKey = `${pointDate.getFullYear()}-${String(pointDate.getMonth() + 1).padStart(2, '0')}-01`;
      }

      const current = periodMap.get(periodKey) || {
        compliant: 0,
        nonCompliant: 0,
        pending: 0,
        count: 0,
        latestDate: 0,
      };

      // Take the latest point in the period as representative
      if (point.date > current.latestDate) {
        current.compliant = point.compliantCount;
        current.nonCompliant = point.nonCompliantCount;
        current.pending = point.pendingCount;
        current.latestDate = point.date;
      }
      current.count++;
      periodMap.set(periodKey, current);
    }

    return Array.from(periodMap.entries())
      .map(([periodKey, data]) => {
        const total = data.compliant + data.nonCompliant + data.pending || 1;
        const rate = (data.compliant / total) * 100;
        return {
          date: new Date(periodKey).getTime(),
          compliantCount: data.compliant,
          nonCompliantCount: data.nonCompliant,
          pendingCount: data.pending,
          complianceRate: Math.round(rate * 100) / 100,
        };
      })
      .sort((a, b) => a.date - b.date);
  }
}
