import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  FORBIDDEN_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from 'src/core/constants/api-response-examples';
import { ErrorDto } from 'src/core/constants/error.dto';
import {
  Permission,
  SubjectType,
} from 'src/core/guards/permissions/decorator/permission.decorator';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { TeamService } from './team.service';
import { TeamAddMemberBodyDto } from './dto/body/team-add-member-body.dto';
import { TeamCreateBodyDto } from './dto/body/team-create-body.dto';
import { TeamGetMembersBodyDto } from './dto/body/team-get-members-body.dto';
import { TeamRemoveUserBodyDto } from './dto/body/team-remove-user-body.dto';
import { TeamUpdateBodyDto } from './dto/body/team-update-body.dto';
import { UpdateTeamRoleBodyDto } from './dto/body/team-update-role-body.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  TeamInformationsResponse,
  TeamGetRequest,
  TeamInformationsList,
  TeamGetAllRequest,
  TeamCreateRequest,
  TeamCreateResponse,
  TeamUpdateRequest,
  TeamUpdateResponse,
  TeamDeleteRequest,
  TeamDeleteResponse,
  TeamAddMemberRequest,
  TeamAddMemberResponse,
  TeamRemoveUserResponse,
  TeamRemoveUserRequest,
  UpdateTeamRoleRequest,
  UpdateTeamRoleResponse,
  TeamGetMembersRequest,
  PaginatedUsersResponse,
  TeamGetMemberRequest,
} from '@grpc/global-management/team';
import { UserInformationsResponse } from '@grpc/global-management/user';
import { TeamInformationsResponseDto } from './dto/response/team-informations-response.dto';
import { TeamCreateResponseDto } from './dto/response/team-create-response.dto';
import { TeamUpdateResponseDto } from './dto/response/team-update-response.dto';
import { TeamDeleteResponseDto } from './dto/response/team-delete-response.dto';
import { TeamAddUserResponseDto } from './dto/response/team-add-user-response.dto';
import { TeamRemoveUserResponseDto } from './dto/response/team-remove-user-response.dto';
import { UpdateTeamRoleResponseDto } from './dto/response/update-team-role-response.dto';
import { PaginatedUsersResponseDto } from '../organization/dto/response/paginated-users-response.dto';
import { UserInformationsResponseDto } from '../user/dto/response/user-informations-response.dto';
import { Logger } from 'nestjs-pino';

@ApiTags('Team')
@Controller()
@UseGuards(CombinedAuthRateLimitGuard)
export class TeamController {
  constructor(
    private readonly TeamService: TeamService,
    private readonly logger: Logger,
  ) {}

