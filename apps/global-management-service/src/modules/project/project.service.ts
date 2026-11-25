// src/project/project.service.ts

import { Injectable, Inject, Optional, OnModuleInit } from '@nestjs/common';
import { ulid } from 'ulid';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { castInt, ident } from '@cybedefend/db-dialect';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { Span } from 'nestjs-otel';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

import { Project, ScanSourceType } from 'src/entities/project.entity';
import { Organization } from 'src/entities/organization.entity';
import {
  ProjectBranchIngestion,
  BranchIngestionStatus,
} from 'src/entities/project-branch-ingestion.entity';
import { ArchivedBranch } from 'src/entities/archived-branch.entity';
import {
  ProjectSecurityContext,
  ProjectEnvironment,
  InternetExposure,
  DeploymentType,
  DataClassification,
  BusinessCriticality,
  UserBaseSize,
  NetworkSegmentation,
} from 'src/entities/project-security-context.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { Logger } from 'nestjs-pino';

import {
  ProjectGetRequest,
  ProjectGetAllRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ProjectDeleteRequest,
  PaginatedProjectsAllInformationsResponse,
  PaginatedProjectsResponse,
  ProjectInformationsResponse,
  ProjectLinkedRepository,
  ProjectUpdateResponse,
  ProjectDeleteResponse,
  IssueCountResponse,
  AnalysisTypeResponse,
  MainStatisticsResponse,
  GetOrganizationMainStatisticsRequest,
  GetOrganizationProjectIdsRequest,
  OrganizationProjectIdsResponse,
  GetReadableProjectsRequest,
  ReadableProjectsResponse,
  GetProjectSecurityContextRequest,
  GetProjectSecurityContextResponse,
  UpdateProjectSecurityContextRequest,
  UpdateProjectSecurityContextResponse,
  ProjectSecurityContext as GrpcProjectSecurityContext,
  ProjectEnvironmentEnum,
  InternetExposureEnum,
  DeploymentTypeEnum,
  DataClassificationEnum,
  BusinessCriticalityEnum,
  UserBaseSizeEnum,
  NetworkSegmentationEnum,
  BranchIngestionStatus as GrpcBranchIngestionStatus,
  MarkProjectAppsecRequest,
  MarkProjectAppsecResponse,
} from '@grpc/global-management/project';

/**
 * The read rule of an organization's projects, as raw EXISTS subqueries: the
 * caller is the creator or an administrator of the organization, or a member
 * of the project's team. Their aliases are unknown to the query builder, so
 * TypeORM leaves their columns as written: the camelCase ones are quoted
 * (db-dialect), since PostgreSQL folds an unquoted name to lower case
 * (it answers `column uom.organizationid does not exist`).
 * `team.id` is the builder's own alias, which TypeORM quotes itself.
 */
const quote = (name: string) => ident(name).text;
const PRIVILEGED_MEMBER_EXISTS = `EXISTS (SELECT 1 FROM users_organizations_members uom WHERE ${quote('uom.organizationId')} = :organizationId AND ${quote('uom.userId')} = :userId AND uom.role IN (:...privilegedRoles))`;
const TEAM_MEMBER_EXISTS = `EXISTS (SELECT 1 FROM teams_members tm WHERE ${quote('tm.teamId')} = team.id AND ${quote('tm.userId')} = :userId)`;

/** Defence in depth, whatever the plan: never more projects in one org. */
const ORGANIZATION_PROJECT_HARD_CAP = 1000;

/** Maps TypeORM string enum → numeric protobuf BranchIngestionStatus */
const BRANCH_STATUS_TO_GRPC: Record<string, GrpcBranchIngestionStatus> = {
  parsing: GrpcBranchIngestionStatus.BRANCH_INGESTION_STATUS_PARSING,
  parsed: GrpcBranchIngestionStatus.BRANCH_INGESTION_STATUS_PARSED,
  failed: GrpcBranchIngestionStatus.BRANCH_INGESTION_STATUS_FAILED,
};
import { AuthorizationService } from '../authorization/authorization.service';
import { findProjectWithTeamOrg } from './find-project-with-team-org';
import { mapBranchIngestionToGrpc } from './branch-ingestion.mapper';
import {
  RESULT_SERVICE_NAME,
  ResultServiceClient,
} from '@grpc/analysis-reporting/analysis_reporting';
import {
  GetMainStatisticsResponse,
  GetProjectVulnerabilitiesCountResponse,
} from '@grpc/analysis-reporting/result';
import { GetProjectIntegrationLinkStatusResponse } from '@grpc/external-integrations/external_integrations';
import { GetLastScanStatusResponse } from '@grpc/security-scanning/scan';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import {
  PROJECT_INTEGRATION_STATUS_SERVICE_NAME,
  ProjectIntegrationStatusServiceClient,
} from '@grpc/external-integrations/external_integrations';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { wrapGrpcClientWithTracing } from 'src/core/grpc/traced-grpc-client';
import type { ClientGrpc } from '@nestjs/microservices';
import {
  ENTITLEMENTS_PORT,
  GlobalManagementEntitlementsPort,
} from 'src/edition/ports/entitlements.port';
import {
  PROJECT_SETTINGS_PORT,
  ProjectSettingsPort,
} from 'src/edition/ports/project-settings.port';

