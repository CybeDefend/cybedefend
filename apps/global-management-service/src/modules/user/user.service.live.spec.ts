import { randomUUID } from 'node:crypto';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from 'src/edition/community/member-products.binding';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Brackets, DataSource, Repository } from 'typeorm';
import { dialectApi, run } from '@cybedefend/db-dialect';

import { UserService } from './user.service';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { User } from 'src/entities/user.entity';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { IDENTITY_PROVIDER_PORT } from 'src/edition/ports/identity-provider.port';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import {
  createLiveDatabase,
  insertRows,
  liveDialect,
  liveEnabled,
  liveSelects,
} from 'src/core/db/live-database';

/**
 * LIVE spec of UserService's profile reads against a REAL MySQL or
 * PostgreSQL.
 *
 * `myAccessibleProjects` (GetUserProfile) decides which projects a user sees:
 * it is an access control. Its query was rewritten (start from the caller's
 * memberships instead of an `OR EXISTS` evaluated against every team of the
 * platform). This spec runs the previous query, copied verbatim below, and the
 * service on the same data, for every user of a varied fixture, and requires
 * the same projects in the same order. The only intended difference is the
 * bound: the previous `.take(500)` was dropped by TypeORM (a raw read with
 * joins gets no LIMIT), the new query really stops at 500 rows.
 *
 * It is skipped unless `GM_LIVE=1` (or the former `GM_MYSQL_LIVE=1`, which
 * means MySQL), so `pnpm run test` stays hermetic. The engine is
 * `LIVE_DB_TYPE` (mysql by default). It creates a throwaway database, builds
 * it with the migrations of global-management, and drops it at the end.
 *
 * How to run (the local docker MySQL listens on 3308):
 *   GM_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=user.service.live --runInBand
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=user.service.live --runInBand
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;
/** The engine of this run, and its SQL. */
const DIALECT = liveDialect('GM');
const db = dialectApi(DIALECT);
/** An identifier as the engine quotes it, for the raw SQL below. */
const id = (name: string) => db.ident(name).text;
/** The engine's identifier quote, for the SQL the assertions read. */
const Q = DIALECT === 'mysql' ? '`' : '"';

interface AccessibleProject {
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
}

/**
 * The query `loadAccessibleProjects` ran before its rewrite, verbatim but for
 * the identifiers of its raw fragments, quoted so that it runs on PostgreSQL
 * too. Its `.take(500)` is kept as it was: TypeORM ignores it on a raw read
 * with joins, which is what the previous code ran.
 */
async function legacyAccessibleProjects(
  projectRepository: Repository<Project>,
  userId: string,
): Promise<AccessibleProject[]> {
  const HARD_MAX = 500;
  const rows = await projectRepository
    .createQueryBuilder('project')
    .innerJoin('project.team', 'team')
    .innerJoin('team.organization', 'org')
    .where(
      new Brackets((sqb) => {
        sqb.where(
          `EXISTS (SELECT 1 FROM users_organizations_members uom WHERE ${id('uom.organizationId')} = org.id AND ${id('uom.userId')} = :userId AND uom.role IN (:...privilegedRoles))`,
        );
        sqb.orWhere(
          `EXISTS (SELECT 1 FROM teams_members tm WHERE ${id('tm.teamId')} = team.id AND ${id('tm.userId')} = :userId)`,
        );
      }),
    )
    .setParameters({
      userId,
      privilegedRoles: ['creator', 'administrator'],
    })
    .select([
      `project.id AS ${id('projectId')}`,
      `project.name AS ${id('projectName')}`,
      `org.id AS ${id('organizationId')}`,
      `org.name AS ${id('organizationName')}`,
    ])
    .orderBy('org.name', 'ASC')
    .addOrderBy('project.name', 'ASC')
    .take(HARD_MAX)
    .getRawMany<{
      projectId: string;
      projectName: string;
      organizationId: string;
      organizationName: string;
    }>();
  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName ?? '',
    organizationId: r.organizationId,
    organizationName: r.organizationName ?? '',
  }));
}

