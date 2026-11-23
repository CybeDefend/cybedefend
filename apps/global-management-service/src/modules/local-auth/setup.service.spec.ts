import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import type { LocalAuthSession } from '@grpc/global-management/local_auth';
import type { OrganizationCreateRequest } from '@grpc/global-management/organization';
import { User } from 'src/entities/user.entity';
import { Team } from 'src/entities/team.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { OrganizationService } from 'src/modules/organization/organization.service';
import {
  createLoggerMock,
  createMockRepository,
  type MockType,
} from 'src/test-utils/typeorm-mock.util';
import { AuthOneTimeToken } from './entities/auth-one-time-token.entity';
import { LocalAccountService } from './local-account.service';
import { LocalAuthService } from './local-auth.service';
import { localAuthRefusal } from './local-auth-refusals';
import { SETUP_CLAIM_HASH, SetupService } from './setup.service';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const SETUP_TOKEN = 'the-setup-token-0123456789';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'the-admin-password-1';

const SESSION: LocalAuthSession = {
  accessToken: 'the.jwt',
  accessTokenExpiresAt: 1_800_000_000_900_000,
  refreshToken: 'the-refresh-token',
  refreshTokenExpiresAt: 1_800_000_000_000_000,
  userId: ADMIN_ID,
  email: 'admin@example.test',
  name: 'Ada Lovelace',
};

const admin = {
  id: ADMIN_ID,
  email: 'admin@example.test',
  firstName: 'Ada Lovelace',
  lastName: '',
} as User;

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: status; message: string }> {
  const thrown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(RpcException);
  return (thrown as RpcException).getError() as {
    code: status;
    message: string;
  };
}

