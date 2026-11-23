import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { firstValueFrom, Observable, TimeoutError, timeout } from 'rxjs';
import {
  type AcceptLocalInvitationRequest,
  type CreateLocalPersonalAccessTokenRequest,
  type CreateLocalPersonalAccessTokenResponse,
  type GetJwksResponse,
  type GetSetupStatusResponse,
  LOCAL_AUTH_SERVICE_NAME,
  type ListLocalPersonalAccessTokensRequest,
  type LocalAuthServiceClient,
  type LocalAuthSession,
  type LocalChangePasswordRequest,
  type LocalLoginRequest,
  type LocalPersonalAccessToken,
  type LocalSignUpRequest,
  type RequestPasswordResetRequest,
  type ResetPasswordRequest,
  type RevokeLocalPersonalAccessTokenRequest,
  type SetupInstanceRequest,
} from '@grpc/global-management/local_auth';
import {
  AUTH_ERROR,
  grpcCodeOf,
  localAuthRefusal,
  toLocalAuthHttpError,
} from './local-auth-errors';

/**
 * Deadline of one LocalAuthService call from an auth route. Longer than the
 * AuthGuard's 2 s (GetJwks, VerifyPersonalAccessToken): a login hashes a
 * password with argon2id, and a setup also creates the organisation, its
 * team and their authorisation tuples.
 */
export const LOCAL_AUTH_ROUTE_DEADLINE_MS = 5_000;

export interface SetupResult {
  session: LocalAuthSession;
  organizationId: string;
  teamId: string;
}

export interface AcceptInvitationResult {
  session: LocalAuthSession;
  organizationId: string;
}

/**
 * The gateway side of global-management's LocalAuthService. Every failure leaves as the HttpException of
 * `toLocalAuthHttpError`: a code of the closed list, AUTH_UNAVAILABLE or
 * AUTH_ERROR, never the server's text. Nothing here logs a password, a token
 * or a setup token.
 */
@Injectable()
export class LocalAuthService implements OnModuleInit {
  private readonly logger = new Logger(LocalAuthService.name);
  private client: LocalAuthServiceClient | null = null;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly grpc: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.localAuth();
  }

  getSetupStatus(): Promise<GetSetupStatusResponse> {
    return this.call(this.localAuth().getSetupStatus({}));
  }

  async setupInstance(request: SetupInstanceRequest): Promise<SetupResult> {
    const response = await this.call(this.localAuth().setupInstance(request));
    return {
      session: this.sessionOf(response),
      organizationId: response.organizationId,
      teamId: response.teamId,
    };
  }

  async signUp(request: LocalSignUpRequest): Promise<LocalAuthSession> {
    return this.sessionOf(await this.call(this.localAuth().signUp(request)));
  }

  async login(request: LocalLoginRequest): Promise<LocalAuthSession> {
    return this.sessionOf(await this.call(this.localAuth().login(request)));
  }

  async refresh(refreshToken: string): Promise<LocalAuthSession> {
    return this.sessionOf(
      await this.call(this.localAuth().refresh({ refreshToken })),
    );
  }

  /**
   * Never fails: a sign-out clears the cookie whatever global-management
   * answers. A failure is logged by its gRPC code only.
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      await firstValueFrom(
        this.localAuth()
          .logout({ refreshToken })
          .pipe(timeout(LOCAL_AUTH_ROUTE_DEADLINE_MS)),
      );
    } catch (err) {
      this.logger.warn(
        `LocalAuthService.Logout failed (gRPC code ${
          grpcCodeOf(err) ?? 'unknown'
        }); the cookie is cleared anyway`,
      );
    }
  }

  /**
   * Every session of the user is revoked, then a new one is opened: the
   * caller gets a fresh access token and rotates its refresh cookie.
   */
  async changePassword(
    request: LocalChangePasswordRequest,
  ): Promise<LocalAuthSession> {
    return this.sessionOf(
      await this.call(this.localAuth().changePassword(request)),
    );
  }

  /**
   * Never fails but an outage: the answer must not reveal whether the e-mail
   * exists, so any gRPC error but UNAVAILABLE / DEADLINE_EXCEEDED / a timeout
   * is logged by its code only and still answered 202. An unreachable
   * global-management is a 503 AUTH_UNAVAILABLE.
   */
  async requestPasswordReset(
    request: RequestPasswordResetRequest,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.localAuth()
          .requestPasswordReset(request)
          .pipe(timeout(LOCAL_AUTH_ROUTE_DEADLINE_MS)),
      );
    } catch (err) {
      const grpc = grpcCodeOf(err);
      if (
        err instanceof TimeoutError ||
        grpc === GrpcStatus.UNAVAILABLE ||
        grpc === GrpcStatus.DEADLINE_EXCEEDED
      ) {
        throw toLocalAuthHttpError(err);
      }
      this.logger.warn(
        `LocalAuthService.RequestPasswordReset failed (gRPC code ${
          grpc ?? 'unknown'
        }); answered 202 anyway`,
      );
    }
  }

  /** Answers the account's e-mail: for the gateway only, never the client. */
  async resetPassword(
    request: ResetPasswordRequest,
  ): Promise<{ email: string }> {
    const response = await this.call(this.localAuth().resetPassword(request));
    return { email: response?.email ?? '' };
  }

  async acceptInvitation(
    request: AcceptLocalInvitationRequest,
  ): Promise<AcceptInvitationResult> {
    const response = await this.call(
      this.localAuth().acceptInvitation(request),
    );
    return {
      session: this.sessionOf(response),
      organizationId: response.organizationId,
    };
  }

  async createPersonalAccessToken(
    request: CreateLocalPersonalAccessTokenRequest,
  ): Promise<CreateLocalPersonalAccessTokenResponse> {
    return this.call(this.localAuth().createPersonalAccessToken(request));
  }

  async listPersonalAccessTokens(
    request: ListLocalPersonalAccessTokensRequest,
  ): Promise<LocalPersonalAccessToken[]> {
    const response = await this.call(
      this.localAuth().listPersonalAccessTokens(request),
    );
    return response.tokens ?? [];
  }

  async revokePersonalAccessToken(
    request: RevokeLocalPersonalAccessTokenRequest,
  ): Promise<void> {
    await this.call(this.localAuth().revokePersonalAccessToken(request));
  }

  getJwks(): Promise<GetJwksResponse> {
    return this.call(this.localAuth().getJwks({}));
  }

  private async call<T>(source: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(
        source.pipe(timeout(LOCAL_AUTH_ROUTE_DEADLINE_MS)),
      );
    } catch (err) {
      throw toLocalAuthHttpError(err);
    }
  }

  private sessionOf(response: {
    session?: LocalAuthSession | undefined;
  }): LocalAuthSession {
    const session = response?.session;
    if (!session?.accessToken || !session.refreshToken) {
      throw localAuthRefusal(AUTH_ERROR, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return session;
  }

  private localAuth(): LocalAuthServiceClient {
    this.client ??= this.grpc.getService<LocalAuthServiceClient>(
      LOCAL_AUTH_SERVICE_NAME,
    );
    return this.client;
  }
}
