// src/modules/project/project.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Span } from 'nestjs-otel';

import { ProjectCreateBodyDto } from './dto/body/project-create-body.dto';
import { ProjectGetAllBodyDto } from './dto/body/project-get-all-body.dto';
import { ProjectUpdateBodyDto } from './dto/body/project-update-body.dto';

import {
  FORBIDDEN_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from 'src/core/constants/api-response-examples';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';

import {
  ProjectGetAllRequest,
  ProjectGetRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ProjectDeleteRequest,
  PaginatedProjectsAllInformationsResponse,
  PaginatedProjectsResponse,
  ProjectInformationsResponse,
  ProjectUpdateResponse,
  ProjectDeleteResponse,
  ArchiveBranchResponse,
  UnarchiveBranchResponse,
  GetArchivedBranchesResponse,
  GetProjectSecurityContextResponse,
  UpdateProjectSecurityContextResponse,
  MainStatisticsResponse,
} from '@grpc/global-management/project';
import { ProjectService } from '../project/project.service';
import { ErrorDto } from 'src/core/constants/error.dto';
import { PaginatedProjectsAllInformationsResponseDto } from './dto/response/paginate-project-all-informations-response.dto';
import { PaginatedProjectsResponseDto } from './dto/response/paginate-projects-response.dto';
import { ProjectInformationsResponseDto } from './dto/response/project-informations-response.dto';
import { ProjectUpdateResponseDto } from './dto/response/project-update-response.dto';
import { ProjectDeleteResponseDto } from './dto/response/project-delete-response.dto';
import { ProjectSecurityContextUpdateDto } from './dto/body/project-security-context-update.dto';
import { ProjectSecurityContextResponseDto } from './dto/response/project-security-context-response.dto';
import {
  mapSecurityContextBodyToCreateInput,
  mapSecurityContextBodyToUpdateRequest,
} from './mappers/security-context.mapper';
import { Logger } from 'nestjs-pino';
import {
  COMPLIANCE_FRAMEWORKS_SYNC,
  ComplianceFrameworksSync,
} from './compliance-frameworks-sync';
import { projectUpdateFields } from './project-update-fields';
import { projectCreateFields } from './project-create-fields';

/**
 * Extract the raw Bearer token from a request's Authorization header. Used to
 * forward the caller's token on the best-effort compliance-frameworks sync.
 */
function extractBearerToken(req: {
  headers?: Record<string, unknown>;
}): string {
  const auth = (req?.headers?.authorization as string) ?? '';
  const [type, token] = auth.split(' ');
  return type === 'Bearer' ? token : '';
}

@ApiTags('Project')
@Controller()
@UseGuards(CombinedAuthRateLimitGuard)
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly logger: Logger,
    @Optional()
    @Inject(COMPLIANCE_FRAMEWORKS_SYNC)
    private readonly complianceSync?: ComplianceFrameworksSync,
  ) {}

  /**
   * Fire-and-forget sync of a project's declared Compliance Frameworks into the
   * security_rules store — this drives compliance-category gating. Never blocks
   * or fails the Security Context request: errors are logged and swallowed.
   * With no sync bound (the Community Edition), it returns at once.
   */
  private syncComplianceFrameworks(
    projectId: string,
    frameworks: string[] | undefined,
    token: string,
  ): void {
    if (!this.complianceSync) return;
    void this.complianceSync
      .setComplianceFrameworks(projectId, frameworks ?? [], token)
      .catch((err: unknown) => {
        this.logger.warn(
          `compliance-frameworks sync failed for project ${projectId}: ${
            (err as Error)?.message ?? String(err)
          }`,
        );
      });
  }

  @Span()
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @ApiOperation({
    summary: 'Get all projects of an organization with pagination',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    example: 10,
    description: 'Page size',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    example: 'my-project',
    description: 'Search query',
  })
  @ApiResponse({
    status: 200,
    description: 'Projects found successfully',
    type: PaginatedProjectsAllInformationsResponseDto,
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('/organization/:organizationId/projects')
  getProjectsOrganization(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: ProjectGetAllBodyDto,
    @Req() req,
  ): Promise<PaginatedProjectsAllInformationsResponse> {
    const pageNumber = Number.parseInt(query.page.toString(), 10);
    const pageSizeNumber = Number.parseInt(query.pageSize.toString(), 10);

    const data: ProjectGetAllRequest = {
      teamId: organizationId,
      pageNumber,
      pageSizeNumber,
      searchQuery: query.search ?? '',
      userId: req.user.sub,
    };
    return this.projectService.getProjectsOrganization(data);
  }

  @Span()
  @SubjectType('organization')
  @Permission('read_appsec')
  @UseGuards(PermissionsGuard)
  @ApiOperation({
    summary:
      'Org-wide home KPI cards (criticalRiskProjects, new/solved issues, severity totals). Decoupled from the paginated project list so that endpoint returns fast; computed over every project the caller can access in the org.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Org-wide main statistics computed successfully',
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('/organization/:organizationId/main-statistics')
  getOrganizationMainStatistics(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Req() req,
  ): Promise<MainStatisticsResponse> {
    return this.projectService.getOrganizationMainStatistics({
      organizationId,
      userId: req.user.sub,
    });
  }

  @Span()
  @SubjectType('team')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Get all projects of a team with pagination' })
  @ApiParam({
    name: 'teamId',
    description: 'Team ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    example: 10,
    description: 'Page size',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    example: 'my-project',
    description: 'Search query',
  })
  @ApiResponse({
    status: 200,
    description: 'Projects found successfully',
    type: PaginatedProjectsResponseDto,
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('/team/:teamId/projects')
  getProjectsTeam(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Query() query: ProjectGetAllBodyDto,
    @Req() req,
  ): Promise<PaginatedProjectsResponse> {
    const pageNumber = Number.parseInt(query.page.toString(), 10);
    const pageSizeNumber = Number.parseInt(query.pageSize.toString(), 10);
    const data: ProjectGetAllRequest = {
      teamId,
      userId: req.user.sub,
      pageNumber,
      pageSizeNumber,
      searchQuery: query.search ?? '',
    };
    return this.projectService.getProjectsTeam(data);
  }

  @Span()
  @SubjectType('project')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Get a project' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Project found successfully',
    type: ProjectInformationsResponseDto,
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('/project/:projectId')
  async getProject(@Param('projectId', new ParseUUIDPipe()) projectId: string) {
    const data: ProjectGetRequest = { projectId };
    const result = await this.projectService.getProject(data);
    // Map security context proto enums to human-readable strings
    if (result.securityContext) {
      (result as any).securityContext = new ProjectSecurityContextResponseDto(
        result.securityContext,
      );
    }
    return result;
  }

  @Span()
  @SubjectType('team')
  @Permission('create_project')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Create a project' })
  @ApiParam({
    name: 'teamId',
    description: 'Team ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: ProjectCreateBodyDto })
  @ApiResponse({
    status: 201,
    description: 'Project created successfully',
    type: ProjectInformationsResponseDto,
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Post('/team/:teamId/project')
  async createProject(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() body: ProjectCreateBodyDto,
    @Req() req,
  ): Promise<ProjectInformationsResponse> {
    this.logger.log(
      `User ${req.user.sub} is creating a project for team ${teamId}`,
    );
    const data: ProjectCreateRequest = {
      name: body.name,
      teamId,
      creatorId: req.user.sub,
      githubIssueEnabled: body.githubIssueEnabled,
      gitlabIssueEnabled: body.gitlabIssueEnabled,
      issueCreationMode: body.issueCreationMode,
      issueCreationBranches: body.issueCreationBranches ?? [],
      securityContext: body.securityContext
        ? mapSecurityContextBodyToCreateInput(body.securityContext)
        : undefined,
      product: body.product,
    };
    // The creation settings a closed feature registered (none in the core),
    // copied when the body carries them: the core names none of them.
    const createBody = body as unknown as Record<string, unknown>;
    const createData = data as unknown as Record<string, unknown>;
    for (const key of projectCreateFields()) {
      if (createBody[key] !== undefined) {
        createData[key] = createBody[key];
      }
    }
    const created = await this.projectService.createProject(data);
    // The dashboard reads the Security Context from GET /project/:id, which
    // does not sync it: a project created with frameworks is synced at birth
    // (best-effort), later changes go through PUT /security-context.
    // global-management stores the frameworks it is sent (when there are
    // some) and does not return the Security Context from createProject, so
    // what is synced is what was sent.
    const frameworks = data.securityContext?.complianceFrameworks ?? [];
    if (frameworks.length > 0) {
      this.syncComplianceFrameworks(
        created.projectId,
        frameworks,
        extractBearerToken(req),
      );
    }
    return created;
  }

  @Span()
  @SubjectType('project')
  @Permission('update')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Update a project' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: ProjectUpdateBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Project updated successfully',
    type: ProjectUpdateResponseDto,
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Patch('/project/:projectId')
  updateProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: ProjectUpdateBodyDto,
    @Req() req,
  ): Promise<ProjectUpdateResponse> {
    this.logger.log(`User ${req.user.sub} is updating project ${projectId}`);

    // Create data object with only defined fields to ensure proper PATCH behavior
    const data: ProjectUpdateRequest = {
      projectId,
      sastSeverities: [],
      iacSeverities: [],
      scaSeverities: [],
      containerSeverities: [],
      secretSeverities: [],
      agentCategoriesSast: [],
      agentCategoriesIac: [],
      agentCategoriesCicd: [],
      issueCreationBranches: [],
      notifSeverityThreshold: [],
      notifScannerTypes: [],
      zeroDaySeverityThreshold: [],
    };

    // String fields - include only if defined and non-empty
    if (body.name !== undefined && body.name !== '') {
      data.name = body.name;
    }
    if (body.teamId !== undefined && body.teamId !== '') {
      data.teamId = body.teamId;
    }
    if (body.applicationType !== undefined && body.applicationType !== '') {
      data.applicationType = body.applicationType;
    }
    if (body.analysisFrequency !== undefined && body.analysisFrequency !== '') {
      data.analysisFrequency = body.analysisFrequency;
    }
    if (
      body.incidentCreationOption !== undefined &&
      body.incidentCreationOption !== ''
    ) {
      data.incidentCreationOption = body.incidentCreationOption;
    }

    // Boolean fields - include only if explicitly defined
    if (body.emailAlertEnabled !== undefined) {
      data.emailAlertEnabled = body.emailAlertEnabled;
    }
    if (body.monthlyReportEnabled !== undefined) {
      data.monthlyReportEnabled = body.monthlyReportEnabled;
    }
    if (body.weeklyReportEnabled !== undefined) {
      data.weeklyReportEnabled = body.weeklyReportEnabled;
    }
    if (body.sastEnabled !== undefined) {
      data.sastEnabled = body.sastEnabled;
    }
    if (body.dastEnabled !== undefined) {
      data.dastEnabled = body.dastEnabled;
    }
    if (body.scaEnabled !== undefined) {
      data.scaEnabled = body.scaEnabled;
    }
    if (body.containerEnabled !== undefined) {
      data.containerEnabled = body.containerEnabled;
    }
    if (body.apiEnabled !== undefined) {
      data.apiEnabled = body.apiEnabled;
    }
    if (body.iacEnabled !== undefined) {
      data.iacEnabled = body.iacEnabled;
    }
    if (body.secretEnabled !== undefined) {
      data.secretEnabled = body.secretEnabled;
    }
    if (body.sastFastScanEnabled !== undefined) {
      data.sastFastScanEnabled = body.sastFastScanEnabled;
    }
    if (body.diffScanMinSeverity !== undefined) {
      data.diffScanMinSeverity = body.diffScanMinSeverity;
    }
    if (body.scaTransitiveDependenciesEnabled !== undefined) {
      data.scaTransitiveDependenciesEnabled =
        body.scaTransitiveDependenciesEnabled;
    }
    if (body.scaDevelopmentDependenciesEnabled !== undefined) {
      data.scaDevelopmentDependenciesEnabled =
        body.scaDevelopmentDependenciesEnabled;
    }
    if (body.scaReachabilityPriorityEnabled !== undefined) {
      data.scaReachabilityPriorityEnabled = body.scaReachabilityPriorityEnabled;
    }
    if (body.scaReachabilityStatusEnabled !== undefined) {
      data.scaReachabilityStatusEnabled = body.scaReachabilityStatusEnabled;
    }

    if (body.containerEnabled !== undefined) {
      data.containerEnabled = body.containerEnabled;
    }
    if (body.containerSeverities !== undefined) {
      data.containerSeverities = body.containerSeverities;
    }
    if (body.secretSeverities !== undefined) {
      data.secretSeverities = body.secretSeverities;
    }

    // Array fields - include only if defined and non-empty
    if (body.sastSeverities !== undefined && body.sastSeverities.length > 0) {
      data.sastSeverities = body.sastSeverities;
    }
    if (body.iacSeverities !== undefined && body.iacSeverities.length > 0) {
      data.iacSeverities = body.iacSeverities;
    }
    if (body.scaSeverities !== undefined && body.scaSeverities.length > 0) {
      data.scaSeverities = body.scaSeverities;
    }
    // SAST Agent categories (full replacement list)
    if (
      body.agentCategoriesSast !== undefined &&
      body.agentCategoriesSast.length > 0
    ) {
      data.agentCategoriesSast = body.agentCategoriesSast;
    }
    // IAC Agent categories (full replacement list)
    if (
      body.agentCategoriesIac !== undefined &&
      body.agentCategoriesIac.length > 0
    ) {
      data.agentCategoriesIac = body.agentCategoriesIac;
    }
    // CICD Agent categories (full replacement list)
    if (body.agentCategoriesCicd !== undefined) {
      data.agentCategoriesCicd = body.agentCategoriesCicd;
    }

    // Issue integration fields
    if (body.githubIssueEnabled !== undefined) {
      data.githubIssueEnabled = body.githubIssueEnabled;
    }
    if (body.gitlabIssueEnabled !== undefined) {
      data.gitlabIssueEnabled = body.gitlabIssueEnabled;
    }
    if (body.issueCreationMode !== undefined && body.issueCreationMode !== '') {
      data.issueCreationMode = body.issueCreationMode;
    }
    // Issue creation branches (empty array clears the setting)
    if (body.issueCreationBranches !== undefined) {
      data.issueCreationBranches = body.issueCreationBranches;
    }

    // Reference branch for vulnerability statistics (null clears the setting)
    if (body.referenceBranch !== undefined) {
      data.referenceBranch = body.referenceBranch;
    }

    // Notification preference fields
    if (body.notifSeverityThreshold !== undefined) {
      data.notifSeverityThreshold = body.notifSeverityThreshold;
    }
    if (body.notifScannerTypes !== undefined) {
      data.notifScannerTypes = body.notifScannerTypes;
    }
    if (body.zeroDayEmailEnabled !== undefined) {
      data.zeroDayEmailEnabled = body.zeroDayEmailEnabled;
    }
    if (body.zeroDaySlackEnabled !== undefined) {
      data.zeroDaySlackEnabled = body.zeroDaySlackEnabled;
    }
    if (body.zeroDaySeverityThreshold !== undefined) {
      data.zeroDaySeverityThreshold = body.zeroDaySeverityThreshold;
    }
    if (body.scanCompleteEmailEnabled !== undefined) {
      data.scanCompleteEmailEnabled = body.scanCompleteEmailEnabled;
    }
    if (body.scanCompleteSlackEnabled !== undefined) {
      data.scanCompleteSlackEnabled = body.scanCompleteSlackEnabled;
    }
    if (body.weeklyReportSlackEnabled !== undefined) {
      data.weeklyReportSlackEnabled = body.weeklyReportSlackEnabled;
    }
    if (body.monthlyReportSlackEnabled !== undefined) {
      data.monthlyReportSlackEnabled = body.monthlyReportSlackEnabled;
    }
    // The update fields a closed product adds (registered by the ee side):
    // the core names none of them.
    const bodyRecord = body as unknown as Record<string, unknown>;
    const dataRecord = data as unknown as Record<string, unknown>;
    for (const key of projectUpdateFields()) {
      if (bodyRecord[key] !== undefined) {
        dataRecord[key] = bodyRecord[key];
      }
    }

    if (body.scanOnCommitEnabled !== undefined) {
      data.scanOnCommitEnabled = body.scanOnCommitEnabled;
    }

    return this.projectService.updateProject(data);
  }

  @Span()
  @SubjectType('project')
  @Permission('delete')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Project deleted successfully',
    type: ProjectDeleteResponseDto,
  })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Bad Request' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Delete('/project/:projectId')
  deleteProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() req,
  ): Promise<ProjectDeleteResponse> {
    this.logger.log(`User ${req.user.sub} is deleting project ${projectId}`);
    const data: ProjectDeleteRequest = { projectId };
    return this.projectService.deleteProject(data);
  }

  // ========== Branch Archiving ==========

  @Span()
  @SubjectType('project')
  @Permission('update')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Archive a branch for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'branchName',
    type: 'string',
    description: 'Branch name to archive',
  })
  @ApiResponse({ status: 200, description: 'Branch archived successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Post('/project/:projectId/branches/:branchName/archive')
  archiveBranch(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('branchName') branchName: string,
  ): Promise<ArchiveBranchResponse> {
    return this.projectService.archiveBranch({
      projectId,
      branchName: decodeURIComponent(branchName),
    });
  }

  @Span()
  @SubjectType('project')
  @Permission('update')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Unarchive a branch for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({
    name: 'branchName',
    type: 'string',
    description: 'Branch name to unarchive',
  })
  @ApiResponse({ status: 200, description: 'Branch unarchived successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Delete('/project/:projectId/branches/:branchName/archive')
  unarchiveBranch(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('branchName') branchName: string,
  ): Promise<UnarchiveBranchResponse> {
    return this.projectService.unarchiveBranch({
      projectId,
      branchName: decodeURIComponent(branchName),
    });
  }

  @Span()
  @SubjectType('project')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Get all archived branches for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Archived branches retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('/project/:projectId/branches/archived')
  getArchivedBranches(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<GetArchivedBranchesResponse> {
    return this.projectService.getArchivedBranches({ projectId });
  }

  // ========== Security Context ==========

  @Span()
  @SubjectType('project')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Get the security context for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Security context retrieved successfully',
    type: ProjectSecurityContextResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('/project/:projectId/security-context')
  async getProjectSecurityContext(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() req,
  ): Promise<ProjectSecurityContextResponseDto | null> {
    const response: GetProjectSecurityContextResponse =
      await this.projectService.getProjectSecurityContext({ projectId });
    if (!response.securityContext) {
      return null;
    }
    // Keep the security_rules compliance-context copy fresh (best-effort).
    this.syncComplianceFrameworks(
      projectId,
      response.securityContext.complianceFrameworks,
      extractBearerToken(req),
    );
    return new ProjectSecurityContextResponseDto(response.securityContext);
  }

  @Span()
  @SubjectType('project')
  @Permission('update')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Update the security context for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: ProjectSecurityContextUpdateDto })
  @ApiResponse({
    status: 200,
    description: 'Security context updated successfully',
    type: ProjectSecurityContextResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorDto })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Put('/project/:projectId/security-context')
  async updateProjectSecurityContext(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: ProjectSecurityContextUpdateDto,
    @Req() req,
  ): Promise<ProjectSecurityContextResponseDto> {
    const data = mapSecurityContextBodyToUpdateRequest(projectId, body);
    const response: UpdateProjectSecurityContextResponse =
      await this.projectService.updateProjectSecurityContext(data);
    // Sync the updated compliance frameworks into security_rules (best-effort).
    this.syncComplianceFrameworks(
      projectId,
      response.securityContext?.complianceFrameworks,
      extractBearerToken(req),
    );
    return new ProjectSecurityContextResponseDto(response.securityContext);
  }
}
