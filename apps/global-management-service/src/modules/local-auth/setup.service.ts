import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ident, insertIgnore, run, sql } from '@cybedefend/db-dialect';
import type {
  LocalAuthSession,
  LocalSignUpRequest,
} from '@grpc/global-management/local_auth';
import type { OrganizationCreateRequest } from '@grpc/global-management/organization';
import { User } from 'src/entities/user.entity';
import { Team } from 'src/entities/team.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { OrganizationService } from 'src/modules/organization/organization.service';
import { AuthOneTimeToken } from './entities/auth-one-time-token.entity';
import { LocalAccountService } from './local-account.service';
import { LocalAuthService } from './local-auth.service';
import { localAuthRefusal } from './local-auth-refusals';
import { assertPasswordPolicy } from './password-policy';
import { tokenHash } from './token-hash';

/**
 * The stored hash of the setup claim: one `auth_one_time_token` row of
 * purpose 'setup' is the instance's claim that a setup is running or finished.
 * It exists before any user row, so `user_id` is null while the setup runs
 * and is set to the administrator's id when it is done.
 */
export const SETUP_CLAIM_HASH = tokenHash('cybedefend-instance-setup');

/** The claim never expires (100 years): it marks the instance, not a session. */
const SETUP_CLAIM_TTL_MS = 100 * 365 * 24 * 3600 * 1000;

const AOTT_TABLE = ident('auth_one_time_token');
const c = ident;

export type SignupMode = 'invite_only' | 'open';

export interface SetupStatus {
  setupOpen: boolean;
  signupMode: SignupMode;
  passwordResetByEmail: boolean;
}

