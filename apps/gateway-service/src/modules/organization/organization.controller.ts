import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { OrganizationService } from './organization.service';
import { OrganizationAcceptInviteBodyDto } from './dto/body/organization-accept-invite-body.dto';
import { OrganizationCreateBodyDto } from './dto/body/organization-create-body.dto';
import { OrganizationDeleteBodyDto } from './dto/body/organization-delete-body.dto';
import { OrganizationDeleteMemberBodyDto } from './dto/body/organization-delete-member-body.dto';
import { OrganizationGetInvitationsBodyDto } from './dto/body/organization-get-invitations-body.dto';
import { OrganizationGetMembersBodyDto } from './dto/body/organization-get-members-body.dto';
import { OrganizationInviteBodyDto } from './dto/body/organization-invite-body.dto';
import { OrganizationUpdateBodyDto } from './dto/body/organization-update-body.dto';
import { OrganizationUpdateRoleBodyDto } from './dto/body/organization-update-role-body.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  GetOrganizationInvitationsResponse,
  OrganizationAcceptInviteRequest,
  OrganizationAcceptInviteResponse,
  OrganizationCancelRequest,
  OrganizationCreateRequest,
  OrganizationCreateResponse,
  OrganizationDeleteMemberRequest,
  OrganizationDeleteMemberResponse,
  ConfirmOrganizationDeletionRequest,
  OrganizationDeleteResponse,
  OrganizationGetAllRequest,
  OrganizationGetInvitationsRequest,
  OrganizationGetMembersRequest,
  OrganizationGetRequest,
  OrganizationInformationsList,
  OrganizationInformationsResponse,
  OrganizationInviteRequest,
  OrganizationInviteResponse,
  OrganizationUpdateRequest,
  OrganizationUpdateResponse,
  OrganizationUpdateRoleRequest,
  OrganizationUpdateRoleResponse,
  PaginatedOrganizationMembersResponse,
  RequestOrganizationDeletionCodeResponse,
} from '@grpc/global-management/organization';
import { OrganizationInviteResponseDto } from './dto/response/organization-invite-response.dto';
import { GetOrganizationInvitationsResponseDto } from './dto/response/get-organization-invitations-response.dto';
import { OrganizationInformationsResponseDto } from './dto/response/organization-informations-response.dto';
import { OrganizationUpdateResponseDto } from './dto/response/organization-update-response.dto';
import { OrganizationCreateResponseDto } from './dto/response/organization-create-response.dto';
import { OrganizationDeleteResponseDto } from './dto/response/organization-delete-response.dto';
import { OrganizationDeletionCodeResponseDto } from './dto/response/organization-deletion-code-response.dto';
import { PaginatedOrganizationMembersResponseDto } from './dto/response/paginated-organization-members-response.dto';
import { OrganizationUpdateRoleResponseDto } from './dto/response/organization-update-role-response.dto';
import { OrganizationDeleteMemberResponseDto } from './dto/response/organization-delete-member-response.dto';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { organizationCreateExtensions } from './organization-create-fields';

/** The authenticated caller, as the deletion handlers read it. */
type AuthenticatedRequest = { user?: { sub?: string } };