/**
 * The organizations, teams and roles `getProfile` returned before its rewrite:
 * its read and its mapping, verbatim, without the billing subscription (which
 * is fetched per organization afterwards, unchanged).
 */
async function legacyProfileOrganizations(
  organizationRepository: Repository<Organization>,
  userId: string,
) {
  const organizations = await organizationRepository.find({
    where: { userMemberships: { user: { id: userId } } },
    relations: [
      'userMemberships',
      'userMemberships.user',
      'teams',
      'teams.userMemberships',
      'teams.userMemberships.user',
    ],
  });
  return organizations.map((org) => {
    const orgMembership = org.userMemberships.find(
      (um) => um.user && um.user.id === userId,
    );
    const teamsDto = org.teams
      .filter((team) =>
        team.userMemberships.some((um) => um.user && um.user.id === userId),
      )
      .map((team) => {
        const teamMembership = team.userMemberships.find(
          (um) => um.user && um.user.id === userId,
        );
        return {
          id: team.id,
          name: team.name,
          myRole: teamMembership?.role ?? '',
        };
      });
    return {
      id: org.id,
      name: org.name,
      country: org.country,
      industry: org.industry,
      isActive: org.isActive,
      // Carried by getProfile since after this reference was written: the
      // per-member products switch.
      memberProducts: Boolean(Number(org.memberProducts ?? 0)),
      myTeams: teamsDto,
      myRole: orgMembership?.role ?? '',
    };
  });
}

