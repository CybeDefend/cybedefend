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
import { JiraService } from './jira.service';
import { JiraCallbackInstallBodyDto } from './dto/body/callback-install-body.dto';
import { SetJiraConfigBodyDto } from './dto/body/set-jira-config-body.dto';
import { CreateJiraIssuesBodyDto } from './dto/body/create-jira-issues-body.dto';
import { LinkJiraIssueBodyDto } from './dto/body/link-jira-issue-body.dto';
import { SyncJiraStatusBodyDto } from './dto/body/sync-jira-status-body.dto';
import {
  UNAUTHORIZED_EXAMPLE,
  FORBIDDEN_EXAMPLE,
  BAD_REQUEST_EXAMPLE,
} from '../../../core/constants/api-response-examples';

@ApiTags('Jira Integration')
@UseGuards(CombinedAuthRateLimitGuard)
@Controller()
export class JiraController {
  /**
   * Detect local/loopback URLs that Jira Cloud cannot reach.
   * Covers localhost, 127.x.x.x, 0.0.0.0, [::1], and .local suffixes.
   */
  static isLocalUrl(url: string): boolean {
    return /localhost|127\.\d|0\.0\.0\.0|\[::1\]|\.local(?:$|[:\/])/i.test(url);
  }

  constructor(
    private readonly jiraService: JiraService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  // ==================== Configuration Endpoints ====================

  /**
   * Generate Jira OAuth installation URL with CSRF state protection
   */
  @Span()
  @ApiOperation({
    summary: 'Generate Jira OAuth installation URL',
    description:
      'Creates an OAuth authorization URL for Jira integration setup. Includes CSRF protection via state parameter stored in Redis.',
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
  @Get('/organization/:organizationId/jira/oauth/url')
  @Permission('manage_integration')
  @SubjectType('organization')
  async generateInstallUrl(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<{ installUrl: string }> {
    const frontendUrls =
      this.configService
        .get<string>('FRONTEND_URL')
        ?.split(',')
        .map((u) => u.trim())
        .filter(Boolean) || [];
    const frontendUrl =
      frontendUrls.find((u) => !JiraController.isLocalUrl(u)) ||
      frontendUrls[0] ||
      '';
    const redirectUri = `${frontendUrl}/integrations/jira/callback`;

    const state = crypto.randomBytes(32).toString('hex');

    const redisKey = `jira_oauth_state:${organizationId}`;
    await this.redisClient.set(redisKey, state, 'EX', 600);

    const result = await this.jiraService.generateOAuthUrl({
      redirectUri,
      state,
    });

    return { installUrl: result.installUrl };
  }

  /**
   * Handle Jira OAuth installation callback
   */
  @Span()
  @ApiOperation({
    summary: 'Handle Jira OAuth installation callback',
    description:
      'Processes the OAuth callback after Jira authorization. This endpoint should be called by the frontend after the user authorizes the Jira App.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description: 'Organization ID',
  })
  @ApiBody({ type: JiraCallbackInstallBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Jira connected successfully',
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
  @Post('/organization/:organizationId/jira/install/callback')
  @Permission('manage_integration')
  @SubjectType('organization')
  async callbackInstall(
    @Req() req,
    @Body() dto: JiraCallbackInstallBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    // Validate CSRF state
    const redisKey = `jira_oauth_state:${organizationId}`;
    const storedState = await this.redisClient.get(redisKey);
    if (!storedState || storedState !== dto.state) {
      throw new BadRequestException(
        'Invalid or expired OAuth state. Please restart the Jira installation.',
      );
    }
    await this.redisClient.del(redisKey);

    this.logger.log(
      `User ${req.user.sub} installing Jira for organization ${organizationId}`,
    );
    return this.jiraService.callbackInstall({
      organizationId,
      userId: req.user.sub,
      code: dto.code,
      redirectUri: dto.redirectUri,
    });
  }

  /**
   * Get Jira installation for an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Get Jira installation status',
    description:
      'Checks whether Jira is connected for an organization and returns installation details.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Jira installation details retrieved',
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
  @Get('/organization/:organizationId/jira/installation')
  @Permission('manage_integration')
  @SubjectType('organization')
  getInstallation(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    // Pass-through. "No integration" is answered by external-integrations with
    // isConfigured=false and reaches the client as a normal 200 — see
    // libs/protos/external-integrations/jira.proto. Error mapping stays where
    // the other 40 gateway controllers put it: safeGrpcCall in the service
    // layer, which turns a real gRPC failure into the right HTTP status. A
    // transport failure must never be flattened into "not configured".
    return this.jiraService.getInstallationForOrga({ organizationId });
  }

  /**
   * Disconnect Jira from an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Disconnect Jira from organization',
    description:
      'Removes the Jira integration. Stops all Jira ticket creation and removes project configurations. Idempotent: succeeds even when the organization has no Jira integration.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira disconnected' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId/jira/disconnect')
  @Permission('manage_integration')
  @SubjectType('organization')
  disconnect(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} disconnecting Jira for organization ${organizationId}`,
    );
    return this.jiraService.disconnect({ organizationId });
  }

  /**
   * List Jira projects accessible to the connected account
   */
  @Span()
  @ApiOperation({
    summary: 'List Jira projects',
    description:
      'Retrieves all accessible Jira projects from the connected Jira Cloud site.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira projects listed' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/jira/projects')
  @Permission('manage_integration')
  @SubjectType('organization')
  listJiraProjects(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.jiraService.listJiraProjects({ organizationId });
  }

  /**
   * Set default Jira project and allowed branches for a CybeDefend project
   */
  @Span()
  @ApiOperation({
    summary: 'Configure Jira project for CybeDefend project',
    description:
      'Sets the default Jira project and optionally restricts which branches can create Jira tickets.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: SetJiraConfigBodyDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira config set' })
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
  @Post('/organization/:organizationId/project/:projectId/jira/config')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  setProjectJiraConfig(
    @Req() req,
    @Body() dto: SetJiraConfigBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} setting Jira config for project ${projectId}: ${dto.jiraProjectKey}`,
    );
    return this.jiraService.setProjectJiraConfig({
      organizationId,
      projectId,
      jiraProjectId: dto.jiraProjectId,
      jiraProjectKey: dto.jiraProjectKey,
      jiraProjectName: dto.jiraProjectName,
      allowedBranches: dto.allowedBranches || [],
      autoCreateEnabled: dto.autoCreateEnabled ?? false,
    });
  }

  /**
   * Get Jira configuration for a project
   */
  @Span()
  @ApiOperation({
    summary: 'Get Jira configuration for project',
    description:
      'Retrieves the Jira project mapping and branch restrictions for a CybeDefend project.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira config retrieved' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/project/:projectId/jira/config')
  @Permission(['manage_integration', 'start_scan'])
  @SubjectType(['organization', 'project'])
  getProjectJiraConfig(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.jiraService.getProjectJiraConfig({ organizationId, projectId });
  }

  /**
   * Remove Jira configuration from a project
   */
  @Span()
  @ApiOperation({
    summary: 'Remove Jira configuration from project',
    description: 'Removes the Jira project mapping and branch restrictions.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira config removed' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId/project/:projectId/jira/config')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  removeProjectJiraConfig(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} removing Jira config for project ${projectId}`,
    );
    return this.jiraService.removeProjectJiraConfig({
      organizationId,
      projectId,
    });
  }

  // ==================== Issue Endpoints ====================

  /**
   * Create Jira issues for vulnerabilities
   */
  @Span()
  @ApiOperation({
    summary: 'Create Jira issues for vulnerabilities',
    description:
      'Creates Jira tickets for selected vulnerabilities. Supports grouping by vulnerability, type, or file.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: CreateJiraIssuesBodyDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira issues created' })
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
  @Post('/organization/:organizationId/project/:projectId/jira/issues')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  createIssues(
    @Req() req,
    @Body() dto: CreateJiraIssuesBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} creating Jira issues for project ${projectId}`,
    );
    // Prefer server-configured FRONTEND_URL, but skip localhost since Jira
    // Cloud can't reach it — fall back to client-provided origin instead
    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      ?.split(',')[0]
      ?.trim();
    const cybedefendBaseUrl =
      frontendUrl && !JiraController.isLocalUrl(frontendUrl)
        ? frontendUrl
        : dto.cybedefendBaseUrl;

    return this.jiraService.createIssues({
      projectId,
      organizationId,
      scanId: dto.scanId,
      mode: dto.mode,
      vulnerabilities: dto.vulnerabilities as any,
      cybedefendBaseUrl,
      jiraProjectKey: dto.jiraProjectKey || '',
    });
  }

  /**
   * Link vulnerabilities to an existing Jira issue
   */
  @Span()
  @ApiOperation({
    summary: 'Link vulnerabilities to existing Jira issue',
    description:
      'Links CybeDefend vulnerabilities to an existing Jira ticket. Only updates the CybeDefend database — does not modify the Jira issue.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiBody({ type: LinkJiraIssueBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vulnerabilities linked to Jira issue',
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
  @Post('/organization/:organizationId/project/:projectId/jira/issues/link')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  linkExistingIssue(
    @Req() req,
    @Body() dto: LinkJiraIssueBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    this.logger.log(
      `User ${req.user.sub} linking vulnerabilities to Jira issue ${dto.jiraIssueKey} for project ${projectId}`,
    );
    // Same FRONTEND_URL logic as createIssues
    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      ?.split(',')[0]
      ?.trim();
    const cybedefendBaseUrl =
      frontendUrl && !JiraController.isLocalUrl(frontendUrl)
        ? frontendUrl
        : dto.cybedefendBaseUrl || '';

    return this.jiraService.linkExistingIssue({
      projectId,
      organizationId,
      jiraIssueKey: dto.jiraIssueKey,
      vulnerabilityIds: dto.vulnerabilityIds,
      scannerType: dto.scannerType,
      vulnerabilities: (dto.vulnerabilities as any) || [],
      cybedefendBaseUrl,
    });
  }

  /**
   * Get Jira issues for a project
   */
  @Span()
  @ApiOperation({
    summary: 'Get Jira issues for project',
    description:
      'Retrieves all Jira issues linked to vulnerabilities in a CybeDefend project.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Jira issues retrieved' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/project/:projectId/jira/issues')
  @Permission(['manage_integration', 'start_scan'])
  @SubjectType(['organization', 'project'])
  getProjectIssues(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.jiraService.getProjectIssues({
      projectId,
      organizationId,
      state: 'all',
      vulnerabilityIds: [],
    });
  }

  /**
   * Sync Jira issue statuses
   */
  @Span()
  @ApiOperation({
    summary: 'Sync Jira issue statuses',
    description:
      'Fetches current statuses from Jira for all linked issues. Handles ticket moves between Jira projects.',
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Statuses synced' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post(
    '/organization/:organizationId/project/:projectId/jira/issues/sync-status',
  )
  @Permission(['manage_integration', 'start_scan'])
  @SubjectType(['organization', 'project'])
  syncIssueStatus(
    @Body() body: SyncJiraStatusBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.jiraService.getIssueStatus({
      projectId,
      organizationId,
      externalIssueKeys: body.externalIssueKeys || [],
    });
  }
}
