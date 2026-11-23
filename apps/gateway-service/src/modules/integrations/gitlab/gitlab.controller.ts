import * as crypto from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Logger,
  Req,
  HttpStatus,
  ParseUUIDPipe,
  Inject,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Span } from 'nestjs-otel';
import { GitlabService } from './gitlab.service';
import { CombinedAuthRateLimitGuard } from '../../../core/guards/combined-auth-rate-limit.guard';
import { GitlabCallbackInstallDto } from './dto/callback-install-body.dto';
import { LinkGitlabRepositoryDto } from './dto/link-repository-body.dto';
import { UnlinkGitlabRepositoryDto } from './dto/unlink-repository-body.dto';
import { StartScanGitlabBodyDto } from './dto/start-scan-gitlab-body.dto';
import { gitlabWebOrigin } from './gitlab-origin';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import {
  assertLinkScanPermission,
  startScanPermission,
} from 'src/core/products/products';
import SecretsService from 'src/core/secrets/secrets.service';
import { Redis } from 'ioredis';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import {
  GetGitlabRepositoriesResponse,
  GitlabCallbackInstallResponse,
  GitlabLinkRepositoryResponse,
  StartGitlabScanResponse,
  DisconnectGitlabResponse,
} from '@grpc/external-integrations/gitlab';
import { ConfigService } from '@nestjs/config';
import {
  UNAUTHORIZED_EXAMPLE,
  FORBIDDEN_EXAMPLE,
  BAD_REQUEST_EXAMPLE,
} from '../../../core/constants/api-response-examples';

/** The refusal of the connect route on an instance without a GitLab OAuth application. */
export const GITLAB_NOT_CONFIGURED = 'GITLAB_NOT_CONFIGURED';

/**
 * GitLab Integration Controller
 * Handles REST endpoints for GitLab OAuth, repository management, and scanning
 */
@Controller('integrations/gitlab')
@UseGuards(CombinedAuthRateLimitGuard)
@ApiTags('GitLab Integration')
export class GitlabController {
  constructor(
    private readonly gitlabService: GitlabService,
    private readonly secretsService: SecretsService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    private readonly permissions: PermissionsGuard,
  ) {}

