import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { Organization } from 'src/entities/organization.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { tokenHash } from 'src/modules/local-auth/token-hash';
import {
  buildMembershipHarness,
  createUser,
  type MembershipHarness,
} from './membership-races.live-harness';

/**
 * LIVE spec: concurrent membership writes on a REAL MySQL or PostgreSQL.
 *
 * Every write that changes who belongs to an organisation or a team, and with
 * which role, is sent together with a competing one, many rounds in a row.
 * After each round the database and the permission engine must agree: no
 * relation without a membership row, one row per member, one role relation
 * per member, and the one the row names.
 *
 * The permission engine is an in-memory fake that records tuples and yields
 * on every call (see membership-races.live-harness.ts): what is checked is
 * the order of the writes, which the database decides; the database is real.
 *
 * Skipped unless GM_LIVE=1; the engine is LIVE_DB_TYPE (mysql by default),
 * the URL GM_MYSQL_URL or GM_PG_URL. It creates a throwaway database, builds
 * it with the migrations of the service, and drops it at the end.
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;

/** Rounds per race. */
const ROUNDS = 20;

const ORG_ROLES = ['administrator', 'manager', 'billing_manager', 'member'];
const TEAM_ROLES = [
  'team_manager',
  'analyst_developer',
  'developer',
  'read_only',
];

