import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import type { Repository } from 'typeorm';
import type {
  AcceptLocalInvitationRequest,
  AcceptLocalInvitationResponse,
  CreateLocalPersonalAccessTokenRequest,
  CreateLocalPersonalAccessTokenResponse,
  GetJwksRequest,
  GetJwksResponse,
  GetSetupStatusRequest,
  GetSetupStatusResponse,
  ListLocalPersonalAccessTokensRequest,
  ListLocalPersonalAccessTokensResponse,
  LocalChangePasswordRequest,
  LocalChangePasswordResponse,
  LocalLoginRequest,
  LocalLoginResponse,
  LocalLogoutRequest,
  LocalLogoutResponse,
  LocalPersonalAccessToken,
  LocalRefreshRequest,
  LocalRefreshResponse,
  LocalSignUpRequest,
  LocalSignUpResponse,
  SetupInstanceRequest,
  SetupInstanceResponse,
  RequestPasswordResetRequest,
  RequestPasswordResetResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  RevokeLocalPersonalAccessTokenRequest,
  RevokeLocalPersonalAccessTokenResponse,
  VerifyLocalPersonalAccessTokenRequest,
  VerifyLocalPersonalAccessTokenResponse,
} from '@grpc/global-management/local_auth';
import { User } from 'src/entities/user.entity';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { LocalAuthService } from './local-auth.service';
import { PasswordResetService } from './password-reset.service';
import { SetupService } from './setup.service';

import { localAuthRefusal } from './local-auth-refusals';
import {
  type LocalPat,
  PersonalAccessTokenStore,
} from './personal-access-token.store';

/** A stored PAT as the `LocalPersonalAccessToken` wire message (epoch ms, 0 = null). */
function toMessage(pat: LocalPat): LocalPersonalAccessToken {
  return {
    id: pat.id,
    name: pat.name,
    lastFour: pat.lastFour,
    createdAt: pat.createdAt.getTime(),
    lastUsedAt: pat.lastUsedAt ? pat.lastUsedAt.getTime() : 0,
    expiresAt: pat.expiresAt ? pat.expiresAt.getTime() : 0,
  };
}

/**
 * The gRPC edge of the Community Edition's local auth. Each RPC has an
 * explicit `@GrpcMethod` (no ts-proto class decorator over the service). In the
 * cloud this module is not loaded, so every call on
 * `LocalAuthService` answers UNIMPLEMENTED. `clientIp` is for the log line
 * only, never stored; the login rate limit is the gateway's.
 *
 * The PAT RPCs keep the original wire shape: `value` is the secret, `token`
 * the metadata. No token is ever logged.
 */
@Controller()
export class LocalAuthController {
  constructor(
    private readonly localAuth: LocalAuthService,
    private readonly pats: PersonalAccessTokenStore,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly logger: Logger,
    private readonly setup: SetupService,
    private readonly passwordReset: PasswordResetService,
    private readonly invitations: InvitationAcceptanceService,
  ) {}

  @GrpcMethod('LocalAuthService', 'GetSetupStatus')
  async getSetupStatus(
    request: GetSetupStatusRequest,
  ): Promise<GetSetupStatusResponse> {
    void request; // GetSetupStatusRequest is empty
    return this.setup.status();
  }

  @GrpcMethod('LocalAuthService', 'SetupInstance')
  async setupInstance(
    request: SetupInstanceRequest,
  ): Promise<SetupInstanceResponse> {
    this.logger.debug(`AUTH_SETUP ip=${request.clientIp ?? ''}`);
    const result = await this.setup.setup(
      {
        setupToken: request.setupToken,
        email: request.email,
        name: request.name,
        password: request.password,
        organizationName: request.organizationName,
      },
      new Date(),
    );
    return {
      session: result.session,
      organizationId: result.organizationId,
      teamId: result.teamId,
    };
  }

  @GrpcMethod('LocalAuthService', 'SignUp')
  async signUp(request: LocalSignUpRequest): Promise<LocalSignUpResponse> {
    this.logger.debug(`AUTH_SIGNUP ip=${request.clientIp ?? ''}`);
    return {
      session: await this.setup.signUp(
        {
          email: request.email,
          name: request.name,
          password: request.password,
        },
        new Date(),
      ),
    };
  }

  @GrpcMethod('LocalAuthService', 'Login')
  async login(request: LocalLoginRequest): Promise<LocalLoginResponse> {
    this.logger.debug(`AUTH_LOGIN ip=${request.clientIp ?? ''}`);
    return {
      session: await this.localAuth.login(request.email, request.password),
    };
  }

