import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { normalizeEmail } from 'src/core/db/normalize-email';
import { User } from 'src/entities/user.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { LocalCredentialStore } from './local-credential.store';
import { localAuthRefusal } from './local-auth-refusals';
import { OneTimeTokenStore } from './one-time-token.store';
import { PersonalAccessTokenStore } from './personal-access-token.store';
import { assertPasswordPolicy } from './password-policy';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenStore } from './refresh-token.store';
import { ResetRequesterKeyer } from './reset-requester-key';

/**
 * The reset link the dashboard reads: the token travels in the fragment, so it
 * never reaches nginx logs or a Referer header.
 */
export function passwordResetLink(frontendUrl: string, token: string): string {
  return `${frontendUrl.replaceAll(/\/+$/g, '')}/reset-password#token=${token}`;
}

/**
 * The password reset of the Community Edition's LocalAuthModule:
 * `RequestPasswordReset` and `ResetPassword`, plus the admin CLI's link
 * issuer. Loaded in community mode only.
 *
 * No account enumeration: `request` always resolves, for a known and an
 * unknown e-mail alike, right after the e-mail lookup: the credential read,
 * the token and the mail run after the answer (not awaited), so a known e-mail
 * answers as fast as an unknown one; a failure is
 * logged by class name only. The 3 per hour per user
 * cap lives in the database (OneTimeTokenStore) and is silent — no refusal
 * code travels; the per-e-mail 429 is the gateway's. `reset` checks the
 * password policy and hashes the new password first (neither a policy
 * failure nor a busy verifier consumes the token), then consumes the
 * one-time token (RESET_TOKEN_INVALID when used, expired or unknown), sets
 * the new credential, and revokes every refresh family and every personal
 * access token of the user, all in one transaction: whoever held the account
 * before the reset keeps no way back in. No token, link or e-mail is ever
 * logged.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tokens: OneTimeTokenStore,
    private readonly credentials: LocalCredentialStore,
    private readonly hasher: PasswordHasher,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
    private readonly requesterKeys: ResetRequesterKeyer,
    private readonly pats: PersonalAccessTokenStore,
  ) {}

  /**
   * RequestPasswordReset. The e-mail is normalised before the lookup
   * (trim().toLowerCase(), never the MySQL collation). Always resolves, and
   * right after that one lookup: the credential read, the token transaction
   * and the mail run detached (`issueAndMail`), so a real account answers
   * after the same single SELECT as an unknown e-mail. Unknown e-mail, user
   * without a local credential, limit reached
   * or no SMTP — nothing is sent. A failure of the detached chain is logged by
   * class name only. `requester` is the client address the gateway sends:
   * the hourly cap counts per (requester, user), so a stranger cannot use up
   * the real user's share. Only its keyed HMAC (ResetRequesterKeyer) reaches
   * the store, never the address.
   */
  async request(email: string, now: Date, requester?: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { email: normalizeEmail(email) },
    });
    if (!user) return;
    void this.issueAndMail(user, now, requester).catch((e: unknown) => {
      this.logger.warn(
        `AUTH_RESET_REQUEST_FAILED class=${PasswordResetService.name} error=${(e as Error)?.name ?? 'unknown'}`,
      );
    });
  }

  /** The detached part of `request`: credential, token, then the mail. */
  private async issueAndMail(
    user: User,
    now: Date,
    requester: string | undefined,
  ): Promise<void> {
    if (!(await this.credentials.hashOf(user.id))) return;
    if (!this.mail.isConfigured()) return;
    const token = await this.tokens.createPasswordReset(user.id, now, {
      requesterKey: this.requesterKeys.keyOf(requester),
    });
    if (!token) return; // the silent hourly cap
    const link = passwordResetLink(this.frontendUrl(), token);
    void this.mail
      .sendPasswordResetEmail({ to: user.email, link })
      .catch((e: unknown) => {
        this.logger.error(
          `AUTH_RESET_MAIL_FAILED class=${PasswordResetService.name} error=${(e as Error).name}`,
        );
      });
  }

  /**
   * ResetPassword. Policy → hash → (consume the token, set the credential,
   * close the user's other open reset links, revoke every refresh family and
   * every personal access token: one transaction). The hash runs first and outside the transaction (argon2 takes
   * ~100 ms and may be refused by the busy verifier): a refusal there leaves
   * the link usable, and a failure inside the transaction rolls the consume
   * back. An invalid token answers RESET_TOKEN_INVALID. Answers the account's
   * e-mail, which the gateway uses to clear the account's login counter; it
   * never reaches the caller.
   */
  async reset(
    token: string,
    newPassword: string,
    now: Date,
  ): Promise<{ email: string }> {
    assertPasswordPolicy(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);
    const userId = await this.dataSource.transaction(async (manager) => {
      const owner = await this.tokens.consumePasswordReset(token, now, manager);
      if (!owner) return null;
      await this.credentials.set(manager, owner, passwordHash, now);
      await this.tokens.expireOpenPasswordResets(owner, now, manager);
      // A reset proves control of the address: nothing created before it (a
      // session, a personal access token) survives it.
      await this.refreshTokens.revokeAllOfUser(owner, now, manager);
      await this.pats.revokeAllOfUser(owner, now, manager);
      return owner;
    });
    if (!userId) throw localAuthRefusal('RESET_TOKEN_INVALID');
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return { email: user?.email ?? '' };
  }

  /**
   * The admin CLI (`pnpm run auth:reset-password -- <email>`): same
   * lower-cased lookup as `request`, but returns the link and bypasses the
   * hourly limit (the administrator may need a fourth one). An unknown e-mail
   * throws Error('NO_LOCAL_ACCOUNT'), which the CLI maps to exit code 2.
   */
  async issueLinkForCli(email: string, now: Date): Promise<string> {
    const user = await this.userRepository.findOne({
      where: { email: normalizeEmail(email) },
    });
    if (!user) throw new Error('NO_LOCAL_ACCOUNT');
    if (!(await this.credentials.hashOf(user.id))) {
      throw new Error('NO_LOCAL_ACCOUNT');
    }
    const token = await this.tokens.createPasswordReset(user.id, now, {
      bypassLimit: true,
    });
    if (!token) throw new Error('NO_LOCAL_ACCOUNT');
    return passwordResetLink(this.frontendUrl(), token);
  }

  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? '';
  }
}
