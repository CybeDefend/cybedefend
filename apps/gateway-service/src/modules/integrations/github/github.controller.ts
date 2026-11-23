import * as crypto from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
import { Redis } from 'ioredis';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import {
  assertLinkScanPermission,
  startScanPermission,
} from 'src/core/products/products';
import { GithubService } from './github.service';
import { CallbackInstallBodyDto } from './dto/body/callback-install-body.dto';
import { LinkRepositoryBodyDto } from './dto/body/link-repository-body.dto';
import { StartScanGithubBodyDto } from './dto/body/start-scan-github-body.dto';
import { UnLinkRepositoryBodyDto } from './dto/body/unlink-repository-body.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { Logger } from 'nestjs-pino';
import {
  CallbackInstallResponse,
  GetRepositoriesResponse,
  LinkRepositoryResponse,
  StartScanResponse,
} from '@grpc/external-integrations/github';
import {
  UNAUTHORIZED_EXAMPLE,
  FORBIDDEN_EXAMPLE,
  BAD_REQUEST_EXAMPLE,
} from '../../../core/constants/api-response-examples';

const GITHUB_INSTALL_STATE_TTL_SECONDS = 600;
const GITHUB_INSTALL_STATE_PREFIX = 'github_install_state:';
const INSTALL_STATE_FORMAT = /^[a-f0-9]{64}$/;
const INVALID_INSTALL_STATE_MESSAGE =
  'Invalid or expired installation state. Please restart the GitHub installation from the dashboard.';

