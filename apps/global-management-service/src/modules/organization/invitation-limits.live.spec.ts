import { randomUUID } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import {
  DEFAULT_CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY,
  DEFAULT_INVITATIONS_PER_INVITER_PER_DAY,
  DEFAULT_INVITATIONS_PER_ORGANIZATION_PER_DAY,
  INVITATION_LIMIT_WINDOW_MS,
} from './invitation-limits';
import {
  buildMembershipHarness,
  createUser,
  type MembershipHarness,
} from './membership-races.live-harness';

/**
 * LIVE spec: the number of invitations an organisation and an inviter may
 * create over a rolling 24 hours, counted on a REAL MySQL or PostgreSQL.
 * Canceled invitations count: inviting then canceling sends an e-mail each
 * time.
 *
 * Skipped unless GM_LIVE=1; the engine is LIVE_DB_TYPE (mysql by default),
 * the URL GM_MYSQL_URL or GM_PG_URL.
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;

describeLive('Invitation limits (real database)', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let h: MembershipHarness;
  const saved = { ...process.env };

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_invitation_limits',
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
    process.env = { ...saved };
    await h.module.close();
  });

  async function newOrganization() {
    const creator = await createUser(dataSource, 'creator');
    const { organizationId } = await h.organizations.createOrganization({
      name: 'Limits',
      creatorId: creator.id,
      industry: '',
      country: '',
    } as Parameters<typeof h.organizations.createOrganization>[0]);
    return { organizationId, creator };
  }

  const invite = (organizationId: string, invitedBy: string) =>
    h.organizations.inviteUserToOrganization({
      organizationId,
      invitedBy,
      email: `invitee-${randomUUID()}@example.test`,
      role: 'member',
      teamAssignments: [],
    } as Parameters<typeof h.organizations.inviteUserToOrganization>[0]);

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcException);
    return (error as RpcException).getError() as {
      code: number;
      message: string;
    };
  };

  it('an organisation that cancels invitations reaches the cancellation limit', async () => {
    const { organizationId, creator } = await newOrganization();

    for (
      let i = 0;
      i < DEFAULT_CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY;
      i += 1
    ) {
      const sent = await invite(organizationId, creator.id);
      await h.organizations.cancelInvitation({
        organizationId,
        invitationId: sent.id,
      });
    }

    expect((await refusal(invite(organizationId, creator.id))).code).toBe(
      status.RESOURCE_EXHAUSTED,
    );
    expect(h.mail.sendOrganizationInviteEmail).toHaveBeenCalledTimes(
      DEFAULT_CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY,
    );
  });

  it('a normal onboarding of 25 people by one administrator is not refused', async () => {
    const { organizationId, creator } = await newOrganization();
    for (let i = 0; i < 25; i += 1) {
      await invite(organizationId, creator.id);
    }
    expect(DEFAULT_INVITATIONS_PER_INVITER_PER_DAY).toBe(100);
    expect(DEFAULT_INVITATIONS_PER_ORGANIZATION_PER_DAY).toBe(300);
  });

  it('an inviter reaches the per-inviter limit, canceled invitations included', async () => {
    process.env.INVITATIONS_PER_INVITER_PER_DAY = '3';
    const { organizationId, creator } = await newOrganization();
    const first = await invite(organizationId, creator.id);
    await h.organizations.cancelInvitation({
      organizationId,
      invitationId: first.id,
    });
    await invite(organizationId, creator.id);
    await invite(organizationId, creator.id);

    expect((await refusal(invite(organizationId, creator.id))).code).toBe(
      status.RESOURCE_EXHAUSTED,
    );
  });

  it('an organisation reaches its own limit whoever invites, and invitations older than the window no longer count', async () => {
    process.env.INVITATIONS_PER_ORGANIZATION_PER_DAY = '3';
    const { organizationId, creator } = await newOrganization();
    const admin = await createUser(dataSource, 'admin');
    await h.organizations.addMemberOrganization({
      organizationId,
      email: admin.email,
      role: 'administrator',
    });

    await invite(organizationId, creator.id);
    await invite(organizationId, admin.id);
    await invite(organizationId, creator.id);
    expect((await refusal(invite(organizationId, admin.id))).code).toBe(
      status.RESOURCE_EXHAUSTED,
    );

    // The three invitations were created more than 24 hours ago.
    const invitations = dataSource.getRepository(OrganizationInvitation);
    const rows = await invitations.find({
      where: { organization: { id: organizationId } },
    });
    expect(rows).toHaveLength(3);
    await invitations.update(
      rows.map((row) => row.id),
      { createdAt: new Date(Date.now() - INVITATION_LIMIT_WINDOW_MS - 60_000) },
    );

    await expect(invite(organizationId, admin.id)).resolves.toMatchObject({
      status: 'pending',
    });
  });
});
