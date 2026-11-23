import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { VulnerabilityInfo } from '@grpc/external-integrations/issue';
import { LinearService } from './linear.service';
import { LinearCallbackInstallBodyDto } from './dto/body/linear-callback-install-body.dto';
import { SetLinearConfigBodyDto } from './dto/body/set-linear-config-body.dto';
import { CreateLinearIssuesBodyDto } from './dto/body/create-linear-issues-body.dto';
import { LinkLinearIssueBodyDto } from './dto/body/link-linear-issue-body.dto';
import { isLocalUrl } from '../shared/is-local-url';
import {
  UNAUTHORIZED_EXAMPLE,
  FORBIDDEN_EXAMPLE,
  BAD_REQUEST_EXAMPLE,
} from '../../../core/constants/api-response-examples';

type AuthenticatedRequest = { user: { sub: string } };

/** The OAuth state lives 10 minutes, long enough to authorize in Linear. */
const OAUTH_STATE_TTL_SECONDS = 600;

/**
 * Keyed by the state itself, not by organization: two admins or two tabs
 * starting an installation do not overwrite each other's state (as Slack).
 */
const oauthStateKey = (state: string): string => `linear_oauth_state:${state}`;

const INVALID_STATE_MESSAGE =
  'Invalid or expired OAuth state. Please restart the Linear installation.';

@ApiTags('Linear Integration')
@UseGuards(CombinedAuthRateLimitGuard)
@Controller()
export class LinearController {
  constructor(
    private readonly linearService: LinearService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  /** The comma-separated FRONTEND_URL setting, trimmed. */
  private frontendUrls(): string[] {
    return (
      this.configService
        .get<string>('FRONTEND_URL')
        ?.split(',')
        .map((u) => u.trim())
        .filter(Boolean) || []
    );
  }

  /**
   * Base URL of the CybeDefend links written in Linear tickets. Prefer the
   * server-configured FRONTEND_URL, but skip localhost since Linear cannot
   * reach it: fall back to the client-provided origin instead (same rule as
   * Jira).
   */
  private cybedefendBaseUrl(clientBaseUrl: string | undefined): string {
    const frontendUrl = this.frontendUrls()[0];
    return frontendUrl && !isLocalUrl(frontendUrl)
      ? frontendUrl
      : clientBaseUrl || '';
  }

  /**
   * Read and delete a state in one transaction (single use), and check it
   * was issued for this organization and this user. GETDEL is not used: the
   * managed Redis version is not guaranteed to have it.
   */
  private async consumeInstallState(
    state: string,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) {
      throw new BadRequestException(INVALID_STATE_MESSAGE);
    }
    const key = oauthStateKey(state);
    const results = await this.redisClient.multi().get(key).del(key).exec();
    const [getError, stored] = results?.[0] ?? [null, null];
    if (getError || typeof stored !== 'string') {
      throw new BadRequestException(INVALID_STATE_MESSAGE);
    }
    let issued: { organizationId?: unknown; userId?: unknown };
    try {
      issued = JSON.parse(stored);
    } catch {
      throw new BadRequestException(INVALID_STATE_MESSAGE);
    }
    if (
      !issued ||
      issued.organizationId !== organizationId ||
      issued.userId !== userId
    ) {
      throw new BadRequestException(INVALID_STATE_MESSAGE);
    }
  }

  // ==================== Configuration Endpoints ====================