@ApiTags('GitHub Integration')
@UseGuards(CombinedAuthRateLimitGuard)
@Controller()
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly logger: Logger,
    private readonly permissions: PermissionsGuard,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  /**
   * Issue a single-use state for a GitHub App installation
   */
  @Span()
  @ApiOperation({
    summary: 'Start a GitHub App installation (CSRF state)',
    description:
      'Issues a random, single-use state bound to the organization and the calling user, valid 10 minutes. The frontend adds it to the GitHub App installation URL as the `state` parameter; GitHub returns it on the redirect, and the install callback refuses any other state.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization installing the GitHub App',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'State issued',
    schema: {
      example: {
        state:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to install GitHub App',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/github/install/state')
  @Permission('manage_integration')
  @SubjectType('organization')
  async issueInstallState(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<{ state: string }> {
    const state = crypto.randomBytes(32).toString('hex');
    // Keyed by the state itself, not by organization: two administrators or
    // two tabs starting an installation do not overwrite each other's state.
    await this.redisClient.set(
      `${GITHUB_INSTALL_STATE_PREFIX}${state}`,
      JSON.stringify({ organizationId, userId: req.user.sub }),
      'EX',
      GITHUB_INSTALL_STATE_TTL_SECONDS,
    );
    return { state };
  }

  /**
   * Read and delete a state in one transaction (single use), and check it
   * was issued for this organization and this user. Without it, anyone could
   * install the App on their own account and send the resulting callback URL
   * to an administrator of another organization, binding their installation
   * to it. GETDEL is not used: the managed Redis version is not guaranteed to
   * have it.
   */
  private async consumeInstallState(
    state: unknown,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (typeof state !== 'string' || !INSTALL_STATE_FORMAT.test(state)) {
      throw new BadRequestException(INVALID_INSTALL_STATE_MESSAGE);
    }
    const key = `${GITHUB_INSTALL_STATE_PREFIX}${state}`;
    const results = await this.redisClient.multi().get(key).del(key).exec();
    const [getError, stored] = results?.[0] ?? [null, null];
    if (getError || typeof stored !== 'string') {
      throw new BadRequestException(INVALID_INSTALL_STATE_MESSAGE);
    }
    let issued: { organizationId?: unknown; userId?: unknown };
    try {
      issued = JSON.parse(stored);
    } catch {
      throw new BadRequestException(INVALID_INSTALL_STATE_MESSAGE);
    }
    if (
      !issued ||
      issued.organizationId !== organizationId ||
      issued.userId !== userId
    ) {
      throw new BadRequestException(INVALID_INSTALL_STATE_MESSAGE);
    }
  }

  /**
   * Link a CybeDefend project to a GitHub repository
   */
  @Span()
  @ApiOperation({
    summary: 'Link GitHub repository to project',
    description:
      'Creates a link between a GitHub repository and a CybeDefend project for automated scanning. Once linked, the project will receive webhook events from the repository for automated security scans.',
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
      'The unique identifier of the project to link with the GitHub repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: LinkRepositoryBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Repository linked successfully',
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
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/project/:projectId/github/link')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  async linkProject(
    @Req() req,
    @Body() linkRepositoryDto: LinkRepositoryBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<LinkRepositoryResponse> {
    // The link starts the repository's first scan, whose kind the body
    // chooses: check the permission of that scan, as the start-scan route does.
    await assertLinkScanPermission(
      this.permissions,
      req,
      projectId,
      linkRepositoryDto.product,
    );
    this.logger.log(
      `User ${req.user.sub} linking project ${projectId} with repository ${linkRepositoryDto.repositoryId}`,
    );
    return this.githubService.linkProject({
      organizationId,
      projectId,
      repositoryId: linkRepositoryDto.repositoryId,
      scanBranch: linkRepositoryDto.scanBranch || '',
      product: linkRepositoryDto.product,
    });
  }

  /**
   * Unlink a CybeDefend project from a GitHub repository
   */
  @Span()
  @ApiOperation({
    summary: 'Unlink GitHub repository from project',
    description:
      'Removes the link between a GitHub repository and a CybeDefend project. This will stop webhook events and automated scans for this repository.',
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
      'The unique identifier of the project to unlink from the GitHub repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: UnLinkRepositoryBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Repository unlinked successfully',
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
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId/project/:projectId/github/unlink')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  unLinkProject(
    @Req() req,
    @Body() unlinkRepositoryDto: UnLinkRepositoryBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<LinkRepositoryResponse> {
    this.logger.log(
      `User ${req.user.sub} unlinking project ${projectId} from repository ${unlinkRepositoryDto.repositoryId}`,
    );
    return this.githubService.unLinkProject({
      repositoryId: unlinkRepositoryDto.repositoryId,
      projectId,
      organizationId,
    });
  }

  /**
   * Handle GitHub App installation callback
   */
  @Span()
  @ApiOperation({
    summary: 'Handle GitHub App installation callback',
    description:
      'Processes the OAuth callback after GitHub App installation. This endpoint should be called by the frontend after the user authorizes the GitHub App.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization installing the GitHub App',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: CallbackInstallBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'GitHub App installed successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid callback parameters or installation failed',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to install GitHub App',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/github/install/callback')
  @Permission('manage_integration')
  @SubjectType('organization')
  async callbackInstall(
    @Req() req,
    @Body() callbackInstallDto: CallbackInstallBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<CallbackInstallResponse> {
    await this.consumeInstallState(
      callbackInstallDto.state,
      organizationId,
      req.user.sub,
    );
    this.logger.log(
      `User ${req.user.sub} installing Github App for organization ${organizationId} with installation ID ${callbackInstallDto.installationId}`,
    );
    return this.githubService.callbackInstall({
      installationId: callbackInstallDto.installationId,
      organizationId,
      userId: req.user.sub,
      code: callbackInstallDto.code,
    });
  }

  /**
   * Get GitHub repositories for an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Get GitHub repositories',
    description:
      'Retrieves all accessible GitHub repositories for an organization. Returns repositories from all GitHub installations associated with the organization.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization to fetch repositories for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Repositories retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to access repositories',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/github/repositories')
  @Permission('manage_integration')
  @SubjectType('organization')
  getRepositories(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<GetRepositoriesResponse> {
    return this.githubService.getRepositories({
      organizationId,
    });
  }

  /**
   * Get branches for a GitHub repository
   */
  @Span()
  @ApiOperation({
    summary: 'Get GitHub repository branches',
    description:
      'Retrieves all branches for a specific GitHub repository in an organization. Use this to populate branch selection when linking a repository.',
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
      'The unique identifier of the GitHub repository to fetch branches for',
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
  @UseGuards(PermissionsGuard)
  @Get(
    '/organization/:organizationId/github/repositories/:repositoryId/branches',
  )
  @Permission('manage_integration')
  @SubjectType('organization')
  getBranches(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('repositoryId', new ParseUUIDPipe()) repositoryId: string,
  ) {
    return this.githubService.getBranches({
      organizationId,
      repositoryId,
    });
  }

  /**
   * Start a scan for the latest commit on a GitHub repository
   */
  @Span()
  @ApiOperation({
    summary: 'Start GitHub repository scan',
    description:
      'Triggers an asynchronous security scan on the latest commit of a linked GitHub repository. The scan runs in the background and results can be retrieved via the analysis reporting endpoints.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the project associated with the GitHub repository',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: StartScanGithubBodyDto })
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
  // No static @Permission / PermissionsGuard: the permission depends on the
  // body's product (the closed product's permission for a graph-only scan,
  // start_scan otherwise), so the handler checks it, once.
  @Post('/project/:projectId/github/start-scan')
  async startScanForLastCommitAndProject(
    @Req() req: { user?: { sub?: string } },
    @Body() startScanDto: StartScanGithubBodyDto,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<StartScanResponse> {
    const userId = req.user?.sub;
    if (!userId) {
      throw new ForbiddenException('Permission denied');
    }
    const allowed = await this.permissions.checkPermission(
      projectId,
      'project',
      startScanPermission(startScanDto.product),
      userId,
    );
    if (!allowed) {
      throw new ForbiddenException('Permission denied');
    }
    this.logger.log(
      `User ${userId} starting scan for last commit on project ${projectId} with repository ${startScanDto.repositoryId}`,
    );
    return this.githubService.handleStartScanForLastCommitAndProject({
      projectId,
      repositoryId: startScanDto.repositoryId,
      branch: startScanDto.branch || '',
      ...(startScanDto.product ? { product: startScanDto.product } : {}),
    });
  }
}