describeLive('UserService on a real database', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let statements: string[];
  let drop: () => Promise<void>;
  let service: UserService;

  const users: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const teams: Record<string, string> = {};

  const insert = (table: string, rows: Record<string, unknown>[]) =>
    insertRows({ dataSource, dialect: DIALECT }, table, rows);
  const insertUser = async (key: string) => {
    users[key] = randomUUID();
    await insert('user', [
      {
        id: users[key],
        firstName: key,
        email: `${key}@example.test`,
        lastName: key,
        picture: '',
      },
    ]);
  };
  const insertOrg = async (key: string, name: string) => {
    orgs[key] = randomUUID();
    await insert('organization', [
      { id: orgs[key], name, industry: 'IT', country: 'FR', isActive: true },
    ]);
  };
  const insertTeam = async (key: string, orgKey: string, name: string) => {
    teams[key] = randomUUID();
    await insert('team', [
      { id: teams[key], name, description: '', organizationId: orgs[orgKey] },
    ]);
  };
  const insertProjects = async (teamKey: string, names: string[]) => {
    await insert(
      'project',
      names.map((name) => ({
        id: randomUUID(),
        name,
        teamId: teams[teamKey],
      })),
    );
  };
  const orgMember = (orgKey: string, userKey: string, role: string) =>
    insert('users_organizations_members', [
      {
        id: randomUUID(),
        organizationId: orgs[orgKey],
        userId: users[userKey],
        role,
      },
    ]);
  const teamMember = (teamKey: string, userKey: string, role = 'developer') =>
    insert('teams_members', [
      {
        id: randomUUID(),
        teamId: teams[teamKey],
        userId: users[userKey],
        role,
      },
    ]);

  beforeAll(async () => {
    ({ dataSource, statements, drop } = await createLiveDatabase({
      prefix: 'gm_back240_l16_user',
      envPrefix: 'GM',
    }));

    for (const key of ['caller', 'bigAdmin', 'other', 'nobody'])
      await insertUser(key);

    // A: the caller administers it, and is also a member of one of its teams
    // (a project reachable both ways must come back once).
    await insertOrg('A', 'acme');
    await insertTeam('A1', 'A', 'Core');
    await insertTeam('A2', 'A', 'Ops');
    await insertTeam('A3', 'A', 'Empty');
    await insertProjects('A1', ['zeta', 'Alpha']);
    await insertProjects('A2', ['éclair']);
    await orgMember('A', 'caller', 'administrator');
    await teamMember('A1', 'caller');
    // E: the caller created it.
    await insertOrg('E', 'Beta Corp');
    await insertTeam('E1', 'E', 'Main');
    await insertProjects('E1', ['billing', 'Billing-2']);
    await orgMember('E', 'caller', 'creator');
    // C: a plain member, in team B only.
    await insertOrg('C', 'Cobalt');
    await insertTeam('CB', 'C', 'B');
    await insertTeam('CO', 'C', 'Other');
    await insertProjects('CB', ['cb-1', 'cb-2']);
    await insertProjects('CO', ['co-1']);
    await orgMember('C', 'caller', 'member');
    await teamMember('CB', 'caller', 'read_only');
    await teamMember('CO', 'other');
    // D: nothing for the caller; another user administers it.
    await insertOrg('D', 'Delta');
    await insertTeam('D1', 'D', 'Main');
    await insertProjects('D1', ['d-1']);
    await orgMember('D', 'other', 'administrator');
    // F: a plain member, in an empty team only.
    await insertOrg('F', 'Foxtrot');
    await insertTeam('FE', 'F', 'Empty');
    await insertTeam('FX', 'F', 'Other');
    await insertProjects('FX', ['fx-1']);
    await orgMember('F', 'caller', 'member');
    await teamMember('FE', 'caller');
    await teamMember('FX', 'other');
    // G: administered by the caller, but without a project (one empty team);
    // H: administered by the caller, without any team.
    await insertOrg('G', 'Golf');
    await insertTeam('G1', 'G', 'Empty');
    await orgMember('G', 'caller', 'administrator');
    await insertOrg('H', 'Hotel');
    await orgMember('H', 'caller', 'administrator');
    // I: a team membership without an organization membership (the previous
    // query let it through its teams_members EXISTS).
    await insertOrg('I', 'India');
    await insertTeam('I1', 'I', 'Main');
    await insertProjects('I1', ['i-1']);
    await teamMember('I1', 'caller');
    // M: a manager is not privileged: only its teams' projects.
    await insertOrg('M', 'Mike');
    await insertTeam('M1', 'M', 'Main');
    await insertProjects('M1', ['m-1']);
    await orgMember('M', 'caller', 'manager');
    // Z: past the bound. bigAdmin administers 501 projects here, and sees one
    // more through a team of acme (sorted before Zulu).
    await insertOrg('Z', 'Zulu');
    await insertTeam('Z1', 'Z', 'Main');
    await insertProjects(
      'Z1',
      Array.from(
        { length: 501 },
        (_, i) => `p-${String(i + 1).padStart(4, '0')}`,
      ),
    );
    await orgMember('Z', 'bigAdmin', 'administrator');
    await teamMember('A2', 'bigAdmin');
    // For the profile: the caller in three teams of acme (created in another
    // order than their names), and other users in the caller's teams and
    // organizations (the previous read loaded them all).
    await teamMember('A3', 'caller', 'team_manager');
    await teamMember('A2', 'caller', 'analyst_developer');
    await teamMember('CB', 'other', 'team_manager');
    await teamMember('A1', 'other');
    await orgMember('A', 'other', 'member');
    await orgMember('C', 'other', 'administrator');

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
        ...[
          User,
          Organization,
          Project,
          Team,
          UserOrganizationMembership,
          UserTeamMembership,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        {
          provide: MailService,
          useValue: { sendWelcomeEmail: async () => undefined },
        },
        { provide: IDENTITY_PROVIDER_PORT, useValue: {} },
        {
          provide: ENTITLEMENTS_PORT,
          useValue: {
            // Billing not wired here: the products stay unknown, the
            // subscription summary absent.
            getProductsForOrganizations: jest.fn(async () => {
              throw new Error('billing not wired here');
            }),
            getSubscriptionSummary: jest.fn(async () => undefined),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    service = moduleRef.get(UserService);
  });

  afterAll(async () => {
    await drop?.();
  });

  const accessibleOf = async (userKey: string) =>
    (await service.getProfile({ userId: users[userKey] })).myAccessibleProjects;
  const legacyOf = (userKey: string) =>
    legacyAccessibleProjects(dataSource.getRepository(Project), users[userKey]);

  describe('myAccessibleProjects is the set the previous query returned', () => {
    it('the caller: projects of acme and Beta Corp, of team B of Cobalt and of India, once each, sorted', async () => {
      const current = await accessibleOf('caller');
      const legacy = await legacyOf('caller');

      expect(current).toEqual(legacy);
      const expected = [
        'acme/Alpha',
        'acme/éclair',
        'acme/zeta',
        'Beta Corp/billing',
        'Beta Corp/Billing-2',
        'Cobalt/cb-1',
        'Cobalt/cb-2',
        'India/i-1',
      ];
      const listed = current.map(
        (p) => `${p.organizationName}/${p.projectName}`,
      );
      if (DIALECT === 'mysql') {
        // utf8mb4_0900_ai_ci: case- and accent-insensitive order.
        expect(listed).toEqual(expected);
      } else {
        // The order is the database collation's (byte order on a musl
        // PostgreSQL image), the same for both queries (above); the set is
        // the same.
        expect([...listed].sort()).toEqual([...expected].sort());
      }
      expect(new Set(current.map((p) => p.projectId)).size).toBe(
        current.length,
      );
    });

    it.each(['other', 'nobody'])(
      'the same projects in the same order for %s',
      async (userKey) => {
        const current = await accessibleOf(userKey);
        const legacy = await legacyOf(userKey);

        expect(current).toEqual(legacy);
      },
    );

    it('a user with no membership at all sees nothing', async () => {
      await expect(accessibleOf('nobody')).resolves.toEqual([]);
    });

    it('stops at 500 rows: the first 500 the previous query returned', async () => {
      const current = await accessibleOf('bigAdmin');
      const legacy = await legacyOf('bigAdmin');

      // The previous query had no LIMIT at all.
      expect(legacy).toHaveLength(502);
      expect(current).toHaveLength(500);
      expect(current).toEqual(legacy.slice(0, 500));
      if (DIALECT === 'mysql') {
        // acme sorts before Zulu in the MySQL collation.
        expect(current[0]).toMatchObject({
          organizationName: 'acme',
          projectName: 'éclair',
        });
      }
    });

    it('sends LIMIT 500 to MySQL', async () => {
      statements.length = 0;
      await accessibleOf('bigAdmin');

      const read = liveSelects(statements).find((s) =>
        s.includes(`FROM ${Q}project${Q}`),
      );
      expect(read).toMatch(/LIMIT 500/);
      expect(read).not.toMatch(/EXISTS/i);
    });
  });

  describe('getProfile: the same organizations, teams and roles', () => {
    type ProfileOrganization = Awaited<
      ReturnType<typeof legacyProfileOrganizations>
    >[number];
    const profileOf = async (userKey: string) =>
      (
        await service.getProfile({ userId: users[userKey] })
      ).myOrganizations.map(
        // The organisation's products and the caller's own came after the
        // read compared here: neither is part of it.
        (organization) => {
          const compared = { ...organization } as Record<string, unknown>;
          // The community entitlements give no subscription summary.
          expect(compared.subscription).toBeUndefined();
          delete compared.subscription;
          delete compared.products;
          delete compared.myProducts;
          delete compared.myProductsKnown;
          return compared as ProfileOrganization;
        },
      );
    // The previous read had no ORDER BY: the order of its organizations and
    // teams was the plan's. On this very fixture two runs of it returned the
    // teams of acme in two different orders. So the comparison is on content,
    // and the new, explicit order is checked on its own below.
    const byId = <T extends { id: string }>(items: T[]) =>
      [...items].sort((a, b) => a.id.localeCompare(b.id));
    const content = (organizations: ProfileOrganization[]) =>
      byId(organizations).map((o) => ({ ...o, myTeams: byId(o.myTeams) }));

    it.each(['caller', 'other', 'bigAdmin', 'nobody'])(
      'the same organizations, roles, teams and team roles for %s',
      async (userKey) => {
        const current = await profileOf(userKey);
        const legacy = await legacyProfileOrganizations(
          dataSource.getRepository(Organization),
          users[userKey],
        );

        expect(content(current)).toEqual(content(legacy));
      },
    );

    it('the caller: seven organizations, a role in each, its teams with their roles', async () => {
      const current = await profileOf('caller');

      expect(current.map((o) => o.name).sort()).toEqual(
        [
          'acme',
          'Beta Corp',
          'Cobalt',
          'Foxtrot',
          'Golf',
          'Hotel',
          'Mike',
        ].sort(),
      );
      const acme = current.find((o) => o.name === 'acme');
      expect(acme).toMatchObject({ myRole: 'administrator', isActive: true });
      expect(acme.myTeams.map((t) => [t.name, t.myRole])).toEqual([
        ['Core', 'developer'],
        ['Empty', 'team_manager'],
        ['Ops', 'analyst_developer'],
      ]);
      expect(current.find((o) => o.name === 'Hotel').myTeams).toEqual([]);
    });

    it("orders the organizations by the caller's memberships and the teams by name", async () => {
      const current = await profileOf('caller');

      const memberships = (
        await run(
          dataSource,
          db.sql`SELECT ${db.ident('organizationId')} AS ${db.ident('organizationId')} FROM ${db.ident('users_organizations_members')} WHERE ${db.ident('userId')} = ${users.caller} ORDER BY ${db.ident('id')}`,
        )
      ).rows as Array<{ organizationId: string }>;
      expect(current.map((o) => o.id)).toEqual([
        ...new Set(memberships.map((m) => m.organizationId)),
      ]);
      for (const organization of current) {
        const teamsByName = (
          await run(
            dataSource,
            db.sql`SELECT t.id FROM team t
            WHERE ${db.ident('t.organizationId')} = ${organization.id}
              AND EXISTS (SELECT 1 FROM teams_members tm WHERE ${db.ident('tm.teamId')} = t.id AND ${db.ident('tm.userId')} = ${users.caller})
            ORDER BY t.name, t.id`,
          )
        ).rows as Array<{ id: string }>;
        expect(organization.myTeams.map((t) => t.id)).toEqual(
          teamsByName.map((t) => t.id),
        );
      }
    });

    it('a membership held twice is listed once, with the role of the lowest membership id', async () => {
      // addMember refuses a second membership, but nothing in the schema does.
      // The previous read took the role of whichever row its plan returned
      // first (on this fixture, not always the same one): the new read takes
      // the row with the lowest membership id (a random UUID, not the oldest
      // row), so only the content is compared with it.
      const cleanup: string[] = [];
      const extraMembership = async (
        table: string,
        row: Record<string, unknown>,
      ) => {
        const membershipId = randomUUID();
        cleanup.push(membershipId);
        await insert(table, [{ id: membershipId, ...row }]);
      };
      try {
        await extraMembership('teams_members', {
          teamId: teams.CB,
          userId: users.caller,
          role: 'developer',
        });
        await extraMembership('users_organizations_members', {
          organizationId: orgs.M,
          userId: users.caller,
          role: 'member',
        });

        const current = await profileOf('caller');
        const legacy = await legacyProfileOrganizations(
          dataSource.getRepository(Organization),
          users.caller,
        );
        const withoutRoles = (organizations: ProfileOrganization[]) =>
          content(organizations).map((o) => ({
            id: o.id,
            teams: o.myTeams.map((t) => t.id),
          }));
        expect(withoutRoles(current)).toEqual(withoutRoles(legacy));

        const lowestIdRole = async (
          table: string,
          column: string,
          value: string,
        ) =>
          (
            await run(
              dataSource,
              db.sql`SELECT role FROM ${db.ident(table)} WHERE ${db.ident(column)} = ${value} AND ${db.ident('userId')} = ${users.caller} ORDER BY id LIMIT 1`,
            )
          ).rows[0].role;
        const cobalt = current.find((o) => o.id === orgs.C);
        expect(cobalt.myTeams).toEqual([
          {
            id: teams.CB,
            name: 'B',
            myRole: await lowestIdRole('teams_members', 'teamId', teams.CB),
          },
        ]);
        expect(current.filter((o) => o.id === orgs.M)).toEqual([
          expect.objectContaining({
            myRole: await lowestIdRole(
              'users_organizations_members',
              'organizationId',
              orgs.M,
            ),
          }),
        ]);
        // And myAccessibleProjects still lists each project once.
        const accessible = await accessibleOf('caller');
        expect(accessible).toEqual(await legacyOf('caller'));
      } finally {
        await run(
          dataSource,
          db.sql`DELETE FROM teams_members WHERE id IN ${db.inList(cleanup)}`,
        );
        await run(
          dataSource,
          db.sql`DELETE FROM users_organizations_members WHERE id IN ${db.inList(cleanup)}`,
        );
      }
    });

    it("reads the caller's memberships, never the other members of its teams", async () => {
      statements.length = 0;
      await service.getProfile({ userId: users.caller });

      const reads = liveSelects(statements);
      // The user, its organization memberships, its team memberships, its
      // accessible projects.
      expect(reads).toHaveLength(4);
      for (const read of reads) {
        expect(read).not.toMatch(/DISTINCT/);
      }
      const organizations = reads.find((s) =>
        s.includes(`FROM ${Q}organization${Q}`),
      );
      expect(organizations).not.toMatch(/teams_members/);
    });
  });

  describe('e-mails, lower-cased on write and on lookup', () => {
    it('a mixed-case e-mail finds the stored user on both engines', async () => {
      if (DIALECT === 'mysql') {
        // Today's cloud data: e-mails stored as the identity provider sent
        // them; the collation still finds them.
        const legacyId = randomUUID();
        await insert('user', [
          {
            id: legacyId,
            firstName: 'Jane',
            email: 'Jane@Acme.io',
            lastName: 'Doe',
            picture: '',
          },
        ]);
        await expect(
          service.getByEmail({ email: 'JANE@acme.io' }),
        ).resolves.toMatchObject({ id: legacyId, email: 'Jane@Acme.io' });
        await expect(
          service.checkExistence({ email: 'jane@ACME.IO' }),
        ).resolves.toEqual({ exists: true, userId: legacyId });
      }

      const { userId } = await service.create({
        email: ' Mixed.Case@Example.TEST ',
        firstName: 'Mixed',
        lastName: 'Case',
        picture: '',
      } as Parameters<UserService['create']>[0]);
      // Stored lower-cased, so PostgreSQL (case-sensitive) finds it too.
      await expect(
        service.getByEmail({ email: 'MIXED.CASE@EXAMPLE.TEST' }),
      ).resolves.toMatchObject({
        id: userId,
        email: 'mixed.case@example.test',
      });
      await expect(
        service.checkExistence({ email: 'Mixed.Case@example.test' }),
      ).resolves.toEqual({ exists: true, userId });
    });

    it('a duplicate e-mail answers ALREADY_EXISTS on both engines', async () => {
      const request = {
        email: 'dup@example.test',
        firstName: 'D',
        lastName: 'U',
        picture: '',
      } as Parameters<UserService['create']>[0];
      await service.create(request);

      for (const email of ['dup@example.test', 'DUP@Example.Test']) {
        const thrown = await service
          .create({ ...request, email })
          .catch((e) => e);
        expect(thrown.getError()).toEqual({
          code: 6,
          message: 'A user with this email already exists',
        });
      }
    });
  });
});
