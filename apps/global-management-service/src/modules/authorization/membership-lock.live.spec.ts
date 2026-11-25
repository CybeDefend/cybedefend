import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { Organization } from 'src/entities/organization.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { User } from 'src/entities/user.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { tokenHash } from 'src/modules/local-auth/token-hash';
import {
  buildMembershipHarness,
  createUser,
} from '../organization/membership-races.live-harness';
import { withMembershipLock, withMembershipLocks } from './membership-lock';

/**
 * LIVE spec: the membership locks never starve the connection pool they
 * share with the work they protect. The database pool is cut to 3
 * connections, then more distinct members than that are written at once,
 * plain and nested (an organisation lock around team locks). Every call
 * must finish; before, each lock holder kept a pooled connection while its
 * work waited for another one, and the replica froze.
 *
 * Skipped unless GM_LIVE=1; the engine is LIVE_DB_TYPE (mysql by default),
 * the URL GM_MYSQL_URL or GM_PG_URL.
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;

const POOL = 3;

/** Rejects when `work` has not settled within `ms`: a frozen pool. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`still running after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describeLive('Membership locks on a small pool (real database)', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_membership_lock_pool',
      envPrefix: 'GM',
      extra:
        liveDialect('GM') === 'postgres'
          ? { max: POOL }
          : { connectionLimit: POOL },
    });
    dataSource = live.dataSource;
  });

  afterAll(async () => {
    await live?.drop();
  });

  it('more distinct members than the pool holds are all written', async () => {
    const results = await within(
      30_000,
      Promise.all(
        Array.from({ length: POOL * 4 }, (_v, i) =>
          withMembershipLock(
            dataSource,
            'organization',
            'org-1',
            `user-${i}`,
            async () => {
              await pause(50);
              await dataSource.query('SELECT 1');
              return i;
            },
          ),
        ),
      ),
    );
    expect(results).toHaveLength(POOL * 4);
  });

  it('nested organisation and team locks of distinct members all finish', async () => {
    const results = await within(
      30_000,
      Promise.all(
        Array.from({ length: POOL * 3 }, (_v, i) =>
          withMembershipLock(
            dataSource,
            'organization',
            'org-1',
            `user-${i}`,
            async () => {
              await dataSource.query('SELECT 1');
              return withMembershipLocks(
                dataSource,
                'team',
                ['team-3', 'team-1', 'team-2'],
                `user-${i}`,
                async () => {
                  await pause(20);
                  await dataSource.query('SELECT 1');
                  // A nested lock on a key this call already holds runs
                  // at once instead of waiting on itself.
                  return withMembershipLock(
                    dataSource,
                    'team',
                    'team-2',
                    `user-${i}`,
                    async () => i,
                  );
                },
              );
            },
          ),
        ),
      ),
    );
    expect(results).toHaveLength(POOL * 3);
  });

  it('one acceptance with more team seats than the pool holds seats the member in every team', async () => {
    const h = await buildMembershipHarness(dataSource);
    try {
      const creator = await createUser(dataSource, 'creator');
      const { organizationId } = await h.organizations.createOrganization({
        name: 'Pool',
        creatorId: creator.id,
        industry: '',
        country: '',
      } as Parameters<typeof h.organizations.createOrganization>[0]);
      const teamIds: string[] = [];
      for (let i = 0; i < POOL * 3; i += 1) {
        const team = await h.teams.createTeam({
          organizationId,
          name: `Team ${i}`,
          description: '',
          creatorId: creator.id,
        });
        teamIds.push(team.teamId);
      }
      const invitee = await createUser(dataSource, 'invitee');
      const token = randomBytes(32).toString('hex');
      const repo = dataSource.getRepository(OrganizationInvitation);
      await repo.save(
        repo.create({
          organization: { id: organizationId } as Organization,
          invitedBy: { id: creator.id } as User,
          email: invitee.email,
          role: 'member',
          tokenHash: tokenHash(token),
          teamAssignments: teamIds.map((teamId) => ({
            teamId,
            role: 'developer',
          })),
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      );

      await within(
        60_000,
        h.organizations.acceptInvitationFromOrganization({
          userId: invitee.id,
          token,
        }),
      );

      const seats = await dataSource
        .getRepository(UserTeamMembership)
        .count({ where: { user: { id: invitee.id } } });
      expect(seats).toBe(teamIds.length);
    } finally {
      await h.module.close();
    }
  });
});
