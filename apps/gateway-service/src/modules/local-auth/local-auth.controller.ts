import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clientIpOf, clientRateLimitAddressOf } from 'src/core/http/client-ip';
import type { LocalAuthSession } from '@grpc/global-management/local_auth';
import {
  AcceptInvitationBodyDto,
  AcceptInvitationWithTokenBodyDto,
} from './dto/accept-invitation-body.dto';
import { LoginBodyDto } from './dto/login-body.dto';
import { PasswordResetConfirmBodyDto } from './dto/password-reset-confirm-body.dto';
import { PasswordResetRequestBodyDto } from './dto/password-reset-request-body.dto';
import { SetupBodyDto } from './dto/setup-body.dto';
import { SetupStatusResponseDto } from './dto/setup-status-response.dto';
import { SignupBodyDto } from './dto/signup-body.dto';
import {
  SetupAnswerResponseDto,
  TokenAnswerResponseDto,
} from './dto/token-answer-response.dto';
import {
  AUTH_ORIGIN_FORBIDDEN,
  localAuthRefusal,
  refusalCodeOf,
} from './local-auth-errors';
import { isCommunityEdition } from 'src/edition/edition';
import { allowedOrigins, isRequestFromAllowedOrigin } from './request-origin';
import { ParseInvitationTokenPipe } from './parse-invitation-token.pipe';
import {
  AuthRateLimit,
  LocalAuthRateLimitGuard,
} from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { LoginAccountLimiter, type LoginClient } from './login-account-limiter';
import {
  buildLoginDeviceCookie,
  newLoginDeviceToken,
  readLoginDeviceCookie,
} from './login-device-cookie';
import { LoginInFlightLimiter } from './login-in-flight-limiter';
import {
  buildRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  refreshCookieOptions,
} from './refresh-cookie';
import { type TokenAnswer, toTokenAnswer } from './token-answer';

/** An accepted invitation opens a session and joins the organization. */
export class AcceptInvitationAnswerDto extends TokenAnswerResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId: string;
}

/**
 * The Community Edition's own sign-in,
 * mounted only in community mode (COMMUNITY_ONLY_MODULES). Public routes: no
 * auth guard, only the rate limits of LocalAuthRateLimitGuard, which also
 * marks every answer `Cache-Control: no-store`. A session answers its access
 * token in the body and its refresh token as the `cd_refresh` cookie, never
 * the reverse.
 */
@ApiTags('Auth')
@Controller('auth')
@UseGuards(LocalAuthRateLimitGuard)
export class LocalAuthController {
  constructor(
    private readonly localAuth: LocalAuthService,
    private readonly config: ConfigService,
    private readonly loginAttempts: LoginAccountLimiter,
    private readonly loginsInFlight: LoginInFlightLimiter,
  ) {}