  /**
   * Generate GitLab OAuth installation URL
   */
  @Post('install/:organizationId')
  @UseGuards(PermissionsGuard)
  @Permission('manage_integration')
  @SubjectType('organization')
  @ApiOperation({
    summary: 'Generate GitLab OAuth installation URL',
    description:
      'Creates an OAuth authorization URL for GitLab integration setup. The URL includes CSRF protection via state parameter stored in Redis. Redirect the user to this URL to begin GitLab authorization.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization to set up GitLab integration for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OAuth installation URL generated successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to configure GitLab integration',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async generateInstallUrl(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<{ installUrl: string }> {
    this.logger.log(
      `Generating GitLab OAuth installation URL for organization: ${organizationId}`,
      GitlabController.name,
    );

    const clientId = await this.secretsService.getSecret(
      'GITLAB_APPLICATION_ID',
    );
    // GitLab is optional on an instance: without its OAuth application the
    // authorize URL would carry no client id and fail on GitLab's side.
    if (!clientId) {
      throw new BadRequestException(GITLAB_NOT_CONFIGURED);
    }

    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      .replaceAll(/\/$/g, '');
    const redirectUri = `${frontendUrl}/integrations/gitlab/callback`;

    const state = crypto.randomBytes(16).toString('hex');
    const scope = 'api read_user read_repository write_repository';

    // Save state to Redis for CSRF protection
    const redisKey = `gitlab_oauth_state:${organizationId}`;
    await this.redisClient.set(redisKey, state, 'EX', 600);
    this.logger.log(`Saved state to Redis for key: ${redisKey}`);

    const installUrl = `${gitlabWebOrigin(
      this.configService.get<string>('GITLAB_API_URL'),
    )}/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&response_type=code&state=${state}&scope=${encodeURIComponent(scope)}`;

    return { installUrl };
  }

  /**
   * Handle GitLab OAuth callback
   */
  @Post('organization/:organizationId/install/callback')
  @UseGuards(PermissionsGuard)
  @Permission('manage_integration')
  @SubjectType('organization')
  @ApiOperation({
    summary: 'Handle GitLab OAuth callback',
    description:
      'Processes the OAuth callback and completes GitLab integration setup. This endpoint exchanges the authorization code for access tokens and stores the credentials for repository access.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization completing GitLab integration',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: GitlabCallbackInstallDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'GitLab integration completed successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid OAuth callback parameters, state mismatch, or token exchange failed',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to complete GitLab integration',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async callbackInstall(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: GitlabCallbackInstallDto,
    @Req() request: Request,
  ): Promise<GitlabCallbackInstallResponse> {
    this.logger.log(
      `Processing GitLab OAuth callback for organization: ${organizationId}`,
      GitlabController.name,
    );

    const userId = (request as any).user?.sub;
    return await this.gitlabService.callbackInstall(
      organizationId,
      userId,
      body.code,
      body.state,
    );
  }

  /**
   * Get GitLab repositories for organization
   */
  @Get('organization/:organizationId/repositories')
  @UseGuards(PermissionsGuard)
  @Permission('manage_integration')
  @SubjectType('organization')
  @ApiOperation({
    summary: 'Get GitLab repositories',
    description:
      'Retrieves all synchronized GitLab repositories for an organization. Returns repositories that the authenticated GitLab user has access to.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization to fetch GitLab repositories for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'GitLab repositories retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to access GitLab repositories',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async getRepositories(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<GetGitlabRepositoriesResponse> {
    return await this.gitlabService.getRepositories(organizationId);
  }

  /**
   * Link GitLab repository to project
   */
  @Post('organization/:organizationId/project/:projectId/link')
  @UseGuards(PermissionsGuard)
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  @ApiOperation({
    summary: 'Link GitLab repository to project',
    description:
      'Creates a link between a GitLab repository and a CybeDefend project. Once linked, the project will receive webhook events from the repository for automated security scans.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization that owns the project',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the project to link with the GitLab repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: LinkGitlabRepositoryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'GitLab repository linked successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters or repository already linked',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to link repository',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async linkRepository(
    @Req() req: { user?: { sub?: string } },
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId') projectId: string,
    @Body() body: LinkGitlabRepositoryDto,
  ): Promise<GitlabLinkRepositoryResponse> {
    // The link starts the repository's first scan, whose kind the body
    // chooses: check the permission of that scan, as the start-scan route does.
    await assertLinkScanPermission(
      this.permissions,
      req,
      projectId,
      body.product,
    );
    this.logger.log(
      `Linking GitLab repository ${body.repositoryId} to project ${projectId}`,
      GitlabController.name,
    );

    return await this.gitlabService.linkProjectToRepository(
      organizationId,
      projectId,
      body.repositoryId,
      body.scanBranch,
      body.product,
    );
  }

  /**
   * Unlink GitLab repository from project
   */
  @Delete('organization/:organizationId/project/:projectId/unlink')
  @UseGuards(PermissionsGuard)
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  @ApiOperation({
    summary: 'Unlink GitLab repository from project',
    description:
      'Removes the link between a GitLab repository and a CybeDefend project. This will stop webhook events and automated scans for this repository.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization that owns the project',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the project to unlink from the GitLab repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: UnlinkGitlabRepositoryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'GitLab repository unlinked successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters or repository not linked',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to unlink repository',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async unlinkRepository(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId') projectId: string,
    @Body() body: UnlinkGitlabRepositoryDto,
  ): Promise<GitlabLinkRepositoryResponse> {
    this.logger.log(
      `Unlinking GitLab repository ${body.repositoryId} from project ${projectId}`,
      GitlabController.name,
    );

    return await this.gitlabService.unlinkProjectFromRepository(
      organizationId,
      projectId,
      body.repositoryId,
    );
  }

  /**
   * Start scan for GitLab repository
   */
  // No static @Permission / PermissionsGuard: the permission depends on the
  // body's product (the closed product's permission for a graph-only scan,
  // start_scan otherwise), so the handler checks it, once.
  @Post('project/:projectId/start-scan')
  @ApiOperation({
    summary: 'Start GitLab repository scan',
    description:
      'Triggers an asynchronous security scan on the latest commit of a linked GitLab repository. The scan runs in the background and results can be retrieved via the analysis reporting endpoints.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the project associated with the GitLab repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: StartScanGitlabBodyDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Scan request accepted and processing asynchronously',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters or repository not linked',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to start scan',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async startScan(
    @Req() req: { user?: { sub?: string } },
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: StartScanGitlabBodyDto,
  ): Promise<StartGitlabScanResponse> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new ForbiddenException('Permission denied');
    }
    const allowed = await this.permissions.checkPermission(
      projectId,
      'project',
      startScanPermission(body.product),
      userId,
    );
    if (!allowed) {
      throw new ForbiddenException('Permission denied');
    }
    this.logger.log(
      `Starting scan for GitLab repository ${body.repositoryId} in project ${projectId}`,
      GitlabController.name,
    );

    return await this.gitlabService.startScanForLastCommit(
      projectId,
      body.repositoryId,
      body.branch,
      body.product,
    );
  }

  /**
   * Get branches for GitLab repository
   */
  @Get('/organization/:organizationId/repositories/:repositoryId/branches')
  @UseGuards(PermissionsGuard)
  @Permission('manage_integration')
  @SubjectType('organization')
  @ApiOperation({
    summary: 'Get GitLab repository branches',
    description:
      'Retrieves all branches for a specific GitLab repository. Use this to populate branch selection when linking a repository.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization that owns the repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiParam({
    name: 'repositoryId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the GitLab repository to fetch branches for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Branches retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to access repository branches',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async getBranches(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('repositoryId', new ParseUUIDPipe()) repositoryId: string,
  ) {
    return await this.gitlabService.getBranches(organizationId, repositoryId);
  }

  /**
   * Disconnect GitLab from an organization
   */
  @Delete('organization/:organizationId/disconnect')
  @UseGuards(PermissionsGuard)
  @Permission('manage_integration')
  @SubjectType('organization')
  @ApiOperation({
    summary: 'Disconnect GitLab from an organization',
    description:
      'Deletes the webhooks CybeDefend registered on the linked GitLab projects and revokes the token (both best effort), then removes the connection: every project of the organization loses its link to its GitLab repository and push-triggered scans stop. Scan history and vulnerabilities are kept. Idempotent: succeeds when the organization has no GitLab connection.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the organization',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'GitLab disconnected (or was not connected)',
    schema: {
      example: { success: true, message: 'GitLab integration disconnected' },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Insufficient permissions to manage the organization integrations',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Span()
  async disconnect(
    @Req() request: Request,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<DisconnectGitlabResponse> {
    const userId = (request as Request & { user?: { sub?: string } }).user?.sub;
    this.logger.log(
      `User ${userId} disconnecting GitLab for organization ${organizationId}`,
    );
    return await this.gitlabService.disconnect(organizationId);
  }
}