/** SHA-256 of both tokens, compared in constant time. */
function sameToken(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * The instance setup and the open sign-up. `GetSetupStatus` never
 * fails: setup is open while the instance has no user row and no setup claim
 * row. `SetupInstance` checks CYBEDEFEND_SETUP_TOKEN, claims the setup with
 * one insertIgnore row (two concurrent setups: exactly one wins, the other
 * answers SETUP_CLOSED), then creates the administrator, its organisation and
 * its default team. `SignUp` (a sign-up must never
 * take an instance that has no administrator yet) refuses SETUP_REQUIRED
 * under the claim's locking read while the setup has not finished, and the new
 * account joins no organisation.
 */
@Injectable()
export class SetupService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AuthOneTimeToken)
    private readonly tokenRepository: Repository<AuthOneTimeToken>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    private readonly accounts: LocalAccountService,
    private readonly auth: LocalAuthService,
    private readonly organizations: OrganizationService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  /** GetSetupStatus; never fails. */
  async status(): Promise<SetupStatus> {
    const [users, claims] = await Promise.all([
      this.userRepository.count(),
      this.tokenRepository.countBy({ tokenHash: SETUP_CLAIM_HASH }),
    ]);
    return {
      setupOpen: users === 0 && claims === 0,
      signupMode: this.signupMode(),
      passwordResetByEmail: this.mail.isConfigured(),
    };
  }

  /**
   * SetupInstance. Order: the token, the password policy, an existing user,
   * then the claim row (insertIgnore, `affected === 0` means another setup
   * holds it). The account, the organisation and the claim's mark each commit
   * on their own; if any of them fails, the claim row and the user (when
   * created) are deleted again and the error is rethrown, so a failed setup
   * reopens.
   */
  async setup(
    input: {
      setupToken: string;
      email: string;
      name: string;
      password: string;
      organizationName: string;
    },
    now: Date,
  ): Promise<{
    session: LocalAuthSession;
    organizationId: string;
    teamId: string;
  }> {
    const expected = this.config.get<string>('CYBEDEFEND_SETUP_TOKEN');
    if (!expected || !sameToken(input.setupToken, expected)) {
      throw localAuthRefusal('SETUP_TOKEN_INVALID');
    }
    assertPasswordPolicy(input.password);
    if ((await this.userRepository.count()) > 0) {
      throw localAuthRefusal('SETUP_CLOSED');
    }
    const { affected } = await run(
      this.dataSource,
      insertIgnore(
        'auth_one_time_token',
        {
          id: randomUUID(),
          user_id: null,
          purpose: 'setup',
          token_hash: SETUP_CLAIM_HASH,
          expires_at: new Date(now.getTime() + SETUP_CLAIM_TTL_MS),
          consumed_at: now,
          attempts: 0,
        },
        ['token_hash'],
      ),
    );
    if (affected === 0) {
      // The row exists: another setup holds the claim.
      throw localAuthRefusal('SETUP_CLOSED');
    }

    let user: User | undefined;
    let organizationId: string;
    // Only steps 5 to 7 (account, organisation, claim mark) are undone on a
    // failure: once the claim carries the administrator, a concurrent sign-up
    // may already exist, and undoing the setup would leave it the instance.
    try {
      user = await this.accounts.createAccount(
        { email: input.email, password: input.password, name: input.name },
        now,
      );
      // The organisation itself: the request's other fields belong to a
      // closed extension's sign-up and stay empty here.
      const request = {
        name: input.organizationName,
        industry: '',
        country: '',
        creatorId: user.id,
      } as OrganizationCreateRequest;
      const organization = await this.organizations.createOrganization(request);
      organizationId = organization.organizationId;
      // Mark the setup finished: this UPDATE locks the claim row, so a
      // sign-up racing the setup either waits for it or is refused. The
      // update builder maps property names only without an alias prefix.
      await this.tokenRepository
        .createQueryBuilder()
        .update(AuthOneTimeToken)
        .set({ userId: user.id })
        .where('tokenHash = :hash', { hash: SETUP_CLAIM_HASH })
        .execute();
    } catch (e) {
      await this.reopenSetup(user);
      throw e;
    }
    // The setup is done: a failure from here on keeps the administrator, who
    // signs in normally.
    const session = await this.auth.openSession(user.id, now);
    const team = await this.teamRepository.findOne({
      where: { organization: { id: organizationId } },
    });
    return {
      session,
      organizationId,
      teamId: team?.id ?? '',
    };
  }

  /**
   * SignUp. invite_only answers SIGNUP_DISABLED; while the setup is still
   * open (no claim row, or a claim row whose user_id is still null) it
   * answers SETUP_REQUIRED — the locking read runs in one transaction, and
   * the setup's mark-UPDATE locks the same row, so a race either waits for
   * the setup's commit or is refused, on both engines. Then the account is
   * created (ACCOUNT_EXISTS on a duplicate e-mail) and a session opened; the
   * new account joins no organisation.
   */
  async signUp(
    input: Pick<LocalSignUpRequest, 'email' | 'name' | 'password'>,
    now: Date,
  ): Promise<LocalAuthSession> {
    if (this.signupMode() !== 'open') {
      throw localAuthRefusal('SIGNUP_DISABLED');
    }
    assertPasswordPolicy(input.password);
    await this.dataSource.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder(AuthOneTimeToken, 't')
        .select('t.userId', 'userId')
        .setLock('pessimistic_read')
        .where('t.tokenHash = :hash', { hash: SETUP_CLAIM_HASH })
        .getRawOne<{ userId: string | null }>();
      if (!row || row.userId === null || row.userId === undefined) {
        throw localAuthRefusal('SETUP_REQUIRED');
      }
    });
    const user = await this.accounts.createAccount(
      { email: input.email, password: input.password, name: input.name },
      now,
    );
    return this.auth.openSession(user.id, now);
  }

  private signupMode(): SignupMode {
    return this.config.get<SignupMode>('AUTH_SIGNUP_MODE') ?? 'invite_only';
  }

  /** Deletes the claim row and the user (when created): the setup reopens. */
  private async reopenSetup(user: User | undefined): Promise<void> {
    try {
      await run(
        this.dataSource,
        sql`DELETE FROM ${AOTT_TABLE} WHERE ${c('token_hash')} = ${SETUP_CLAIM_HASH}`,
      );
      if (user) {
        // The credential row goes with the user (FK … ON DELETE CASCADE).
        await this.userRepository.delete({ id: user.id });
      }
    } catch (e) {
      this.logger.error(`AUTH_SETUP_CLEANUP_FAILED error=${(e as Error).name}`);
    }
  }
}
