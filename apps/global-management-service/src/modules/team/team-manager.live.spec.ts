import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import {
  buildMembershipHarness,
  createUser,
  type MembershipHarness,
} from '../organization/membership-races.live-harness';

/**
 * LIVE spec on a REAL MySQL or PostgreSQL: who may demote or remove a team
 * manager. The organisation's creator and its administrators may; another
 * team manager, a plain member or an unnamed requester may not.
 *
 * Skipped unless GM_LIVE=1; the engine is LIVE_DB_TYPE (mysql by default),
 * the URL GM_MYSQL_URL or GM_PG_URL.
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;

describeLive('Demoting or removing a team manager (real database)', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let h: MembershipHarness;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_team_manager',
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

  /**
   * An organisation, its default team (its creator is the team manager),
   * an administrator, and two more team managers of that team.
   */
  async function setting() {
    const creator = await createUser(dataSource, 'creator');
    const { organizationId } = await h.organizations.createOrganization({
      name: 'Managers',
      creatorId: creator.id,
      industry: '',
      country: '',
    } as Parameters<typeof h.organizations.createOrganization>[0]);
    const team = await dataSource
      .getRepository(Team)
      .findOneOrFail({ where: { organization: { id: organizationId } } });
    const member = async (orgRole: string, teamRole?: string) => {
      const user = await createUser(dataSource, orgRole);
      await h.organizations.addMemberOrganization({
        organizationId,
        email: user.email,
        role: orgRole,
      });
      if (teamRole) {
        await h.teams.addMember({
          teamId: team.id,
          userId: user.id,
          role: teamRole,
        });
      }
      return user;
    };
    const admin = await member('administrator');
    const manager = await member('member', 'team_manager');
    const otherManager = await member('member', 'team_manager');
    return { creator, admin, manager, otherManager, team };
  }

  const roleOf = async (teamId: string, user: User) =>
    (
      await dataSource.getRepository(UserTeamMembership).findOne({
        where: { team: { id: teamId }, user: { id: user.id } },
      })
    )?.role ?? null;

  const refusalCode = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcException);
    return ((error as RpcException).getError() as { code: number }).code;
  };

  it('the organisation creator demotes a team manager', async () => {
    const { creator, manager, team } = await setting();

    await h.teams.updateMemberRole({
      teamId: team.id,
      userId: manager.id,
      role: 'developer',
      updatedBy: creator.id,
    });

    expect(await roleOf(team.id, manager)).toBe('developer');
    expect(
      h.permify
        .relationsOf('team', team.id, manager.id)
        .filter((r) => r !== 'organization'),
    ).toEqual(['developer']);
  });

  it('an organisation administrator removes a team manager from the team', async () => {
    const { admin, manager, team } = await setting();

    await h.teams.removeMember({
      teamId: team.id,
      userId: manager.id,
      removedBy: admin.id,
    });

    expect(await roleOf(team.id, manager)).toBeNull();
    expect(h.permify.relationsOf('team', team.id, manager.id)).toEqual([]);
  });

  it('another team manager may neither demote nor remove a team manager', async () => {
    const { manager, otherManager, team } = await setting();

    expect(
      await refusalCode(
        h.teams.updateMemberRole({
          teamId: team.id,
          userId: manager.id,
          role: 'read_only',
          updatedBy: otherManager.id,
        }),
      ),
    ).toBe(status.PERMISSION_DENIED);
    expect(
      await refusalCode(
        h.teams.removeMember({
          teamId: team.id,
          userId: manager.id,
          removedBy: otherManager.id,
        }),
      ),
    ).toBe(status.PERMISSION_DENIED);
    expect(await roleOf(team.id, manager)).toBe('team_manager');
  });

  it('a request that names no requester is refused for a team manager', async () => {
    const { manager, team } = await setting();

    expect(
      await refusalCode(
        h.teams.updateMemberRole({
          teamId: team.id,
          userId: manager.id,
          role: 'read_only',
          updatedBy: '',
        }),
      ),
    ).toBe(status.PERMISSION_DENIED);
    expect(
      await refusalCode(
        h.teams.removeMember({
          teamId: team.id,
          userId: manager.id,
          removedBy: '',
        }),
      ),
    ).toBe(status.PERMISSION_DENIED);
  });

  it('a creator of another organisation is not the creator of this one', async () => {
    const { manager, team } = await setting();
    const stranger = await setting();

    expect(
      await refusalCode(
        h.teams.updateMemberRole({
          teamId: team.id,
          userId: manager.id,
          role: 'read_only',
          updatedBy: stranger.creator.id,
        }),
      ),
    ).toBe(status.PERMISSION_DENIED);
  });
});