  @GrpcMethod('LocalAuthService', 'Refresh')
  async refresh(request: LocalRefreshRequest): Promise<LocalRefreshResponse> {
    return {
      session: await this.localAuth.refresh(request.refreshToken),
    };
  }

  @GrpcMethod('LocalAuthService', 'Logout')
  async logout(request: LocalLogoutRequest): Promise<LocalLogoutResponse> {
    await this.localAuth.logout(request.refreshToken);
    return {};
  }

  @GrpcMethod('LocalAuthService', 'AcceptInvitation')
  async acceptInvitation(
    request: AcceptLocalInvitationRequest,
  ): Promise<AcceptLocalInvitationResponse> {
    const result = await this.invitations.accept(
      {
        token: request.token,
        password: request.password,
        name: request.name,
      },
      new Date(),
    );
    return { session: result.session, organizationId: result.organizationId };
  }

  @GrpcMethod('LocalAuthService', 'GetJwks')
  async getJwks(request: GetJwksRequest): Promise<GetJwksResponse> {
    void request; // GetJwksRequest is empty
    return { keys: await this.localAuth.jwks() };
  }

  @GrpcMethod('LocalAuthService', 'ChangePassword')
  async changePassword(
    request: LocalChangePasswordRequest,
  ): Promise<LocalChangePasswordResponse> {
    // userId comes from the gateway's authenticated user (an access JWT,
    // never a cdp_ token); request.refreshToken is not needed, since every
    // family of the user is revoked.
    return {
      session: await this.localAuth.changePassword(
        request.userId,
        request.currentPassword,
        request.newPassword,
      ),
    };
  }

  @GrpcMethod('LocalAuthService', 'RequestPasswordReset')
  async requestPasswordReset(
    request: RequestPasswordResetRequest,
  ): Promise<RequestPasswordResetResponse> {
    // Always answers {}: no account enumeration. The per-e-mail 429 is the
    // gateway's; the 3 per hour per (address, user) cap is silent in the
    // store.
    this.logger.debug(`AUTH_RESET_REQUEST ip=${request.clientIp ?? ''}`);
    await this.passwordReset.request(
      request.email,
      new Date(),
      request.clientIp || undefined,
    );
    return {};
  }

  @GrpcMethod('LocalAuthService', 'ResetPassword')
  async resetPassword(
    request: ResetPasswordRequest,
  ): Promise<ResetPasswordResponse> {
    // Never logged: the token and the new password stay on the wire only.
    // The answer's e-mail is for the gateway only, never for the client.
    return this.passwordReset.reset(
      request.token,
      request.newPassword,
      new Date(),
    );
  }

  @GrpcMethod('LocalAuthService', 'CreatePersonalAccessToken')
  async createPersonalAccessToken(
    request: CreateLocalPersonalAccessTokenRequest,
  ): Promise<CreateLocalPersonalAccessTokenResponse> {
    // int64 arrives as a string at runtime (longs: String): read it with
    // Number(). 0 = never expires.
    const expiresAtMs = Number(request.expiresAt);
    const expiresAt = expiresAtMs > 0 ? new Date(expiresAtMs) : null;
    const { pat, token } = await this.pats.create(
      request.userId,
      request.name,
      expiresAt,
      new Date(),
    );
    return { token: toMessage(pat), value: token };
  }

  @GrpcMethod('LocalAuthService', 'ListPersonalAccessTokens')
  async listPersonalAccessTokens(
    request: ListLocalPersonalAccessTokensRequest,
  ): Promise<ListLocalPersonalAccessTokensResponse> {
    const tokens = await this.pats.list(request.userId, new Date());
    return { tokens: tokens.map(toMessage) };
  }

  @GrpcMethod('LocalAuthService', 'RevokePersonalAccessToken')
  async revokePersonalAccessToken(
    request: RevokeLocalPersonalAccessTokenRequest,
  ): Promise<RevokeLocalPersonalAccessTokenResponse> {
    await this.pats.revoke(request.userId, request.tokenId, new Date());
    return {};
  }

  @GrpcMethod('LocalAuthService', 'VerifyPersonalAccessToken')
  async verifyPersonalAccessToken(
    request: VerifyLocalPersonalAccessTokenRequest,
  ): Promise<VerifyLocalPersonalAccessTokenResponse> {
    const found = await this.pats.verify(request.token, new Date());
    if (!found) throw localAuthRefusal('PAT_INVALID');
    const user = await this.users.findOne({ where: { id: found.userId } });
    if (!user) throw localAuthRefusal('PAT_INVALID');
    return {
      userId: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      tokenId: found.tokenId,
    };
  }
}
