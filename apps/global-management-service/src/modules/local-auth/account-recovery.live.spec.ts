import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { dialectApi, ident, run, sql } from '@cybedefend/db-dialect';
import type { OrganizationCreateRequest } from '@grpc/global-management/organization';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import type SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { OrganizationService } from 'src/modules/organization/organization.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { CommunityIdentityProvider } from 'src/edition/community/identity-provider.community';
import { AccessTokenIssuer } from './access-token.issuer';
import { AuthOneTimeToken } from './entities/auth-one-time-token.entity';
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
 * LIVE spec of what a password reset and a password change do to the
 * account's other credentials, on a real MySQL and a real PostgreSQL, through
 * the real gRPC controller, services and stores:
 *
 * - a reset and a change revoke every personal access token and every
 *   session (refresh family) of the account;
 * - an account created by open sign-up with someone else's address, then
 *   recovered by the address's owner through a reset, keeps nothing the
 *   person who registered it created: their token is refused even once the
 *   owner has joined an organisation.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=account-recovery.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=account-recovery.live
 */
const LIVE = liveEnabled('LOCAL_AUTH');
const describeLive = LIVE ? describe : describe.skip;

/** The service root (`src/`), where the entity globs point. */
const ROOT = join(__dirname, '..', '..');
const LOCAL_AUTH_ENTITIES = join(
  ROOT,
  'modules',
  'local-auth',
  'entities',
  '*.entity{.ts,.js}',
);

const SETUP_TOKEN = 'live-setup-token-0123456789';
const ADMIN_PASSWORD = 'the-admin-password-1';