  /**
   * Generate Linear OAuth installation URL with CSRF state protection
   */
  @Span()
  @ApiOperation({
    summary: 'Generate Linear OAuth installation URL',
    description:
      'Creates an OAuth authorization URL for Linear integration setup. Includes CSRF protection via state parameter stored in Redis.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'OAuth URL generated' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/linear/oauth/url')
  @Permission('manage_integration')
  @SubjectType('organization')
  async generateInstallUrl(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<{ installUrl: string }> {
    const frontendUrls = this.frontendUrls();
    const frontendUrl =
      frontendUrls.find((u) => !isLocalUrl(u)) || frontendUrls[0] || '';
    const redirectUri = `${frontendUrl}/integrations/linear/callback`;

    const state = crypto.randomBytes(32).toString('hex');
    await this.redisClient.set(
      oauthStateKey(state),
      JSON.stringify({ organizationId, userId: req.user.sub }),
      'EX',
      OAUTH_STATE_TTL_SECONDS,
    );

    const result = await this.linearService.generateOAuthUrl({
      redirectUri,
      state,
    });

    return { installUrl: result.installUrl };
  }

  /**
   * Handle Linear OAuth installation callback
   */
  @Span()
  @ApiOperation({
    summary: 'Handle Linear OAuth installation callback',
    description:
      'Processes the OAuth callback after Linear authorization. This endpoint should be called by the frontend after the user authorizes the Linear app.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description: 'Organization ID',
  })
  @ApiBody({ type: LinearCallbackInstallBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Linear connected successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/linear/install/callback')
  @Permission('manage_integration')
  @SubjectType('organization')
  async callbackInstall(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LinearCallbackInstallBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    await this.consumeInstallState(dto.state, organizationId, req.user.sub);

    this.logger.log(
      `User ${req.user.sub} installing Linear for organization ${organizationId}`,
    );
    return this.linearService.callbackInstall({
      organizationId,
      userId: req.user.sub,
      code: dto.code,
      redirectUri: dto.redirectUri,
    });
  }

  /**
   * Get Linear installation for an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Get Linear installation status',
    description:
      'Checks whether Linear is connected for an organization and returns installation details, including whether the workspace must be connected again.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Linear installation details retrieved',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/linear/installation')
  @Permission('manage_integration')
  @SubjectType('organization')
  getInstallation(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    // Pass-through, like Jira: "no integration" is answered by
    // external-integrations with isConfigured=false (a normal 200), and a real
    // gRPC failure is mapped by safeGrpcCall in the service layer. A transport
    // failure must never be flattened into "not configured".
    return this.linearService.getInstallationForOrga({ organizationId });
  }

  /**
   * Disconnect Linear from an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Disconnect Linear from organization',
    description:
      'Removes the Linear integration. Stops all Linear ticket creation and removes project configurations. Idempotent: succeeds even when the organization has no Linear integration.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Linear disconnected' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId/linear/disconnect')
  @Permission('manage_integration')
  @SubjectType('organization')
  disconnect(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} disconnecting Linear for organization ${organizationId}`,
    );
    return this.linearService.disconnect({ organizationId });
  }

  /**
   * List Linear teams of the connected workspace
   */
  @Span()
  @ApiOperation({
    summary: 'List Linear teams',
    description:
      'Retrieves the teams of the connected Linear workspace, to pick the team tickets are created in.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Linear teams listed' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/linear/teams')
  @Permission('manage_integration')
  @SubjectType('organization')
  listTeams(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.linearService.listTeams({ organizationId });
  }

  /**
   * List the projects, labels and members of a Linear team
   */
  @Span()
  @ApiOperation({
    summary: 'List the options of a Linear team',
    description:
      'Retrieves the Linear projects, labels and members of a team, to configure and create tickets.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Linear team options listed',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/linear/teams/:teamId/options')
  @Permission('manage_integration')
  @SubjectType('organization')
  getTeamOptions(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
  ) {
    return this.linearService.getTeamOptions({ organizationId, teamId });
  }

  /**
   * Set the Linear team, project, labels and allowed branches of a CybeDefend project
   */
  @Span()
  @ApiOperation({
    summary: 'Configure Linear for CybeDefend project',
    description:
      'Sets the Linear team (and optionally the Linear project and labels) tickets are created in, and optionally restricts which branches can create Linear tickets.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: SetLinearConfigBodyDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Linear config set' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/project/:projectId/linear/config')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  setProjectLinearConfig(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SetLinearConfigBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} setting Linear config for project ${projectId}: team ${dto.teamId}`,
    );
    return this.linearService.setProjectLinearConfig({
      organizationId,
      projectId,
      teamId: dto.teamId,
      linearProjectId: dto.linearProjectId ?? '',
      labelIds: dto.labelIds ?? [],
      allowedBranches: dto.allowedBranches ?? [],
      autoCreateEnabled: dto.autoCreateEnabled ?? false,
    });
  }

  /**
   * Get Linear configuration for a project
   */
  @Span()
  @ApiOperation({
    summary: 'Get Linear configuration for project',
    description:
      'Retrieves the Linear team, project, labels and branch restrictions for a CybeDefend project.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Linear config retrieved',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/project/:projectId/linear/config')
  @Permission(['manage_integration', 'start_scan'])
  @SubjectType(['organization', 'project'])
  getProjectLinearConfig(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.linearService.getProjectLinearConfig({
      organizationId,
      projectId,
    });
  }

  /**
   * Remove Linear configuration from a project
   */
  @Span()
  @ApiOperation({
    summary: 'Remove Linear configuration from project',
    description: 'Removes the Linear mapping and branch restrictions.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Linear config removed' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId/project/:projectId/linear/config')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  removeProjectLinearConfig(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} removing Linear config for project ${projectId}`,
    );
    return this.linearService.removeProjectLinearConfig({
      organizationId,
      projectId,
    });
  }

  // ==================== Issue Endpoints ====================

  /**
   * Create Linear issues for vulnerabilities
   */
  @Span()
  @ApiOperation({
    summary: 'Create Linear issues for vulnerabilities',
    description:
      'Creates Linear tickets for selected vulnerabilities. Supports grouping by vulnerability, type, or file, and per-ticket team, project, labels, assignee and priority.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: CreateLinearIssuesBodyDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Linear issues created' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/project/:projectId/linear/issues')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  createIssues(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateLinearIssuesBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} creating Linear issues for project ${projectId}`,
    );

    return this.linearService.createIssues({
      projectId,
      organizationId,
      scanId: dto.scanId ?? '',
      mode: dto.mode,
      vulnerabilities: dto.vulnerabilities as VulnerabilityInfo[],
      cybedefendBaseUrl: this.cybedefendBaseUrl(dto.cybedefendBaseUrl),
      teamId: dto.teamId ?? '',
      linearProjectId: dto.linearProjectId ?? '',
      labelIds: dto.labelIds ?? [],
      assigneeId: dto.assigneeId ?? '',
      // Left absent (not 0) when the caller chose none: 0 means "no priority".
      priority: dto.priority,
    });
  }

  /**
   * Link vulnerabilities to an existing Linear issue
   */
  @Span()
  @ApiOperation({
    summary: 'Link vulnerabilities to existing Linear issue',
    description:
      'Links CybeDefend vulnerabilities to an existing Linear ticket, given by identifier or URL. Stores the links in CybeDefend and adds a CybeDefend attachment to the Linear issue; its description and fields are never changed.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: LinkLinearIssueBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vulnerabilities linked to Linear issue',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/project/:projectId/linear/issues/link')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  linkExistingIssue(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LinkLinearIssueBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} linking vulnerabilities to Linear issue ${dto.issueRef} for project ${projectId}`,
    );

    return this.linearService.linkExistingIssue({
      projectId,
      organizationId,
      issueRef: dto.issueRef,
      vulnerabilityIds: dto.vulnerabilityIds,
      scannerType: dto.scannerType,
      vulnerabilities: (dto.vulnerabilities as VulnerabilityInfo[]) ?? [],
      cybedefendBaseUrl: this.cybedefendBaseUrl(dto.cybedefendBaseUrl),
    });
  }

  /**
   * Get Linear issues for a project
   */
  @Span()
  @ApiOperation({
    summary: 'Get Linear issues for project',
    description:
      'Retrieves all Linear issues linked to vulnerabilities in a CybeDefend project.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Linear issues retrieved',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/project/:projectId/linear/issues')
  @Permission(['manage_integration', 'start_scan'])
  @SubjectType(['organization', 'project'])
  getProjectIssues(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.linearService.getProjectIssues({
      projectId,
      organizationId,
      state: 'all',
      vulnerabilityIds: [],
    });
  }

  /**
   * Sync Linear issue states
   */
  @Span()
  @ApiOperation({
    summary: 'Sync Linear issue states',
    description:
      'Fetches the current state of every linked Linear issue. Handles tickets moved to another team (new identifier and URL).',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'States synced' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post(
    '/organization/:organizationId/project/:projectId/linear/issues/sync-status',
  )
  @Permission(['manage_integration', 'start_scan'])
  @SubjectType(['organization', 'project'])
  syncIssueStatus(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.linearService.syncIssueStatus({ projectId, organizationId });
  }
}
