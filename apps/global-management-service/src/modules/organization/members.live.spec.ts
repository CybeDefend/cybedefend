import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';
import { dialectApi, run } from '@cybedefend/db-dialect';

import { OrganizationService } from './organization.service';
import { buildOrganizationService } from './organization.service.fixtures';
import { TeamService } from '../team/team.service';
import { ProjectService } from '../project/project.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import {
  createLiveDatabase,
  insertRows,
  liveDialect,
  liveEnabled,
  liveSelects,
} from 'src/core/db/live-database';

/**
 * LIVE spec against a REAL MySQL or PostgreSQL: the members of an
 * organization and of a team are paginated in SQL, and getAllTeams decides
 * the caller's privilege without loading the organization's members.
 *
 * The previous reads are copied verbatim below and run on the same data. They
 * had no ORDER BY (the members came in the order of the index the plan used),
 * so pages are compared as a whole: the same members and roles over all pages,
 * the same totals; the new order is checked on its own (user id, then
 * membership id: the order of IDX_uom_org_user / IDX_tm_team_user).
 *
 * `totalUsers` of GetMembers is read by billing as the organization's member
 * count (CountMembersInOrganization gives the same figure): it must equal
 * that count.
 *
 * It is skipped unless `GM_LIVE=1` (or the former `GM_MYSQL_LIVE=1`, which
 * means MySQL), so `pnpm run test` stays hermetic. The engine is
 * `LIVE_DB_TYPE` (mysql by default). It creates a throwaway database, builds
 * it with the migrations of global-management, and drops it at the end.
 *
 * How to run (the local docker MySQL listens on 3308):
 *   GM_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=members.live --runInBand
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=members.live --runInBand
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;
/** The engine of this run, and its SQL. */
const DIALECT = liveDialect('GM');
const db = dialectApi(DIALECT);
/** The engine's identifier quote, for the SQL the assertions read. */
const Q = DIALECT === 'mysql' ? '`' : '"';

interface MembersPage {
  users: Array<{ id: string; role?: string }>;
  totalUsers: number;
  totalPages: number;
}

/** OrganizationService.getMembersOrganization before SQL pagination, verbatim. */
async function legacyOrganizationMembers(
  organizationRepository: Repository<Organization>,
  request: {
    organizationId: string;
    page: number;
    pageSize: number;
    searchQuery: string;
  },
) {
  const { page = 1, pageSize = 5, searchQuery = '' } = request;
  const organization = await organizationRepository.findOne({
    where: { id: request.organizationId },
    relations: ['userMemberships', 'userMemberships.user'],
  });
  if (!organization) return null;
  let userMemberships = organization.userMemberships;
  if (searchQuery) {
    const lowerSearchQuery = searchQuery.toLowerCase();
    userMemberships = userMemberships.filter((membership) => {
      const { firstName, lastName, email } = membership.user;
      return (
        (firstName && firstName.toLowerCase().includes(lowerSearchQuery)) ||
        (lastName && lastName.toLowerCase().includes(lowerSearchQuery)) ||
        (email && email.toLowerCase().includes(lowerSearchQuery))
      );
    });
  }
  const totalUsers = userMemberships.length;
  const totalPages = Math.ceil(totalUsers / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedMemberships = userMemberships.slice(
    startIndex,
    startIndex + pageSize,
  );
  const users = paginatedMemberships.map((membership) => ({
    id: membership.user.id,
    firstName: membership.user.firstName,
    lastName: membership.user.lastName,
    email: membership.user.email,
    picture: membership.user.picture,
    role: membership.role,
  }));
  return { users, totalUsers, totalPages };
}

/** TeamService.getMembers before SQL pagination, verbatim. */
async function legacyTeamMembers(
  teamRepository: Repository<Team>,
  request: {
    teamId: string;
    page: number;
    pageSize: number;
    searchQuery: string;
  },
) {
  const { teamId, page = 1, pageSize = 15, searchQuery = '' } = request;
  const team = await teamRepository.findOne({
    where: { id: teamId },
    relations: ['userMemberships', 'userMemberships.user'],
  });
  if (!team) return null;
  let memberships = team.userMemberships;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    memberships = memberships.filter((m) =>
      [m.user.firstName, m.user.lastName, m.user.email]
        .filter(Boolean)
        .some((f) => f.toLowerCase().includes(q)),
    );
  }
  const totalUsers = memberships.length;
  const totalPages = Math.ceil(totalUsers / pageSize);
  const slice = memberships.slice((page - 1) * pageSize, page * pageSize);
  const users = slice.map((m) => ({
    id: m.user.id,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    email: m.user.email,
    picture: m.user.picture,
    role: m.role,
  }));
  return { users, totalUsers, totalPages };
}