// A reference branch is matched against stored scan branches. It once reached
// the SQL of the project-list counts, so a value no git branch
// carries is refused: a quote, a backslash, a control character or `..`.
// The gateway's ProjectUpdateBodyDto applies the same rule: change both
// together.
const REFERENCE_BRANCH_MAX_LENGTH = 191;
const REFERENCE_BRANCH_PATTERN = /^(?!.*\.\.)[^'"\\\u0000-\u001f\u007f]*$/;

// Conservative defaults applied when no security context is provided at
// project creation. Kept in sync with the Skip path in the creation wizard.
const DEFAULT_SECURITY_CONTEXT = {
  environment: ProjectEnvironment.PRODUCTION,
  internetExposure: InternetExposure.PUBLIC,
  deploymentType: DeploymentType.SAAS,
  dataClassification: DataClassification.CONFIDENTIAL,
  handlesPii: false,
  handlesPaymentData: false,
  businessCriticality: BusinessCriticality.MEDIUM,
  userBaseSize: UserBaseSize.MEDIUM,
  complianceFrameworks: [] as string[],
  safetyCritical: false,
  networkSegmentation: NetworkSegmentation.FLAT,
} as const;

/**
 * Projects read and written per round trip by setProjectCyberRiskScores:
 * the backfill pushes up to 500 scores per call.
 */
const SCORE_SYNC_BATCH = 100;

const EMPTY_MAIN_STATISTICS: MainStatisticsResponse = {
  criticalRiskProjects: 0,
  criticalRiskProjectsInLast7Days: 0,
  highRiskProjects: 0,
  highRiskProjectsInLast7Days: 0,
  solvedIssues: 0,
  solvedIssuesInLast7Days: 0,
  newIssues: 0,
  newIssuesInLast7Days: 0,
  criticalIssues: 0,
  highIssues: 0,
  mediumIssues: 0,
  lowIssues: 0,
  agentAnalysesCount: 0,
  agentAutofixCount: 0,
  agentTriageCount: 0,
  agentFalsePositiveCount: 0,
};

/** What getProject keeps from analysis-reporting. */
interface ProjectRiskSummary {
  cyberRiskScore: number;
  cyberRiskLevel: string;
  detectedLanguages: string[];
}

/** The risk summary of a read that skipped, or could not reach, analysis-reporting. */
const noRiskSummary = (): ProjectRiskSummary => ({
  cyberRiskScore: 0,
  cyberRiskLevel: 'none',
  detectedLanguages: [],
});

/** The integration status of a read that skipped, or could not reach, external-integrations. */
const noIntegrationStatus = (): GetProjectIntegrationLinkStatusResponse => ({
  isGithubLinked: false,
  isGitlabLinked: false,
  isJiraLinked: false,
  isLinearLinked: false,
  defaultBranch: '',
  linkedRepository: undefined,
});

/**
 * The gRPC status of a failed client call: a grpc-js ServiceError carries it as
 * `code`, and safeGrpcCall rethrows it inside an RpcException.
 */
function grpcStatusOf(error: unknown): number | undefined {
  const payload: unknown =
    error instanceof RpcException ? error.getError() : error;
  if (typeof payload === 'object' && payload !== null && 'code' in payload) {
    const { code } = payload as { code: unknown };
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

/** Project the analysis-reporting stats DTO into the gRPC response shape. */
function toMainStatisticsResponse(
  s: GetMainStatisticsResponse,
): MainStatisticsResponse {
  return {
    criticalRiskProjects: s.criticalRiskProjects ?? 0,
    criticalRiskProjectsInLast7Days: s.criticalRiskProjectsInLast7Days ?? 0,
    highRiskProjects: s.highRiskProjects ?? 0,
    highRiskProjectsInLast7Days: s.highRiskProjectsInLast7Days ?? 0,
    solvedIssues: s.solvedIssues ?? 0,
    solvedIssuesInLast7Days: s.solvedIssuesInLast7Days ?? 0,
    newIssues: s.newIssues ?? 0,
    newIssuesInLast7Days: s.newIssuesInLast7Days ?? 0,
    criticalIssues: s.criticalIssues ?? 0,
    highIssues: s.highIssues ?? 0,
    mediumIssues: s.mediumIssues ?? 0,
    lowIssues: s.lowIssues ?? 0,
    agentAnalysesCount: s.agentAnalysesCount ?? 0,
    agentAutofixCount: s.agentAutofixCount ?? 0,
    agentTriageCount: s.agentTriageCount ?? 0,
    agentFalsePositiveCount: s.agentFalsePositiveCount ?? 0,
  };
}

@Injectable()
export class ProjectService implements OnModuleInit {
  private resultServiceClient!: ResultServiceClient;
  private scanServiceClient!: ScanServiceClient;
  private projectIntegrationStatusServiceClient!: ProjectIntegrationStatusServiceClient;

  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectBranchIngestion)
    private readonly branchIngestionRepo: Repository<ProjectBranchIngestion>,
    @InjectRepository(ArchivedBranch)
    private readonly archivedBranchRepo: Repository<ArchivedBranch>,
    @InjectRepository(ProjectSecurityContext)
    private readonly securityContextRepo: Repository<ProjectSecurityContext>,
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: Logger,
    private readonly authorizationService: AuthorizationService,
    private readonly purgeLedger: DataPurgeLedger,
    private readonly purgeRunner: DataPurgeRunner,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisClient: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly externalIntegrationClient: ClientGrpc,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: GlobalManagementEntitlementsPort,
    @Inject(PROJECT_SETTINGS_PORT)
    private readonly projectSettings: ProjectSettingsPort,
    @Optional() private readonly realtime?: RealtimeEventPublisher,
  ) {}

  onModuleInit() {
    this.resultServiceClient = wrapGrpcClientWithTracing(
      this.analysisClient.getService<ResultServiceClient>(RESULT_SERVICE_NAME),
    );
    this.scanServiceClient = wrapGrpcClientWithTracing(
      this.securityScanningClient.getService<ScanServiceClient>(
        SCAN_SERVICE_NAME,
      ),
    );
    this.projectIntegrationStatusServiceClient = wrapGrpcClientWithTracing(
      this.externalIntegrationClient.getService<ProjectIntegrationStatusServiceClient>(
        PROJECT_INTEGRATION_STATUS_SERVICE_NAME,
      ),
    );
  }

  @Span()
  async getProject(
    data: ProjectGetRequest,
  ): Promise<ProjectInformationsResponse> {
    const proj = await findProjectWithTeamOrg(this.projectRepo, data.projectId);
    if (!proj) {
      this.logger.warn(`Project not found: ${data.projectId}`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
    }

    // The full read serves the project page. An internal caller
    // that reads only the project's own settings opts out of what it does not
    // read: the score and languages (analysis-reporting), the integration
    // status (external-integrations, which carries defaultBranch) and the
    // security context. Each skipped part reads as absent, like a failed one.
    const skipVulnerabilityStats = data.skipVulnerabilityStats === true;
    const skipIntegrationStatus = data.skipIntegrationStatus === true;
    const skipSecurityContext = data.skipSecurityContext === true;

    // Parsed-branch list, integration link status, risk summary and security
    // context all key off the project id and are independent of each other.
    const [branchIngestions, integrationStatus, riskSummary, securityContext] =
      await Promise.all([
        this.branchIngestionRepo.find({ where: { projectId: proj.id } }),
        skipIntegrationStatus
          ? noIntegrationStatus()
          : safeGrpcCall(
              this.projectIntegrationStatusServiceClient.getProjectIntegrationLinkStatus(
                {
                  projectId: proj.id,
                  organizationId: proj.team.organization.id,
                },
              ),
            ).catch((err) => {
              this.logger.warn(
                `Failed to fetch project integration link status for ${proj.id}: ${err}. Falling back to all-false`,
              );
              return noIntegrationStatus();
            }),
        skipVulnerabilityStats
          ? noRiskSummary()
          : this.readProjectRiskSummary(proj.id),
        skipSecurityContext
          ? null
          : this.securityContextRepo
              .findOne({ where: { projectId: proj.id } })
              .catch(() => null),
      ]);

    // Parsed branches for this project with all required fields.
    const parsedBranches = branchIngestions
      .filter((b) => b.status === BranchIngestionStatus.PARSED)
      .map((b) => ({
        id: b.id,
        projectId: b.projectId,
        branch: b.branch,
        lastParsedScanId: b.lastParsedScanId || '',
        lastParsedAt: b.lastParsedAt ? b.lastParsedAt.toISOString() : '',
        status:
          BRANCH_STATUS_TO_GRPC[b.status] ??
          GrpcBranchIngestionStatus.BRANCH_INGESTION_STATUS_UNSPECIFIED,
        createdAt: b.createdAt ? b.createdAt.toISOString() : '',
        updatedAt: b.updatedAt ? b.updatedAt.toISOString() : '',
      }));

    return this.mapToGrpcProject(
      proj,
      parsedBranches,
      integrationStatus.isGithubLinked,
      integrationStatus.isGitlabLinked,
      riskSummary.cyberRiskScore,
      riskSummary.cyberRiskLevel,
      securityContext ?? undefined,
      integrationStatus.isJiraLinked,
      integrationStatus.defaultBranch ?? '',
      riskSummary.detectedLanguages,
      integrationStatus.linkedRepository ?? undefined,
      integrationStatus.isLinearLinked,
    );
  }

  /**
   * The CybeRisk score (unbounded sum of CVSS-based points,
   * branch-scoped) and the detected languages, from analysis-reporting.
   *
   * Read with GetProjectRiskSummary, which serves only these two
   * fields. An analysis-reporting that predates it answers UNIMPLEMENTED, and
   * the read falls back to GetVulnerabilitiesCount (deploy order: analysis-
   * reporting, then global-management). Any other failure reads as no score,
   * as before.
   */
  private async readProjectRiskSummary(
    projectId: string,
  ): Promise<ProjectRiskSummary> {
    try {
      const summary = await safeGrpcCall(
        this.resultServiceClient.getProjectRiskSummary({ projectId }),
      );
      return {
        cyberRiskScore: summary.cyberRisk?.score ?? 0,
        cyberRiskLevel: summary.cyberRisk?.level ?? 'none',
        detectedLanguages: summary.detectedLanguages ?? [],
      };
    } catch (error) {
      const code = grpcStatusOf(error);
      if (code !== status.UNIMPLEMENTED) {
        this.logger.warn(
          `Failed to fetch project risk summary for ${projectId} (gRPC code ${code}): ${error}. Falling back to no score`,
        );
        return noRiskSummary();
      }
      this.logger.debug(
        `analysis-reporting does not implement GetProjectRiskSummary yet, reading project ${projectId} with GetVulnerabilitiesCount`,
      );
    }

    try {
      const counts = await safeGrpcCall<GetProjectVulnerabilitiesCountResponse>(
        this.resultServiceClient.getVulnerabilitiesCount({ projectId }),
      );
      return {
        cyberRiskScore: counts.cyberRisk?.score ?? 0,
        cyberRiskLevel: counts.cyberRisk?.level ?? 'none',
        detectedLanguages: counts.detectedLanguages ?? [],
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch vulnerability counts for ${projectId} (gRPC code ${grpcStatusOf(error)}): ${error}. Falling back to no score`,
      );
      return noRiskSummary();
    }
  }

  /**
   * Retrieves a paginated list of projects for a given organization,
   * respecting user permissions.
   * - Users with 'creator' or 'administrator' roles in the organization can see all projects.
   * - Other users can only see projects belonging to the teams they are members of.
   * @param data - The request payload containing organization ID, user ID, and pagination options.
   * @returns A promise that resolves to a paginated list of projects with their statistics.
   */
  @Span()
  async getProjectsOrganization(
    data: ProjectGetAllRequest,
  ): Promise<PaginatedProjectsAllInformationsResponse> {
    // Use clear variable names: the gRPC request uses 'teamId' for the organization's ID.
    const {
      teamId: organizationId,
      userId,
      pageNumber: page = 1,
      pageSizeNumber: size = 10,
      searchQuery: q = '',
    } = data;

    if (!userId || !organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A userId and organizationId must be provided.',
      });
    }

    const qb = this.projectRepo
      .createQueryBuilder('project')
      .innerJoinAndSelect('project.team', 'team')
      .innerJoin('team.organization', 'org', 'org.id = :organizationId', {
        organizationId,
      });

    if (q) {
      // Cross-database case-insensitive search: use LOWER(..) LIKE .. (works on MySQL & Postgres)
      qb.andWhere('LOWER(project.name) LIKE :q', { q: `%${q.toLowerCase()}%` });
    }

    qb.andWhere(
      new Brackets((sqb) => {
        sqb.where(PRIVILEGED_MEMBER_EXISTS);
        sqb.orWhere(TEAM_MEMBER_EXISTS);
      }),
    );

    // Set parameters for the security subqueries.
    qb.setParameters({
      ...qb.getParameters(), // Preserve existing parameters (orgId, q)
      userId,
      privilegedRoles: ['creator', 'administrator'],
    });

    // Sort by the denormalized CybeRisk score directly in SQL, then paginate, so
    // the database returns only the requested page (ORDER BY ... LIMIT) — no
    // cross-service call and no whole-org fetch on this hot path. The score
    // column on `project` is kept in sync by analysis-reporting's recompute
    // (best-effort push + worker-boot backfill); it is a SORT KEY ONLY and may be
    // briefly stale — the displayed score below still comes from the live,
    // page-scoped batch. Deterministic tiebreak (name, id) keeps paging stable.
    qb.orderBy('project.cyberRiskScore', 'DESC')
      .addOrderBy('project.name', 'ASC')
      .addOrderBy('project.id', 'ASC')
      .skip((page - 1) * size)
      .take(size);

    // Single round-trip: COUNT + page SELECT in one query.
    const [entities, totalProjects] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalProjects / size);

    const projectIds = entities.map((p) => p.id);

    // Critical-path fan-out: scan status, branch ingestion and integration
    // link status are independent of each other once we have entities[], so
    // they run in one Promise.all. The vulnerability counts wait for the
    // integration status only: analysis-reporting counts each project on the
    // branches its CybeRisk is scoped on, and needs the git default branch for
    // a project without a reference branch. Without it a project would be
    // counted on every branch.
    const emptyVulnCounts: { counts: any[] } = { counts: [] };
    const emptyIntegrationStatus: {
      statuses: Array<{
        projectId: string;
        isGithubLinked: boolean;
        isGitlabLinked: boolean;
        defaultBranch?: string;
      }>;
      isJiraLinked: boolean;
      isLinearLinked: boolean;
    } = {
      statuses: [],
      isJiraLinked: false,
      isLinearLinked: false,
    };
    const integrationStatusPromise =
      entities.length > 0
        ? safeGrpcCall(
            this.projectIntegrationStatusServiceClient.getBatchProjectIntegrationLinkStatus(
              {
                organizationId,
                projectIds,
              },
            ),
          ).catch((err) => {
            this.logger.warn(
              `Failed to fetch batch project integration link status: ${err}. Falling back to empty`,
            );
            return emptyIntegrationStatus;
          })
        : Promise.resolve(emptyIntegrationStatus);
    const vulnCountsPromise =
      entities.length > 0
        ? integrationStatusPromise.then((integrationStatus) => {
            const defaultBranchByProject = new Map(
              (integrationStatus.statuses || []).map((s) => [
                s.projectId,
                s.defaultBranch ?? '',
              ]),
            );
            return safeGrpcCall(
              this.resultServiceClient.getBatchVulnerabilitiesCount({
                projectIds,
                referenceBranches: entities.map((p) => ({
                  projectId: p.id,
                  referenceBranch: p.referenceBranch?.trim() ?? '',
                  defaultBranch: defaultBranchByProject.get(p.id) ?? '',
                })),
              }),
            ).catch((err) => {
              this.logger.warn(
                `Failed to fetch batch vulnerability counts: ${err}. Falling back to empty`,
              );
              return emptyVulnCounts;
            });
          })
        : Promise.resolve(emptyVulnCounts);
    const [
      scanStatusResponse,
      branchRecords,
      vulnCountsResponse,
      integrationStatusResponse,
    ] = await Promise.all([
      entities.length > 0
        ? safeGrpcCall<{
            statuses: { projectId: string; isScanning: boolean }[];
          }>(
            (this.scanServiceClient as any).getProjectsScanStatus({
              projectIds,
            }),
          ).catch((err) => {
            this.logger.warn(
              `Failed to fetch scan status for projects: ${err}. Defaulting to isScanning=false`,
            );
            return { statuses: [] };
          })
        : Promise.resolve({
            statuses: [] as { projectId: string; isScanning: boolean }[],
          }),
      entities.length > 0
        ? this.branchIngestionRepo
            .find({
              where: { projectId: In(projectIds) },
              order: { branch: 'ASC' },
            })
            .catch((err) => {
              this.logger.warn(
                `Failed to fetch branch ingestion records: ${err}. Defaulting to empty arrays`,
              );
              return [] as ProjectBranchIngestion[];
            })
        : Promise.resolve([] as ProjectBranchIngestion[]),
      vulnCountsPromise,
      integrationStatusPromise,
    ]);

    const scanStatusMap = new Map<string, boolean>();
    for (const s of scanStatusResponse.statuses || []) {
      scanStatusMap.set(s.projectId, s.isScanning);
    }

    const branchIngestionMap = new Map<string, any[]>();
    for (const record of branchRecords) {
      const list = branchIngestionMap.get(record.projectId) || [];
      list.push(mapBranchIngestionToGrpc(record));
      branchIngestionMap.set(record.projectId, list);
    }

    // Build maps for O(1) lookup
    const vulnCountsMap = new Map<
      string,
      GetProjectVulnerabilitiesCountResponse
    >();
    for (const count of vulnCountsResponse.counts || []) {
      vulnCountsMap.set(count.projectId, count);
    }

    const githubStatusMap = new Map<string, boolean>();
    const gitlabStatusMap = new Map<string, boolean>();
    for (const status of integrationStatusResponse.statuses || []) {
      githubStatusMap.set(status.projectId, status.isGithubLinked);
      gitlabStatusMap.set(status.projectId, status.isGitlabLinked);
    }
    // Jira and Linear are org-scoped — same value for every project in the response.
    const isJiraLinkedForOrg = integrationStatusResponse.isJiraLinked;
    const isLinearLinkedForOrg = integrationStatusResponse.isLinearLinked;

    // Yield event loop after batch fetches
    await new Promise((resolve) => setImmediate(resolve));

    const projects = entities.map((proj) => {
      const countDto = vulnCountsMap.get(proj.id) || {
        projectId: proj.id,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        analyses: [],
      };

      const issuesCount: IssueCountResponse = {
        critical: countDto.critical,
        high: countDto.high,
        medium: countDto.medium,
        low: countDto.low,
      };

      const analyses: AnalysisTypeResponse[] = (countDto.analyses || []).map(
        (a) => ({
          type: a.type,
          lastScan: a.lastScan,
          source: a.source,
          issuesCount: {
            critical: a.critical,
            high: a.high,
            medium: a.medium,
            low: a.low,
          },
        }),
      );

      // The CybeRisk score (unbounded sum of CVSS-based points,
      // branch-scoped) is computed authoritatively by analysis-reporting. The
      // legacy severity-only formula that used to live here has been removed.
      const cyberRiskScore =
        (countDto as GetProjectVulnerabilitiesCountResponse).cyberRisk?.score ??
        0;
      const cyberRiskLevel =
        (countDto as GetProjectVulnerabilitiesCountResponse).cyberRisk?.level ??
        'none';

      // Get parsed branches for this project (only status=PARSED)
      const allBranches = branchIngestionMap.get(proj.id) || [];
      const parsedBranches = allBranches.filter((b) => b.status === 2); // 2 = PARSED

      // Use pre-fetched GitHub/GitLab link status
      const isGithubLinked = githubStatusMap.get(proj.id) || false;
      const isGitlabLinked = gitlabStatusMap.get(proj.id) || false;

      // Get the lastScan from the countDto (set by analysis-reporting service)
      const lastScan = (countDto as any).lastScan || '';

      return {
        projectId: proj.id,
        teamId: proj.team.id,
        teamName: proj.team.name,
        name: proj.name,
        createdAt: proj.createdAt ? proj.createdAt.toISOString() : '',
        updatedAt: proj.updatedAt ? proj.updatedAt.toISOString() : '',
        cyberRiskLevel,
        cyberRiskScore,
        issuesCount,
        analyses,
        ingestionProjectId: (proj as any).ingestionProjectId || '', // Deprecated, kept for backward compat
        ...this.projectSettings.listFields(proj),
        lastScanSourceType: proj.lastScanSourceType || 'manual',
        isScanning: scanStatusMap.get(proj.id) || false,
        parsedBranches,
        isGithubLinked,
        isGitlabLinked,
        isJiraLinked: isJiraLinkedForOrg,
        isLinearLinked: isLinearLinkedForOrg,
        lastScan,
        referenceBranch: proj.referenceBranch || undefined,
      };
    });

    // The org-wide KPI cards moved off this hot path to
    // GET /organization/:id/main-statistics. The proto field stays present
    // (zeroed) for backward compatibility during rollout; the home page now
    // fetches it separately so the project list returns immediately.
    return {
      projects,
      totalProjects,
      totalPages,
      mainStatistics: EMPTY_MAIN_STATISTICS,
    };
  }

  /**
   * Sets the denormalized CybeRisk score used as the SQL sort key for the
   * organization project list. Called by analysis-reporting's recompute worker
   * (per-recompute push + worker-boot backfill). Idempotent per project; a
   * missing/deleted project is simply not updated. This is NEVER the
   * authoritative score — that lives in analysis-reporting (project_cyber_risk).
   *
   * The backfill pushes every persisted score. The
   * projects are read by batches of SCORE_SYNC_BATCH, three columns each (the
   * id, the stored score, the organization a change is published to), instead
   * of whole with their team and organization; the changed scores of a batch
   * are written by one UPDATE ... CASE instead of one UPDATE each. When a
   * project appears twice in a call, its last score is the one written.
   */
  @Span()
  async setProjectCyberRiskScores(data: {
    items: Array<{ projectId: string; score: number }>;
  }): Promise<{ updated: number }> {
    const scores = new Map<string, number>();
    for (const item of data?.items || []) {
      if (item?.projectId) scores.set(item.projectId, item.score ?? 0);
    }
    if (scores.size === 0) return { updated: 0 };

    const projectIds = [...scores.keys()];
    let updated = 0;
    for (let i = 0; i < projectIds.length; i += SCORE_SYNC_BATCH) {
      const batch = projectIds.slice(i, i + SCORE_SYNC_BATCH);
      const stored = await this.projectRepo
        .createQueryBuilder('project')
        .leftJoin('project.team', 'team')
        .select('project.id', 'id')
        .addSelect('project.cyberRiskScore', 'score')
        .addSelect('team.organizationId', 'organizationId')
        .where('project.id IN (:...batch)', { batch })
        .getRawMany<{
          id: string;
          score: number | string;
          organizationId: string | null;
        }>();

      // Skip no-op writes, and emit a project-list realtime refresh ONLY when
      // a score actually changed. A row whose id is not a pushed id byte for
      // byte (the IN compares with the column's _ci collation) has no score
      // here: its CASE branch would write NULL into a NOT NULL column, so it
      // is skipped, as the previous lookup by id skipped it.
      const changed = stored.filter(
        (row) => scores.has(row.id) && Number(row.score) !== scores.get(row.id),
      );
      if (changed.length === 0) continue;

      const parameters: Record<string, string | number> = {};
      const whens = changed.map((row, index) => {
        parameters[`id${index}`] = row.id;
        parameters[`score${index}`] = scores.get(row.id);
        // The score is cast to an integer: PostgreSQL types the CASE from it.
        return `WHEN :id${index} THEN ${castInt(`:score${index}`).text}`;
      });
      const res = await this.projectRepo
        .createQueryBuilder()
        .update(Project)
        .set({
          cyberRiskScore: () =>
            `CASE ${ident('id').text} ${whens.join(' ')} ELSE cyber_risk_score END`,
        })
        .where('id IN (:...changedIds)', {
          changedIds: changed.map((row) => row.id),
        })
        .setParameters(parameters)
        .execute();
      updated += res.affected ?? 0;

      // The home "/" project list subscribes to the org projects stream and
      // refetches on any PROJECT_STATE_CHANGED, so a changed CybeRisk score
      // must emit one to keep the displayed scores fresh without polling.
      for (const { id: projectId, organizationId } of changed) {
        if (!organizationId) continue;
        void this.realtime?.publish({
          eventId: ulid(),
          type: 'PROJECT_STATE_CHANGED',
          scope: { organizationId, projectId },
          payload: {
            projectStateChanged: {
              projectId,
              changeType: 'cyberrisk_updated',
            },
          },
        });
      }
    }
    return { updated };
  }

  /**
   * Every project ID in an organization — ID-only and unpaginated.
   *
   * SYSTEM SCOPE: there is deliberately NO user filter here (the request has no
   * `userId` to filter on). It is called by analysis-reporting's org-statistics
   * recompute worker, which has no principal. Do NOT reuse it to answer a
   * user's request — see `getReadableProjectsInOrganization` below for the
   * user-scoped projection.
   */
  async getOrganizationProjectIds(
    data: GetOrganizationProjectIdsRequest,
  ): Promise<OrganizationProjectIdsResponse> {
    const rows = await this.projectRepo
      .createQueryBuilder('project')
      .select('project.id', 'id')
      .innerJoin('project.team', 'team')
      .innerJoin('team.organization', 'org', 'org.id = :organizationId', {
        organizationId: data.organizationId,
      })
      .getRawMany<{ id: string }>();
    return { projectIds: rows.map((r) => r.id) };
  }

  /**
   * The (id, name) of every project the CALLER may read in an organization.
   *
   * Same principal filter as {@link getProjectsOrganization} — org
   * creator/administrator sees all, everyone else sees the projects of the
   * teams they belong to — but a single projection SELECT: no `skip`/`take`
   * ceiling, and none of that method's four-way fan-out (scan status, branch
   * ingestion, batch vulnerability counts back into analysis-reporting,
   * integration link status).
   *
   * It exists for the GRC findings export, which must resolve the readable set
   * on EVERY page: paying the home-page loader per page of 50 findings turns a
   * nightly compliance pull into sustained org-wide load, and its page-size
   * ceiling silently drops the projects past it — an invisible hole in an
   * audit-grade export.
   */
  @Span()
  async getReadableProjectsInOrganization(
    data: GetReadableProjectsRequest,
  ): Promise<ReadableProjectsResponse> {
    const { organizationId, userId } = data;

    // Fail closed. A caller that forgets to forward the principal must not be
    // handed the whole organization.
    if (!userId || !organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A userId and organizationId must be provided.',
      });
    }

    const qb = this.projectRepo
      .createQueryBuilder('project')
      .select('project.id', 'projectId')
      .addSelect('project.name', 'name')
      // The GRC export scopes every one of its six UNION branches to this, and
      // it is a plain column here. Resolving it through ProjectService.Get
      // instead would be one gRPC round-trip per project per exported page.
      .addSelect('project.referenceBranch', 'referenceBranch')
      // The second product's home table: the team column, and the dimmed row
      // of a project whose second-product surface is off. Both are on rows
      // already joined.
      .addSelect('team.name', 'teamName')
      // Two teams of an organisation may share a name: the second product's map
      // keys its teams by id, and the organization overview groups and
      // filters its projects by team. On the team row already joined.
      .addSelect('team.id', 'teamId')
      .innerJoin('project.team', 'team')
      .innerJoin('team.organization', 'org', 'org.id = :organizationId', {
        organizationId,
      });

    // The edition's own columns of the summary (none in the Community
    // Edition). This raw projection only: the paginated list loads the whole
    // entity, and a column selected twice there is refused by MySQL inside
    // the DISTINCT pre-query of skip/take.
    for (const [expression, alias] of this.projectSettings.summarySelects()) {
      qb.addSelect(expression, alias);
    }

    qb.andWhere(
      new Brackets((sqb) => {
        sqb.where(PRIVILEGED_MEMBER_EXISTS);
        sqb.orWhere(TEAM_MEMBER_EXISTS);
      }),
    );

    qb.setParameters({
      ...qb.getParameters(),
      organizationId,
      userId,
      privilegedRoles: ['creator', 'administrator'],
    });
    const rows = await qb.getRawMany<{
      projectId: string;
      name: string;
      referenceBranch: string | null;
      teamId?: string | null;
      teamName?: string | null;
    }>();

    return {
      projects: rows.map((r) => ({
        projectId: r.projectId,
        name: r.name || '',
        // Empty means "not configured" on the wire — proto3 has no null, and
        // the consumer's cascade treats empty and unset identically.
        referenceBranch: r.referenceBranch || '',
        teamId: r.teamId || '',
        teamName: r.teamName || '',
        ...this.projectSettings.summaryFields(r),
      })) as ReadableProjectsResponse['projects'],
    };
  }

  /**
   * Home KPI cards, scoped to the projects the caller may read. analysis-reporting
   * serves its persisted organization_statistics row only to a caller who reads
   * every project of the organization.
   *
   * @deprecated the gateway reads them from analysis-reporting itself
   * (gateway ProjectService.getOrganizationMainStatistics, same mapping).
   * Kept so that an older gateway still answers; to be removed with
   * toMainStatisticsResponse and the GetOrganizationMainStatistics RPC.
   */
  @Span()
  async getOrganizationMainStatistics(
    data: GetOrganizationMainStatisticsRequest,
  ): Promise<MainStatisticsResponse> {
    const statsDto = await safeGrpcCall<GetMainStatisticsResponse>(
      // The caller is forwarded so the figures cover only the projects they
      // may read; without it analysis-reporting serves the organization row.
      this.resultServiceClient.getOrganizationStatistics({
        organizationId: data.organizationId,
        userId: data.userId,
      }),
    ).catch((err) => {
      this.logger.warn(
        `Failed to fetch org statistics: ${err}. Falling back to zeros`,
      );
      return undefined;
    });

    return statsDto
      ? toMainStatisticsResponse(statsDto)
      : { ...EMPTY_MAIN_STATISTICS };
  }

  @Span()
  async getProjectsTeam(
    data: ProjectGetAllRequest,
  ): Promise<PaginatedProjectsResponse> {
    const {
      teamId,
      pageNumber = 1,
      pageSizeNumber = 10,
      searchQuery = '',
    } = data;
    const team = await this.teamRepo.findOne({
      where: { id: teamId },
      relations: ['projects', 'organization'],
    });
    if (!team) {
      this.logger.warn(`Team not found: ${teamId}`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }

    let list = team.projects;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    const totalProjects = list.length;
    const totalPages = Math.ceil(totalProjects / pageSizeNumber);
    const start = (pageNumber - 1) * pageSizeNumber;
    const page = list.slice(start, start + pageSizeNumber);

    // Batch fetch unified integration link status (github + gitlab + jira)
    // and vulnerability counts for all projects in the page in parallel.
    const projectIds = page.map((p) => p.id);
    const organizationId = team.organization?.id ?? '';
    const [integrationStatusResponse, vulnCountsResponse] = await Promise.all([
      page.length > 0
        ? safeGrpcCall(
            this.projectIntegrationStatusServiceClient.getBatchProjectIntegrationLinkStatus(
              {
                organizationId,
                projectIds,
              },
            ),
          ).catch((err) => {
            this.logger.warn(
              `Failed to fetch batch project integration link status: ${err}. Falling back to empty`,
            );
            return { statuses: [], isJiraLinked: false, isLinearLinked: false };
          })
        : Promise.resolve({
            statuses: [],
            isJiraLinked: false,
            isLinearLinked: false,
          }),
      page.length > 0
        ? safeGrpcCall(
            this.resultServiceClient.getBatchVulnerabilitiesCount({
              projectIds,
              referenceBranches: [],
            }),
          ).catch((err) => {
            this.logger.warn(
              `Failed to fetch batch vulnerability counts: ${err}. Falling back to empty`,
            );
            return { counts: [] };
          })
        : Promise.resolve({ counts: [] }),
    ]);

    // Build maps for O(1) lookup
    const githubStatusMap = new Map<string, boolean>();
    const gitlabStatusMap = new Map<string, boolean>();
    for (const status of integrationStatusResponse.statuses || []) {
      githubStatusMap.set(status.projectId, status.isGithubLinked);
      gitlabStatusMap.set(status.projectId, status.isGitlabLinked);
    }
    const isJiraLinkedForOrg = integrationStatusResponse.isJiraLinked;
    const isLinearLinkedForOrg = integrationStatusResponse.isLinearLinked;

    const vulnCountsMap = new Map<string, any>();
    for (const count of vulnCountsResponse.counts || []) {
      vulnCountsMap.set(count.projectId, count);
    }

    const projects: ProjectInformationsResponse[] = page.map((proj) => {
      const isGithubLinked = githubStatusMap.get(proj.id) || false;
      const isGitlabLinked = gitlabStatusMap.get(proj.id) || false;
      const countDto = vulnCountsMap.get(proj.id);
      // Reuse the authoritative CybeRisk score from analysis-reporting.
      const cyberRiskScore = countDto?.cyberRisk?.score ?? 0;
      const cyberRiskLevel = countDto?.cyberRisk?.level ?? 'none';
      return this.mapToGrpcProject(
        proj,
        [],
        isGithubLinked,
        isGitlabLinked,
        cyberRiskScore,
        cyberRiskLevel,
        undefined,
        isJiraLinkedForOrg,
        '',
        [],
        undefined,
        isLinearLinkedForOrg,
      );
    });

    return { projects, totalProjects, totalPages };
  }

  @Span()
  async createProject(
    data: ProjectCreateRequest,
  ): Promise<ProjectInformationsResponse> {
    // The space the project is created from, one of the edition's products.
    // "appsec" makes it an AppSec project at once and checks the AppSec
    // project limit; another product, or nothing (an older caller), does
    // neither.
    const product = data.product || undefined;
    const products = this.projectSettings.products();
    if (product !== undefined && !products.includes(product)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `product must be ${products.join(' or ')}`,
      });
    }
    const isAppsec = product === 'appsec';

    const exists = await this.projectRepo.findOne({
      where: { name: data.name, team: { id: data.teamId } },
    });
    if (exists) {
      this.logger.warn(
        `Project already exists: ${data.name} in team ${data.teamId}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'Project already exists',
      });
    }

    const team = await this.teamRepo.findOne({
      where: { id: data.teamId },
      relations: ['organization'],
    });
    if (!team) {
      this.logger.warn(`Team not found: ${data.teamId}`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }
    if (!team.organization) {
      this.logger.warn(`Organization missing for team: ${data.teamId}`);
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Team has no organization',
      });
    }

    // Resolve the plan-based project limit BEFORE entering the locked
    // transaction. The gRPC roundtrip to billing can be slow (~50ms),
    // and plan changes are not high-frequency — there is no value in
    // serializing this call behind the org lock. The actual count
    // comparison happens inside the transaction below, so a stale plan
    // value here cannot cause an over-quota insert (the in-tx count is
    // re-read after the lock is acquired).
    // Only an AppSec project weighs on the AppSec plan: a second-product project
    // asks billing nothing (its organisation may have no AppSec at all).
    const planProjectLimit = isAppsec
      ? await this.resolvePlanProjectLimit(team.organization.id)
      : Number.POSITIVE_INFINITY;

    const creator = await this.userRepo.findOne({
      where: { id: data.creatorId },
    });
    if (!creator) {
      this.logger.warn(`Creator not found: ${data.creatorId}`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Creator not found',
      });
    }

    const proj = new Project();
    proj.name = data.name;
    proj.team = team;
    proj.creator = creator;
    proj.iacEnabled = true;
    proj.sastEnabled = true;
    proj.scaEnabled = true;
    proj.scaTransitiveDependenciesEnabled = false;
    proj.scaDevelopmentDependenciesEnabled = false;
    proj.sastSeverities = ['critical', 'high', 'medium', 'low'];
    proj.scaSeverities = ['critical', 'high', 'medium', 'low'];
    proj.iacSeverities = ['critical', 'high', 'medium', 'low'];
    proj.containerSeverities = ['critical', 'high', 'medium', 'low'];
    proj.secretSeverities = ['critical', 'high', 'medium', 'low'];
    proj.containerEnabled = true;
    proj.secretEnabled = true;
    proj.scaTransitiveDependenciesEnabled = true;
    proj.scaDevelopmentDependenciesEnabled = true;
    proj.scaReachabilityPriorityEnabled = true;
    proj.scaReachabilityStatusEnabled = true;
    proj.monthlyReportEnabled = true;
    proj.weeklyReportEnabled = true;
    proj.emailAlertEnabled = true;
    proj.appsecEnabledAt = isAppsec ? new Date() : null;
    // The edition's own settings (none in the Community Edition).
    Object.assign(
      proj,
      this.projectSettings.creationColumns(
        data as unknown as Record<string, unknown>,
      ),
    );

    // Notification preferences defaults
    proj.notifSeverityThreshold = ['critical', 'high'];
    proj.notifScannerTypes = ['sast', 'sca', 'iac', 'container'];
    proj.zeroDaySeverityThreshold = ['critical', 'high'];

    // Issue integration settings (disabled by default)
    proj.githubIssueEnabled = data.githubIssueEnabled ?? true;
    proj.gitlabIssueEnabled = data.gitlabIssueEnabled ?? true;
    proj.issueCreationMode =
      (data as any).issueCreationMode ?? 'per_vulnerability_type';
    // Issue creation branches (empty: no GitHub/GitLab issue is created)
    proj.issueCreationBranches =
      (data as any).issueCreationBranches?.length > 0
        ? (data as any).issueCreationBranches
        : null;

    // Active SAST agent categories by default
    proj.agentCategoriesSast = [
      'sql_injection',
      'path_and_file_manipulation',
      'redos',
      'xss',
      'ldap_injection',
      'code_injection',
      'xxe',
      'ssrf',
      'nosql_injection',
      'unsafe_deserialization',
      'open_redirect',
      'os_command_injection',
    ];

    // Active IAC agent categories by default
    proj.agentCategoriesIac = [
      'volume_mounts',
      'service_account',
      'security_context',
      'liveness',
      'resource_limits',
    ];

    // Active CICD agent categories by default
    proj.agentCategoriesCicd = ['cicd_security'];

    // Persist Project + ProjectSecurityContext atomically and serialize
    // concurrent createProject calls under the same organization to
    // close the TOCTOU race that would let N parallel requests bypass the
    // plan project limit: the count and the insert must hold one lock.
    //
    // Order matters:
    //  1. SELECT ... FOR UPDATE on the organization row — this is the
    //     serialization point. Any other createProject targeting the
    //     same org blocks here until our tx commits/rolls back.
    //  2. Re-count projects under the org via the transactional
    //     EntityManager. The lock above guarantees this count cannot
    //     change underneath us.
    //  3. Compare to the plan limit; reject if exceeded.
    //  4. Insert Project + SecurityContext.
    const orgId = team.organization.id;
    const saved = await this.dataSource.transaction(async (manager) => {
      // Step 1: lock the organization row. setLock('pessimistic_write')
      // → MySQL SELECT ... FOR UPDATE. orgId comes from a UUID-validated
      // path param and is passed through TypeORM's parameterized
      // `where` option (not raw SQL string interpolation).
      const lockedOrg = await manager.findOne(Organization, {
        where: { id: orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrg) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Organization not found',
        });
      }

      // Step 2: count projects in the locked org. Concurrent
      // createProject calls under the same org wait on the lock above,
      // so this count is consistent with the post-insert state we will
      // produce in step 4.
      const inTxCount = await manager.count(Project, {
        where: { team: { organization: { id: orgId } } },
      });

      // Step 3: enforce the plan limit using the in-tx count of the AppSec
      // projects (second-product projects never count). The plan
      // limit was resolved before entering the transaction (see comment
      // upstream) — that's safe because the count is fresh under lock.
      if (isAppsec && Number.isFinite(planProjectLimit)) {
        const appsecCount = await this.countAppsecProjects(manager, orgId);
        if (appsecCount >= planProjectLimit) {
          this.logger.warn(
            { orgId, count: appsecCount, limit: planProjectLimit },
            'Project limit reached by plan (in-tx check)',
          );
          throw new RpcException({
            code: status.RESOURCE_EXHAUSTED,
            message: 'Project limit reached for current plan',
          });
        }
      }

      // Hard cap as defense in depth — even if billing returns an
      // unbounded limit, never let a single org accumulate more than
      // 1000 projects (of any space) without explicit operator action.
      if (inTxCount >= ORGANIZATION_PROJECT_HARD_CAP) {
        this.logger.warn(
          `Project limit reached: ${inTxCount} for organization ${orgId}`,
        );
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: 'Project limit reached for current plan',
        });
      }

      // Step 4: insert Project then SecurityContext. The lock is held
      // until this transaction commits, so a sibling tx can only
      // proceed after our row is visible — its in-tx count will then
      // include our new project.
      const persisted = await manager.save(Project, proj);
      const secCtx = this.buildSecurityContextForCreation(
        persisted.id,
        data.securityContext,
      );
      await manager.save(ProjectSecurityContext, secCtx);
      return persisted;
    });

    try {
      await this.authorizationService.addProjectRelation({
        projectId: saved.id,
        teamId: data.teamId,
        organizationId: team.organization.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to create IAM relation for project ${saved.id}: ${err}`,
      );
      // ON DELETE CASCADE on the FK cleans up ProjectSecurityContext as well.
      await this.projectRepo.delete(saved.id);
      this.logger.error(
        `Project ${saved.id} deleted due to IAM relation failure during creation`,
      );
      throw err;
    }

    this.logger.log(
      `Project ${saved.id} created successfully in team ${data.teamId}`,
    );
    void this.realtime?.publish({
      eventId: ulid(),
      type: 'PROJECT_STATE_CHANGED',
      scope: { organizationId: team.organization.id, projectId: saved.id },
      payload: {
        projectStateChanged: { projectId: saved.id, changeType: 'created' },
      },
    });
    return this.mapToGrpcProject(saved);
  }

  /**
   * Resolve the plan-based project limit for an organization via the
   * Billing service. Returns POSITIVE_INFINITY when the plan is
   * unbounded (projectLimit = -1) or when billing is unavailable, so
   * the caller can use a single Number.isFinite() guard at the
   * comparison site.
   *
   * NOTE: This is intentionally called OUTSIDE the
   * pessimistic_write transaction in createProject — the gRPC call
   * can take ~50ms and there is no point holding the row lock during
   * a network roundtrip. The actual count vs limit comparison happens
   * inside the locked transaction, so a stale plan value here cannot
   * cause an over-quota insert.
   */
  private async resolvePlanProjectLimit(orgId: string): Promise<number> {
    try {
      const { projectLimit } = await this.entitlements.getSubscription(orgId);
      return projectLimit === -1
        ? Number.POSITIVE_INFINITY
        : Number(projectLimit);
    } catch (e) {
      // Propagate gRPC errors as RpcException; on internal issues, be
      // safe and allow creation but log loudly.
      if (e instanceof RpcException) throw e;
      this.logger.warn(
        { err: (e as any)?.message },
        'Project limit check failed; allowing creation',
      );
      return Number.POSITIVE_INFINITY;
    }
  }

  /**
   * The organisation's AppSec projects, counted on the caller's transaction
   * (which holds the organisation row lock).
   */
  private countAppsecProjects(
    manager: EntityManager,
    orgId: string,
  ): Promise<number> {
    return manager.count(Project, {
      where: {
        team: { organization: { id: orgId } },
        appsecEnabledAt: Not(IsNull()),
      },
    });
  }

  /**
   * A project becomes an AppSec project the first
   * time AppSec analyses it, when the AppSec project limit allows. Called by
   * security-scanning before a full scan. Idempotent.
   *
   * Same serialisation as createProject: the plan limit is read outside the
   * transaction, then the organisation row is locked, the AppSec projects
   * counted and the mark written by one conditional UPDATE (only a project
   * not yet AppSec is written), so concurrent marks or creations in one
   * organisation can never exceed the limit.
   */
  @Span()
  async markProjectAppsec(
    data: MarkProjectAppsecRequest,
  ): Promise<MarkProjectAppsecResponse> {
    const project = await this.projectRepo.findOne({
      where: { id: data.projectId },
      relations: ['team', 'team.organization'],
    });
    if (!project || !project.team?.organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
    }
    if (project.appsecEnabledAt) {
      return {
        appsec: true,
        alreadyAppsec: true,
        limitReached: false,
        projectLimit: 0,
        appsecProjectCount: 0,
      };
    }

    const orgId = project.team.organization.id;
    const planProjectLimit = await this.resolvePlanProjectLimit(orgId);
    const projectLimit = Number.isFinite(planProjectLimit)
      ? planProjectLimit
      : -1;

    return this.dataSource.transaction(async (manager) => {
      const lockedOrg = await manager.findOne(Organization, {
        where: { id: orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrg) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Organization not found',
        });
      }

      const appsecProjectCount = await this.countAppsecProjects(manager, orgId);
      if (
        Number.isFinite(planProjectLimit) &&
        appsecProjectCount >= planProjectLimit
      ) {
        this.logger.warn(
          {
            orgId,
            projectId: project.id,
            count: appsecProjectCount,
            limit: planProjectLimit,
          },
          'AppSec project limit reached, project not marked AppSec',
        );
        return {
          appsec: false,
          alreadyAppsec: false,
          limitReached: true,
          projectLimit,
          appsecProjectCount,
        };
      }

      const result = await manager.update(
        Project,
        { id: project.id, appsecEnabledAt: IsNull() },
        { appsecEnabledAt: new Date() },
      );
      // Zero rows: a concurrent mark got there first, already counted.
      const marked = (result?.affected ?? 0) > 0;
      return {
        appsec: true,
        alreadyAppsec: !marked,
        limitReached: false,
        projectLimit,
        appsecProjectCount: marked
          ? appsecProjectCount + 1
          : appsecProjectCount,
      };
    });
  }

  /**
   * Build the ProjectSecurityContext entity for a freshly created project.
   *
   * Conservative defaults are applied for any field not provided by the
   * client. isCustomized is always true at creation: by going through the
   * creation wizard the user has implicitly accepted (defaults) or
   * explicitly tuned the context, so the "not configured" banner must not
   * appear on the project page afterwards. The legacy backfilled rows
   * keep isCustomized=false until they are edited via updateProjectSecurityContext.
   */
  private buildSecurityContextForCreation(
    projectId: string,
    input?: ProjectCreateRequest['securityContext'],
  ): ProjectSecurityContext {
    const ctx = new ProjectSecurityContext();
    ctx.projectId = projectId;
    ctx.environment = DEFAULT_SECURITY_CONTEXT.environment;
    ctx.internetExposure = DEFAULT_SECURITY_CONTEXT.internetExposure;
    ctx.deploymentType = DEFAULT_SECURITY_CONTEXT.deploymentType;
    ctx.dataClassification = DEFAULT_SECURITY_CONTEXT.dataClassification;
    ctx.handlesPii = DEFAULT_SECURITY_CONTEXT.handlesPii;
    ctx.handlesPaymentData = DEFAULT_SECURITY_CONTEXT.handlesPaymentData;
    ctx.businessCriticality = DEFAULT_SECURITY_CONTEXT.businessCriticality;
    ctx.userBaseSize = DEFAULT_SECURITY_CONTEXT.userBaseSize;
    ctx.complianceFrameworks = [
      ...DEFAULT_SECURITY_CONTEXT.complianceFrameworks,
    ];
    ctx.safetyCritical = DEFAULT_SECURITY_CONTEXT.safetyCritical;
    ctx.networkSegmentation = DEFAULT_SECURITY_CONTEXT.networkSegmentation;

    if (input) {
      if (input.environment !== undefined) {
        ctx.environment = this.protoEnvToEntity(input.environment);
      }
      if (input.internetExposure !== undefined) {
        ctx.internetExposure = this.protoExposureToEntity(
          input.internetExposure,
        );
      }
      if (input.deploymentType !== undefined) {
        ctx.deploymentType = this.protoDeploymentToEntity(input.deploymentType);
      }
      if (input.dataClassification !== undefined) {
        ctx.dataClassification = this.protoDataClassToEntity(
          input.dataClassification,
        );
      }
      if (input.handlesPii !== undefined) {
        ctx.handlesPii = input.handlesPii;
      }
      if (input.handlesPaymentData !== undefined) {
        ctx.handlesPaymentData = input.handlesPaymentData;
      }
      if (input.businessCriticality !== undefined) {
        ctx.businessCriticality = this.protoCriticalityToEntity(
          input.businessCriticality,
        );
      }
      if (input.userBaseSize !== undefined) {
        ctx.userBaseSize = this.protoUserBaseSizeToEntity(input.userBaseSize);
      }
      if (input.complianceFrameworks && input.complianceFrameworks.length > 0) {
        ctx.complianceFrameworks = input.complianceFrameworks;
      }
      if (input.safetyCritical !== undefined) {
        ctx.safetyCritical = input.safetyCritical;
      }
      if (input.networkSegmentation !== undefined) {
        ctx.networkSegmentation = this.protoNetworkSegToEntity(
          input.networkSegmentation,
        );
      }
    }

    ctx.isCustomized = true;
    return ctx;
  }

  private matchesSecurityContextDefaults(ctx: ProjectSecurityContext): boolean {
    return (
      ctx.environment === DEFAULT_SECURITY_CONTEXT.environment &&
      ctx.internetExposure === DEFAULT_SECURITY_CONTEXT.internetExposure &&
      ctx.deploymentType === DEFAULT_SECURITY_CONTEXT.deploymentType &&
      ctx.dataClassification === DEFAULT_SECURITY_CONTEXT.dataClassification &&
      ctx.handlesPii === DEFAULT_SECURITY_CONTEXT.handlesPii &&
      ctx.handlesPaymentData === DEFAULT_SECURITY_CONTEXT.handlesPaymentData &&
      ctx.businessCriticality ===
        DEFAULT_SECURITY_CONTEXT.businessCriticality &&
      ctx.userBaseSize === DEFAULT_SECURITY_CONTEXT.userBaseSize &&
      (ctx.complianceFrameworks?.length ?? 0) === 0 &&
      ctx.safetyCritical === DEFAULT_SECURITY_CONTEXT.safetyCritical &&
      ctx.networkSegmentation === DEFAULT_SECURITY_CONTEXT.networkSegmentation
    );
  }

  @Span()
  async updateProject(
    data: ProjectUpdateRequest,
  ): Promise<ProjectUpdateResponse> {
    const proj = await findProjectWithTeamOrg(this.projectRepo, data.projectId);
    if (!proj) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
    }

    // Snapshot the reference branch BEFORE applying the update so we
    // can detect an actual change after the save and trigger a (branch-scoped)
    // CyberRisk recompute in analysis-reporting.
    const previousReferenceBranch = proj.referenceBranch ?? null;

    if (data.name !== undefined && data.name !== '') {
      // Same rule as creation: two projects of a team never share a name.
      if (data.name !== proj.name) {
        const taken = await this.projectRepo.findOne({
          where: {
            name: data.name,
            team: { id: proj.team?.id },
            id: Not(proj.id),
          },
        });
        if (taken) {
          throw new RpcException({
            code: status.ALREADY_EXISTS,
            message: 'Project already exists',
          });
        }
      }
      proj.name = data.name;
    }
    if (data.applicationType !== undefined && data.applicationType !== '') {
      proj.applicationType = data.applicationType;
    }
    if (data.analysisFrequency !== undefined && data.analysisFrequency !== '') {
      proj.analysisFrequency = data.analysisFrequency;
    }
    if (
      data.incidentCreationOption !== undefined &&
      data.incidentCreationOption !== ''
    ) {
      proj.incidentCreationOption = data.incidentCreationOption;
    }

    if (data.emailAlertEnabled !== undefined) {
      proj.emailAlertEnabled = data.emailAlertEnabled;
    }
    if (data.monthlyReportEnabled !== undefined) {
      proj.monthlyReportEnabled = data.monthlyReportEnabled;
    }
    if (data.weeklyReportEnabled !== undefined) {
      proj.weeklyReportEnabled = data.weeklyReportEnabled;
    }
    if (data.sastEnabled !== undefined) {
      proj.sastEnabled = data.sastEnabled;
    }
    if (data.dastEnabled !== undefined) {
      proj.dastEnabled = data.dastEnabled;
    }
    if (data.scaEnabled !== undefined) {
      proj.scaEnabled = data.scaEnabled;
    }
    if (data.containerEnabled !== undefined) {
      proj.containerEnabled = data.containerEnabled;
    }
    if (data.apiEnabled !== undefined) {
      proj.apiEnabled = data.apiEnabled;
    }
    if (data.iacEnabled !== undefined) {
      proj.iacEnabled = data.iacEnabled;
    }
    if (data.secretEnabled !== undefined) {
      proj.secretEnabled = data.secretEnabled;
    }
    if (data.scanOnCommitEnabled !== undefined) {
      proj.scanOnCommitEnabled = data.scanOnCommitEnabled;
    }
    if (data.sastFastScanEnabled !== undefined) {
      proj.sastFastScanEnabled = data.sastFastScanEnabled;
    }
    // Diff-scan default minimum severity (validated allow-list).
    if (data.diffScanMinSeverity !== undefined && data.diffScanMinSeverity) {
      const allowed = ['info', 'low', 'medium', 'high', 'critical'];
      const v = data.diffScanMinSeverity.toLowerCase();
      if (allowed.includes(v)) {
        proj.diffScanMinSeverity = v;
      }
    }
    if (data.scaTransitiveDependenciesEnabled !== undefined) {
      proj.scaTransitiveDependenciesEnabled =
        data.scaTransitiveDependenciesEnabled;
    }
    if (data.scaDevelopmentDependenciesEnabled !== undefined) {
      proj.scaDevelopmentDependenciesEnabled =
        data.scaDevelopmentDependenciesEnabled;
    }
    if (data.scaReachabilityPriorityEnabled !== undefined) {
      proj.scaReachabilityPriorityEnabled = data.scaReachabilityPriorityEnabled;
    }
    if (data.scaReachabilityStatusEnabled !== undefined) {
      proj.scaReachabilityStatusEnabled = data.scaReachabilityStatusEnabled;
    }
    // The edition's own settings (none in the Community Edition).
    Object.assign(
      proj,
      this.projectSettings.updateColumns(
        data as unknown as Record<string, unknown>,
      ),
    );

    // Update the arrays only when they are defined and non-empty
    if (data.sastSeverities !== undefined && data.sastSeverities.length > 0) {
      proj.sastSeverities = data.sastSeverities;
    }
    if (data.scaSeverities !== undefined && data.scaSeverities.length > 0) {
      proj.scaSeverities = data.scaSeverities;
    }
    if (data.iacSeverities !== undefined && data.iacSeverities.length > 0) {
      proj.iacSeverities = data.iacSeverities;
    }
    if (
      data.containerSeverities !== undefined &&
      data.containerSeverities.length > 0
    ) {
      proj.containerSeverities = data.containerSeverities;
    }
    if (
      data.secretSeverities !== undefined &&
      data.secretSeverities.length > 0
    ) {
      proj.secretSeverities = data.secretSeverities;
    }

    // SAST Agent categories update (full replacement semantics)
    const agentCategoriesSastInput = (data as any).agentCategoriesSast as
      | string[]
      | undefined;
    if (agentCategoriesSastInput && agentCategoriesSastInput.length > 0) {
      // normalize: trim + lowercase
      const normalized = Array.from(
        new Set(
          agentCategoriesSastInput.map((c: string) => c.trim().toLowerCase()),
        ),
      ).filter((c) => !!c);
      if (normalized.length === 0) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'agentCategoriesSast must contain at least one category',
        });
      }
      // We cannot validate existence here without categories table in this service; assume validated upstream (UI) / later enrichment.
      proj.agentCategoriesSast = normalized as string[];
    }

    // IAC Agent categories update (full replacement semantics)
    const agentCategoriesIacInput = (data as any).agentCategoriesIac as
      | string[]
      | undefined;
    if (agentCategoriesIacInput && agentCategoriesIacInput.length > 0) {
      // normalize: trim + lowercase
      const normalized = Array.from(
        new Set(
          agentCategoriesIacInput.map((c: string) => c.trim().toLowerCase()),
        ),
      ).filter((c) => !!c);
      if (normalized.length === 0) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'agentCategoriesIac must contain at least one category',
        });
      }
      // We cannot validate existence here without categories table in this service; assume validated upstream (UI) / later enrichment.
      proj.agentCategoriesIac = normalized as string[];
    }

    // CICD Agent categories (full replacement). As for the issue-creation
    // branches, an empty list is "no change" (callers that do not mean to touch
    // the setting send one), and disabling the analysis takes the explicit
    // flag.
    const agentCategoriesCicdInput = data.agentCategoriesCicd;
    if (data.clearAgentCategoriesCicd) {
      proj.agentCategoriesCicd = null;
    } else if (agentCategoriesCicdInput?.length > 0) {
      // normalize: trim + lowercase
      const normalized = Array.from(
        new Set(
          agentCategoriesCicdInput.map((c: string) => c.trim().toLowerCase()),
        ),
      ).filter((c) => !!c);
      if (normalized.length === 0) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'agentCategoriesCicd must contain at least one category',
        });
      }
      proj.agentCategoriesCicd = normalized;
    }

    // Update lastScanSourceType if provided (used when starting a scan)
    if ((data as any).lastScanSourceType !== undefined) {
      const sourceType = (data as any).lastScanSourceType as string;
      if (
        sourceType &&
        Object.values(ScanSourceType).includes(sourceType as ScanSourceType)
      ) {
        proj.lastScanSourceType = sourceType as ScanSourceType;
      }
    }

    // Issue integration settings update
    if ((data as any).githubIssueEnabled !== undefined) {
      proj.githubIssueEnabled = (data as any).githubIssueEnabled;
    }
    if ((data as any).gitlabIssueEnabled !== undefined) {
      proj.gitlabIssueEnabled = (data as any).gitlabIssueEnabled;
    }
    if (
      (data as any).issueCreationMode !== undefined &&
      (data as any).issueCreationMode !== ''
    ) {
      const mode = (data as any).issueCreationMode;
      if (
        ['per_vulnerability', 'per_vulnerability_type', 'per_file'].includes(
          mode,
        )
      ) {
        proj.issueCreationMode = mode;
      }
    }
    // Issue creation branches. A repeated field cannot tell "absent" from
    // "empty", and callers that do not mean to touch the setting (a scan
    // recording its source type, a PATCH of another field) send an empty list:
    // an empty list is "no change", like the other repeated fields, and
    // clearing takes the explicit flag.
    if (data.clearIssueCreationBranches) {
      proj.issueCreationBranches = null;
    } else if (data.issueCreationBranches?.length > 0) {
      proj.issueCreationBranches = data.issueCreationBranches;
    }

    // Reference branch update (empty string or null clears the setting)
    if ((data as any).referenceBranch !== undefined) {
      const branch = (data as any).referenceBranch?.trim();
      if (
        branch &&
        (branch.length > REFERENCE_BRANCH_MAX_LENGTH ||
          !REFERENCE_BRANCH_PATTERN.test(branch))
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message:
            'referenceBranch must be a git branch name without quotes, backslashes, control characters or ".."',
        });
      }
      proj.referenceBranch = branch || null;
    }

    // Notification preferences update
    if (
      data.notifSeverityThreshold !== undefined &&
      data.notifSeverityThreshold.length > 0
    ) {
      proj.notifSeverityThreshold = data.notifSeverityThreshold;
    }
    if (
      data.notifScannerTypes !== undefined &&
      data.notifScannerTypes.length > 0
    ) {
      proj.notifScannerTypes = data.notifScannerTypes;
    }
    if (data.zeroDayEmailEnabled !== undefined) {
      proj.zeroDayEmailEnabled = data.zeroDayEmailEnabled;
    }
    if (data.zeroDaySlackEnabled !== undefined) {
      proj.zeroDaySlackEnabled = data.zeroDaySlackEnabled;
    }
    if (
      data.zeroDaySeverityThreshold !== undefined &&
      data.zeroDaySeverityThreshold.length > 0
    ) {
      proj.zeroDaySeverityThreshold = data.zeroDaySeverityThreshold;
    }
    if (data.weeklyReportSlackEnabled !== undefined) {
      proj.weeklyReportSlackEnabled = data.weeklyReportSlackEnabled;
    }
    if (data.monthlyReportSlackEnabled !== undefined) {
      proj.monthlyReportSlackEnabled = data.monthlyReportSlackEnabled;
    }
    if (data.scanCompleteEmailEnabled !== undefined) {
      proj.scanCompleteEmailEnabled = data.scanCompleteEmailEnabled;
    }
    if (data.scanCompleteSlackEnabled !== undefined) {
      proj.scanCompleteSlackEnabled = data.scanCompleteSlackEnabled;
    }

    const updated = await this.projectRepo.save(proj);
    this.logger.log(`Project ${updated.id} updated successfully`);

    // The CyberRisk score is branch-scoped (analysis-reporting resolves
    // this referenceBranch to scope the score). When it actually changes the
    // persisted score is stale, so trigger a recompute. Best-effort: a recompute
    // failure must never break the project update (mirrors notifySecurityContextUpdated).
    if ((updated.referenceBranch ?? null) !== previousReferenceBranch) {
      try {
        await safeGrpcCall(
          this.resultServiceClient.recomputeCyberRisk({
            projectId: updated.id,
            trigger: 'reference_branch_update',
          }),
        );
      } catch (err) {
        this.logger.warn(
          `Failed to trigger CyberRisk recompute after referenceBranch change for project ${updated.id}: ${err?.message || err}`,
        );
      }
    }

    void this.realtime?.publish({
      eventId: ulid(),
      type: 'PROJECT_STATE_CHANGED',
      scope: {
        organizationId: proj.team?.organization?.id,
        projectId: updated.id,
      },
      payload: {
        projectStateChanged: { projectId: updated.id, changeType: 'updated' },
      },
    });
    return {
      success: true,
      message: 'Project updated successfully',
      projectInformations: this.mapToGrpcProject(updated),
    };
  }

  @Span()
  async deleteProject(
    data: ProjectDeleteRequest,
  ): Promise<ProjectDeleteResponse> {
    const proj = await findProjectWithTeamOrg(this.projectRepo, data.projectId);
    if (!proj) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
    }

    const scanDto: GetLastScanStatusResponse = await safeGrpcCall(
      this.scanServiceClient.getLastScanStatus({ projectId: data.projectId }),
    );
    if (scanDto.state === 'running' || scanDto.state === 'queued') {
      this.logger.warn(
        `Cannot delete project ${data.projectId} while scan is in progress`,
      );
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Scan in progress',
      });
    }

    try {
      await this.authorizationService.removeProjectFromTeam({
        projectId: proj.id,
        teamId: proj.team.id,
        organizationId: proj.team.organization.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to delete IAM relation for project ${data.projectId}: ${err}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to delete IAM relation',
      });
    }

    // The rows and the purge job that stands for everything the other
    // services hold of the project, together or not at all: a deletion is
    // never left without its job. The runner (data-purge) executes it.
    const jobId = await this.dataSource.transaction(async (manager) => {
      await manager.delete(ProjectBranchIngestion, {
        projectId: data.projectId,
      });
      await manager.delete(Project, data.projectId);
      return this.purgeLedger.enqueueProject(manager, {
        projectId: data.projectId,
        organizationId: proj.team.organization.id,
      });
    });

    this.logger.log(
      `Project ${data.projectId} deleted from team ${proj.team.id} — purge job ${jobId} recorded`,
    );
    // After the commit, never inside it: a failed kick leaves the job to the
    // CronJob and cannot undo the deletion.
    try {
      this.purgeRunner.kick([jobId]);
    } catch (err) {
      this.logger.warn(
        `DATA_PURGE_KICK_FAILED job=${jobId} error=${(err as Error)?.constructor?.name}`,
      );
    }
    void this.realtime?.publish({
      eventId: ulid(),
      type: 'PROJECT_STATE_CHANGED',
      scope: {
        organizationId: proj.team.organization.id,
        projectId: data.projectId,
      },
      payload: {
        projectStateChanged: {
          projectId: data.projectId,
          changeType: 'deleted',
        },
      },
    });

    return {
      message: `Project deleted successfully with id: ${data.projectId}`,
    };
  }

  /**
   * Map a Project entity to a ProjectInformationsResponse gRPC message.
   * @param proj - The project entity.
   * @param parsedBranches - List of parsed branch ingestion records.
   * @param isGithubLinked - Whether the project is linked to GitHub.
   * @param isGitlabLinked - Whether the project is linked to GitLab.
   */
  // ========== Security Context ==========

  @Span()
  async getProjectSecurityContext(
    data: GetProjectSecurityContextRequest,
  ): Promise<GetProjectSecurityContextResponse> {
    const ctx = await this.securityContextRepo.findOne({
      where: { projectId: data.projectId },
    });
    if (!ctx) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Security context not found for this project',
      });
    }
    return { securityContext: this.mapSecurityContextToGrpc(ctx) };
  }

  @Span()
  async updateProjectSecurityContext(
    data: UpdateProjectSecurityContextRequest,
  ): Promise<UpdateProjectSecurityContextResponse> {
    let ctx = await this.securityContextRepo.findOne({
      where: { projectId: data.projectId },
    });
    if (!ctx) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Security context not found for this project',
      });
    }

    const before = this.snapshotSecurityContext(ctx);

    if (data.environment !== undefined) {
      ctx.environment = this.protoEnvToEntity(data.environment);
    }
    if (data.internetExposure !== undefined) {
      ctx.internetExposure = this.protoExposureToEntity(data.internetExposure);
    }
    if (data.deploymentType !== undefined) {
      ctx.deploymentType = this.protoDeploymentToEntity(data.deploymentType);
    }
    if (data.dataClassification !== undefined) {
      ctx.dataClassification = this.protoDataClassToEntity(
        data.dataClassification,
      );
    }
    if (data.handlesPii !== undefined) {
      ctx.handlesPii = data.handlesPii;
    }
    if (data.handlesPaymentData !== undefined) {
      ctx.handlesPaymentData = data.handlesPaymentData;
    }
    if (data.businessCriticality !== undefined) {
      ctx.businessCriticality = this.protoCriticalityToEntity(
        data.businessCriticality,
      );
    }
    if (data.userBaseSize !== undefined) {
      ctx.userBaseSize = this.protoUserBaseSizeToEntity(data.userBaseSize);
    }
    // repeated fields in proto3 default to [] — only update if non-empty
    if (data.complianceFrameworks && data.complianceFrameworks.length > 0) {
      ctx.complianceFrameworks = data.complianceFrameworks;
    }
    if (data.safetyCritical !== undefined) {
      ctx.safetyCritical = data.safetyCritical;
    }
    if (data.networkSegmentation !== undefined) {
      ctx.networkSegmentation = this.protoNetworkSegToEntity(
        data.networkSegmentation,
      );
    }

    ctx.isCustomized = true;

    const after = this.snapshotSecurityContext(ctx);
    if (this.securityContextSnapshotsEqual(before, after)) {
      return {
        success: true,
        message: 'Security context unchanged',
        securityContext: this.mapSecurityContextToGrpc(ctx),
      };
    }

    ctx = await this.securityContextRepo.save(ctx);

    // Notify analysis-reporting-service to recalculate CVSS environmental scores (non-blocking)
    try {
      await safeGrpcCall(
        this.resultServiceClient.notifySecurityContextUpdated({
          projectId: data.projectId,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to notify analysis-reporting of security context update for project ${data.projectId}: ${err?.message || err}`,
      );
    }

    return {
      success: true,
      message: 'Security context updated',
      securityContext: this.mapSecurityContextToGrpc(ctx),
    };
  }

  private snapshotSecurityContext(ctx: ProjectSecurityContext) {
    return {
      environment: ctx.environment,
      internetExposure: ctx.internetExposure,
      deploymentType: ctx.deploymentType,
      dataClassification: ctx.dataClassification,
      handlesPii: ctx.handlesPii,
      handlesPaymentData: ctx.handlesPaymentData,
      businessCriticality: ctx.businessCriticality,
      userBaseSize: ctx.userBaseSize,
      complianceFrameworks: [...(ctx.complianceFrameworks ?? [])].sort(),
      safetyCritical: ctx.safetyCritical,
      networkSegmentation: ctx.networkSegmentation,
      isCustomized: ctx.isCustomized,
    };
  }

  private securityContextSnapshotsEqual(
    a: ReturnType<ProjectService['snapshotSecurityContext']>,
    b: ReturnType<ProjectService['snapshotSecurityContext']>,
  ): boolean {
    return (
      a.environment === b.environment &&
      a.internetExposure === b.internetExposure &&
      a.deploymentType === b.deploymentType &&
      a.dataClassification === b.dataClassification &&
      a.handlesPii === b.handlesPii &&
      a.handlesPaymentData === b.handlesPaymentData &&
      a.businessCriticality === b.businessCriticality &&
      a.userBaseSize === b.userBaseSize &&
      a.safetyCritical === b.safetyCritical &&
      a.networkSegmentation === b.networkSegmentation &&
      a.isCustomized === b.isCustomized &&
      a.complianceFrameworks.length === b.complianceFrameworks.length &&
      a.complianceFrameworks.every((v, i) => v === b.complianceFrameworks[i])
    );
  }

  private mapSecurityContextToGrpc(
    ctx: ProjectSecurityContext,
  ): GrpcProjectSecurityContext {
    const envMap: Record<string, ProjectEnvironmentEnum> = {
      [ProjectEnvironment.PRODUCTION]:
        ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_PRODUCTION,
      [ProjectEnvironment.STAGING]:
        ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_STAGING,
      [ProjectEnvironment.DEVELOPMENT]:
        ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_DEVELOPMENT,
    };
    const exposureMap: Record<string, InternetExposureEnum> = {
      [InternetExposure.PUBLIC]: InternetExposureEnum.INTERNET_EXPOSURE_PUBLIC,
      [InternetExposure.INTERNAL]:
        InternetExposureEnum.INTERNET_EXPOSURE_INTERNAL,
      [InternetExposure.AIRGAPPED]:
        InternetExposureEnum.INTERNET_EXPOSURE_AIRGAPPED,
    };
    const deployMap: Record<string, DeploymentTypeEnum> = {
      [DeploymentType.SAAS]: DeploymentTypeEnum.DEPLOYMENT_TYPE_SAAS,
      [DeploymentType.ONPREM]: DeploymentTypeEnum.DEPLOYMENT_TYPE_ONPREM,
      [DeploymentType.EMBEDDED]: DeploymentTypeEnum.DEPLOYMENT_TYPE_EMBEDDED,
      [DeploymentType.MOBILE]: DeploymentTypeEnum.DEPLOYMENT_TYPE_MOBILE,
    };
    const dataClassMap: Record<string, DataClassificationEnum> = {
      [DataClassification.PUBLIC]:
        DataClassificationEnum.DATA_CLASSIFICATION_PUBLIC,
      [DataClassification.INTERNAL]:
        DataClassificationEnum.DATA_CLASSIFICATION_INTERNAL,
      [DataClassification.CONFIDENTIAL]:
        DataClassificationEnum.DATA_CLASSIFICATION_CONFIDENTIAL,
      [DataClassification.REGULATED]:
        DataClassificationEnum.DATA_CLASSIFICATION_REGULATED,
    };
    const criticalityMap: Record<string, BusinessCriticalityEnum> = {
      [BusinessCriticality.LOW]:
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_LOW,
      [BusinessCriticality.MEDIUM]:
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_MEDIUM,
      [BusinessCriticality.HIGH]:
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_HIGH,
      [BusinessCriticality.MISSION_CRITICAL]:
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_MISSION_CRITICAL,
    };
    const userBaseSizeMap: Record<string, UserBaseSizeEnum> = {
      [UserBaseSize.SMALL]: UserBaseSizeEnum.USER_BASE_SIZE_SMALL,
      [UserBaseSize.MEDIUM]: UserBaseSizeEnum.USER_BASE_SIZE_MEDIUM,
      [UserBaseSize.LARGE]: UserBaseSizeEnum.USER_BASE_SIZE_LARGE,
    };
    const networkSegMap: Record<string, NetworkSegmentationEnum> = {
      [NetworkSegmentation.FLAT]:
        NetworkSegmentationEnum.NETWORK_SEGMENTATION_FLAT,
      [NetworkSegmentation.SEGMENTED]:
        NetworkSegmentationEnum.NETWORK_SEGMENTATION_SEGMENTED,
      [NetworkSegmentation.MICROSEGMENTED]:
        NetworkSegmentationEnum.NETWORK_SEGMENTATION_MICROSEGMENTED,
    };

    return {
      id: ctx.id,
      projectId: ctx.projectId,
      environment:
        envMap[ctx.environment] ??
        ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_PRODUCTION,
      internetExposure:
        exposureMap[ctx.internetExposure] ??
        InternetExposureEnum.INTERNET_EXPOSURE_PUBLIC,
      deploymentType:
        deployMap[ctx.deploymentType] ??
        DeploymentTypeEnum.DEPLOYMENT_TYPE_SAAS,
      dataClassification:
        dataClassMap[ctx.dataClassification] ??
        DataClassificationEnum.DATA_CLASSIFICATION_CONFIDENTIAL,
      handlesPii: ctx.handlesPii,
      handlesPaymentData: ctx.handlesPaymentData,
      businessCriticality:
        criticalityMap[ctx.businessCriticality] ??
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_MEDIUM,
      userBaseSize:
        userBaseSizeMap[ctx.userBaseSize] ??
        UserBaseSizeEnum.USER_BASE_SIZE_MEDIUM,
      complianceFrameworks: ctx.complianceFrameworks ?? [],
      safetyCritical: ctx.safetyCritical,
      networkSegmentation:
        networkSegMap[ctx.networkSegmentation] ??
        NetworkSegmentationEnum.NETWORK_SEGMENTATION_FLAT,
      isCustomized: ctx.isCustomized,
      createdAt: ctx.createdAt ? ctx.createdAt.toISOString() : '',
      updatedAt: ctx.updatedAt ? ctx.updatedAt.toISOString() : '',
    };
  }

  /**
   * Resolve proto enum value to entity enum.
   * ts-proto with nestJs=true sends optional enums as STRINGS like
   * "PROJECT_ENVIRONMENT_DEVELOPMENT", not numbers. This resolver handles both.
   */
  private resolveProtoEnum<T extends string>(
    value: unknown,
    validValues: T[],
    fallback: T,
  ): T {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      // Direct match (e.g., "production")
      for (const v of validValues) {
        if (v === lower) return v;
      }
      // Proto enum name (e.g., "PROJECT_ENVIRONMENT_PRODUCTION" → match against entity value)
      for (const v of validValues) {
        if (lower.endsWith(`_${v}`) || lower === v) return v;
      }
    }
    if (typeof value === 'number' && value > 0 && value <= validValues.length) {
      return validValues[value - 1];
    }
    return fallback;
  }

  private protoEnvToEntity(v: ProjectEnvironmentEnum): ProjectEnvironment {
    return this.resolveProtoEnum(
      v,
      [
        ProjectEnvironment.PRODUCTION,
        ProjectEnvironment.STAGING,
        ProjectEnvironment.DEVELOPMENT,
      ],
      ProjectEnvironment.PRODUCTION,
    );
  }

  private protoExposureToEntity(v: InternetExposureEnum): InternetExposure {
    return this.resolveProtoEnum(
      v,
      [
        InternetExposure.PUBLIC,
        InternetExposure.INTERNAL,
        InternetExposure.AIRGAPPED,
      ],
      InternetExposure.PUBLIC,
    );
  }

  private protoDeploymentToEntity(v: DeploymentTypeEnum): DeploymentType {
    return this.resolveProtoEnum(
      v,
      [
        DeploymentType.SAAS,
        DeploymentType.ONPREM,
        DeploymentType.EMBEDDED,
        DeploymentType.MOBILE,
      ],
      DeploymentType.SAAS,
    );
  }

  private protoDataClassToEntity(
    v: DataClassificationEnum,
  ): DataClassification {
    return this.resolveProtoEnum(
      v,
      [
        DataClassification.PUBLIC,
        DataClassification.INTERNAL,
        DataClassification.CONFIDENTIAL,
        DataClassification.REGULATED,
      ],
      DataClassification.CONFIDENTIAL,
    );
  }

  private protoCriticalityToEntity(
    v: BusinessCriticalityEnum,
  ): BusinessCriticality {
    return this.resolveProtoEnum(
      v,
      [
        BusinessCriticality.LOW,
        BusinessCriticality.MEDIUM,
        BusinessCriticality.HIGH,
        BusinessCriticality.MISSION_CRITICAL,
      ],
      BusinessCriticality.MEDIUM,
    );
  }

  private protoUserBaseSizeToEntity(v: UserBaseSizeEnum): UserBaseSize {
    return this.resolveProtoEnum(
      v,
      [UserBaseSize.SMALL, UserBaseSize.MEDIUM, UserBaseSize.LARGE],
      UserBaseSize.MEDIUM,
    );
  }

  private protoNetworkSegToEntity(
    v: NetworkSegmentationEnum,
  ): NetworkSegmentation {
    return this.resolveProtoEnum(
      v,
      [
        NetworkSegmentation.FLAT,
        NetworkSegmentation.SEGMENTED,
        NetworkSegmentation.MICROSEGMENTED,
      ],
      NetworkSegmentation.FLAT,
    );
  }

  private mapToGrpcProject(
    proj: Project,
    parsedBranches: any[] = [],
    isGithubLinked: boolean = false,
    isGitlabLinked: boolean = false,
    cyberRiskScore: number = 0,
    cyberRiskLevel: string = 'none',
    securityContext?: ProjectSecurityContext,
    isJiraLinked: boolean = false,
    gitDefaultBranch: string = '',
    detectedLanguages: string[] = [],
    linkedRepository?: ProjectLinkedRepository,
    isLinearLinked: boolean = false,
  ): ProjectInformationsResponse {
    return {
      projectId: proj.id,
      teamId: proj.team?.id ?? '',
      teamName: proj.team?.name ?? '',
      name: proj.name,
      createdAt: proj.createdAt ? proj.createdAt.toISOString() : '',
      updatedAt: proj.updatedAt ? proj.updatedAt.toISOString() : '',
      cyberRiskScore,
      cyberRiskLevel,
      applicationType: proj.applicationType ?? '',
      analysisFrequency: proj.analysisFrequency ?? '',
      emailAlertEnabled: proj.emailAlertEnabled,
      monthlyReportEnabled: proj.monthlyReportEnabled,
      weeklyReportEnabled: proj.weeklyReportEnabled,
      sastEnabled: proj.sastEnabled,
      dastEnabled: proj.dastEnabled,
      scaEnabled: proj.scaEnabled,
      containerEnabled: proj.containerEnabled,
      apiEnabled: proj.apiEnabled,
      iacEnabled: proj.iacEnabled,
      secretEnabled: proj.secretEnabled,
      sastFastScanEnabled: proj.sastFastScanEnabled,
      diffScanMinSeverity: proj.diffScanMinSeverity || 'medium',
      sastSeverities: proj.sastSeverities ?? [],
      scaSeverities: proj.scaSeverities ?? [],
      iacSeverities: proj.iacSeverities ?? [],
      containerSeverities: proj.containerSeverities ?? [],
      secretSeverities: proj.secretSeverities ?? [],
      incidentCreationOption: proj.incidentCreationOption ?? '',
      scaTransitiveDependenciesEnabled: proj.scaTransitiveDependenciesEnabled,
      scaDevelopmentDependenciesEnabled: proj.scaDevelopmentDependenciesEnabled,
      organizationId: proj.team?.organization?.id ?? '',
      organizationName: proj.team?.organization?.name ?? '',
      agentCategoriesSast: proj.agentCategoriesSast || [],
      agentCategoriesIac: proj.agentCategoriesIac || [],
      agentCategoriesCicd: proj.agentCategoriesCicd || [],
      lastScanSourceType: proj.lastScanSourceType || 'manual',
      parsedBranches,
      githubIssueEnabled: proj.githubIssueEnabled ?? true,
      gitlabIssueEnabled: proj.gitlabIssueEnabled ?? true,
      issueCreationMode: proj.issueCreationMode || 'per_vulnerability_type',
      isGithubLinked,
      isGitlabLinked,
      isJiraLinked,
      isLinearLinked,
      issueCreationBranches: proj.issueCreationBranches ?? [],
      referenceBranch: proj.referenceBranch ?? undefined,
      defaultBranch: gitDefaultBranch || undefined,
      scaReachabilityPriorityEnabled:
        proj.scaReachabilityPriorityEnabled ?? true,
      scaReachabilityStatusEnabled: proj.scaReachabilityStatusEnabled ?? true,
      notifSeverityThreshold: proj.notifSeverityThreshold ?? [],
      notifScannerTypes: proj.notifScannerTypes ?? [],
      zeroDayEmailEnabled: proj.zeroDayEmailEnabled ?? false,
      zeroDaySlackEnabled: proj.zeroDaySlackEnabled ?? false,
      zeroDaySeverityThreshold: proj.zeroDaySeverityThreshold ?? [],
      weeklyReportSlackEnabled: proj.weeklyReportSlackEnabled ?? false,
      monthlyReportSlackEnabled: proj.monthlyReportSlackEnabled ?? false,
      scanCompleteEmailEnabled: proj.scanCompleteEmailEnabled ?? false,
      scanCompleteSlackEnabled: proj.scanCompleteSlackEnabled ?? false,
      securityContext: securityContext
        ? this.mapSecurityContextToGrpc(securityContext)
        : undefined,
      detectedLanguages,
      // Rows predating the migration carry no value; fail open so a project
      // never silently stops being scanned on commit.
      scanOnCommitEnabled: proj.scanOnCommitEnabled ?? true,
      linkedRepository,
      // The edition's own settings (none in the Community Edition).
      ...this.projectSettings.answerFields(proj),
    } as ProjectInformationsResponse;
  }

  /**
   * Global fetch of projects (all organizations) with simple pagination and optional
   * flag-based filtering (weekly/monthly/email alerts). Intended for internal cron usage.
   * NOTE: For very large datasets (hundreds of thousands+) consider keyset pagination
   * and projecting only required columns to reduce memory pressure.
   */
  @Span()
  async getAllProjects(data: {
    pageNumber?: number;
    pageSizeNumber?: number;
    weekly?: boolean;
    monthly?: boolean;
    emailAlert?: boolean;
    zeroDayEmail?: boolean;
    zeroDaySlack?: boolean;
    weeklySlack?: boolean;
    monthlySlack?: boolean;
    scanCompleteEmail?: boolean;
    scanCompleteSlack?: boolean;
  }): Promise<PaginatedProjectsResponse> {
    const page = data.pageNumber && data.pageNumber > 0 ? data.pageNumber : 1;
    const size =
      data.pageSizeNumber && data.pageSizeNumber > 0
        ? Math.min(data.pageSizeNumber, 200)
        : 50;

    const qb = this.projectRepo
      .createQueryBuilder('project')
      .innerJoinAndSelect('project.team', 'team')
      .innerJoinAndSelect('team.organization', 'org');

    const flagClauses: string[] = [];
    if (data.weekly) flagClauses.push('project.weeklyReportEnabled = true');
    if (data.monthly) flagClauses.push('project.monthlyReportEnabled = true');
    if (data.emailAlert) flagClauses.push('project.emailAlertEnabled = true');
    if (data.zeroDayEmail)
      flagClauses.push('project.zeroDayEmailEnabled = true');
    if (data.zeroDaySlack)
      flagClauses.push('project.zeroDaySlackEnabled = true');
    if (data.weeklySlack)
      flagClauses.push('project.weeklyReportSlackEnabled = true');
    if (data.monthlySlack)
      flagClauses.push('project.monthlyReportSlackEnabled = true');
    if (data.scanCompleteEmail)
      flagClauses.push('project.scanCompleteEmailEnabled = true');
    if (data.scanCompleteSlack)
      flagClauses.push('project.scanCompleteSlackEnabled = true');
    if (flagClauses.length > 0) {
      qb.andWhere(flagClauses.map((c) => `(${c})`).join(' OR '));
    }

    const totalProjects = await qb.getCount();
    const totalPages = Math.ceil(totalProjects / size);
    qb.orderBy('project.id', 'ASC');
    qb.skip((page - 1) * size).take(size);
    const entities = await qb.getMany();
    const projects: ProjectInformationsResponse[] = entities.map((proj) =>
      this.mapToGrpcProject(proj, []),
    );
    return { projects, totalProjects, totalPages };
  }

  // ========== Branch Ingestion Management ==========

  /**
   * Get all branch ingestion records for a project.
   */
  @Span()
  async getProjectBranches(data: { projectId: string }): Promise<{
    branches: any[];
  }> {
    const { projectId } = data;

    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }

    const records = await this.branchIngestionRepo.find({
      where: { projectId },
      order: { branch: 'ASC' },
    });

    return {
      branches: records.map((r) => mapBranchIngestionToGrpc(r)),
    };
  }

  /**
   * Delete all branch ingestion records for a project (called on project deletion).
   */
  @Span()
  async deleteProjectBranches(data: { projectId: string }): Promise<{
    success: boolean;
    deletedCount: number;
  }> {
    const { projectId } = data;

    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }

    const result = await this.branchIngestionRepo.delete({ projectId });
    const deletedCount = result.affected || 0;

    this.logger.log(
      `Deleted ${deletedCount} branch ingestion records for project ${projectId}`,
    );

    return {
      success: true,
      deletedCount,
    };
  }

  // ========== Branch Archiving ==========

  /**
   * Archive a branch for a project (hides it from branch selectors by default).
   */
  @Span()
  async archiveBranch(data: {
    projectId: string;
    branchName: string;
  }): Promise<{ success: boolean }> {
    const { projectId, branchName } = data;

    if (!projectId || !branchName) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId and branchName are required',
      });
    }

    try {
      // Upsert: insert if not exists, ignore if already archived
      const existing = await this.archivedBranchRepo.findOne({
        where: { projectId, branchName },
      });

      if (!existing) {
        await this.archivedBranchRepo.save(
          this.archivedBranchRepo.create({ projectId, branchName }),
        );
        this.logger.log(
          `Archived branch "${branchName}" for project ${projectId}`,
        );
      }

      return { success: true };
    } catch (error) {
      // The statement's error can quote values: logged, never answered.
      this.logger.error({ err: error, msg: 'Error archiving branch' });
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error archiving branch',
      });
    }
  }

  /**
   * Unarchive a branch for a project (makes it visible again).
   */
  @Span()
  async unarchiveBranch(data: {
    projectId: string;
    branchName: string;
  }): Promise<{ success: boolean }> {
    const { projectId, branchName } = data;

    if (!projectId || !branchName) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId and branchName are required',
      });
    }

    try {
      await this.archivedBranchRepo.delete({ projectId, branchName });
      this.logger.log(
        `Unarchived branch "${branchName}" for project ${projectId}`,
      );
      return { success: true };
    } catch (error) {
      // The statement's error can quote values: logged, never answered.
      this.logger.error({ err: error, msg: 'Error unarchiving branch' });
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error unarchiving branch',
      });
    }
  }

  /**
   * Get all archived branches for a project.
   */
  @Span()
  async getArchivedBranches(data: {
    projectId: string;
  }): Promise<{ branches: string[] }> {
    const { projectId } = data;

    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }

    try {
      const records = await this.archivedBranchRepo.find({
        where: { projectId },
        order: { branchName: 'ASC' },
      });

      return {
        branches: records.map((r) => r.branchName),
      };
    } catch (error) {
      // The statement's error can quote values: logged, never answered.
      this.logger.error({ err: error, msg: 'Error getting archived branches' });
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error getting archived branches',
      });
    }
  }

  /**
   * Map a ProjectBranchIngestion entity to gRPC response format.
   */
  /**
   * Validate that multiple projects belong to an organization in a single SQL query.
   * Used by policy-management-service for efficient validation.
   */
  @Span()
  async validateProjectsInOrganization(data: {
    projectIds: string[];
    organizationId: string;
  }): Promise<{
    valid: boolean;
    notFoundIds: string[];
    invalidIds: string[];
  }> {
    const { projectIds, organizationId } = data;

    // Handle empty array case
    if (!projectIds || projectIds.length === 0) {
      return { valid: true, notFoundIds: [], invalidIds: [] };
    }

    // Single SQL query to find all projects by IDs
    const projects = await this.projectRepo.find({
      where: { id: In(projectIds) },
      select: ['id', 'team'],
      relations: ['team', 'team.organization'],
    });

    const foundIds = new Set(projects.map((p) => p.id));
    const notFoundIds = projectIds.filter((id) => !foundIds.has(id));

    // Check which projects belong to the organization
    const invalidIds: string[] = [];
    for (const project of projects) {
      if (project.team?.organization?.id !== organizationId) {
        invalidIds.push(project.id);
      }
    }

    return {
      valid: notFoundIds.length === 0 && invalidIds.length === 0,
      notFoundIds,
      invalidIds,
    };
  }

  /**
   * Count projects in an organization with a single efficient SQL COUNT query.
   * Used by policy-management-service for CISO dashboard statistics.
   */
  @Span()
  async countProjectsInOrganization(data: {
    organizationId: string;
    userId: string;
    /**
     * Count EVERY project in the organization, ignoring per-user visibility.
     *
     * For internal capacity checks (plan limits) that have no user context.
     * A user-scoped count would UNDER-report and let a downgrade through: an
     * org holding ten projects reports two to a caller who can see two, and
     * sails past the Developer cap of three.
     *
     * Opt-in on purpose, rather than treating an empty userId as "count all" —
     * a caller that simply forgets the userId must keep failing loudly instead
     * of silently receiving a different number.
     */
    orgWide?: boolean;
  }): Promise<{ totalProjects: number }> {
    const { organizationId, userId, orgWide } = data;

    if (!organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'An organizationId must be provided.',
      });
    }
    if (!userId && !orgWide) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A userId must be provided unless orgWide is set.',
      });
    }

    const qb = this.projectRepo
      .createQueryBuilder('project')
      .innerJoin('project.team', 'team')
      .innerJoin('team.organization', 'org', 'org.id = :organizationId', {
        organizationId,
      });

    // Apply same security check as getProjectsOrganization — skipped for an
    // org-wide capacity count, which deliberately sees past user visibility.
    // That count is billing's AppSec plan capacity check: it
    // counts AppSec projects only (second-product projects never weigh
    // on the AppSec plan).
    if (orgWide) {
      qb.andWhere('project.appsec_enabled_at IS NOT NULL');
    } else {
      qb.andWhere(
        new Brackets((sqb) => {
          sqb.where(PRIVILEGED_MEMBER_EXISTS);
          sqb.orWhere(TEAM_MEMBER_EXISTS);
        }),
      );

      qb.setParameters({
        ...qb.getParameters(),
        userId,
        privilegedRoles: ['creator', 'administrator'],
      });
    }

    const totalProjects = await qb.getCount();

    return { totalProjects };
  }
}