  /**
   * Get team by ID
   *
   * @param teamId Team ID
   * @param organizationId Organization ID
   * @param req Request HTTP
   * @returns Team informations
   */
  @Span()
  @ApiOperation({ summary: 'Get team by ID' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Team informations',
    type: TeamInformationsResponseDto,
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
  @SubjectType('team')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/team/:teamId')
  getTeam(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Param('organizationId', new ParseUUIDPipe()) organizationId,
  ): Promise<TeamInformationsResponse> {
    const data: TeamGetRequest = {
      teamId: teamId,
      organizationId: organizationId,
    };
    return this.TeamService.getTeam(data);
  }

  /**
   * Get all teams of an organization
   *
   * @param organizationId Organization ID
   * @param req Request HTTP
   * @returns All teams of an organization
   */
  @Span()
  @ApiOperation({ summary: 'Get all teams of an organization' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'All teams of an organization',
    type: [TeamInformationsResponseDto],
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
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/teams')
  getTeams(
    @Param('organizationId', new ParseUUIDPipe()) organizationId,
    @Req() req,
  ): Promise<TeamInformationsList> {
    const data: TeamGetAllRequest = {
      organizationId: organizationId,
      userId: req.user.sub,
    };
    return this.TeamService.getAllTeams(data);
  }

  /**
   * Create a new team
   *
   * @param organizationId Organization ID
   * @param req Request HTTP
   * @param body Request body to create a team
   * @returns Team created
   */
  @Span()
  @ApiOperation({ summary: 'Create a new team' })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiBody({ type: TeamCreateBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Team created',
    type: TeamCreateResponseDto,
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
  @SubjectType('organization')
  @Permission('create_team')
  @UseGuards(PermissionsGuard)
  @Post('/organization/:organizationId/team')
  createTeam(
    @Param('organizationId', new ParseUUIDPipe()) organizationId,
    @Req() req,
    @Body() body: TeamCreateBodyDto,
  ): Promise<TeamCreateResponse> {
    this.logger.log(
      `User ${req.user.sub} is creating a team in organization ${organizationId}`,
    );
    const data: TeamCreateRequest = {
      organizationId: organizationId,
      name: body.name,
      description: body.description,
      creatorId: req.user.sub,
    };
    return this.TeamService.createTeam(data);
  }

  /**
   * Update a team
   *
   * @param teamId Team ID
   * @param req Request HTTP
   * @param body Request body to update a team
   * @returns Team updated
   */
  @Span()
  @ApiOperation({ summary: 'Update a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiBody({ type: TeamUpdateBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Team updated',
    type: TeamUpdateResponseDto,
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
  @SubjectType('team')
  @Permission('manage')
  @UseGuards(PermissionsGuard)
  @Put('/team/:teamId')
  updateTeam(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Body() body: TeamUpdateBodyDto,
    @Req() req,
  ): Promise<TeamUpdateResponse> {
    this.logger.log(`User ${req.user.sub} is updating team ${teamId}`);
    const data: TeamUpdateRequest = {
      teamId: teamId,
      name: body.name,
      description: body.description,
    };
    return this.TeamService.updateTeam(data);
  }

  /**
   * Delete a team
   *
   * @param teamId Team ID
   * @param req Request HTTP
   * @param body Request body to delete a team
   * @returns Team deleted
   */
  @Span()
  @ApiOperation({ summary: 'Delete a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Team deleted',
    type: TeamDeleteResponseDto,
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
  @SubjectType('team')
  @Permission('manage')
  @UseGuards(PermissionsGuard)
  @Delete('/team/:teamId')
  deleteTeam(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Req() req,
  ): Promise<TeamDeleteResponse> {
    this.logger.log(`User ${req.user.sub} is deleting team ${teamId}`);
    const data: TeamDeleteRequest = {
      teamId: teamId,
    };
    return this.TeamService.deleteTeam(data);
  }

  /**
   * Add a member to a team
   *
   * @param teamId Team ID
   * @param req Request HTTP
   * @param body Request body to add a member to a team
   * @returns Member added to team
   */
  @Span()
  @ApiOperation({ summary: 'Add a member to a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiBody({ type: TeamAddMemberBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Member added to team',
    type: TeamAddUserResponseDto,
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
  @SubjectType('team')
  @Permission('add_user')
  @UseGuards(PermissionsGuard)
  @Post('/team/:teamId/member')
  TeamAddMember(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Req() req,
    @Body() body: TeamAddMemberBodyDto,
  ): Promise<TeamAddMemberResponse> {
    this.logger.log(
      `User ${req.user.sub} is adding user ${body.userId} to team ${teamId} with role ${body.role}`,
    );
    const data: TeamAddMemberRequest = {
      teamId: teamId,
      userId: body.userId,
      role: body.role,
    };
    return this.TeamService.addMember(data);
  }

  /**
   * Remove a member from a team
   *
   * @param teamId Team ID
   * @param req Request HTTP
   * @param body Request body to remove a member from a team
   * @returns Member removed from team
   */
  @Span()
  @ApiOperation({ summary: 'Remove a member from a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiBody({ type: TeamRemoveUserBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Member removed from team',
    type: TeamRemoveUserResponseDto,
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
  @SubjectType('team')
  @Permission('remove_user')
  @UseGuards(PermissionsGuard)
  @Delete('/team/:teamId/member')
  deleteTeamMember(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Req() req,
    @Body() body: TeamRemoveUserBodyDto,
  ): Promise<TeamRemoveUserResponse> {
    this.logger.log(
      `User ${req.user.sub} is removing user ${body.userId} from team ${teamId}`,
    );
    // The requester is the token's subject, never a body field: removing a
    // team manager is the organization creator's or an administrator's.
    const data: TeamRemoveUserRequest = {
      teamId,
      userId: body.userId,
      removedBy: req.user.sub,
    };
    return this.TeamService.removeMember(data);
  }

  /**
   * Update a member role in a team
   *
   * @param teamId Team ID
   * @param req Request HTTP
   * @param body Request body to update a member role in a team
   * @returns Member role updated
   */
  @Span()
  @ApiOperation({ summary: 'Update a member role in a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateTeamRoleBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Member role updated',
    type: UpdateTeamRoleResponseDto,
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
  @SubjectType('team')
  @Permission('update_user_role')
  @UseGuards(PermissionsGuard)
  @Put('/team/:teamId/member/role')
  updateTeamMemberRole(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Req() req,
    @Body() body: UpdateTeamRoleBodyDto,
  ): Promise<UpdateTeamRoleResponse> {
    this.logger.log(
      `User ${req.user.sub} is updating role of user ${body.userId} in team ${teamId} to ${body.role}`,
    );
    // The requester is the token's subject (see deleteTeamMember).
    const data: UpdateTeamRoleRequest = {
      teamId,
      userId: body.userId,
      role: body.role,
      updatedBy: req.user.sub,
    };
    return this.TeamService.updateMemberRole(data);
  }

  /**
   * Get all members of a team
   *
   * @param teamId Team ID
   * @param req Request HTTP
   * @param query Request query to get all members of a team
   * @returns All members of a team
   */
  @Span()
  @ApiOperation({ summary: 'Get all members of a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'page', type: TeamGetMembersBodyDto })
  @ApiResponse({
    status: 200,
    description: 'All members of a team',
    type: PaginatedUsersResponseDto,
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
  @SubjectType('team')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Get('/team/:teamId/members')
  getTeamMembers(
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Query() query: TeamGetMembersBodyDto,
  ): Promise<PaginatedUsersResponse> {
    const { page, pageSize, search } = query;

    const pageNumber = Number.parseInt(page.toString(), 10);
    const pageSizeNumber = Number.parseInt(pageSize.toString(), 10);

    const data: TeamGetMembersRequest = {
      teamId,
      page: pageNumber,
      pageSize: pageSizeNumber,
      searchQuery: search,
    };
    return this.TeamService.getMembers(data);
  }

  /**
   * Get a member of a team
   *
   * @param teamId Team ID
   * @param userId User ID
   * @param req Request HTTP
   * @returns Member of a team
   */
  @Span()
  @ApiOperation({ summary: 'Get a member of a team' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Member of a team',
    type: UserInformationsResponseDto,
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
  @SubjectType('team')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Get('/team/:teamId/member/:userId')
  getTeamMember(
    @Param('teamId', new ParseUUIDPipe()) teamId,
    @Param('userId', new ParseUUIDPipe()) userId,
  ): Promise<UserInformationsResponse> {
    const data: TeamGetMemberRequest = { teamId, userId };
    return this.TeamService.getMember(data);
  }
}