describeLive('Concurrent membership writes (real database)', () => {
  jest.setTimeout(600_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let h: MembershipHarness;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_membership_races',
      envPrefix: 'GM',
    });
    dataSource = live.dataSource;
  });

  afterAll(async () => {
    await live?.drop();
  });

  beforeEach(async () => {
    h = await buildMembershipHarness(dataSource);
  });

  afterEach(async () => {
    await h.module.close();
  });

  /** A new organisation whose creator is a new user. */
  async function newOrganization(): Promise<{
    organization: Organization;
    creator: User;
  }> {
    const creator = await createUser(dataSource, 'creator');
    const { organizationId } = await h.organizations.createOrganization({
      name: 'Race',
      creatorId: creator.id,
      industry: '',
      country: '',
    } as Parameters<typeof h.organizations.createOrganization>[0]);
    const organization = await dataSource
      .getRepository(Organization)
      .findOneOrFail({ where: { id: organizationId } });
    return { organization, creator };
  }

  async function orgRows(organizationId: string, userId: string) {
    return dataSource.getRepository(UserOrganizationMembership).find({
      where: { organization: { id: organizationId }, user: { id: userId } },
    });
  }

  async function teamRows(teamId: string, userId: string) {
    return dataSource.getRepository(UserTeamMembership).find({
      where: { team: { id: teamId }, user: { id: userId } },
    });
  }

  const orgRoleTuples = (organizationId: string, userId: string) =>
    h.permify
      .relationsOf('organization', organizationId, userId)
      .filter((r) => ORG_ROLES.includes(r));

  const teamRoleTuples = (teamId: string, userId: string) =>
    h.permify
      .relationsOf('team', teamId, userId)
      .filter((r) => TEAM_ROLES.includes(r));

  /** The organisation's default team. */
  async function defaultTeam(organizationId: string): Promise<Team> {
    return dataSource
      .getRepository(Team)
      .findOneOrFail({ where: { organization: { id: organizationId } } });
  }

  async function addOrgMember(
    organizationId: string,
    role: string,
  ): Promise<User> {
    const user = await createUser(dataSource);
    await h.organizations.addMemberOrganization({
      organizationId,
      email: user.email,
      role,
    });
    return user;
  }

  it('a removal sent with a role change never leaves a role without a membership row', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { organization, creator } = await newOrganization();
      const member = await addOrgMember(organization.id, 'member');

      await Promise.allSettled([
        h.organizations.updateMemberRole({
          organizationId: organization.id,
          userId: member.id,
          role: 'administrator',
          updatedBy: creator.id,
        }),
        h.organizations.deleteMember({
          organizationId: organization.id,
          userId: member.id,
          removedBy: creator.id,
        }),
      ]);

      const rows = await orgRows(organization.id, member.id);
      const tuples = orgRoleTuples(organization.id, member.id);
      expect({ round, rows: rows.length, tuples }).toEqual({
        round,
        rows: 0,
        tuples: [],
      });
    }
  });

  it('two concurrent team role changes leave one role, the one the row names, and removal deletes it', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { organization, creator } = await newOrganization();
      const team = await defaultTeam(organization.id);
      const member = await addOrgMember(organization.id, 'member');
      await h.teams.addMember({
        teamId: team.id,
        userId: member.id,
        role: 'developer',
      });

      await Promise.allSettled([
        h.teams.updateMemberRole({
          teamId: team.id,
          userId: member.id,
          role: 'read_only',
          updatedBy: creator.id,
        }),
        h.teams.updateMemberRole({
          teamId: team.id,
          userId: member.id,
          role: 'analyst_developer',
          updatedBy: creator.id,
        }),
      ]);

      const rows = await teamRows(team.id, member.id);
      expect(rows).toHaveLength(1);
      expect({ round, tuples: teamRoleTuples(team.id, member.id) }).toEqual({
        round,
        tuples: [rows[0].role],
      });

      await h.teams.removeMember({
        teamId: team.id,
        userId: member.id,
        removedBy: creator.id,
      });
      expect({ round, tuples: teamRoleTuples(team.id, member.id) }).toEqual({
        round,
        tuples: [],
      });
      expect(await teamRows(team.id, member.id)).toHaveLength(0);
    }
  });

  it('two concurrent adds to a team seat the member once', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { organization, creator } = await newOrganization();
      const team = await defaultTeam(organization.id);
      const member = await addOrgMember(organization.id, 'member');

      const outcomes = await Promise.allSettled([
        h.teams.addMember({
          teamId: team.id,
          userId: member.id,
          role: 'developer',
        }),
        h.teams.addMember({
          teamId: team.id,
          userId: member.id,
          role: 'read_only',
        }),
      ]);

      const rows = await teamRows(team.id, member.id);
      expect({
        round,
        winners: outcomes.filter((o) => o.status === 'fulfilled').length,
        rows: rows.length,
      }).toEqual({ round, winners: 1, rows: 1 });
      expect(teamRoleTuples(team.id, member.id)).toEqual([rows[0].role]);

      await h.teams.removeMember({
        teamId: team.id,
        userId: member.id,
        removedBy: creator.id,
      });
      expect(teamRoleTuples(team.id, member.id)).toEqual([]);
      expect(await teamRows(team.id, member.id)).toHaveLength(0);
    }
  });

  it('an invitation accepted several times at once seats the member once', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { organization, creator } = await newOrganization();
      const invitee = await createUser(dataSource, 'invitee');
      const token = randomBytes(32).toString('hex');
      const repo = dataSource.getRepository(OrganizationInvitation);
      await repo.save(
        repo.create({
          organization: { id: organization.id } as Organization,
          invitedBy: { id: creator.id } as User,
          email: invitee.email,
          role: 'administrator',
          tokenHash: tokenHash(token),
          teamAssignments: null,
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      );

      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          h.organizations.acceptInvitationFromOrganization({
            userId: invitee.id,
            token,
          }),
        ),
      );

      const rows = await orgRows(organization.id, invitee.id);
      expect({
        round,
        winners: outcomes.filter((o) => o.status === 'fulfilled').length,
        rows: rows.length,
        tuples: orgRoleTuples(organization.id, invitee.id),
      }).toEqual({ round, winners: 1, rows: 1, tuples: ['administrator'] });
    }
  });

  it('a burst of creations by one user creates one organisation', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const creator = await createUser(dataSource, 'creator');

      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, (_v, i) =>
          h.organizations.createOrganization({
            name: `Burst ${i}`,
            creatorId: creator.id,
            industry: '',
            country: '',
          } as Parameters<typeof h.organizations.createOrganization>[0]),
        ),
      );

      const created = await dataSource
        .getRepository(Organization)
        .count({ where: { creator: { id: creator.id } } });
      expect({
        round,
        winners: outcomes.filter((o) => o.status === 'fulfilled').length,
        created,
      }).toEqual({ round, winners: 1, created: 1 });
    }
  });

  /** A pending invitation of `invitee` to `organization`, and its token. */
  async function invitationFor(
    organization: Organization,
    creator: User,
    invitee: User,
    role = 'member',
  ) {
    const token = randomBytes(32).toString('hex');
    const repo = dataSource.getRepository(OrganizationInvitation);
    const saved = await repo.save(
      repo.create({
        organization: { id: organization.id } as Organization,
        invitedBy: { id: creator.id } as User,
        email: invitee.email,
        role,
        tokenHash: tokenHash(token),
        teamAssignments: null,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
    return { token, id: saved.id };
  }

  const invitationRow = (id: string) =>
    dataSource
      .getRepository(OrganizationInvitation)
      .findOneOrFail({ where: { id } });

  it('a role left with no membership by an earlier failure is replaced, not kept, when the user is added again', async () => {
    const { organization } = await newOrganization();
    const team = await defaultTeam(organization.id);
    const user = await createUser(dataSource);
    // Orphans: roles with no membership row behind them.
    h.permify.tuples.add(
      `organization:${organization.id}#administrator@user:${user.id}`,
    );
    h.permify.tuples.add(`team:${team.id}#team_manager@user:${user.id}`);

    await h.organizations.addMemberOrganization({
      organizationId: organization.id,
      email: user.email,
      role: 'member',
    });
    await h.teams.addMember({
      teamId: team.id,
      userId: user.id,
      role: 'developer',
    });

    expect(orgRoleTuples(organization.id, user.id)).toEqual(['member']);
    expect(teamRoleTuples(team.id, user.id)).toEqual(['developer']);
  });

  it('an acceptance whose role write reached the engine but failed leaves no role, no row, and the invitation open', async () => {
    const { organization, creator } = await newOrganization();
    const invitee = await createUser(dataSource, 'invitee');
    const { token, id } = await invitationFor(organization, creator, invitee);
    const write = h.permify.writePermission.bind(h.permify);
    let failed = false;
    h.permify.writePermission = async (...args) => {
      await write(...args);
      if (!failed && args[3] === 'organization') {
        failed = true;
        // Applied, then the client gave up (a deadline).
        throw new Error('deadline exceeded');
      }
      return true;
    };

    await expect(
      h.organizations.acceptInvitationFromOrganization({
        userId: invitee.id,
        token,
      }),
    ).rejects.toBeDefined();

    expect(await orgRows(organization.id, invitee.id)).toHaveLength(0);
    expect(orgRoleTuples(organization.id, invitee.id)).toEqual([]);
    expect((await invitationRow(id)).status).toBe('pending');

    // And it can be accepted again.
    h.permify.writePermission = write;
    await h.organizations.acceptInvitationFromOrganization({
      userId: invitee.id,
      token,
    });
    expect(orgRoleTuples(organization.id, invitee.id)).toEqual(['member']);
  });

  it('an invitation consumed by an acceptance that never seated the member is completed by the next acceptance', async () => {
    const { organization, creator } = await newOrganization();
    const invitee = await createUser(dataSource, 'invitee');
    const { token, id } = await invitationFor(organization, creator, invitee);
    // The process stopped right after the consuming update.
    await dataSource
      .getRepository(OrganizationInvitation)
      .update(id, { status: 'accepted', acceptedAt: null });

    await h.organizations.acceptInvitationFromOrganization({
      userId: invitee.id,
      token,
    });

    expect(await orgRows(organization.id, invitee.id)).toHaveLength(1);
    expect(orgRoleTuples(organization.id, invitee.id)).toEqual(['member']);
    const done = await invitationRow(id);
    expect(done.status).toBe('accepted');
    expect(done.acceptedAt).toBeInstanceOf(Date);
  });

  it('a completed acceptance cannot seat a member removed since', async () => {
    const { organization, creator } = await newOrganization();
    const invitee = await createUser(dataSource, 'invitee');
    const { token } = await invitationFor(organization, creator, invitee);
    await h.organizations.acceptInvitationFromOrganization({
      userId: invitee.id,
      token,
    });
    await h.organizations.deleteMember({
      organizationId: organization.id,
      userId: invitee.id,
      removedBy: creator.id,
    });

    await expect(
      h.organizations.acceptInvitationFromOrganization({
        userId: invitee.id,
        token,
      }),
    ).rejects.toBeDefined();
    expect(await orgRows(organization.id, invitee.id)).toHaveLength(0);
    expect(orgRoleTuples(organization.id, invitee.id)).toEqual([]);
  });
});