describeLive('Account recovery on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let setup: SetupService;
  let auth: LocalAuthService;
  let accounts: LocalAccountService;
  let passwordReset: PasswordResetService;
  let controller: LocalAuthController;
  let identity: CommunityIdentityProvider;
  const signupMode = 'open';
  /** The reset links the mail stub was asked to send, by address. */
  const mailedLinks = new Map<string, string>();

  const encryptionKey = randomBytes(32);
  const secrets = {
    ensureCacheLoaded: async (): Promise<void> => undefined,
    getSecret: (key: string): string | undefined =>
      key === 'AUTH_SIGNING_KEY_ENCRYPTION_KEY'
        ? encryptionKey.toString('base64')
        : undefined,
  } as unknown as SecretsService;

  const config = {
    get: (key: string): string | undefined => {
      if (key === 'CYBEDEFEND_SETUP_TOKEN') return SETUP_TOKEN;
      if (key === 'AUTH_SIGNUP_MODE') return signupMode;
      if (key === 'FRONTEND_URL') return 'https://cd.example.test';
      return undefined;
    },
  } as unknown as ConfigService;

  const mail = {
    isConfigured: (): boolean => true,
    sendWelcomeEmail: async (): Promise<void> => undefined,
    sendPasswordResetEmail: async (input: {
      to: string;
      link: string;
    }): Promise<boolean> => {
      mailedLinks.set(input.to, input.link);
      return true;
    },
  } as unknown as MailService;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_recovery',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      extra: dialect === 'postgres' ? { max: 10 } : { connectionLimit: 10 },
    });
    dataSource = live.dataSource;
    const logger = createLoggerMock() as unknown as Logger;

    const hasher = new PasswordHasher();
    const oneTimeTokens = new OneTimeTokenStore(dataSource);
    const credentials = new LocalCredentialStore(
      dataSource,
      hasher,
      oneTimeTokens,
    );
    const signingKeys = new SigningKeyService(dataSource, secrets);
    await signingKeys.ensureSigningKey();
    const refreshTokens = new RefreshTokenStore(dataSource);
    const pats = new PersonalAccessTokenStore(dataSource);
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
    // Creates the organisation and its default team with plain inserts, to
    // stay independent of the authorization service.
    const organizations = {
      createOrganization: async (request: OrganizationCreateRequest) => {
        const orgRepo = dataSource.getRepository(Organization);
        const org = await orgRepo.save(
          orgRepo.create({
            id: randomUUID(),
            name: request.name,
            industry: '',
            country: '',
            isActive: true,
            concurrentScanLimit: 1,
            memberProducts: false,
            creator: { id: request.creatorId } as User,
          } as Partial<Organization>),
        );
        await dataSource.getRepository(Team).save(
          dataSource.getRepository(Team).create({
            id: randomUUID(),
            name: 'Default team',
            description: 'Default team for the organization',
            organization: { id: org.id } as Organization,
            creator: { id: request.creatorId } as User,
          } as Partial<Team>),
        );
        return {
          message: 'Organization created successfully',
          organizationId: org.id,
          name: org.name,
          industry: org.industry,
        };
      },
    } as unknown as OrganizationService;
    setup = new SetupService(
      dataSource,
      userRepo,
      dataSource.getRepository(AuthOneTimeToken),
      dataSource.getRepository(Team),
      accounts,
      auth,
      organizations,
      mail,
      config,
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
      setup,
      passwordReset,
      {} as InvitationAcceptanceService,
      credentials,
    );

    // What UserService's generic token routes reach in the Community Edition.
    identity = new CommunityIdentityProvider(pats, refreshTokens);

    // The instance is set up: open sign-up is possible from here on.
    await setup.setup(
      {
        setupToken: SETUP_TOKEN,
        email: 'admin@example.test',
        name: 'Admin',
        password: ADMIN_PASSWORD,
        organizationName: 'Acme',
      },
      new Date(),
    );
  });

  afterAll(async () => {
    await live?.drop();
  });

  function refusalOf(promise: Promise<unknown>): Promise<string> {
    return promise.then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => {
        expect(e).toBeInstanceOf(RpcException);
        return ((e as RpcException).getError() as { message: string }).message;
      },
    );
  }

  async function newAccount(password: string): Promise<{
    userId: string;
    email: string;
    refreshToken: string;
  }> {
    const email = `member-${randomUUID()}@example.test`;
    const user = await accounts.createAccount(
      { email, password, name: 'Grace' },
      new Date(),
    );
    const session = await auth.login(email, password);
    return { userId: user.id, email, refreshToken: session.refreshToken };
  }

  async function createToken(
    userId: string,
    password: string,
    name = `ci-${randomUUID()}`,
  ): Promise<string> {
    const created = await controller.createPersonalAccessToken({
      userId,
      name,
      expiresAt: 0,
      currentPassword: password,
    });
    return created.value;
  }

  /** The token of the reset link mailed to `email` (the detached chain). */
  async function mailedResetToken(email: string): Promise<string> {
    mailedLinks.delete(email);
    await passwordReset.request(email, new Date());
    for (let i = 0; i < 200 && !mailedLinks.has(email); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const link = mailedLinks.get(email);
    if (!link) throw new Error('no reset link was mailed');
    return link.split('#token=')[1];
  }

  async function activeTokens(userId: string): Promise<number> {
    const { rows } = await run(
      dataSource,
      sql`SELECT COUNT(*) AS ${ident('n')} FROM ${ident('personal_access_token')}
        WHERE ${ident('user_id')} = ${userId} AND ${ident('revoked_at')} IS NULL`,
    );
    return Number(rows[0]?.n);
  }

  it('creates a personal access token only with the account password', async () => {
    const password = 'the-first-password-0';
    const account = await newAccount(password);
    for (const currentPassword of ['not-the-password-0', '', undefined]) {
      expect(
        await refusalOf(
          controller.createPersonalAccessToken({
            userId: account.userId,
            name: 'ci',
            expiresAt: 0,
            currentPassword,
          }),
        ),
      ).toBe('CURRENT_PASSWORD_INVALID');
    }
    expect(await activeTokens(account.userId)).toBe(0);

    const token = await createToken(account.userId, password, 'ci');
    await expect(
      controller.verifyPersonalAccessToken({ token }),
    ).resolves.toMatchObject({ userId: account.userId });
    expect(await activeTokens(account.userId)).toBe(1);
  });

  it('a session token alone cannot create a token through either route', async () => {
    const password = 'the-first-password-9';
    const account = await newAccount(password);

    // The local-auth route without the password.
    expect(
      await refusalOf(
        controller.createPersonalAccessToken({
          userId: account.userId,
          name: 'ci',
          expiresAt: 0,
          currentPassword: '',
        }),
      ),
    ).toBe('CURRENT_PASSWORD_INVALID');
    // The generic route, which carries no password at all.
    expect(
      await refusalOf(identity.createPersonalAccessToken(account.userId, 'ci')),
    ).toMatch(/^PAT_PASSWORD_REQUIRED: /);
    expect(await activeTokens(account.userId)).toBe(0);
  });

  it('a password reset revokes every personal access token and every session', async () => {
    const password = 'the-first-password-1';
    const account = await newAccount(password);
    const first = await createToken(account.userId, password);
    const second = await createToken(account.userId, password);
    const otherSession = await auth.login(account.email, password);

    await passwordReset.reset(
      await mailedResetToken(account.email),
      'the-recovered-password-1',
      new Date(),
    );

    for (const token of [first, second]) {
      expect(
        await refusalOf(controller.verifyPersonalAccessToken({ token })),
      ).toBe('PAT_INVALID');
    }
    for (const refreshToken of [
      account.refreshToken,
      otherSession.refreshToken,
    ]) {
      expect(await refusalOf(auth.refresh(refreshToken))).toBe(
        'REFRESH_INVALID',
      );
    }
    expect(await activeTokens(account.userId)).toBe(0);
  });

  it('a password change revokes every personal access token and every other session', async () => {
    const password = 'the-first-password-2';
    const account = await newAccount(password);
    const token = await createToken(account.userId, password);

    const session = await auth.changePassword(
      account.userId,
      password,
      'the-changed-password-2',
    );

    expect(
      await refusalOf(controller.verifyPersonalAccessToken({ token })),
    ).toBe('PAT_INVALID');
    expect(await refusalOf(auth.refresh(account.refreshToken))).toBe(
      'REFRESH_INVALID',
    );
    expect(await activeTokens(account.userId)).toBe(0);
    // The caller keeps the new session the change opened.
    await expect(auth.refresh(session.refreshToken)).resolves.toMatchObject({
      userId: account.userId,
    });
  });

  it("refuses the token of whoever registered someone else's address once the owner recovers the account", async () => {
    const owner = `colleague-${randomUUID()}@example.test`;
    // Open sign-up with an address the visitor does not own.
    const visitorPassword = 'the-visitor-password-1';
    const visitorSession = await setup.signUp(
      { email: owner, name: 'Not the owner', password: visitorPassword },
      new Date(),
    );
    const visitorToken = await createToken(
      visitorSession.userId,
      visitorPassword,
    );
    await expect(
      controller.verifyPersonalAccessToken({ token: visitorToken }),
    ).resolves.toMatchObject({ userId: visitorSession.userId });

    // The owner cannot sign up again: they recover the account by e-mail.
    expect(
      await refusalOf(
        setup.signUp(
          { email: owner, name: 'Owner', password: 'the-owner-password-1' },
          new Date(),
        ),
      ),
    ).toBe('ACCOUNT_EXISTS');
    await passwordReset.reset(
      await mailedResetToken(owner),
      'the-owner-password-1',
      new Date(),
    );
    const ownerSession = await auth.login(owner, 'the-owner-password-1');
    expect(ownerSession.userId).toBe(visitorSession.userId);

    // The owner then joins an organisation (the accepted invitation's row).
    const organizationId = (
      await dataSource.getRepository(Organization).findOneOrFail({
        where: { name: 'Acme' },
      })
    ).id;
    const db = dialectApi(live.dialect);
    await run(
      dataSource,
      db.sql`INSERT INTO ${db.ident('users_organizations_members')} (${db.ident('id')}, ${db.ident('role')}, ${db.ident('userId')}, ${db.ident('organizationId')})
        VALUES (${randomUUID()}, 'member', ${ownerSession.userId}, ${organizationId})`,
    );

    // Nothing the visitor kept still opens the account.
    expect(
      await refusalOf(
        controller.verifyPersonalAccessToken({ token: visitorToken }),
      ),
    ).toBe('PAT_INVALID');
    expect(await refusalOf(auth.refresh(visitorSession.refreshToken))).toBe(
      'REFRESH_INVALID',
    );
    expect(await refusalOf(auth.login(owner, visitorPassword))).toBe(
      'INVALID_CREDENTIALS',
    );
  });
});
