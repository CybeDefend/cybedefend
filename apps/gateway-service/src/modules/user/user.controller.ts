import {
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Span } from 'nestjs-otel';

import {
  GetUserProfileRequest,
  GetUserProfileResponse,
  UpdateUserProfileRequest,
  UserUpdateResponse,
  ListPersonalAccessTokensRequest,
  ListPersonalAccessTokensResponse,
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  DeletePersonalAccessTokenRequest,
  DeletePersonalAccessTokenResponse,
  UpdatePersonalAccessTokenNameRequest,
  UpdatePersonalAccessTokenNameResponse,
} from '@grpc/global-management/user';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  FORBIDDEN_EXAMPLE,
  UNAUTHORIZED_EXAMPLE,
} from 'src/core/constants/api-response-examples';

import { UserService } from './user.service';
import { UpdateUserProfileBodyDto } from './dto/body/user-update-profile-body.dto';
import { GetUserProfileResponseDto } from './dto/response/user-get-profile-response.dto';
import { UserUpdateResponseDto } from './dto/response/user-update-response.dto';
import { Logger } from 'nestjs-pino';
import { refusePatCallerInCommunity } from 'src/modules/local-auth/pat-management';

@ApiTags('User')
@Controller('user')
@UseGuards(CombinedAuthRateLimitGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly logger: Logger,
  ) {}

  /**
   * Get the authenticated user's profile information
   */
  @Span()
  @ApiOperation({
    summary: 'Get user profile',
    description:
      'Retrieves the profile information of the currently authenticated user including notification settings and onboarding status.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: GetUserProfileResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Get('profile')
  getProfile(@Req() req): Promise<GetUserProfileResponse> {
    const data: GetUserProfileRequest = { userId: req.user.sub };
    return this.userService.getProfile(data);
  }

  /**
   * Update the authenticated user's profile
   */
  @Span()
  @ApiOperation({
    summary: 'Update user profile',
    description:
      'Updates the profile information of the currently authenticated user. Allows modification of notification preferences and onboarding completion status.',
  })
  @ApiBody({ type: UpdateUserProfileBodyDto })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
    type: UserUpdateResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
    schema: { example: UNAUTHORIZED_EXAMPLE },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
    schema: { example: FORBIDDEN_EXAMPLE },
  })
  @Patch('profile')
  updateProfile(
    @Req() req,
    @Body() body: UpdateUserProfileBodyDto,
  ): Promise<UserUpdateResponse> {
    this.logger.log(`User ${req.user.sub} updating his/her profile`);
    const data: UpdateUserProfileRequest = {
      userId: req.user.sub,
      onboardingProgress: body.onboardingProgress || '',
    };
    if (body.notification !== undefined) {
      data.notification = body.notification;
    }
    if (body.isOnboardingCompleted !== undefined) {
      data.isOnboardingCompleted = body.isOnboardingCompleted;
    }
    if (body.onboardingPersona !== undefined) {
      data.onboardingPersona = body.onboardingPersona;
    }
    if (body.onboardingUsage !== undefined) {
      data.onboardingUsage = body.onboardingUsage.join(',');
    }
    return this.userService.updateProfile(data);
  }

  // ─── Personal Access Tokens ───────────────────────────────────
  // Available to every organisation, whatever the plan.
  // In the Community edition a caller authenticated by a personal access token
  // is refused on all four (403 PAT_FORBIDDEN_FOR_PAT_MANAGEMENT, no call):
  // global-management serves them from the same store as
  // /me/personal-access-tokens.

  @Span()
  @ApiOperation({ summary: 'List personal access tokens' })
  @ApiResponse({ status: 200, description: 'Tokens listed' })
  @Get('personal-access-tokens')
  listPersonalAccessTokens(
    @Req() req,
  ): Promise<ListPersonalAccessTokensResponse> {
    refusePatCallerInCommunity(req.user);
    const data: ListPersonalAccessTokensRequest = { userId: req.user.sub };
    return this.userService.listPersonalAccessTokens(data);
  }

  @Span()
  @ApiOperation({ summary: 'Create a personal access token' })
  @ApiResponse({ status: 201, description: 'Token created' })
  @Post('personal-access-tokens')
  createPersonalAccessToken(
    @Req() req,
    @Body() body: { name: string; expiresAt?: number },
  ): Promise<CreatePersonalAccessTokenResponse> {
    refusePatCallerInCommunity(req.user);
    const data: CreatePersonalAccessTokenRequest = {
      userId: req.user.sub,
      name: body.name,
      expiresAt: body.expiresAt ?? 0,
    };
    return this.userService.createPersonalAccessToken(data);
  }

  @Span()
  @ApiOperation({ summary: 'Delete a personal access token' })
  @ApiResponse({ status: 200, description: 'Token deleted' })
  @Post('personal-access-tokens/delete')
  deletePersonalAccessToken(
    @Req() req,
    @Body() body: { name: string },
  ): Promise<DeletePersonalAccessTokenResponse> {
    refusePatCallerInCommunity(req.user);
    const data: DeletePersonalAccessTokenRequest = {
      userId: req.user.sub,
      tokenName: body.name,
    };
    return this.userService.deletePersonalAccessToken(data);
  }

  @Span()
  @ApiOperation({ summary: 'Rename a personal access token' })
  @ApiResponse({ status: 200, description: 'Token renamed' })
  @Patch('personal-access-tokens/name')
  updatePersonalAccessTokenName(
    @Req() req,
    @Body() body: { currentName: string; newName: string },
  ): Promise<UpdatePersonalAccessTokenNameResponse> {
    refusePatCallerInCommunity(req.user);
    const data: UpdatePersonalAccessTokenNameRequest = {
      userId: req.user.sub,
      currentName: body.currentName,
      newName: body.newName,
    };
    return this.userService.updatePersonalAccessTokenName(data);
  }
}
