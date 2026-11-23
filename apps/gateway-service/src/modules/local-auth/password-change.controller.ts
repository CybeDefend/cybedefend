import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import type { RequestUser } from 'src/edition/ports/jwks-source.port';
import { PasswordChangeBodyDto } from './dto/password-change-body.dto';
import { TokenAnswerResponseDto } from './dto/token-answer-response.dto';
import { localAuthRefusal } from './local-auth-errors';
import {
  AuthRateLimit,
  LocalAuthRateLimitGuard,
} from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import {
  buildRefreshCookie,
  readRefreshCookie,
  refreshCookieOptions,
} from './refresh-cookie';
import { type TokenAnswer, toTokenAnswer } from './token-answer';

type AuthenticatedRequest = FastifyRequest & { user?: RequestUser };

/**
 * POST /auth/password/change: the
 * signed-in user changes their password. global-management revokes every
 * session of the user and opens a new one, so the answer carries a fresh
 * access token and a rotated refresh cookie. A personal access token cannot
 * change a password (403 PAT_NOT_ALLOWED, no gRPC call): a leaked
 * `cdp_` token must not be able to lock the account. The rate-limit bucket is
 * the user, so LocalAuthRateLimitGuard runs after the authentication guard.
 */
@ApiTags('Auth')
@Controller('auth/password')
@UseGuards(CombinedAuthRateLimitGuard, LocalAuthRateLimitGuard)
export class PasswordChangeController {
  constructor(
    private readonly localAuth: LocalAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('change')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit('password-change')
  @ApiOperation({
    summary: 'Change the signed-in user’s password (every session revoked)',
  })
  @ApiOkResponse({ type: TokenAnswerResponseDto })
  async change(
    @Body() body: PasswordChangeBodyDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenAnswer> {
    reply.header('Cache-Control', 'no-store');
    const user = req.user;
    if (!user?.sub) throw new UnauthorizedException();
    if (user.via === 'pat') {
      throw localAuthRefusal('PAT_NOT_ALLOWED', HttpStatus.FORBIDDEN);
    }
    const session = await this.localAuth.changePassword({
      // The user is always the authenticated sub, never the body.
      userId: user.sub,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      refreshToken: readRefreshCookie(req.headers.cookie) ?? '',
    });
    reply.header(
      'Set-Cookie',
      buildRefreshCookie(
        session.refreshToken,
        Number(session.refreshTokenExpiresAt),
        refreshCookieOptions(this.config),
      ),
    );
    return toTokenAnswer(session);
  }
}
