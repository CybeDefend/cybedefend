import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ident, run, sql } from '@cybedefend/db-dialect';
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
import { AccessTokenIssuer } from './access-token.issuer';
import { AuthOneTimeToken } from './entities/auth-one-time-token.entity';
import { LocalCredential } from './entities/local-credential.entity';
import { LocalAccountService } from './local-account.service';
import { LocalAuthService } from './local-auth.service';
import { LocalCredentialStore } from './local-credential.store';
import { OneTimeTokenStore } from './one-time-token.store';
import { PasswordHasher } from './password-hasher';
import { PersonalAccessTokenStore } from './personal-access-token.store';
import { RefreshTokenStore } from './refresh-token.store';
import { SETUP_CLAIM_HASH, SetupService } from './setup.service';
import { SigningKeyService } from './signing-key.service';

/**
 * LIVE spec of the instance setup and sign-up: on a real MySQL and a
 * real PostgreSQL, two concurrent setups create exactly one administrator
 * (the insertIgnore claim row serialises them), a sign-up racing the setup
 * never becomes the first user (the claim's locking read), the e-mail is stored
 * lower-cased and the same e-mail in another case is refused with
 * ACCOUNT_EXISTS leaving no credential row, and the administrator signs in
 * with an upper-case e-mail through LocalAuthService.login.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=setup.service.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=setup.service.live
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
const PASSWORD = 'the-admin-password-1';

describeLive('SetupService on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let service: SetupService;
  let auth: LocalAuthService;
  let signupMode = 'invite_only';
  let logger: ReturnType<typeof createLoggerMock>;

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
      return undefined;
    },
  } as unknown as ConfigService;

  const mail = {
    isConfigured: (): boolean => false,
    sendWelcomeEmail: async (): Promise<void> => undefined,
  } as unknown as MailService;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_setup',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option (contract issue 15)
      extra: dialect === 'postgres' ? { max: 10 } : { connectionLimit: 10 },
    });
    dataSource = live.dataSource;
    logger = createLoggerMock();

    const hasher = new PasswordHasher();
    const credentials = new LocalCredentialStore(
      dataSource,
      hasher,
      new OneTimeTokenStore(dataSource),
    );
    const signingKeys = new SigningKeyService(dataSource, secrets);
    await signingKeys.ensureSigningKey();
    const issuer = new AccessTokenIssuer(signingKeys);
    const refreshTokens = new RefreshTokenStore(dataSource);
    const userRepo = dataSource.getRepository(User);
    auth = new LocalAuthService(
      userRepo,
      hasher,
      credentials,
      signingKeys,
      issuer,
      refreshTokens,
      logger as unknown as Logger,
      new PersonalAccessTokenStore(dataSource),
    );
    const accounts = new LocalAccountService(
      dataSource,
      hasher,
      credentials,
      mail,
      logger as unknown as Logger,
    );
    // Stubbed with plain repository inserts, to stay independent of Permify:
    // it creates the organisation and its default team, nothing else.
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
        const teamRepo = dataSource.getRepository(Team);
        await teamRepo.save(
          teamRepo.create({
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

    service = new SetupService(
      dataSource,
      userRepo,
      dataSource.getRepository(AuthOneTimeToken),
      dataSource.getRepository(Team),
      accounts,
      auth,
      organizations,
      mail,
      config,
      logger as unknown as Logger,
    );
  });

  afterAll(async () => {
    await live?.drop();
  });

  /** Empties every table the setup touches, children first (FK order). */
  async function resetTables(): Promise<void> {
    for (const table of [
      'auth_one_time_token',
      'auth_refresh_token',
      'local_credential',
      'personal_access_token',
      'teams_members',
      'users_organizations_members',
      'team',
      'organization',
      'user',
    ]) {
      await run(dataSource, sql`DELETE FROM ${ident(table)}`);
    }
    signupMode = 'invite_only';
  }

  function setupInput(email = 'admin@example.test') {
    return {
      setupToken: SETUP_TOKEN,
      email,
      name: 'Ada Lovelace',
      password: PASSWORD,
      organizationName: 'Acme',
    };
  }

  function refusalOf(
    promise: Promise<unknown>,
  ): Promise<{ code: status; message: string }> {
    return promise.then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => {
        expect(e).toBeInstanceOf(RpcException);
        return (e as RpcException).getError() as {
          code: status;
          message: string;
        };
      },
    );
  }

  it('two concurrent setups create one administrator', async () => {
    await resetTables();
    const results = await Promise.allSettled([
      service.setup(setupInput(), new Date()),
      service.setup(setupInput(), new Date()),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const refusal = await refusalOf(
      Promise.reject((rejected[0] as PromiseRejectedResult).reason),
    );
    expect(refusal).toEqual({
      code: status.FAILED_PRECONDITION,
      message: 'SETUP_CLOSED',
    });
    // SELECT COUNT(*) FROM user = 1, read through the repository (the `user`
    // table is a reserved word on PostgreSQL, never named in raw text).
    expect(await dataSource.getRepository(User).count()).toBe(1);
    // The winner's answer carries the organisation and its default team.
    const ok = (
      fulfilled[0] as PromiseFulfilledResult<{
        session: unknown;
        organizationId: string;
        teamId: string;
      }>
    ).value;
    expect(ok.session).toBeDefined();
    expect(ok.organizationId).toBeTruthy();
    expect(ok.teamId).toBeTruthy();
    const claim = await dataSource
      .getRepository(AuthOneTimeToken)
      .findOneByOrFail({ tokenHash: SETUP_CLAIM_HASH });
    const users = await dataSource.getRepository(User).find();
    expect(users).toHaveLength(1);
    expect(claim.userId).toBe(users[0].id);
  });

  it('a sign-up racing the setup never becomes the first user', async () => {
    for (let i = 0; i < 10; i += 1) {
      await resetTables();
      signupMode = 'open';
      const racer = `racer-${i}@example.test`;
      const [setupResult, signUpResult] = await Promise.allSettled([
        service.setup(setupInput(), new Date()),
        service.signUp(
          { email: racer, password: PASSWORD, name: 'Racer' },
          new Date(),
        ),
      ]);
      // The setup always wins.
      expect(setupResult.status).toBe('fulfilled');
      if (signUpResult.status === 'rejected') {
        const refusal = await refusalOf(
          Promise.reject((signUpResult as PromiseRejectedResult).reason),
        );
        expect(refusal).toEqual({
          code: status.FAILED_PRECONDITION,
          message: 'SETUP_REQUIRED',
        });
      }
      const users = await dataSource
        .getRepository(User)
        .find({ order: { createdAt: 'ASC', id: 'ASC' } });
      // The first user row is the administrator, never the racing sign-up.
      expect(users[0].email).toBe('admin@example.test');
      if (signUpResult.status === 'fulfilled') {
        expect(users).toHaveLength(2);
        expect(users[1].email).toBe(racer);
      } else {
        expect(users).toHaveLength(1);
      }
    }
  });

  it('stores the e-mail lower-cased and refuses the same e-mail in another case', async () => {
    await resetTables();
    signupMode = 'open';
    await service.setup(setupInput('Admin@Example.TEST'), new Date());
    const admin = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'admin@example.test' });
    expect(admin.email).toBe('admin@example.test');

    const refusal = await refusalOf(
      service.signUp(
        { email: 'ADMIN@example.test', password: PASSWORD, name: 'Other' },
        new Date(),
      ),
    );
    expect(refusal).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'ACCOUNT_EXISTS',
    });
    // The failed transaction left no row behind: still one user, one
    // credential.
    expect(await dataSource.getRepository(User).count()).toBe(1);
    expect(await dataSource.getRepository(LocalCredential).count()).toBe(1);
  });

  it('the administrator signs in with an upper-case e-mail', async () => {
    await resetTables();
    await service.setup(setupInput('Admin@Example.TEST'), new Date());
    const session = await auth.login(
      'ADMIN@EXAMPLE.TEST',
      PASSWORD,
      new Date(),
    );
    const users = await dataSource.getRepository(User).find();
    expect(users).toHaveLength(1);
    expect(session.userId).toBe(users[0].id);
    expect(session.email).toBe('admin@example.test');
    expect(session.name).toBe('Ada Lovelace');
    expect(session.accessToken.split('.')).toHaveLength(3);
  });

  it('reports the setup status', async () => {
    await resetTables();
    await expect(service.status()).resolves.toEqual({
      setupOpen: true,
      signupMode: 'invite_only',
      passwordResetByEmail: false,
    });
    await service.setup(setupInput(), new Date());
    await expect(service.status()).resolves.toEqual({
      setupOpen: false,
      signupMode: 'invite_only',
      passwordResetByEmail: false,
    });
  });
});