describe('SetupService', () => {
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock; transaction: jest.Mock };
  let userRepo: MockType<Repository<User>>;
  let tokenRepo: MockType<Repository<AuthOneTimeToken>> & {
    createQueryBuilder: jest.Mock;
  };
  let updateQb: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };
  let teamRepo: MockType<Repository<Team>>;
  let accounts: { createAccount: jest.Mock };
  let auth: { openSession: jest.Mock };
  let organizations: { createOrganization: jest.Mock };
  let mail: { isConfigured: jest.Mock; sendWelcomeEmail: jest.Mock };
  let configGet: jest.Mock;
  let config: ConfigService;
  let logger: ReturnType<typeof createLoggerMock>;
  let service: SetupService;
  let signupMode: string | undefined;

  beforeEach(() => {
    runner = {
      connect: jest.fn(async () => undefined),
      query: jest.fn(async () => ({ affectedRows: 1 })),
      release: jest.fn(async () => undefined),
    };
    dataSource = {
      createQueryRunner: jest.fn(() => runner),
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) =>
        cb({} as EntityManager),
      ),
    };
    userRepo = createMockRepository<User>();
    updateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => ({ affected: 1 })),
    };
    tokenRepo = {
      ...createMockRepository<AuthOneTimeToken>(),
      countBy: jest.fn(),
      createQueryBuilder: jest.fn(() => updateQb),
    } as MockType<Repository<AuthOneTimeToken>> & {
      createQueryBuilder: jest.Mock;
    };
    teamRepo = createMockRepository<Team>();
    accounts = {
      createAccount: jest.fn(async () => admin),
    };
    auth = { openSession: jest.fn(async () => SESSION) };
    organizations = {
      createOrganization: jest.fn(async () => ({
        message: 'Organization created successfully',
        organizationId: ORG_ID,
        name: 'Acme',
        industry: '',
      })),
    };
    mail = {
      isConfigured: jest.fn(() => false),
      sendWelcomeEmail: jest.fn(async () => undefined),
    };
    signupMode = undefined;
    configGet = jest.fn((key: string) => {
      if (key === 'CYBEDEFEND_SETUP_TOKEN') return SETUP_TOKEN;
      if (key === 'AUTH_SIGNUP_MODE') return signupMode;
      return undefined;
    });
    config = { get: configGet } as unknown as ConfigService;
    logger = createLoggerMock();
    service = new SetupService(
      dataSource as unknown as DataSource,
      userRepo as unknown as Repository<User>,
      tokenRepo as unknown as Repository<AuthOneTimeToken>,
      teamRepo as unknown as Repository<Team>,
      accounts as unknown as LocalAccountService,
      auth as unknown as LocalAuthService,
      organizations as unknown as OrganizationService,
      mail as unknown as MailService,
      config,
      logger as unknown as Logger,
    );
  });

  function setupInput(overrides: Record<string, string> = {}) {
    return {
      setupToken: SETUP_TOKEN,
      email: 'Admin@Example.TEST',
      name: 'Ada Lovelace',
      password: PASSWORD,
      organizationName: 'Acme',
      ...overrides,
    };
  }

  describe('setup', () => {
    it('refuses a wrong setup token with SETUP_TOKEN_INVALID', async () => {
      const refusal = await refusalOf(
        service.setup(
          setupInput({ setupToken: 'a-wrong-token-0123456789' }),
          NOW,
        ),
      );
      expect(refusal).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'SETUP_TOKEN_INVALID',
      });
      // The token is checked before anything else.
      expect(userRepo.count).not.toHaveBeenCalled();
      expect(runner.query).not.toHaveBeenCalled();
    });

    it('refuses with SETUP_TOKEN_INVALID when no token is configured', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'AUTH_SIGNUP_MODE') return signupMode;
        return undefined;
      });
      const refusal = await refusalOf(service.setup(setupInput(), NOW));
      expect(refusal).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'SETUP_TOKEN_INVALID',
      });
    });

    it('refuses a short password with PASSWORD_POLICY', async () => {
      const refusal = await refusalOf(
        service.setup(setupInput({ password: 'too short' }), NOW),
      );
      expect(refusal).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'PASSWORD_POLICY',
      });
      expect(userRepo.count).not.toHaveBeenCalled();
    });

    it('refuses once a user exists with SETUP_CLOSED', async () => {
      userRepo.count!.mockResolvedValue(1);
      const refusal = await refusalOf(service.setup(setupInput(), NOW));
      expect(refusal).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'SETUP_CLOSED',
      });
      // No claim row was written.
      expect(runner.query).not.toHaveBeenCalled();
    });

    it('refuses with SETUP_CLOSED when another setup already holds the claim', async () => {
      userRepo.count!.mockResolvedValue(0);
      runner.query.mockResolvedValueOnce({ affectedRows: 0 });
      const refusal = await refusalOf(service.setup(setupInput(), NOW));
      expect(refusal).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'SETUP_CLOSED',
      });
      expect(accounts.createAccount).not.toHaveBeenCalled();
    });

    it('creates the administrator, its organisation and a default team', async () => {
      userRepo.count!.mockResolvedValue(0);
      teamRepo.findOne!.mockResolvedValue({ id: TEAM_ID } as Team);
      const result = await service.setup(setupInput(), NOW);

      // The claim row was inserted with insertIgnore, keyed by its hash.
      expect(runner.query).toHaveBeenCalledTimes(1);
      const [claimSql, claimParams] = runner.query.mock.calls[0];
      expect(String(claimSql)).toContain('auth_one_time_token');
      expect(claimParams).toContain(SETUP_CLAIM_HASH);

      expect(accounts.createAccount).toHaveBeenCalledWith(
        {
          email: 'Admin@Example.TEST',
          password: PASSWORD,
          name: 'Ada Lovelace',
        },
        NOW,
      );
      const createRequest = organizations.createOrganization.mock
        .calls[0][0] as OrganizationCreateRequest;
      expect(createRequest).toMatchObject({
        name: 'Acme',
        creatorId: ADMIN_ID,
      });
      // The claim is marked finished with the administrator's id.
      expect(tokenRepo.createQueryBuilder).toHaveBeenCalled();
      expect(updateQb.set).toHaveBeenCalledWith({ userId: ADMIN_ID });
      expect(updateQb.execute).toHaveBeenCalledTimes(1);
      expect(auth.openSession).toHaveBeenCalledWith(ADMIN_ID, NOW);
      expect(result).toEqual({
        session: SESSION,
        organizationId: ORG_ID,
        teamId: TEAM_ID,
      });
    });

    it('stores one name string unsplit', async () => {
      userRepo.count!.mockResolvedValue(0);
      teamRepo.findOne!.mockResolvedValue({ id: TEAM_ID } as Team);
      await service.setup(setupInput({ name: 'Ada Lovelace' }), NOW);
      // One `name` string is passed through; the split into firstName /
      // lastName is LocalAccountService's business, never the setup's.
      expect(accounts.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ada Lovelace' }),
        NOW,
      );
    });

    it('reopens setup when organisation creation fails', async () => {
      userRepo.count!.mockResolvedValue(0);
      const boom = new Error('permify down');
      organizations.createOrganization.mockRejectedValueOnce(boom);
      const thrown = await service.setup(setupInput(), NOW).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(thrown).toBe(boom);
      // The claim row was deleted again (a second statement through run()).
      expect(runner.query).toHaveBeenCalledTimes(2);
      const [cleanupSql, cleanupParams] = runner.query.mock.calls[1];
      expect(String(cleanupSql)).toMatch(/DELETE/i);
      expect(String(cleanupSql)).toContain('auth_one_time_token');
      expect(cleanupParams).toContain(SETUP_CLAIM_HASH);
      // … and the created user was deleted.
      expect(userRepo.delete).toHaveBeenCalledWith({ id: ADMIN_ID });
      expect(auth.openSession).not.toHaveBeenCalled();
    });

    it('reopens setup when marking the claim fails', async () => {
      userRepo.count!.mockResolvedValue(0);
      updateQb.execute.mockRejectedValueOnce(new Error('db gone'));
      await expect(service.setup(setupInput(), NOW)).rejects.toThrow('db gone');
      expect(userRepo.delete).toHaveBeenCalledWith({ id: ADMIN_ID });
    });

    it('keeps the claim and the administrator when opening the session fails after the claim is marked', async () => {
      // Once the claim carries the administrator, a concurrent sign-up may
      // already exist: undoing the setup then would leave the instance to it.
      // The administrator signs in normally afterwards.
      userRepo.count!.mockResolvedValue(0);
      auth.openSession.mockRejectedValueOnce(new Error('signing key gone'));
      await expect(service.setup(setupInput(), NOW)).rejects.toThrow(
        'signing key gone',
      );
      expect(userRepo.delete).not.toHaveBeenCalled();
      expect(runner.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('status', () => {
    it('reports the sign-up mode and the reset channel', async () => {
      userRepo.count!.mockResolvedValue(0);
      tokenRepo.countBy!.mockResolvedValue(0);
      await expect(service.status()).resolves.toEqual({
        setupOpen: true,
        signupMode: 'invite_only',
        passwordResetByEmail: false,
      });
      expect(tokenRepo.countBy).toHaveBeenCalledWith({
        tokenHash: SETUP_CLAIM_HASH,
      });
    });

    it('is closed once a user or a claim row exists', async () => {
      userRepo.count!.mockResolvedValue(1);
      tokenRepo.countBy!.mockResolvedValue(0);
      await expect(service.status()).resolves.toMatchObject({
        setupOpen: false,
      });
      userRepo.count!.mockResolvedValue(0);
      tokenRepo.countBy!.mockResolvedValue(1);
      await expect(service.status()).resolves.toMatchObject({
        setupOpen: false,
      });
    });

    it('reports open sign-up and e-mail reset when configured', async () => {
      signupMode = 'open';
      mail.isConfigured.mockReturnValue(true);
      userRepo.count!.mockResolvedValue(0);
      tokenRepo.countBy!.mockResolvedValue(0);
      await expect(service.status()).resolves.toEqual({
        setupOpen: true,
        signupMode: 'open',
        passwordResetByEmail: true,
      });
    });
  });

  describe('signUp', () => {
    function givenLockingRead(row: { userId: string | null } | undefined) {
      const selectQb = {
        select: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => row),
      };
      const manager = {
        createQueryBuilder: jest.fn(() => selectQb),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: EntityManager) => Promise<unknown>) =>
          cb(manager as unknown as EntityManager),
      );
      return selectQb;
    }

    it('refuses sign-up in invite_only mode with SIGNUP_DISABLED', async () => {
      signupMode = 'invite_only';
      const refusal = await refusalOf(
        service.signUp(
          { email: 'ada@example.test', password: PASSWORD, name: 'Ada' },
          NOW,
        ),
      );
      expect(refusal).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'SIGNUP_DISABLED',
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(accounts.createAccount).not.toHaveBeenCalled();
    });

    it('refuses a short password with PASSWORD_POLICY before any read', async () => {
      signupMode = 'open';
      const refusal = await refusalOf(
        service.signUp(
          { email: 'ada@example.test', password: 'short', name: 'Ada' },
          NOW,
        ),
      );
      expect(refusal).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'PASSWORD_POLICY',
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses sign-up while setup is open with SETUP_REQUIRED (no claim row)', async () => {
      signupMode = 'open';
      const selectQb = givenLockingRead(undefined);
      const refusal = await refusalOf(
        service.signUp(
          { email: 'ada@example.test', password: PASSWORD, name: 'Ada' },
          NOW,
        ),
      );
      expect(refusal).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'SETUP_REQUIRED',
      });
      // The claim was read under a locking read, in one transaction.
      expect(selectQb.setLock).toHaveBeenCalledWith('pessimistic_read');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      // No user row is written.
      expect(accounts.createAccount).not.toHaveBeenCalled();
      expect(auth.openSession).not.toHaveBeenCalled();
    });

    it('refuses sign-up with SETUP_REQUIRED while the claim has no administrator yet', async () => {
      signupMode = 'open';
      givenLockingRead({ userId: null });
      const refusal = await refusalOf(
        service.signUp(
          { email: 'ada@example.test', password: PASSWORD, name: 'Ada' },
          NOW,
        ),
      );
      expect(refusal).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'SETUP_REQUIRED',
      });
      expect(accounts.createAccount).not.toHaveBeenCalled();
    });

    it('opens sign-up in open mode once setup is done, and the new user joins no organisation', async () => {
      signupMode = 'open';
      givenLockingRead({ userId: ADMIN_ID });
      const newcomer = {
        id: '44444444-4444-4444-8444-444444444444',
        email: 'ada@example.test',
        firstName: 'Ada',
        lastName: '',
      } as User;
      accounts.createAccount.mockResolvedValueOnce(newcomer);
      const session = await service.signUp(
        { email: 'ada@example.test', password: PASSWORD, name: 'Ada' },
        NOW,
      );
      expect(session).toBe(SESSION);
      expect(accounts.createAccount).toHaveBeenCalledWith(
        { email: 'ada@example.test', password: PASSWORD, name: 'Ada' },
        NOW,
      );
      expect(auth.openSession).toHaveBeenCalledWith(newcomer.id, NOW);
      // A sign-up never creates an organisation.
      expect(organizations.createOrganization).not.toHaveBeenCalled();
    });

    it('answers ACCOUNT_EXISTS to a sign-up with a known e-mail', async () => {
      signupMode = 'open';
      givenLockingRead({ userId: ADMIN_ID });
      accounts.createAccount.mockRejectedValueOnce(
        localAuthRefusal('ACCOUNT_EXISTS'),
      );
      const refusal = await refusalOf(
        service.signUp(
          { email: 'admin@example.test', password: PASSWORD, name: 'Ada' },
          NOW,
        ),
      );
      expect(refusal).toEqual({
        code: status.ALREADY_EXISTS,
        message: 'ACCOUNT_EXISTS',
      });
      expect(auth.openSession).not.toHaveBeenCalled();
    });
  });
});
