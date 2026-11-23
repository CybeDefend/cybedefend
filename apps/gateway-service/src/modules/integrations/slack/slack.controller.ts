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
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { Feature } from 'src/core/guards/feature/feature.decorator';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { Logger } from 'nestjs-pino';
import { SlackService } from './slack.service';
import { SlackCallbackInstallBodyDto } from './dto/body/callback-install-body.dto';
import { SetChannelBodyDto } from './dto/body/set-channel-body.dto';
import {
  SlackCallbackInstallResponse,
  GetSlackInstallationForOrgaResponse,
  SlackGenericResponse,
  ListSlackChannelsResponse,
  SetProjectSlackChannelResponse,
  GetProjectSlackChannelResponse,
} from '@grpc/external-integrations/slack';
import {
  UNAUTHORIZED_EXAMPLE,
  FORBIDDEN_EXAMPLE,
  BAD_REQUEST_EXAMPLE,
} from '../../../core/constants/api-response-examples';

const SLACK_OAUTH_STATE_TTL_SECONDS = 600;
const SLACK_OAUTH_STATE_PREFIX = 'slack_oauth_state:';
const INVALID_STATE_MESSAGE =
  'Invalid or expired OAuth state. Please restart the Slack installation.';

@ApiTags('Slack Integration')
// Authentication on the class. The plan check is on each route, after its
// PermissionsGuard, so a caller Permify refuses never learns whether the
// organization has the plan.
@UseGuards(CombinedAuthRateLimitGuard)
@Feature('slack')
@Controller()
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    private readonly logger: Logger,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  /**
   * Issue a single-use OAuth state for a Slack installation
   */
  @Span()
  @ApiOperation({
    summary: 'Start a Slack installation (CSRF state)',
    description:
      'Issues a random, single-use OAuth state bound to the organization and the calling user, valid 10 minutes. The frontend sends it to Slack as the `state` parameter and back to the install callback, which refuses any other state.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization installing the Slack App',
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
    description: 'Insufficient permissions to install Slack App',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Post('/organization/:organizationId/slack/install/state')
  @Permission('manage_integration')
  @SubjectType('organization')
  async issueInstallState(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<{ state: string }> {
    const state = crypto.randomBytes(32).toString('hex');
    // Keyed by the state itself, not by organization: two admins or two tabs
    // starting an installation do not overwrite each other's state.
    await this.redisClient.set(
      `${SLACK_OAUTH_STATE_PREFIX}${state}`,
      JSON.stringify({ organizationId, userId: req.user.sub }),
      'EX',
      SLACK_OAUTH_STATE_TTL_SECONDS,
    );
    return { state };
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
    const key = `${SLACK_OAUTH_STATE_PREFIX}${state}`;
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

  /**
   * Handle Slack OAuth installation callback
   */
  @Span()
  @ApiOperation({
    summary: 'Handle Slack OAuth installation callback',
    description:
      'Processes the OAuth callback after Slack App installation. This endpoint should be called by the frontend after the user authorizes the Slack App.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization installing the Slack App',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: SlackCallbackInstallBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Slack App installed successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid callback parameters, invalid or expired OAuth state, or installation failed',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to install Slack App',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Post('/organization/:organizationId/slack/install/callback')
  @Permission('manage_integration')
  @SubjectType('organization')
  async callbackInstall(
    @Req() req,
    @Body() callbackInstallDto: SlackCallbackInstallBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<SlackCallbackInstallResponse> {
    // CSRF: the code must come from an installation this user started for
    // this organization, or a link carrying a code for someone else's
    // workspace would bind it to this organization.
    await this.consumeInstallState(
      callbackInstallDto.state,
      organizationId,
      req.user.sub,
    );
    this.logger.log(
      `User ${req.user.sub} installing Slack App for organization ${organizationId}`,
    );
    return this.slackService.callbackInstall({
      organizationId,
      userId: req.user.sub,
      code: callbackInstallDto.code,
      redirectUri: callbackInstallDto.redirectUri,
    });
  }

  /**
   * Get Slack installation for an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Get Slack installation status',
    description:
      'Checks whether Slack is connected for an organization and returns installation details if available.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization to check Slack installation for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Slack installation details retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to view integration',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Get('/organization/:organizationId/slack/installation')
  @Permission('manage_integration')
  @SubjectType('organization')
  getInstallation(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<GetSlackInstallationForOrgaResponse> {
    // Pass-through. "No integration" is answered by external-integrations with
    // isConfigured=false and reaches the client as a normal 200 — see
    // libs/protos/external-integrations/slack.proto. Error mapping stays where
    // the other 40 gateway controllers put it: safeGrpcCall in the service
    // layer, which turns a real gRPC failure into the right HTTP status. A
    // transport failure must never be flattened into "not configured".
    return this.slackService.getInstallationForOrga({ organizationId });
  }

  /**
   * Disconnect Slack from an organization
   */
  @Span()
  @ApiOperation({
    summary: 'Disconnect Slack from organization',
    description:
      'Removes the Slack integration for the organization. This will stop all Slack notifications and remove all project channel mappings. Idempotent: succeeds even when the organization has no Slack integration.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization to disconnect Slack from',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Slack disconnected successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to disconnect Slack',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Delete('/organization/:organizationId/slack/disconnect')
  @Permission('manage_integration')
  @SubjectType('organization')
  disconnect(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<SlackGenericResponse> {
    this.logger.log(
      `User ${req.user.sub} disconnecting Slack for organization ${organizationId}`,
    );
    return this.slackService.disconnect({ organizationId });
  }

  /**
   * List Slack workspace channels for an organization
   */
  @Span()
  @ApiOperation({
    summary: 'List Slack workspace channels',
    description:
      'Retrieves all accessible channels from the connected Slack workspace for the organization.',
  })
  @ApiParam({
    name: 'organizationId',
    type: 'string',
    format: 'uuid',
    description:
      'The unique identifier of the organization to list channels for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Channels retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to view channels',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Get('/organization/:organizationId/slack/channels')
  @Permission('manage_integration')
  @SubjectType('organization')
  listChannels(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<ListSlackChannelsResponse> {
    return this.slackService.listChannels({ organizationId });
  }

  /**
   * Set Slack channel for a project
   */
  @Span()
  @ApiOperation({
    summary: 'Set Slack notification channel for project',
    description:
      'Maps a Slack channel to a CybeDefend project. Notifications for this project (scan results, alerts) will be sent to the specified channel.',
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
    description: 'The unique identifier of the project to set the channel for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: SetChannelBodyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Channel set successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters or Slack not connected',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to manage integration',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Post('/organization/:organizationId/project/:projectId/slack/channel')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  setProjectChannel(
    @Req() req,
    @Body() setChannelDto: SetChannelBodyDto,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<SetProjectSlackChannelResponse> {
    this.logger.log(
      `User ${req.user.sub} setting Slack channel ${setChannelDto.channelId} for project ${projectId}`,
    );
    return this.slackService.setProjectChannel({
      organizationId,
      projectId,
      channelId: setChannelDto.channelId,
      channelName: setChannelDto.channelName,
    });
  }

  /**
   * Remove Slack channel mapping from a project
   */
  @Span()
  @ApiOperation({
    summary: 'Remove Slack notification channel from project',
    description:
      'Removes the Slack channel mapping from a project. Notifications will no longer be sent to Slack for this project.',
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
      'The unique identifier of the project to remove the channel from',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Channel mapping removed successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'No channel mapping exists for this project',
    schema: { example: BAD_REQUEST_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to manage integration',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Delete('/organization/:organizationId/project/:projectId/slack/channel')
  @Permission(['manage_integration', 'update'])
  @SubjectType(['organization', 'project'])
  removeProjectChannel(
    @Req() req,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<SlackGenericResponse> {
    this.logger.log(
      `User ${req.user.sub} removing Slack channel for project ${projectId}`,
    );
    return this.slackService.removeProjectChannel({
      organizationId,
      projectId,
    });
  }

  /**
   * Get current Slack channel mapping for a project
   */
  @Span()
  @ApiOperation({
    summary: 'Get Slack notification channel for project',
    description:
      'Retrieves the current Slack channel mapping for a project, including whether a channel is configured.',
  })
  @ApiParam({
    name: 'projectId',
    type: 'string',
    format: 'uuid',
    description: 'The unique identifier of the project to get the channel for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Channel mapping retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication token is missing or invalid',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to view integration',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @UseGuards(PermissionsGuard, FeatureGuard)
  @Get('/project/:projectId/slack/channel')
  @Permission('start_scan')
  @SubjectType('project')
  getProjectChannel(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<GetProjectSlackChannelResponse> {
    return this.slackService.getProjectChannel({ projectId });
  }
}