@ApiTags('Organization')
@UseGuards(CombinedAuthRateLimitGuard)
@Controller()
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly logger: Logger,
    private readonly config: ConfigService,
  ) {}

  /**
   * Invite user to organization with email
   *
   * @param organizationId Organization ID to invite user
   * @param req Request HTTP
   * @param body Request body to invite user
   * @returns Invite response
   */
  @Span()
  @ApiOperation({ summary: 'Invite user to organization' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: OrganizationInviteBodyDto })
  @ApiResponse({
    status: 201,
    description: 'User invited to organization',
    type: OrganizationInviteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request, or a refusal whose `code` is `APPSEC_SEATS_FULL`, `INVITES_DISABLED`, `PRODUCT_NOT_ACTIVE`, `PRODUCT_NOT_GRANTABLE` or `NO_PRODUCT_SELECTED` (an administrator is invited with both products, so never `ADMIN_KEEPS_ALL_PRODUCTS`)',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @Post('/organization/:organizationId/invite')
  @SubjectType('organization')
  @Permission('add_user')
  @UseGuards(PermissionsGuard)
  inviteUserToOrganization(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Req() req,
    @Body() body: OrganizationInviteBodyDto,
  ): Promise<OrganizationInviteResponse> {
    this.logger.log(
      `User ${req?.user.sub} is inviting a user to organization ${organizationId} with role ${body.role}${
        body.teamAssignments
          ? ` and team assignments: ${body.teamAssignments.map((a) => `${a.teamId}:${a.role}`).join(', ')}`
          : ''
      }${body.products ? ` and products: ${body.products.join(', ')}` : ''}`,
    );
    const data: OrganizationInviteRequest = {
      invitedBy: req?.user.sub,
      email: body.email,
      role: body.role,
      organizationId: organizationId,
      teamAssignments: body.teamAssignments || [],
      // Per-member products: none named (an older dashboard or the CLI)
      // means every active product the inviter may give, as before.
      products: body.products ?? [],
    };
    return this.organizationService.inviteUserToOrganization(data);
  }

  /**
   * Get organization invitations
   *
   * @param organizationId Organization ID to get invitations
   * @param req Request HTTP
   * @param query Request query to get invitations
   * @returns Get invitations response
   */
  @Span()
  @ApiOperation({ summary: 'Get organization invitations' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ type: OrganizationGetInvitationsBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Organization invitations retrieved',
    type: GetOrganizationInvitationsResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @Get('/organization/:organizationId/invitations')
  @SubjectType('organization')
  @Permission('add_user')
  @UseGuards(PermissionsGuard)
  getOrganizationInvitations(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: OrganizationGetInvitationsBodyDto,
  ): Promise<GetOrganizationInvitationsResponse> {
    const data: OrganizationGetInvitationsRequest = {
      organizationId,
      page: query.page,
      pageSize: query.pageSize,
    };
    return this.organizationService.getOrganizationInvitations(data);
  }

  /**
   * Cancel organization invitation
   *
   * @param organizationId Organization ID to cancel invitation
   * @param invitationId Invitation ID to cancel
   * @param req Request HTTP
   * @returns Cancel invitation response
   */
  @Span()
  @ApiOperation({ summary: 'Cancel organization invitation' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiParam({
    name: 'invitationId',
    description: 'Invitation identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation cancelled',
    type: OrganizationInviteResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @Delete('/organization/:organizationId/invitation/:invitationId')
  @SubjectType('organization')
  @Permission('add_user')
  @UseGuards(PermissionsGuard)
  cancelOrganizationInvitation(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() req,
  ): Promise<OrganizationInviteResponse> {
    this.logger.log(
      `User ${req?.user.sub} is cancelling invitation ${invitationId} for organization ${organizationId}`,
    );
    const data: OrganizationCancelRequest = { organizationId, invitationId };
    return this.organizationService.cancelOrganizationInvitation(data);
  }

  /**
   * Accept invitation to organization
   *
   * @param req Request HTTP
   * @param body Request body to accept invitation
   * @returns Accept invitation response
   */
  @Span()
  @ApiOperation({ summary: 'Accept invitation to organization' })
  @ApiBody({ type: OrganizationAcceptInviteBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Invitation accepted',
    type: OrganizationInviteResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @Post('/organization/invite/accept')
  acceptInvitationToOrganization(
    @Req() req,
    @Body() body: OrganizationAcceptInviteBodyDto,
  ): Promise<OrganizationAcceptInviteResponse> {
    this.logger.log(
      `${req?.user.sub} is accepting an invitation to an organization`,
    );
    const data: OrganizationAcceptInviteRequest = {
      userId: req?.user.sub,
      token: body.token,
    };
    return this.organizationService.acceptInvitationToOrganization(data);
  }

  /**
   * Get organizations of user
   *
   * @param req Request HTTP
   * @returns Get organizations response
   */
  @Span()
  @ApiOperation({ summary: 'Get organizations of user' })
  @ApiResponse({
    status: 200,
    description: 'Organizations retrieved',
    type: [OrganizationInformationsResponseDto],
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @Get('/organizations')
  getOrganizations(@Req() req): Promise<OrganizationInformationsList> {
    const data: OrganizationGetAllRequest = { userId: req?.user.sub };
    return this.organizationService.getOrganizations(data);
  }

  /**
   * Get organization by ID
   *
   * @param organizationId Organization ID to get
   * @param req Request HTTP
   * @returns Get organization response
   */
  @Span()
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization details retrieved',
    type: OrganizationInformationsResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId')
  getOrganization(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Promise<OrganizationInformationsResponse> {
    const data: OrganizationGetRequest = { organizationId };
    return this.organizationService.getOrganization(data);
  }

  /**
   * Update organization
   *
   * @param organizationId Organization ID to update
   * @param req Request HTTP
   * @param body Request body to update organization
   * @returns Update organization response
   */
  @Span()
  @ApiOperation({ summary: 'Update organization' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: OrganizationUpdateBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Organization updated',
    type: OrganizationUpdateResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @SubjectType('organization')
  @Permission('manage')
  @UseGuards(PermissionsGuard)
  @Put('/organization/:organizationId')
  updateOrganization(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Req() req,
    @Body() body: OrganizationUpdateBodyDto,
  ): Promise<OrganizationUpdateResponse> {
    this.logger.log(
      `User ${req?.user.sub} is updating organization ${organizationId}`,
    );
    const data: OrganizationUpdateRequest = {
      organizationId,
      name: body.name,
      industry: body.industry,
      country: body.country,
    };

    return this.organizationService.updateOrganization(data);
  }

  /**
   * Create organization
   *
   * @param req Request HTTP
   * @param body Request body to create organization
   * @returns Create organization response
   */
  @Span()
  @ApiOperation({ summary: 'Create organization' })
  @ApiBody({ type: OrganizationCreateBodyDto })
  @ApiResponse({
    status: 201,
    description: 'Organization created',
    type: OrganizationCreateResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @Post('/organization')
  createOrganization(
    @Req() req,
    @Body() body: OrganizationCreateBodyDto,
  ): Promise<OrganizationCreateResponse> {
    this.logger.log(`User ${req?.user.sub} is creating a new organization`);
    // The organisation itself; every other field of the request is a closed
    // extension's (organization-create-fields.ts), empty without one.
    const data: OrganizationCreateRequest = {
      name: body.name,
      industry: body.industry,
      country: body.country || '',
      creatorId: req?.user.sub,
      customerType: '',
      firstName: '',
      lastName: '',
      companyName: '',
      vatNumber: '',
      billingAddressLine1: '',
      billingAddressLine2: '',
      billingCity: '',
      billingPostalCode: '',
      billingRegion: '',
      attribution: undefined,
      clientIp: '',
      clientUserAgent: '',
    };
    const context = {
      request: req,
      nodeEnv: this.config.get<string>('NODE_ENV'),
    };
    for (const extension of organizationCreateExtensions()) {
      Object.assign(
        data,
        extension(body as unknown as Record<string, unknown>, context),
      );
    }
    return this.organizationService.createOrganization(data);
  }

  /**
   * E-mails the organization's creator the code that confirms its deletion.
   * Membership is checked here; that the caller is the creator,
   * and every limit, are global-management's.
   */
  @Span()
  @ApiOperation({
    summary: 'Send the organization deletion code to its creator',
    description:
      'Only the organization creator may delete it. This sends a 6-digit code to the e-mail address of the creator account, valid 10 minutes and once; DELETE /organization/:organizationId takes it as `code`. At most 3 codes an hour, 60 s apart. A new code replaces the previous one.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 202,
    description: 'Code sent to the creator',
    type: OrganizationDeletionCodeResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description:
      'Not a member, or `code: NOT_ORGANIZATION_CREATOR`: the caller is not the creator',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 429,
    description:
      '`code: DELETION_CODE_RATE_LIMITED` (60 s between two codes, 3 an hour; `Retry-After: 60`) or `code: DELETION_LOCKED` (too many wrong codes: locked for 24 h)',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 503,
    description: 'The code could not be sent; no code is valid',
    type: ErrorDto,
  })
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('/organization/:organizationId/deletion-code')
  requestOrganizationDeletionCode(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<RequestOrganizationDeletionCodeResponse> {
    return this.organizationService.requestOrganizationDeletionCode({
      organizationId,
      requestedBy: req?.user?.sub ?? '',
    });
  }

  /**
   * Delete an organization and all of its data: its creator only, with the
   * code e-mailed by POST /organization/:organizationId/deletion-code.
   * Membership is checked here, the rest by global-management.
   */
  @Span()
  @ApiOperation({
    summary: 'Delete organization',
    description:
      'Only the organization creator may delete it, with the 6-digit code sent by POST /organization/:organizationId/deletion-code. 5 attempts per code; 10 wrong codes within 24 h lock the deletion for 24 h.',
  })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: OrganizationDeleteBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Organization deleted',
    type: OrganizationDeleteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'A body without a 6-digit `code`; `code: DELETION_CODE_INVALID` (wrong, expired, already used); `code: DELETION_CODE_ATTEMPTS_EXCEEDED` (ask for a new code)',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description:
      'Not a member, or `code: NOT_ORGANIZATION_CREATOR`: the caller is not the creator',
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @ApiResponse({
    status: 429,
    description:
      '`code: DELETION_LOCKED`: too many wrong codes, the deletion is locked for 24 h',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 501,
    description:
      'An older global-management that does not know the confirmation code yet: nothing was deleted',
    type: ErrorDto,
  })
  @SubjectType('organization')
  @Permission('read')
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId')
  deleteOrganization(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: OrganizationDeleteBodyDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrganizationDeleteResponse> {
    this.logger.log(
      `User ${req?.user?.sub} is deleting organization ${organizationId}`,
    );
    const data: ConfirmOrganizationDeletionRequest = {
      organizationId,
      requestedBy: req?.user?.sub ?? '',
      confirmationCode: body.code,
    };
    return this.organizationService.deleteOrganization(data);
  }

  /**
   * Get organization members
   *
   * @param organizationId Organization ID to get members
   * @param query Request query to get members
   * @param req Request HTTP
   * @returns Get members response
   */
  @Span()
  @ApiOperation({ summary: 'Get organization members' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ type: OrganizationGetMembersBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Organization members retrieved, each with its products',
    type: PaginatedOrganizationMembersResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @SubjectType('organization')
  @Permission('read_user')
  @UseGuards(PermissionsGuard)
  @Get('/organization/:organizationId/members')
  getOrganizationMembers(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: OrganizationGetMembersBodyDto,
  ): Promise<PaginatedOrganizationMembersResponse> {
    const { page, pageSize, search } = query;

    const pageNumber = Number.parseInt(page.toString(), 10);
    const pageSizeNumber = Number.parseInt(pageSize.toString(), 10);

    const data: OrganizationGetMembersRequest = {
      organizationId,
      page: pageNumber,
      pageSize: pageSizeNumber,
      searchQuery: search,
    };
    return this.organizationService.getOrganizationMembers(data);
  }

  /**
   * Update organization member role
   *
   * @param organizationId Organization ID to update member role
   * @param req Request HTTP
   * @param body Request body to update member role
   * @returns Update member role response
   */
  @Span()
  @ApiOperation({ summary: 'Update organization member role' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: OrganizationUpdateRoleBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Member role updated',
    type: OrganizationUpdateRoleResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request, or a refusal whose `code` names it: a promotion to administrator gives both products, refused `APPSEC_SEATS_FULL` when no AppSec seat is free',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @SubjectType('organization')
  @Permission('update_user_role')
  @UseGuards(PermissionsGuard)
  @Put('/organization/:organizationId/member/role')
  updateOrganizationMemberRole(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: OrganizationUpdateRoleBodyDto,
    @Req() req,
  ): Promise<OrganizationUpdateRoleResponse> {
    this.logger.log(
      `User ${req?.user.sub} is updating role for user ${body.userId} in organization ${organizationId}`,
    );
    // The author from the token, never the body: global-management ranks
    // the change against them.
    const data: OrganizationUpdateRoleRequest = {
      organizationId,
      userId: body.userId,
      role: body.role,
      updatedBy: req?.user.sub,
    };
    return this.organizationService.updateOrganizationMemberRole(data);
  }

  // PUT /organization/:organizationId/members/:userId/products (a member's
  // products) and GET|PUT /organization/:organizationId/billing/profile
  // belong to the cloud edition.

  /**
   * Remove member from organization
   *
   * @param organizationId Organization ID to remove member
   * @param req Request HTTP
   * @param body Request body to remove member
   * @returns Remove member response
   */
  @Span()
  @ApiOperation({ summary: 'Remove member from organization' })
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    type: 'string',
    format: 'uuid',
  })
  @ApiBody({ type: OrganizationDeleteMemberBodyDto })
  @ApiResponse({
    status: 200,
    description: 'Member removed from organization',
    type: OrganizationDeleteMemberResponseDto,
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
    schema: {
      example: FORBIDDEN_EXAMPLE,
    },
  })
  @SubjectType('organization')
  @Permission('remove_user')
  @UseGuards(PermissionsGuard)
  @Delete('/organization/:organizationId/member')
  removeOrganizationMember(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() body: OrganizationDeleteMemberBodyDto,
    @Req() req,
  ): Promise<OrganizationDeleteMemberResponse> {
    this.logger.log(
      `User ${req?.user.sub} is removing user ${body.userId} from organization ${organizationId}`,
    );
    // The author from the token: global-management ranks the removal
    // against them.
    const data: OrganizationDeleteMemberRequest = {
      organizationId,
      userId: body.userId,
      removedBy: req?.user.sub,
    };
    return this.organizationService.removeOrganizationMember(data);
  }
}
