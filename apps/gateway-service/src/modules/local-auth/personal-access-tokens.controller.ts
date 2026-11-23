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
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import type { RequestUser } from 'src/edition/ports/jwks-source.port';
import { CreatePersonalAccessTokenBodyDto } from './dto/create-personal-access-token-body.dto';
import {
  CreatedPersonalAccessTokenResponseDto,
  ListPersonalAccessTokensResponseDto,
} from './dto/personal-access-token-response.dto';
import { LocalAuthService } from './local-auth.service';
import {
  type CreatedPersonalAccessToken,
  isoToMs,
  type PersonalAccessTokenItem,
  toCreatedPersonalAccessToken,
  toPersonalAccessTokenItem,
} from './personal-access-token-mapping';
import { patManagementForbidden } from './pat-management';

type AuthenticatedRequest = FastifyRequest & { user?: RequestUser };

/**
 * The personal access tokens (`cdp_…`) of the signed-in user. The user is always `req.user.sub`, never the
 * body. A request authenticated by a personal access token cannot manage
 * tokens (403 PAT_FORBIDDEN_FOR_PAT_MANAGEMENT, no gRPC call): managing
 * them takes a session JWT, so a leaked token cannot make itself permanent.
 * Every answer is `Cache-Control: no-store`; the secret appears once, in the
 * creation answer, and never in a list.
 */
@ApiTags('Auth')
@Controller('me/personal-access-tokens')
@UseGuards(CombinedAuthRateLimitGuard)
export class PersonalAccessTokensController {
  constructor(private readonly localAuth: LocalAuthService) {}

  @Get()
  @ApiOperation({ summary: 'List the caller’s personal access tokens' })
  @ApiOkResponse({ type: ListPersonalAccessTokensResponseDto })
  async list(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ tokens: PersonalAccessTokenItem[] }> {
    reply.header('Cache-Control', 'no-store');
    const user = this.sessionUser(req);
    const tokens = await this.localAuth.listPersonalAccessTokens({
      userId: user.sub,
    });
    return {
      tokens: tokens
        .slice()
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        .map(toPersonalAccessTokenItem),
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a personal access token (the secret is shown once)',
  })
  @ApiCreatedResponse({ type: CreatedPersonalAccessTokenResponseDto })
  async create(
    @Body() body: CreatePersonalAccessTokenBodyDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CreatedPersonalAccessToken> {
    reply.header('Cache-Control', 'no-store');
    const user = this.sessionUser(req);
    const created = await this.localAuth.createPersonalAccessToken({
      userId: user.sub,
      name: body.name,
      expiresAt: isoToMs(body.expiresAt),
    });
    return toCreatedPersonalAccessToken(created);
  }

  @Delete(':tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a personal access token' })
  @ApiNoContentResponse()
  async revoke(
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const user = this.sessionUser(req);
    await this.localAuth.revokePersonalAccessToken({
      userId: user.sub,
      tokenId,
    });
  }

  private sessionUser(req: AuthenticatedRequest): RequestUser {
    const user = req.user;
    if (!user?.sub) throw new UnauthorizedException();
    if (user.via === 'pat') throw patManagementForbidden();
    return user;
  }
}
