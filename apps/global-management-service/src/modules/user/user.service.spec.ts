import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { In } from 'typeorm';
import { USERS_BY_IDS_MAX, UserService } from './user.service';
import { User } from 'src/entities/user.entity';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { MailService } from 'src/modules/mail/mail.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from 'src/test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { IDENTITY_PROVIDER_PORT } from 'src/edition/ports/identity-provider.port';
import {
  MEMBER_PRODUCTS_PORT,
  MemberProductsPort,
} from 'src/edition/ports/member-products.port';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from 'src/edition/community/member-products.binding';
import {
  identityProviderMock,
  type IdentityProviderMock,
} from '../organization/organization.service.fixtures';
import {
  CapturedStatement,
  createSqlCaptureDataSource,
} from 'src/test-utils/sql-capture.util';

describe('UserService', () => {
  let service: UserService;
  let userRepo: MockType<any>;
  let orgRepo: MockType<any>;
  let projectRepo: MockType<any>;
  let teamRepo: MockType<any>;
  let mailService: { sendWelcomeEmail: jest.Mock };
  let identity: IdentityProviderMock;
  let memberProducts: MemberProductsPort;
  beforeEach(async () => {
    identity = identityProviderMock();
    userRepo = createMockRepository<User>();
    orgRepo = createMockRepository<Organization>();
    projectRepo = createMockRepository<Project>();
    teamRepo = createMockRepository<Team>();
    // Default: no accessible projects. Tests that exercise the
    // ``myAccessibleProjects`` surface override the queryBuilder chain
    // explicitly. The default getRawMany returns [] so existing
    // getProfile happy-path tests stay unaffected.
    projectRepo.createQueryBuilder = jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }));
    mailService = { sendWelcomeEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: MailService, useValue: mailService },
        { provide: IDENTITY_PROVIDER_PORT, useValue: identity },
        {
          provide: ENTITLEMENTS_PORT,
          useValue: {
            // Billing down: the products stay unknown ([]), the summary absent.
            getProductsForOrganizations: jest.fn(async () => {
              throw new Error('billing down');
            }),
            getSubscriptionSummary: jest.fn(async () => undefined),
          },
        },
        {
          provide: Logger,
          useValue: createLoggerMock(),
        },
        ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    memberProducts = module.get<MemberProductsPort>(MEMBER_PRODUCTS_PORT);
  });

  it('checkExistence returns true when user exists', async () => {
    userRepo.findOne!.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    const res = await service.checkExistence({ email: 'a@b.c' } as any);
    expect(res).toEqual({ exists: true, userId: 'u1' });
  });

  it('getByEmail throws NOT_FOUND when missing', async () => {
    userRepo.findOne!.mockResolvedValue(null);
    await expect(service.getByEmail({ email: 'x@y.z' } as any)).rejects.toEqual(
      new RpcException({ code: status.NOT_FOUND, message: 'User not found' }),
    );
  });

  it('getById returns user info', async () => {
    const user = {
      id: 'u2',
      firstName: 'John',
      lastName: 'D',
      email: 'j@d',
      picture: '',
    } as any;
    userRepo.findOne!.mockResolvedValue(user);
    const res = await service.getById({ userId: 'u2' } as any);
    expect(res.id).toBe('u2');
    expect(res.email).toBe('j@d');
  });

  // The gateway names the user behind each live agent session and guard
  // trigger. It used to call getById once per person (85 calls per sessions
  // poll at 1,500 projects): one query now reads them all.
  describe('getByIds', () => {
    it('reads every distinct user in ONE query, selecting only what the gateway shows', async () => {
      userRepo.find!.mockResolvedValue([
        {
          id: 'u1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.test',
          picture: 'https://pics.example.test/ada.png',
        },
        {
          id: 'u2',
          firstName: 'Alan',
          lastName: null,
          email: 'alan@example.test',
          picture: null,
        },
      ]);

      const res = await service.getByIds({ userIds: ['u1', 'u2'] });

      expect(userRepo.find).toHaveBeenCalledTimes(1);
      expect(userRepo.find).toHaveBeenCalledWith({
        select: ['id', 'firstName', 'lastName', 'email', 'picture'],
        where: { id: In(['u1', 'u2']) },
      });
      expect(res).toEqual({
        users: [
          {
            id: 'u1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.test',
            picture: 'https://pics.example.test/ada.png',
          },
          // null columns become '' on the wire, as getById answers them.
          {
            id: 'u2',
            firstName: 'Alan',
            lastName: '',
            email: 'alan@example.test',
            picture: '',
          },
        ],
      });
    });

    it('never answers a field beyond the five, whatever the row holds', async () => {
      userRepo.find!.mockResolvedValue([
        {
          id: 'u1',
          firstName: 'Ada',
          lastName: 'L',
          email: 'ada@example.test',
          picture: '',
          onboardingProgress: '{"step":"x"}',
          notification: true,
        },
      ]);

      const res = await service.getByIds({ userIds: ['u1'] });

      expect(Object.keys(res.users[0]).sort()).toEqual([
        'email',
        'firstName',
        'id',
        'lastName',
        'picture',
      ]);
    });

    it('leaves out an id the platform does not know, without failing the others', async () => {
      userRepo.find!.mockResolvedValue([
        { id: 'u1', firstName: 'A', lastName: '', email: 'a@x.test' },
      ]);

      const res = await service.getByIds({ userIds: ['u1', 'gone'] });

      expect(res.users.map((u) => u.id)).toEqual(['u1']);
    });

    it('ignores blank and repeated ids', async () => {
      userRepo.find!.mockResolvedValue([]);

      await service.getByIds({ userIds: ['u1', '', '  ', 'u1', 'u2'] });

      expect(userRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: In(['u1', 'u2']) } }),
      );
    });

    it('answers no user, without a query, when no id is given', async () => {
      await expect(service.getByIds({ userIds: [] })).resolves.toEqual({
        users: [],
      });
      await expect(
        service.getByIds({ userIds: undefined as unknown as string[] }),
      ).resolves.toEqual({ users: [] });
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it(`refuses more than ${USERS_BY_IDS_MAX} distinct ids, without a query`, async () => {
      const ids = Array.from(
        { length: USERS_BY_IDS_MAX + 1 },
        (_, i) => `u${i}`,
      );

      let thrown: unknown;
      await service.getByIds({ userIds: ids }).catch((e) => {
        thrown = e;
      });

      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toMatchObject({
        code: status.INVALID_ARGUMENT,
      });
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it(`accepts exactly ${USERS_BY_IDS_MAX} distinct ids`, async () => {
      userRepo.find!.mockResolvedValue([]);
      const ids = Array.from({ length: USERS_BY_IDS_MAX }, (_, i) => `u${i}`);

      await expect(service.getByIds({ userIds: ids })).resolves.toEqual({
        users: [],
      });
      expect(userRepo.find).toHaveBeenCalledTimes(1);
    });
  });

  it('create saves and sends welcome email', async () => {
    userRepo.save!.mockImplementation(async (u: any) => {
      u.id = 'u3';
      return u;
    });
    const res = await service.create({
      email: 'n@o',
      firstName: 'N',
      lastName: 'O',
    } as any);
    expect(res.userId).toBe('u3');
    expect(mailService.sendWelcomeEmail).toHaveBeenCalledWith('n@o', 'N O');
  });

  it('create throws ALREADY_EXISTS when email already exists (ER_DUP_ENTRY)', async () => {
    // Simulate the MySQL UNIQUE-index violation that the new index enforces.
    const dupErr: any = new Error(
      "Duplicate entry 'dup@x.y' for key 'IDX_user_email_unique'",
    );
    dupErr.code = 'ER_DUP_ENTRY';
    dupErr.errno = 1062;
    userRepo.save!.mockRejectedValue(dupErr);

    await expect(
      service.create({
        email: 'dup@x.y',
        firstName: 'D',
        lastName: 'X',
      } as any),
    ).rejects.toEqual(
      new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'A user with this email already exists',
      }),
    );
    // Welcome email must not be sent when the insert failed.
    expect(mailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('create throws ALREADY_EXISTS on a PostgreSQL unique violation (23505)', async () => {
    const dupErr = Object.assign(new Error('duplicate key value'), {
      driverError: { code: '23505' },
    });
    userRepo.save!.mockRejectedValue(dupErr);

    await expect(
      service.create({ email: 'dup@x.y', firstName: 'D' } as any),
    ).rejects.toEqual(
      new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'A user with this email already exists',
      }),
    );
  });

  it('create stores the e-mail trimmed and lower-cased, and the lookups use it so', async () => {
    userRepo.create!.mockImplementation((v: unknown) => v);
    userRepo.save!.mockImplementation(async (u: any) =>
      Object.assign(u, { id: 'u9' }),
    );
    await service.create({
      email: ' Jane@Acme.IO ',
      firstName: 'J',
    } as any);
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jane@acme.io' }),
    );

    userRepo.findOne!.mockResolvedValue(null);
    await service.checkExistence({ email: 'JANE@acme.io' } as any);
    await service
      .getByEmail({ email: 'Jane@ACME.io' } as any)
      .catch(() => undefined);
    expect(userRepo.findOne).toHaveBeenNthCalledWith(1, {
      where: { email: 'jane@acme.io' },
    });
    expect(userRepo.findOne).toHaveBeenNthCalledWith(2, {
      where: { email: 'jane@acme.io' },
    });
  });

  it('create propagates INTERNAL when save fails for a non-duplicate reason', async () => {
    userRepo.save!.mockRejectedValue(new Error('connection lost'));
    await expect(
      service.create({
        email: 'x@y',
        firstName: 'X',
        lastName: 'Y',
      } as any),
    ).rejects.toEqual(
      new RpcException({
        code: status.INTERNAL,
        message: 'Error creating user',
      }),
    );
    expect(mailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('delete removes existing user', async () => {
    userRepo.findOne!.mockResolvedValue({ id: 'u4' });
    userRepo.remove!.mockResolvedValue(undefined);
    orgRepo.count!.mockResolvedValue(0);
    const res = await service.delete({ userId: 'u4' } as any);
    expect(res.message).toContain('deleted');
    expect(userRepo.remove).toHaveBeenCalled();
    expect(orgRepo.count).toHaveBeenCalledWith({
      where: { creator: { id: 'u4' } },
    });
    expect(orgRepo.count!.mock.invocationCallOrder[0]).toBeLessThan(
      userRepo.remove!.mock.invocationCallOrder[0],
    );
  });

  it('delete asks the identity provider to mirror the deletion, once the row is gone', async () => {
    const user = { id: 'u4', logtoUserId: 'lg-4' };
    userRepo.findOne!.mockResolvedValue(user);
    userRepo.remove!.mockResolvedValue(undefined);
    orgRepo.count!.mockResolvedValue(0);

    await service.delete({ userId: 'u4' } as any);

    expect(identity.userDeleted).toHaveBeenCalledWith(user);
    expect(userRepo.remove!.mock.invocationCallOrder[0]).toBeLessThan(
      identity.userDeleted.mock.invocationCallOrder[0],
    );
  });

  // An organization is deleted by its creator alone, so a
  // creator who deleted their account would leave it undeletable
  // (organization.creator is ON DELETE SET NULL).
  it('delete refuses a user who is still the creator of an organization, before any write', async () => {
    userRepo.findOne!.mockResolvedValue({ id: 'u4', logtoUserId: 'lg-4' });
    orgRepo.count!.mockResolvedValue(1);

    const thrown = await service
      .delete({ userId: 'u4' } as any)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.FAILED_PRECONDITION,
      message: 'USER_IS_ORGANIZATION_CREATOR',
    });
    expect(userRepo.remove).not.toHaveBeenCalled();
    expect(userRepo.delete).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(identity.userDeleted).not.toHaveBeenCalled();
  });

  it('update modifies boolean fields', async () => {
    userRepo.findOne!.mockResolvedValue({ id: 'u5' });
    userRepo.save!.mockResolvedValue({ id: 'u5' });
    const res = await service.update({
      userId: 'u5',
      notification: true,
      isOnboardingCompleted: false,
    } as any);
    expect(res.userId).toBe('u5');
  });

  it('update preserves isOnboardingCompleted when only onboardingProgress is sent', async () => {
    const existingUser = {
      id: 'u7',
      notification: true,
      isOnboardingCompleted: true,
      onboardingProgress: ['org_created'],
    };
    userRepo.findOne!.mockResolvedValue({ ...existingUser });
    userRepo.save!.mockImplementation(async (u: any) => u);
    await service.update({
      userId: 'u7',
      onboardingProgress: '["first_scan_completed"]',
      // isOnboardingCompleted is undefined (not sent via proto optional)
    } as any);
    const savedUser = userRepo.save!.mock.calls[0][0];
    expect(savedUser.isOnboardingCompleted).toBe(true);
    expect(savedUser.notification).toBe(true);
    expect(savedUser.onboardingProgress).toEqual([
      'org_created',
      'first_scan_completed',
    ]);
  });

  it('update allows explicitly setting isOnboardingCompleted to false', async () => {
    const existingUser = {
      id: 'u8',
      isOnboardingCompleted: true,
      onboardingProgress: [],
    };
    userRepo.findOne!.mockResolvedValue({ ...existingUser });
    userRepo.save!.mockImplementation(async (u: any) => u);
    await service.update({
      userId: 'u8',
      isOnboardingCompleted: false,
    } as any);
    const savedUser = userRepo.save!.mock.calls[0][0];
    expect(savedUser.isOnboardingCompleted).toBe(false);
  });

  // onboardingPersona/onboardingUsage are a simple overwrite (no Set-merge,
  // unlike onboardingProgress).
  it('update overwrites onboardingPersona and onboardingUsage (no merge)', async () => {
    const existingUser = {
      id: 'u9',
      onboardingPersona: 'solo_dev',
      onboardingUsage: 'vibecoding',
    };
    userRepo.findOne!.mockResolvedValue({ ...existingUser });
    userRepo.save!.mockImplementation(async (u: any) => u);
    await service.update({
      userId: 'u9',
      onboardingPersona: 'tech_lead',
      onboardingUsage: 'team_security',
    } as any);
    const savedUser = userRepo.save!.mock.calls[0][0];
    expect(savedUser.onboardingPersona).toBe('tech_lead');
    expect(savedUser.onboardingUsage).toBe('team_security');
  });

  it('update leaves onboardingPersona/onboardingUsage unchanged when not provided', async () => {
    const existingUser = {
      id: 'u10',
      onboardingPersona: 'security_pro',
      onboardingUsage: 'compliance',
    };
    userRepo.findOne!.mockResolvedValue({ ...existingUser });
    userRepo.save!.mockImplementation(async (u: any) => u);
    await service.update({
      userId: 'u10',
      notification: true,
    } as any);
    const savedUser = userRepo.save!.mock.calls[0][0];
    expect(savedUser.onboardingPersona).toBe('security_pro');
    expect(savedUser.onboardingUsage).toBe('compliance');
  });

  it('getProfile maps organizations and teams', async () => {
    const fakeUser = {
      id: 'u6',
      firstName: 'A',
      email: 'a@a',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastName: '',
      picture: '',
      notification: true,
      isOnboardingCompleted: false,
    } as any;
    userRepo.findOne!.mockResolvedValue(fakeUser);
    // The caller's organization memberships and team
    // memberships, each read as raw rows.
    (orgRepo.createQueryBuilder!() as any).getRawMany.mockResolvedValue([
      {
        id: 'o1',
        name: 'Org',
        country: 'FR',
        industry: 'IT',
        isActive: 1,
        role: 'administrator',
      },
    ]);
    (teamRepo.createQueryBuilder!() as any).getRawMany.mockResolvedValue([
      { id: 't1', name: 'Team 1', organizationId: 'o1', role: 'developer' },
    ]);
    const res = await service.getProfile({ userId: 'u6' } as any);
    expect(res.myOrganizations?.[0]?.myTeams?.[0]?.id).toBe('t1');
    expect(res.myOrganizations?.[0]?.myRole).toBe('administrator');
  });

  // `getProfile` joined every team of every organization
  // of the caller with ALL their memberships and users, to keep the caller's.
  // It now reads the caller's organization memberships and the caller's team
  // memberships, one SELECT each. The shape of myOrganizations / myTeams /
  // myRole does not change: user.service.live.spec.ts compares it with the
  // previous read on a real MySQL.
  describe('getProfile memberships', () => {
    let statements: CapturedStatement[];
    // What the two reads answer, in the order their SQL asks for: the
    // organizations by membership, the teams by name.
    const switchedOnRows = [
      {
        id: 'o1',
        name: 'Acme',
        country: 'FR',
        industry: 'IT',
        isActive: 1,
        role: 'administrator',
        // Per-member products switched on in both organisations.
        memberProducts: 1,
        // An administrator holds both products whatever its columns say.
        appsecAccess: 0,
        vibedefendAccess: 0,
      },
      {
        id: 'o2',
        name: 'Beta',
        country: 'US',
        industry: 'Health',
        isActive: 0,
        role: 'member',
        memberProducts: 1,
        // MySQL hands the TINYINT columns back as numbers.
        appsecAccess: 0,
        vibedefendAccess: 1,
      },
      // A second membership in the same organization: the one with the lowest
      // membership id, read first, wins.
      {
        id: 'o2',
        name: 'Beta',
        country: 'US',
        industry: 'Health',
        isActive: 0,
        role: 'billing_manager',
        memberProducts: 1,
        appsecAccess: 1,
        vibedefendAccess: 1,
      },
    ];
    let organizationRows: Record<string, unknown>[] = switchedOnRows;
    /** One organisation, the caller a member of it with these columns. */
    const oneOrganization = (
      memberProducts: number,
      appsecAccess: number,
      vibedefendAccess: number,
    ) => [
      {
        id: 'o3',
        name: 'Gamma',
        country: 'FR',
        industry: 'IT',
        isActive: 1,
        role: 'member',
        memberProducts,
        appsecAccess,
        vibedefendAccess,
      },
    ];
    const teamRows = [
      { id: 't2', name: 'Alpha team', organizationId: 'o1', role: 'developer' },
      { id: 't1', name: 'Core', organizationId: 'o1', role: 'team_manager' },
      { id: 't1', name: 'Core', organizationId: 'o1', role: 'read_only' },
      { id: 't3', name: 'Ops', organizationId: 'o2', role: 'read_only' },
      // A team of an organization the caller is no member of: not listed.
      { id: 't9', name: 'Orphan', organizationId: 'o9', role: 'developer' },
    ];
    const statementOn = (table: string) =>
      statements.filter((s) =>
        new RegExp(`^SELECT .* FROM \`${table}\``).test(s.sql),
      );

    beforeEach(async () => {
      organizationRows = switchedOnRows;
      const capture = await createSqlCaptureDataSource((s) => {
        if (/ FROM `organization`/.test(s.sql)) return organizationRows;
        if (/ FROM `team`/.test(s.sql)) return teamRows;
        return [];
      });
      statements = capture.statements;
      for (const [repo, entity] of [
        [orgRepo, Organization],
        [teamRepo, Team],
        [projectRepo, Project],
      ] as const) {
        const real = capture.dataSource.getRepository(entity);
        repo.find = jest.fn((options) => real.find(options));
        repo.createQueryBuilder = jest.fn((alias?: string) =>
          real.createQueryBuilder(alias),
        );
      }
      userRepo.findOne!.mockResolvedValue({
        id: 'u-caller',
        firstName: 'A',
        email: 'a@a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("reads the caller's memberships only: one SELECT for its organizations, one for its teams", async () => {
      await service.getProfile({ userId: 'u-caller' } as any);

      const [organizations, ...moreOrganizations] = statementOn('organization');
      expect(moreOrganizations).toHaveLength(0);
      expect(organizations.sql).toMatch(/users_organizations_members/);
      expect(organizations.sql).not.toMatch(/teams_members|`team`|`user`/);
      expect(organizations.params).toEqual(['u-caller']);

      const [teams, ...moreTeams] = statementOn('team');
      expect(moreTeams).toHaveLength(0);
      expect(teams.sql).toMatch(/teams_members/);
      expect(teams.sql).not.toMatch(/`user`/);
      expect(teams.params).toEqual(['u-caller']);
    });

    it('keeps the shape of myOrganizations, myTeams and myRole for a multi-organization user', async () => {
      const res = await service.getProfile({ userId: 'u-caller' } as any);

      expect(res.myOrganizations).toEqual([
        {
          id: 'o1',
          name: 'Acme',
          country: 'FR',
          industry: 'IT',
          isActive: true,
          myTeams: [
            { id: 't2', name: 'Alpha team', myRole: 'developer' },
            { id: 't1', name: 'Core', myRole: 'team_manager' },
          ],
          myRole: 'administrator',
          subscription: undefined,
          // Billing named no product here, so [] (unknown).
          products: [],
          // The caller's own products, as the member access port says
          // (the community one here), and computed (an older
          // global-management sends no flag).
          myProducts: ['appsec'],
          myProductsKnown: true,
          // The organisation's switch: on here.
          memberProducts: true,
        },
        {
          id: 'o2',
          name: 'Beta',
          country: 'US',
          industry: 'Health',
          isActive: false,
          myTeams: [{ id: 't3', name: 'Ops', myRole: 'read_only' }],
          myRole: 'member',
          subscription: undefined,
          products: [],
          myProducts: ['appsec'],
          myProductsKnown: true,
          memberProducts: true,
        },
      ]);
    });

    it("hands the organisation's switch and the caller's row to the member access port", async () => {
      organizationRows = oneOrganization(1, 0, 1);
      const productsInForce = jest
        .spyOn(memberProducts, 'productsInForce')
        .mockReturnValue(['x']);

      const [organization] = (
        await service.getProfile({ userId: 'u-caller' } as any)
      ).myOrganizations;

      expect(organization).toEqual(
        expect.objectContaining({ myProducts: ['x'], myProductsKnown: true }),
      );
      expect(productsInForce).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          role: 'member',
          appsecAccess: 0,
          vibedefendAccess: 1,
        }),
      );
    });

    it("reads the caller's product columns with its role, in the same SELECT", async () => {
      await service.getProfile({ userId: 'u-caller' } as any);

      const [organizations] = statementOn('organization');
      expect(organizations.sql).toMatch(
        /`membership`\.`appsec_access` AS `appsecAccess`/,
      );
      expect(organizations.sql).toMatch(
        /`membership`\.`vibedefend_access` AS `vibedefendAccess`/,
      );
      expect(organizations.sql).toMatch(
        /`org`\.`member_products` AS `memberProducts`/,
      );
    });
  });

  // `myAccessibleProjects` is an access-control read: the
  // set of projects it returns must not change. These tests read the SQL it
  // sends (real TypeORM SQL, recording query runner); user.service.live.spec.ts
  // proves on a real MySQL that it returns what the previous query returned.
  describe('myAccessibleProjects query', () => {
    let statements: CapturedStatement[];
    const accessibleRows = [
      {
        projectId: 'p1',
        projectName: 'Alpha',
        organizationId: 'o1',
        organizationName: 'Acme',
      },
      {
        projectId: 'p2',
        projectName: null,
        organizationId: 'o2',
        organizationName: null,
      },
    ];
    const projectRead = () =>
      statements.find((s) => /FROM `project`/.test(s.sql));

    beforeEach(async () => {
      const capture = await createSqlCaptureDataSource((s) =>
        /FROM `project`/.test(s.sql) ? accessibleRows : [],
      );
      statements = capture.statements;
      const real = capture.dataSource.getRepository(Project);
      projectRepo.createQueryBuilder = jest.fn((alias?: string) =>
        real.createQueryBuilder(alias),
      );
      userRepo.findOne!.mockResolvedValue({
        id: 'u-caller',
        firstName: 'A',
        email: 'a@a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      orgRepo.find!.mockResolvedValue([]);
    });

    it('starts from the caller memberships: a UNION of the teams it may read, no OR EXISTS', async () => {
      await service.getProfile({ userId: 'u-caller' } as any);

      const read = projectRead();
      expect(read).toBeDefined();
      expect(read!.sql).not.toMatch(/EXISTS/i);
      expect(read!.sql).toMatch(/\bUNION\b/);
      expect(read!.sql).toMatch(/users_organizations_members/);
      expect(read!.sql).toMatch(/teams_members/);
      // The caller is the only principal of the query, and only the
      // creator / administrator roles open a whole organization.
      expect(read!.params.filter((p) => p === 'u-caller')).toHaveLength(2);
      expect(read!.params).toEqual(
        expect.arrayContaining(['creator', 'administrator']),
      );
    });

    it('bounds the list at 500 rows in the SQL, ordered by organization then project name', async () => {
      await service.getProfile({ userId: 'u-caller' } as any);

      const read = projectRead()!;
      expect(read.sql).toMatch(/\bLIMIT 500$/);
      expect(read.sql).toMatch(
        /ORDER BY `org`\.`name` ASC, `project`\.`name` ASC, `project`\.`id` ASC/,
      );
    });

    it('maps the rows, empty names as empty strings', async () => {
      const res = await service.getProfile({ userId: 'u-caller' } as any);

      expect(res.myAccessibleProjects).toEqual([
        {
          projectId: 'p1',
          projectName: 'Alpha',
          organizationId: 'o1',
          organizationName: 'Acme',
        },
        {
          projectId: 'p2',
          projectName: '',
          organizationId: 'o2',
          organizationName: '',
        },
      ]);
    });
  });

  // onboardingPersona/onboardingUsage must be sourced from the persisted User
  // columns, not a placeholder.
  it('getProfile returns the persisted onboardingPersona/onboardingUsage', async () => {
    const fakeUser = {
      id: 'u11',
      firstName: 'A',
      email: 'a@a',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastName: '',
      picture: '',
      notification: true,
      isOnboardingCompleted: false,
      onboardingPersona: 'security_pro',
      onboardingUsage: 'compliance',
    } as any;
    userRepo.findOne!.mockResolvedValue(fakeUser);
    orgRepo.find!.mockResolvedValue([]);
    const res = await service.getProfile({ userId: 'u11' } as any);
    expect(res.onboardingPersona).toBe('security_pro');
    expect(res.onboardingUsage).toBe('compliance');
  });
});
