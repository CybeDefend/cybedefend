import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import type {
  LocalAuthSession,
  LocalJwk,
} from '@grpc/global-management/local_auth';
import { normalizeEmail } from 'src/core/db/normalize-email';
import { User } from 'src/entities/user.entity';
import { AccessTokenIssuer } from './access-token.issuer';
import { LocalCredentialStore } from './local-credential.store';
import { localAuthRefusal } from './local-auth-refusals';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenStore } from './refresh-token.store';
import { SigningKeyService } from './signing-key.service';

/**
 * The Community Edition's local auth core: Login, Refresh, Logout,
 * GetJwks and ChangePassword over the credential, signing-key and refresh-token
 * stores. Loaded only in
 * community mode, through COMMUNITY_ONLY_MODULES.
 *
 * Refusals are the closed list of local-auth-refusals.ts: the gRPC message is
 * the code, never free text. No password, hash, token, key or e-mail is ever
 * logged: the logs carry ids, codes and the client IP only.
 */
@Injectable()
export class LocalAuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly hasher: PasswordHasher,
    private readonly credentials: LocalCredentialStore,
    private readonly signingKeys: SigningKeyService,
    private readonly tokenIssuer: AccessTokenIssuer,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly logger: Logger,
  ) {}

  /**
   * Login. The e-mail is normalised before the lookup (never the MySQL
   * collation: PostgreSQL compares case-sensitively, and every `user.email`
   * is stored lower-cased). An unknown e-mail runs one dummy argon2
   * verification, so it costs the same as a wrong password, and both answer
   * INVALID_CREDENTIALS (no account enumeration). `clientIp` never reaches
   * this method: the login rate limit is the gateway's.
   */
  async login(
    email: string,
    password: string,
    now: Date = new Date(),
  ): Promise<LocalAuthSession> {
    const user = await this.userRepository.findOne({
      where: { email: normalizeEmail(email) },
    });
    if (!user) {
      await this.hasher.verifyAgainstDummy(password);
      throw localAuthRefusal('INVALID_CREDENTIALS');
    }
    const hash = await this.credentials.hashOf(user.id);
    if (!hash) {
      // Same cost as an unknown e-mail, so the answer time does not tell an
      // account without a local password apart from a wrong password.
      await this.hasher.verifyAgainstDummy(password);
      throw localAuthRefusal('INVALID_CREDENTIALS');
    }
    if (!(await this.hasher.verify(hash, password))) {
      throw localAuthRefusal('INVALID_CREDENTIALS');
    }
    const issued = await this.refreshTokens.issue(user.id, now);
    return this.sessionFor(user, issued.token, issued.expiresAt, now);
  }

  /**
   * Refresh. A race within 20 s of the rotation answers REFRESH_RACE and
   * revokes nothing; a reuse after it (or an unknown, expired or revoked
   * token) revokes the family when reused and answers REFRESH_INVALID on the
   * wire alike — only the log line says AUTH_REFRESH_REUSE.
   */
  async refresh(
    refreshToken: string,
    now: Date = new Date(),
  ): Promise<LocalAuthSession> {
    const outcome = await this.refreshTokens.rotate(refreshToken, now);
    if (outcome.kind === 'race') {
      throw localAuthRefusal('REFRESH_RACE');
    }
    if (outcome.kind === 'reused') {
      this.logger.warn(
        `AUTH_REFRESH_REUSE user=${outcome.userId} family=${outcome.familyId}`,
      );
      throw localAuthRefusal('REFRESH_INVALID');
    }
    if (outcome.kind === 'invalid') {
      throw localAuthRefusal('REFRESH_INVALID');
    }
    const user = await this.userOf(outcome.userId);
    return this.sessionFor(user, outcome.token, outcome.expiresAt, now);
  }

  /** Logout: revokes the token's family; an unknown token is a no-op. */
  async logout(refreshToken: string, now: Date = new Date()): Promise<void> {
    await this.refreshTokens.revokeFamilyOf(refreshToken, now);
  }

  /** The unretired signing keys, as GetJwks serves them. */
  async jwks(): Promise<LocalJwk[]> {
    const keys = await this.signingKeys.jwks();
    return keys.map((jwk) => ({
      kid: jwk.kid,
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      alg: jwk.alg,
      use: jwk.use,
    }));
  }

  /**
   * The ChangePassword RPC's core: check the current password and set the new
   * one (LocalCredentialStore.changePassword, CURRENT_PASSWORD_INVALID on a
   * wrong one), revoke every refresh family of the user, then open a fresh
   * session for the caller. An access token issued before the change stays
   * valid until it expires (15 min at most).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    now: Date = new Date(),
  ): Promise<LocalAuthSession> {
    await this.credentials.changePassword(
      userId,
      currentPassword,
      newPassword,
      now,
    );
    await this.refreshTokens.revokeAllOfUser(userId, now);
    return this.openSession(userId, now);
  }

  /**
   * Opens a new session for an existing user (used by setup / sign-up
   * and invitations too): a new refresh-token family plus an access
   * token. Every `*ExpiresAt` is epoch milliseconds.
   */
  async openSession(userId: string, now: Date): Promise<LocalAuthSession> {
    const user = await this.userOf(userId);
    const issued = await this.refreshTokens.issue(user.id, now);
    return this.sessionFor(user, issued.token, issued.expiresAt, now);
  }

  private async userOf(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'user not found',
      });
    }
    return user;
  }

  private async sessionFor(
    user: User,
    refreshToken: string,
    refreshExpiresAt: Date,
    now: Date,
  ): Promise<LocalAuthSession> {
    const { token: accessToken, expiresAt: accessTokenExpiresAt } =
      await this.tokenIssuer.issue(user, now);
    return {
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.getTime(),
      userId: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
    };
  }
}
