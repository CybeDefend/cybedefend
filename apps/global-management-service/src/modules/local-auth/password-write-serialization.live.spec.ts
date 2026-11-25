import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import type { DataSource, EntityManager } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ident, run, sql } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import type SecretsService from 'src/core/secrets/secrets.service';
import { User } from 'src/entities/user.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { AccessTokenIssuer } from './access-token.issuer';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { LocalAccountService } from './local-account.service';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';
import { LocalCredentialStore } from './local-credential.store';
import { OneTimeTokenStore } from './one-time-token.store';
import { PasswordHasher } from './password-hasher';
import { PasswordResetService } from './password-reset.service';
import { PersonalAccessTokenStore } from './personal-access-token.store';
import { RefreshTokenStore } from './refresh-token.store';
import { ResetRequesterKeyer } from './reset-requester-key';
import { SetupService } from './setup.service';
import { SigningKeyService } from './signing-key.service';

/**
 * LIVE spec of how a password write (reset or change) orders itself against
 * the account's other credential writes, on a real MySQL and a real
 * PostgreSQL:
 *
 * - a refresh rotation and a token creation running at the same moment as a
 *   reset leave nothing valid behind: the replacement refresh token inserted
 *   by a rotation in flight, and a token created with the old password while
 *   the reset commits, are revoked or refused like everything else;
 * - the revocations are part of the password's transaction: when one fails,
 *   the password is not changed and the reset link is not used up.
 *
 * To make the race window wide and the outcome deterministic, a trigger
 * delays every insert into the refresh-token table by 150 ms while the
 * concurrent rounds run.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=password-write-serialization.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=password-write-serialization.live
 */
const LIVE = liveEnabled('LOCAL_AUTH');
const describeLive = LIVE ? describe : describe.skip;

const ROOT = join(__dirname, '..', '..');
const LOCAL_AUTH_ENTITIES = join(
  ROOT,
  'modules',
  'local-auth',
  'entities',
  '*.entity{.ts,.js}',
);

const ROUNDS = 20;

/** A token store whose user-wide revocation fails inside the caller's transaction. */
class FailingRevocationStore extends PersonalAccessTokenStore {
  fail = false;

  async revokeAllOfUser(
    userId: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<number> {
    if (this.fail && manager) {
      // A real statement that the engine refuses, on the transaction's
      // connection: the transaction must roll back as a whole.
      await run(
        manager,
        sql`UPDATE ${ident('no_such_table_for_this_spec')} SET ${ident('x')} = 1`,
      );
    }
    return super.revokeAllOfUser(userId, now, manager);
  }
}

/** A hasher whose verification answers only once `hold` resolves. */
class GatedHasher extends PasswordHasher {
  hold: Promise<void> = Promise.resolve();