/** TeamService.getAllTeams before SQL pagination, verbatim (ids only). */
async function legacyAllTeams(
  dataSource: DataSource,
  organizationId: string,
  userId: string,
) {
  const org = await dataSource.getRepository(Organization).findOne({
    where: { id: organizationId },
    relations: ['userMemberships', 'userMemberships.user'],
  });
  if (!org) return null;
  const privileged = org.userMemberships.some(
    (m) =>
      m.user.id === userId && ['creator', 'administrator'].includes(m.role),
  );
  const teamRepo = dataSource.getRepository(Team);
  const teams = privileged
    ? await teamRepo.find({ where: { organization: { id: organizationId } } })
    : await teamRepo
        .createQueryBuilder('team')
        .innerJoin('team.userMemberships', 'um')
        .where('team.organization.id = :org', { org: organizationId })
        .andWhere('um.user.id = :uid', { uid: userId })
        .getMany();
  return teams.map((t) => t.id);
}

describeLive('Members in O(page) on a real database', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let statements: string[];
  let drop: () => Promise<void>;
  let organizationService: OrganizationService;
  let teamService: TeamService;

  const users: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const teams: Record<string, string> = {};
  let insertInto: (
    table: string,
    row: Record<string, unknown>,
  ) => Promise<void>;

  // [key, firstName, lastName, email]
  const people: Array<[string, string, string, string]> = [
    ['alice', 'Alice', 'Martin', 'alice@example.test'],
    ['alice2', 'ALICE', 'Durand', 'a.durand@corp.test'],
    ['bob', 'Bob', 'Alicea', 'bob@example.test'],
    ['carol', 'Carol', 'Smith', 'x_y@example.test'],
    ['dave', 'Dave', 'Jones', 'dave+100%@example.test'],
    ['erin', 'Erin', 'Brown', 'erin@corp.test'],
    ...Array.from({ length: 17 }, (_, i): [string, string, string, string] => [
      `user${i}`,
      `User${i}`,
      `Number${i}`,
      `user${i}@example.test`,
    ]),
  ];

  beforeAll(async () => {
    ({ dataSource, statements, drop } = await createLiveDatabase({
      prefix: 'gm_back240_l16_members',
      envPrefix: 'GM',
    }));
    const insert = (table: string, row: Record<string, unknown>) =>
      insertRows({ dataSource, dialect: DIALECT }, table, [row]);
    insertInto = insert;

    for (const [key, firstName, lastName, email] of [
      ...people,
      ['outsider', 'Outsider', 'Alice', 'outsider@example.test'],
    ] as Array<[string, string, string, string]>) {
      users[key] = randomUUID();
      await insert('user', {
        id: users[key],
        firstName,
        email,
        lastName,
        picture: '',
      });
    }
    for (const [key, name] of [
      ['O', 'Org'],
      ['P', 'Other org'],
    ]) {
      orgs[key] = randomUUID();
      await insert('organization', {
        id: orgs[key],
        name,
        industry: 'IT',
        country: 'FR',
      });
    }
    for (const [key, orgKey, name] of [
      ['T', 'O', 'Platform'],
      ['T2', 'O', 'Empty'],
      ['T3', 'O', 'Apps'],
      ['TP', 'P', 'Theirs'],
    ]) {
      teams[key] = randomUUID();
      await insert('team', {
        id: teams[key],
        name,
        description: '',
        organizationId: orgs[orgKey],
      });
    }
    const orgMember = (organizationId: string, userId: string, role: string) =>
      insert('users_organizations_members', {
        id: randomUUID(),
        organizationId,
        userId,
        role,
      });
    const teamMember = (teamId: string, userId: string, role: string) =>
      insert('teams_members', { id: randomUUID(), teamId, userId, role });
    // Every person is a member of O, with a few roles; the first twelve are
    // in team T, alice also in T3. The outsider is only in P and TP.
    for (const [i, [key]] of people.entries()) {
      const role = i === 0 ? 'creator' : i === 1 ? 'administrator' : 'member';
      await orgMember(orgs.O, users[key], role);
      if (i < 12)
        await teamMember(
          teams.T,
          users[key],
          i === 2 ? 'team_manager' : 'developer',
        );
    }
    await teamMember(teams.T3, users.bob, 'developer');
    await orgMember(orgs.P, users.outsider, 'creator');
    await teamMember(teams.TP, users.outsider, 'team_manager');

    // OrganizationService: its usual test wiring, on the real repositories.
    const testbed = await buildOrganizationService();
    organizationService = testbed.service;
    Object.assign(organizationService as unknown as Record<string, unknown>, {
      organizationRepository: dataSource.getRepository(Organization),
      teamRepository: dataSource.getRepository(Team),
      projectRepository: dataSource.getRepository(Project),
      userRepository: dataSource.getRepository(User),
      userOrganizationMembershipRepository: dataSource.getRepository(
        UserOrganizationMembership,
      ),
      userTeamMembershipRepository:
        dataSource.getRepository(UserTeamMembership),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        TeamService,
        ...[
          Team,
          Organization,
          Project,
          User,
          UserOrganizationMembership,
          UserTeamMembership,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        { provide: ProjectService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: DataPurgeLedger, useValue: {} },
        { provide: DataPurgeRunner, useValue: { kick: () => undefined } },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    teamService = moduleRef.get(TeamService);
  });

  afterAll(async () => {
    await drop?.();
  });

  /** Every page of a members read, until the last one. */
  const allPages = async (
    read: (page: number) => Promise<MembersPage>,
    pageSize: number,
  ) => {
    const first = await read(1);
    const pages = [first];
    for (let page = 2; page <= first.totalPages; page += 1)
      pages.push(await read(page));
    for (const page of pages) {
      expect(page.users.length).toBeLessThanOrEqual(pageSize);
      expect(page.totalUsers).toBe(first.totalUsers);
      expect(page.totalPages).toBe(first.totalPages);
    }
    return {
      totalUsers: first.totalUsers,
      totalPages: first.totalPages,
      users: pages.flatMap((p) => p.users),
    };
  };
  const asSet = (members: Array<{ id: string; role?: string }>) =>
    members.map((m) => `${m.id}:${m.role}`).sort();

  // No accented search: LIKE follows the column collation (utf8mb4_0900_ai_ci),
  // which matches "elise" in "Élise"; the previous JS includes() did not.
  const searches = ['', 'alice', 'ALICE', 'x_y', '100%', 'corp', 'zzz'];

  describe('organization members', () => {
    it.each(
      searches.flatMap((searchQuery) =>
        [5, 20, 500].map((pageSize) => [searchQuery, pageSize] as const),
      ),
    )(
      'search "%s", pages of %d: the same members, roles and totals as before',
      async (searchQuery, pageSize) => {
        const request = (page: number) => ({
          organizationId: orgs.O,
          page,
          pageSize,
          searchQuery,
        });
        const current = await allPages(
          (page) => organizationService.getMembersOrganization(request(page)),
          pageSize,
        );
        const legacy = await allPages(
          (page) =>
            legacyOrganizationMembers(
              dataSource.getRepository(Organization),
              request(page),
            ),
          pageSize,
        );

        expect(current.totalUsers).toBe(legacy.totalUsers);
        expect(current.totalPages).toBe(legacy.totalPages);
        expect(asSet(current.users)).toEqual(asSet(legacy.users));
        expect(new Set(current.users.map((u) => u.id)).size).toBe(
          current.users.length,
        );
      },
    );

    it('pages in the order of the user id, then the membership id', async () => {
      const current = await allPages(
        (page) =>
          organizationService.getMembersOrganization({
            organizationId: orgs.O,
            page,
            pageSize: 5,
            searchQuery: '',
          }),
        5,
      );
      const ordered = (
        await run(
          dataSource,
          db.sql`SELECT ${db.ident('userId')} AS ${db.ident('userId')} FROM ${db.ident('users_organizations_members')} WHERE ${db.ident('organizationId')} = ${orgs.O} ORDER BY ${db.ident('userId')}, ${db.ident('id')}`,
        )
      ).rows as Array<{ userId: string }>;

      expect(current.users.map((u) => u.id)).toEqual(
        ordered.map((r) => r.userId),
      );
    });

    it('totalUsers is the count billing reads: countMembersInOrganization', async () => {
      const page = await organizationService.getMembersOrganization({
        organizationId: orgs.O,
        page: 1,
        pageSize: 1,
        searchQuery: '',
      });
      const { totalMembers } =
        await organizationService.countMembersInOrganization({
          organizationId: orgs.O,
        });

      expect(page.totalUsers).toBe(people.length);
      expect(totalMembers).toBe(people.length);
    });

    // The page and its COUNT, plus ONE primary-key read of
    // the organisation's per-member products switch (`member_products`),
    // whatever the page size: O(page), no per-member query.
    it.each([
      [2, 5, /LIMIT 5 OFFSET 5/],
      [1, 25, /LIMIT 25\b/],
    ])(
      'reads page %i of %i with three SELECTs: the page, its count and the switch by primary key',
      async (page, pageSize, limit) => {
        statements.length = 0;
        const answer = await organizationService.getMembersOrganization({
          organizationId: orgs.O,
          page,
          pageSize,
          searchQuery: '',
        });
        expect(answer.users).toHaveLength(
          Math.max(
            0,
            Math.min(pageSize, people.length - (page - 1) * pageSize),
          ),
        );

        const reads = liveSelects(statements);
        expect(reads).toHaveLength(3);
        for (const read of reads)
          expect(read).not.toContain(`DISTINCT ${Q}distinctAlias${Q}`);
        const switchReads = reads.filter((read) =>
          read.includes(`FROM ${Q}organization${Q}`),
        );
        expect(switchReads).toHaveLength(1);
        expect(switchReads[0]).toContain(`${Q}member_products${Q}`);
        expect(switchReads[0]).toMatch(
          new RegExp(
            `WHERE .*${Q}id${Q} = ${DIALECT === 'mysql' ? '\\?' : '\\$\\d+'}`,
          ),
        );
        expect(switchReads[0]).toMatch(/LIMIT 1/);
        expect(switchReads[0]).not.toMatch(/users_organizations_members/);
        const pageReads = reads.filter((read) => !switchReads.includes(read));
        expect(pageReads.join('\n')).toMatch(limit);
      },
    );

    it('the members search is case-insensitive on both engines', async () => {
      // A separate organization, so the totals above are not affected.
      const organizationId = randomUUID();
      await insertInto('organization', {
        id: organizationId,
        name: 'Acme',
        industry: 'IT',
        country: 'FR',
      });
      const acme: string[] = [];
      for (const [firstName, lastName, email] of [
        ['Ann', 'Lee', 'ann@acme.io'],
        ['Tom', 'Ray', 'Tom.Ray@Acme.IO'],
        ['Zoe', 'Kim', 'zoe@other.test'],
      ]) {
        const userId = randomUUID();
        if (email.includes('cme')) acme.push(userId);
        await insertInto('user', {
          id: userId,
          firstName,
          email,
          lastName,
          picture: '',
        });
        await insertInto('users_organizations_members', {
          id: randomUUID(),
          organizationId,
          userId,
          role: 'member',
        });
      }

      for (const searchQuery of ['ACME', 'acme', 'AcMe.Io']) {
        const page = await organizationService.getMembersOrganization({
          organizationId,
          page: 1,
          pageSize: 10,
          searchQuery,
        });
        expect(page.users.map((u) => u.id).sort()).toEqual([...acme].sort());
        expect(page.totalUsers).toBe(2);
      }
      // A first or last name too, whatever its case.
      const byName = await organizationService.getMembersOrganization({
        organizationId,
        page: 1,
        pageSize: 10,
        searchQuery: 'rAY',
      });
      expect(byName.users.map((u) => u.id)).toEqual([acme[1]]);
    });

    it('the search follows the column collation: case- and accent-insensitive on MySQL', async () => {
      // The one intended difference with the previous JS filter, which was
      // case-insensitive only. A separate organization, so the totals above
      // are not affected.
      const organizationId = randomUUID();
      const userId = randomUUID();
      await insertInto('organization', {
        id: organizationId,
        name: 'Accents',
        industry: 'IT',
        country: 'FR',
      });
      await insertInto('user', {
        id: userId,
        firstName: 'Élise',
        email: 'elise@example.test',
        lastName: 'Lefèvre',
        picture: '',
      });
      await insertInto('users_organizations_members', {
        id: randomUUID(),
        organizationId,
        userId,
        role: 'creator',
      });
      const request = {
        organizationId,
        page: 1,
        pageSize: 5,
        searchQuery: 'LEFEVRE',
      };

      const current = await organizationService.getMembersOrganization(request);
      const legacy = await legacyOrganizationMembers(
        dataSource.getRepository(Organization),
        request,
      );

      // ILIKE is case-insensitive only: accent-insensitivity is not
      // reproduced on PostgreSQL (an accepted engine difference).
      expect(current.users.map((u) => u.id)).toEqual(
        DIALECT === 'mysql' ? [userId] : [],
      );
      expect(legacy.users).toEqual([]);
    });

    it('still answers NOT_FOUND for an unknown organization', async () => {
      const thrown = await organizationService
        .getMembersOrganization({
          organizationId: randomUUID(),
          page: 1,
          pageSize: 5,
          searchQuery: '',
        })
        .catch((e) => e);

      expect(thrown.getError()).toMatchObject({ code: 5 });
    });
  });

  describe('team members', () => {
    it.each(
      searches.flatMap((searchQuery) =>
        [5, 15].map((pageSize) => [searchQuery, pageSize] as const),
      ),
    )(
      'search "%s", pages of %d: the same members, roles and totals as before',
      async (searchQuery, pageSize) => {
        const request = (page: number) => ({
          teamId: teams.T,
          page,
          pageSize,
          searchQuery,
        });
        const current = await allPages(
          (page) => teamService.getMembers(request(page)),
          pageSize,
        );
        const legacy = await allPages(
          (page) =>
            legacyTeamMembers(dataSource.getRepository(Team), request(page)),
          pageSize,
        );

        expect(current.totalUsers).toBe(legacy.totalUsers);
        expect(current.totalPages).toBe(legacy.totalPages);
        expect(asSet(current.users)).toEqual(asSet(legacy.users));
      },
    );

    it('an empty team has no member, an unknown team is NOT_FOUND', async () => {
      await expect(
        teamService.getMembers({
          teamId: teams.T2,
          page: 1,
          pageSize: 15,
          searchQuery: '',
        }),
      ).resolves.toEqual({ users: [], totalUsers: 0, totalPages: 0 });
      const thrown = await teamService
        .getMembers({
          teamId: randomUUID(),
          page: 1,
          pageSize: 15,
          searchQuery: '',
        })
        .catch((e) => e);
      expect(thrown.getError()).toEqual({
        code: 5,
        message: 'Team not found',
      });
    });

    it('getMember: a member, a user outside the team, an unknown team', async () => {
      await expect(
        teamService.getMember({ teamId: teams.T, userId: users.bob }),
      ).resolves.toEqual({
        id: users.bob,
        firstName: 'Bob',
        lastName: 'Alicea',
        email: 'bob@example.test',
        picture: '',
        role: 'team_manager',
      });
      const outside = await teamService
        .getMember({ teamId: teams.T, userId: users.outsider })
        .catch((e) => e);
      expect(outside.getError()).toEqual({
        code: 5,
        message: 'User not in team',
      });
      const unknown = await teamService
        .getMember({ teamId: randomUUID(), userId: users.bob })
        .catch((e) => e);
      expect(unknown.getError()).toEqual({
        code: 5,
        message: 'Team not found',
      });
    });
  });

  describe('getAllTeams', () => {
    it.each([
      ['the creator', 'alice'],
      ['an administrator', 'alice2'],
      ['a member of two teams', 'bob'],
      ['a member of one team', 'carol'],
      ['a member of no team', 'user15'],
      ['a member of another organization', 'outsider'],
    ])('%s: the same teams as before, by name', async (_who, userKey) => {
      const current = await teamService.getAllTeams({
        organizationId: orgs.O,
        userId: users[userKey],
      });
      const legacy = await legacyAllTeams(dataSource, orgs.O, users[userKey]);

      expect(current.teams.map((t) => t.id).sort()).toEqual([...legacy].sort());
      const names = current.teams.map((t) => t.name);
      expect(names).toEqual(
        [...names].sort((a, b) => a.localeCompare(b, 'en')),
      );
    });

    it('reads no member of the organization to decide the privilege', async () => {
      statements.length = 0;
      await teamService.getAllTeams({
        organizationId: orgs.O,
        userId: users.alice,
      });

      for (const read of liveSelects(statements)) {
        expect(read).not.toContain(`${Q}user${Q}`);
        expect(read).not.toContain(`DISTINCT ${Q}distinctAlias${Q}`);
      }
    });
  });
});