  @Get('setup')
  @ApiOperation({ summary: 'Whether the instance still waits for its setup' })
  @ApiOkResponse({ type: SetupStatusResponseDto })
  async setupStatus(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SetupStatusResponseDto> {
    this.noStore(reply);
    const status = await this.localAuth.getSetupStatus();
    return {
      setupOpen: status.setupOpen,
      signupMode: status.signupMode,
      passwordResetByEmail: status.passwordResetByEmail,
    };
  }

  @Post('setup')
  @AuthRateLimit('ip')
  @ApiOperation({ summary: 'Create the first administrator and organisation' })
  @ApiCreatedResponse({ type: SetupAnswerResponseDto })
  async setup(
    @Body() body: SetupBodyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SetupAnswerResponseDto> {
    this.noStore(reply);
    const result = await this.localAuth.setupInstance({
      setupToken: body.setupToken,
      email: body.email,
      name: body.name,
      password: body.password,
      organizationName: body.organizationName,
      clientIp: this.clientIp(req),
    });
    return {
      ...this.open(result.session, reply),
      organizationId: result.organizationId,
      teamId: result.teamId,
    };
  }

  @Post('signup')
  @AuthRateLimit('signup')
  @ApiOperation({ summary: 'Create an account (AUTH_SIGNUP_MODE=open)' })
  @ApiCreatedResponse({ type: TokenAnswerResponseDto })
  async signup(
    @Body() body: SignupBodyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenAnswer> {
    this.noStore(reply);
    const session = await this.localAuth.signUp({
      email: body.email,
      name: body.name,
      password: body.password,
      clientIp: this.clientIp(req),
    });
    return this.open(session, reply);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit('login')
  @ApiOperation({ summary: 'Sign in with an e-mail and a password' })
  @ApiOkResponse({ type: TokenAnswerResponseDto })
  async login(
    @Body() body: LoginBodyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenAnswer> {
    this.noStore(reply);
    const client = this.loginClient(req);
    // A few logins at once per address (an IPv6 /64), so one address cannot
    // fill the password verifier's queue for everyone.
    const release = await this.loginsInFlight.acquire(
      this.rateLimitAddress(req),
      reply,
    );
    try {
      // Per account, after the address buckets of the guard: a locked
      // account is a 429 before any argon2 verification, except for the
      // browser (its device cookie) that signed in to it before. Only a wrong
      // password (or an unknown e-mail, answered the same) stays counted.
      const attempt = await this.loginAttempts.reserve(
        body.email,
        reply,
        client,
      );
      let session: LocalAuthSession;
      try {
        session = await this.localAuth.login({
          email: body.email,
          password: body.password,
          clientIp: this.clientIp(req),
        });
      } catch (err) {
        if (refusalCodeOf(err) !== 'INVALID_CREDENTIALS') {
          await attempt.refund();
        }
        throw err;
      }
      await attempt.succeeded();
      const answer = this.open(session, reply);
      this.keepLoginDevice(client, reply);
      return answer;
    } finally {
      await release();
    }
  }

  /**
   * Rotates the refresh cookie. A race (two tabs refreshing at once) is a 409
   * that leaves the cookie alone, so the other tab's rotation stands; an
   * invalid, reused or missing token is a 401 that clears it. An outage
   * leaves the cookie too: it is not the user's fault. In the Community
   * edition a request from another origin is a 403 AUTH_ORIGIN_FORBIDDEN that
   * leaves it too (assertInstanceOrigin).
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new session' })
  @ApiOkResponse({ type: TokenAnswerResponseDto })
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenAnswer> {
    this.noStore(reply);
    this.assertInstanceOrigin(req);
    const token = readRefreshCookie(req.headers.cookie);
    if (!token) {
      this.clear(reply);
      throw localAuthRefusal('REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
    let session: LocalAuthSession;
    try {
      session = await this.localAuth.refresh(token);
    } catch (err) {
      if (refusalCodeOf(err) === 'REFRESH_INVALID') this.clear(reply);
      throw err;
    }
    return this.open(session, reply);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revoke the session, clear the cookie' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.noStore(reply);
    this.assertInstanceOrigin(req);
    const token = readRefreshCookie(req.headers.cookie);
    if (token) await this.localAuth.logout(token);
    this.clear(reply);
  }

  /**
   * Always 202, for a known e-mail and an unknown one alike: the answer must
   * not reveal whether the account exists. Only an unreachable
   * global-management is a 503 AUTH_UNAVAILABLE; any other gRPC error is
   * logged by its code and still answered 202.
   */
  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthRateLimit('reset')
  @ApiOperation({ summary: 'Ask for a password reset link (always 202)' })
  @ApiAcceptedResponse({ description: 'Empty body, known e-mail or not' })
  async requestPasswordReset(
    @Body() body: PasswordResetRequestBodyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Record<string, never>> {
    this.noStore(reply);
    // The hourly cap of global-management counts per requester: its /64.
    await this.localAuth.requestPasswordReset({
      email: body.email,
      clientIp: clientRateLimitAddressOf(
        req,
        this.config.get<string>('NODE_ENV'),
      ),
    });
    return {};
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthRateLimit('ip')
  @ApiOperation({ summary: 'Set a new password with the one-time link token' })
  @ApiNoContentResponse()
  async resetPasswordConfirm(
    @Body() body: PasswordResetConfirmBodyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.noStore(reply);
    const { email } = await this.localAuth.resetPassword({
      token: body.token,
      newPassword: body.newPassword,
    });
    // The account's login counter starts again, and the browser that proved
    // it holds the reset link may sign in even while the account is locked.
    if (email) {
      const client = this.loginClient(req);
      await this.loginAttempts.trust(email, client);
      this.keepLoginDevice(client, reply);
    }
  }

  /**
   * The invitation token in the body, never in the URL: what the Community
   * invitation link (`/invite#token=…`) and the dashboard use. Same
   * validation, refusals, rate limit and answer as the path route below,
   * which stays for compatibility.
   */
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit('ip')
  @ApiOperation({ summary: 'Accept an invitation (token in the body)' })
  @ApiOkResponse({ type: AcceptInvitationAnswerDto })
  async acceptInvitationByBody(
    @Body() body: AcceptInvitationWithTokenBodyDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenAnswer & { organizationId: string }> {
    const token = new ParseInvitationTokenPipe().transform(body.token);
    return this.accept(token, body, reply);
  }

  /**
   * The token is 64 hex characters (ParseInvitationTokenPipe refuses anything
   * else with 400 INVITATION_INVALID, no call), and the path is redacted in
   * every log (redactUrlSecrets).
   */
  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit('ip')
  @ApiOperation({ summary: 'Accept an invitation and open a session' })
  @ApiOkResponse({ type: AcceptInvitationAnswerDto })
  async acceptInvitation(
    @Param('token', ParseInvitationTokenPipe) token: string,
    @Body() body: AcceptInvitationBodyDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenAnswer & { organizationId: string }> {
    return this.accept(token, body, reply);
  }

  private async accept(
    token: string,
    body: AcceptInvitationBodyDto,
    reply: FastifyReply,
  ): Promise<TokenAnswer & { organizationId: string }> {
    this.noStore(reply);
    const result = await this.localAuth.acceptInvitation({
      token,
      name: body.name,
      password: body.password,
    });
    return {
      ...this.open(result.session, reply),
      organizationId: result.organizationId,
    };
  }

  private open(session: LocalAuthSession, reply: FastifyReply): TokenAnswer {
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

  private clear(reply: FastifyReply): void {
    reply.header(
      'Set-Cookie',
      clearRefreshCookie(refreshCookieOptions(this.config)),
    );
  }

  /**
   * Refresh and logout are authenticated by the cookie alone, and SameSite is
   * per site, so a sibling subdomain could post to them (sign a user out, or
   * rotate the cookie). In the Community edition they take the request only
   * from the instance's own origin (FRONTEND_URL, the CORS allow-list):
   * `Origin`, else `Referer`'s origin; neither is refused too. No call, no
   * cookie change. The cloud edition is unchanged.
   */
  private assertInstanceOrigin(req: FastifyRequest): void {
    if (!isCommunityEdition()) return;
    const allowed = allowedOrigins(this.config.get<string>('FRONTEND_URL'));
    if (!isRequestFromAllowedOrigin(req.headers, allowed)) {
      throw localAuthRefusal(AUTH_ORIGIN_FORBIDDEN, HttpStatus.FORBIDDEN);
    }
  }

  /** The rate-limit address of the request (an IPv6 /64). */
  private rateLimitAddress(req: FastifyRequest): string {
    return (
      clientRateLimitAddressOf(req, this.config.get<string>('NODE_ENV')) ||
      'unknown'
    );
  }

  /** The login device token of the request: its cookie, or a new one. */
  private loginClient(req: FastifyRequest): LoginClient {
    return {
      deviceToken:
        readLoginDeviceCookie(req.headers.cookie) ?? newLoginDeviceToken(),
    };
  }

  private keepLoginDevice(client: LoginClient, reply: FastifyReply): void {
    reply.header(
      'Set-Cookie',
      buildLoginDeviceCookie(
        client.deviceToken,
        refreshCookieOptions(this.config),
      ),
    );
  }

  private noStore(reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store');
  }

  private clientIp(req: FastifyRequest): string {
    return clientIpOf(req, this.config.get<string>('NODE_ENV'));
  }
}