  async verify(hash: string, password: string): Promise<boolean> {
    const ok = await super.verify(hash, password);
    await this.hold;
    return ok;
  }
}

describeLive('Password writes against concurrent credential writes', () => {
  jest.setTimeout(600_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let dialect: 'mysql' | 'postgres';
  let auth: LocalAuthService;
  let accounts: LocalAccountService;
  let passwordReset: PasswordResetService;
  let controller: LocalAuthController;
  let oneTimeTokens: OneTimeTokenStore;
  let pats: FailingRevocationStore;
  let gated: GatedHasher;
  let gatedController: LocalAuthController;

  const encryptionKey = randomBytes(32);
  const secrets = {
    ensureCacheLoaded: async (): Promise<void> => undefined,
    getSecret: (key: string): string | undefined =>
      key === 'AUTH_SIGNING_KEY_ENCRYPTION_KEY'
        ? encryptionKey.toString('base64')
        : undefined,
  } as unknown as SecretsService;
  const config = {
    get: (key: string): string | undefined =>
      key === 'FRONTEND_URL' ? 'https://cd.example.test' : undefined,
  } as unknown as ConfigService;
  const mail = {
    isConfigured: (): boolean => false,
    sendWelcomeEmail: async (): Promise<void> => undefined,
  } as unknown as MailService;

  beforeAll(async () => {
    dialect = liveDialect('GM') as 'mysql' | 'postgres';
    live = await createLiveDatabase({
      prefix: 'gm_pwserial',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      extra: dialect === 'postgres' ? { max: 20 } : { connectionLimit: 20 },
    });
    dataSource = live.dataSource;
    const logger = createLoggerMock() as unknown as Logger;
    const hasher = new PasswordHasher();
    oneTimeTokens = new OneTimeTokenStore(dataSource);
    const credentials = new LocalCredentialStore(
      dataSource,
      hasher,
      oneTimeTokens,
    );
    const signingKeys = new SigningKeyService(dataSource, secrets);
    await signingKeys.ensureSigningKey();
    const refreshTokens = new RefreshTokenStore(dataSource);
    pats = new FailingRevocationStore(dataSource);
    const userRepo = dataSource.getRepository(User);
    auth = new LocalAuthService(
      userRepo,
      hasher,
      credentials,
      signingKeys,
      new AccessTokenIssuer(signingKeys),
      refreshTokens,
      logger,
      pats,
    );
    accounts = new LocalAccountService(
      dataSource,
      hasher,
      credentials,
      mail,
      logger,
    );
    passwordReset = new PasswordResetService(
      dataSource,
      userRepo,
      oneTimeTokens,
      credentials,
      hasher,
      refreshTokens,
      mail,
      config,
      logger,
      { keyOf: () => 'requester' } as unknown as ResetRequesterKeyer,
      pats,
    );
    controller = new LocalAuthController(
      auth,
      pats,
      userRepo,
      logger,
      {} as SetupService,
      passwordReset,
      {} as InvitationAcceptanceService,
      credentials,
    );
    // The same edge, with a password check that can be held open.
    gated = new GatedHasher();
    gatedController = new LocalAuthController(
      auth,
      pats,
      userRepo,
      logger,
      {} as SetupService,
      passwordReset,
      {} as InvitationAcceptanceService,
      new LocalCredentialStore(dataSource, gated, oneTimeTokens),
    );
  });

  afterAll(async () => {
    await dropDelay().catch(() => undefined);
    await live?.drop();
  });

  /** Delays every insert into auth_refresh_token by 150 ms. */
  async function addDelay(): Promise<void> {
    if (dialect === 'postgres') {
      await dataSource.query(
        `CREATE OR REPLACE FUNCTION spec_slow_refresh_insert() RETURNS trigger AS $$
         BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$ LANGUAGE plpgsql`,
      );
      await dataSource.query(
        `CREATE TRIGGER spec_slow_refresh_insert BEFORE INSERT ON auth_refresh_token
         FOR EACH ROW EXECUTE FUNCTION spec_slow_refresh_insert()`,
      );
    } else {
      await dataSource.query(
        `CREATE TRIGGER spec_slow_refresh_insert BEFORE INSERT ON auth_refresh_token
         FOR EACH ROW SET @spec_slept = SLEEP(0.15)`,
      );
    }
  }

  async function dropDelay(): Promise<void> {
    if (dialect === 'postgres') {
      await dataSource.query(
        'DROP TRIGGER IF EXISTS spec_slow_refresh_insert ON auth_refresh_token',
      );
    } else {
      await dataSource.query('DROP TRIGGER IF EXISTS spec_slow_refresh_insert');
    }
  }

  async function newAccount(password: string) {
    const email = `serial-${randomUUID()}@example.test`;
    const user = await accounts.createAccount(
      { email, password, name: 'Grace' },
      new Date(),
    );
    return { userId: user.id, email };
  }

  async function count(table: string, userId: string, extra = sql``) {
    const { rows } = await run(
      dataSource,
      sql`SELECT COUNT(*) AS ${ident('n')} FROM ${ident(table)}
        WHERE ${ident('user_id')} = ${userId} AND ${ident('revoked_at')} IS NULL ${extra}`,
    );
    return Number(rows[0]?.n);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it(`a refresh loop and a token creation racing a reset leave nothing valid (${ROUNDS} rounds)`, async () => {
    await addDelay();
    try {
      for (let round = 0; round < ROUNDS; round += 1) {
        const password = `the-old-password-${round}`;
        const account = await newAccount(password);
        const session = await auth.login(account.email, password);
        const resetToken = await oneTimeTokens.createPasswordReset(
          account.userId,
          new Date(),
          { bypassLimit: true },
        );

        // A client that keeps its session alive: rotate, rotate, rotate…
        let latest = session.refreshToken;
        const refreshLoop = (async () => {
          for (let i = 0; i < 10; i += 1) {
            try {
              latest = (await auth.refresh(latest)).refreshToken;
            } catch {
              return;
            }
          }
        })();
        // A token created with the old password at the same moment.
        const creation = controller
          .createPersonalAccessToken({
            userId: account.userId,
            name: 'ci',
            expiresAt: 0,
            currentPassword: password,
          })
          .catch((e: unknown) => e);
        // The reset lands while both run.
        await sleep(40 + (round % 5) * 30);
        await passwordReset.reset(
          resetToken as string,
          `the-new-password-${round}`,
          new Date(),
        );
        await Promise.all([refreshLoop, creation]);

        // Nothing that predates or raced the reset is still valid.
        expect({
          round,
          sessions: await count(
            'auth_refresh_token',
            account.userId,
            sql`AND ${ident('rotated_at')} IS NULL`,
          ),
          tokens: await count('personal_access_token', account.userId),
        }).toEqual({ round, sessions: 0, tokens: 0 });
        await expect(auth.refresh(latest)).rejects.toBeInstanceOf(RpcException);
      }
    } finally {
      await dropDelay();
    }
  });

  it('a token created with the old password while the reset commits does not survive it', async () => {
    const account = await newAccount('the-old-password-z');
    const resetToken = (await oneTimeTokens.createPasswordReset(
      account.userId,
      new Date(),
      { bypassLimit: true },
    )) as string;
    let open!: () => void;
    gated.hold = new Promise<void>((resolve) => {
      open = resolve;
    });

    // The old password is checked, then the reset commits, then the token
    // would be written.
    const creation = gatedController
      .createPersonalAccessToken({
        userId: account.userId,
        name: 'ci',
        expiresAt: 0,
        currentPassword: 'the-old-password-z',
      })
      .then(
        () => 'created',
        (e: unknown) =>
          ((e as RpcException).getError() as { message: string }).message,
      );
    await sleep(300);
    await passwordReset.reset(resetToken, 'the-new-password-z', new Date());
    open();

    expect(await creation).toBe('CURRENT_PASSWORD_INVALID');
    expect(await count('personal_access_token', account.userId)).toBe(0);
    gated.hold = Promise.resolve();
  });

  it('a revocation that fails rolls the reset back: the password and the link are unchanged', async () => {
    const account = await newAccount('the-old-password-x');
    const resetToken = (await oneTimeTokens.createPasswordReset(
      account.userId,
      new Date(),
      { bypassLimit: true },
    )) as string;

    pats.fail = true;
    try {
      await expect(
        passwordReset.reset(resetToken, 'the-new-password-x', new Date()),
      ).rejects.toBeDefined();
    } finally {
      pats.fail = false;
    }

    await expect(
      auth.login(account.email, 'the-old-password-x'),
    ).resolves.toMatchObject({ userId: account.userId });
    await expect(
      auth.login(account.email, 'the-new-password-x'),
    ).rejects.toBeInstanceOf(RpcException);
    // The link was not used up: the same reset now goes through.
    await passwordReset.reset(resetToken, 'the-new-password-x', new Date());
    await expect(
      auth.login(account.email, 'the-new-password-x'),
    ).resolves.toMatchObject({ userId: account.userId });
  });

  it('a revocation that fails rolls the change back: the password is unchanged', async () => {
    const account = await newAccount('the-old-password-y');

    pats.fail = true;
    try {
      await expect(
        auth.changePassword(
          account.userId,
          'the-old-password-y',
          'the-new-password-y',
        ),
      ).rejects.toBeDefined();
    } finally {
      pats.fail = false;
    }

    await expect(
      auth.login(account.email, 'the-old-password-y'),
    ).resolves.toMatchObject({ userId: account.userId });
    await expect(
      auth.login(account.email, 'the-new-password-y'),
    ).rejects.toBeInstanceOf(RpcException);
  });
});
