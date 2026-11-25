import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { IsNull } from 'typeorm';

import { OrganizationService } from './organization.service';
import { MockType } from 'src/test-utils/typeorm-mock.util';
import {
  buildOrganizationService,
  OrganizationFixture,
} from './organization.service.fixtures';
import { ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS } from 'src/edition/community/organization-lifecycle.binding';
import { Organization } from 'src/entities/organization.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { Project } from 'src/entities/project.entity';
import {
  CapturedStatement,
  CaptureResponder,
  createSqlCaptureDataSource,
  rawRow,
  selectedAliases,
  selects,
} from 'src/test-utils/sql-capture.util';
import { Logger } from 'nestjs-pino';
import { InMemoryOrganizationDeletionCodeStore } from 'src/test-utils/in-memory-organization-deletion-code-store';
import { MailService } from '../mail/mail.service';
import { OrganizationDeletionCodeService } from './organization-deletion-code.service';
import { tokenHash } from '../local-auth/token-hash';

describe('OrganizationService', () => {
  let service: OrganizationService;

  let orgRepo: MockType<any>;
  let teamRepo: MockType<any>;
  let projectRepo: MockType<any>;
  let userRepo: MockType<any>;
  let uomRepo: MockType<any>;
  let utmRepo: MockType<any>;
  let invRepo: MockType<any>;
  let mailService: { sendOrganizationInviteEmail: jest.Mock };
  let teamService: { createTeam: jest.Mock; addMember: jest.Mock };
  let authorizationService: {
    canAddTeamMember: jest.Mock;
    organizationAddMember: jest.Mock;
    setOrganizationActive: jest.Mock;
    initializeOrganizationWithoutProduct: jest.Mock;
    initializeOrganizationProducts: jest.Mock;
    organizationRemoveMember: jest.Mock;
  };
  let deleteIntegrationsForOrg: jest.Mock;
  let dataSource: { transaction: jest.Mock };
  let purgeLedger: OrganizationFixture['purgeLedger'];
  let purgeRunner: OrganizationFixture['purgeRunner'];
  let realtimePublisher: { publish: jest.Mock };
  let lifecycleHooks: OrganizationFixture['lifecycleHooks'];
  let identity: OrganizationFixture['identity'];
  let logger: OrganizationFixture['logger'];
  let deletionCodes: OrganizationFixture['deletionCodes'];
  let memberProducts: OrganizationFixture['memberProducts'];

  // Every mock, and the wiring itself, lives in organization.service.fixtures
  // so this spec and organization.service.lead.spec.ts cannot drift apart when
  // the constructor gains a dependency.
  beforeEach(async () => {
    ({
      service,
      memberProducts,
      orgRepo,
      teamRepo,
      projectRepo,
      userRepo,
      uomRepo,
      utmRepo,
      invRepo,
      mailService,
      teamService,
      authorizationService,
      deleteIntegrationsForOrg,
      dataSource,
      purgeLedger,
      purgeRunner,
      realtimePublisher,
      lifecycleHooks,
      identity,
      logger,
      deletionCodes,
    } = await buildOrganizationService());
  });

  /**
   * inviteUserToOrganization decides on the seat and inserts the invitation in
   * one transaction that first locks the organization row. This
   * fake transactional EntityManager answers that lock, the two seat counts,
   * the duplicate-invitation lookup and the insert. `tx` marks when the
   * transaction began and how it ended, so a test can place every other call
   * (billing, Logto, e-mail, repositories) relative to it.
   */
  const givenInviteTransaction = ({
    lockedOrganization = { id: 'o1', name: 'Org' },
    members = 1,
    pendingInvitations = 0,
    existingInvitation = null,
  }: {
    /** What SELECT … FOR UPDATE finds: null once the organization is gone. */
    lockedOrganization?: { id: string; name: string } | null;
    members?: number;
    pendingInvitations?: number;
    /** A pending, unexpired invitation to the same e-mail, if any. */
    existingInvitation?: { id: string } | null;
  } = {}) => {
    // (entity, options) — the options are asserted through mock.calls.
    type EntityManagerCall = [entity: unknown, options?: unknown];
    const manager = {
      findOne: jest.fn<Promise<object | null>, EntityManagerCall>(
        async (entity) => {
          if (entity === Organization) return lockedOrganization;
          if (entity === OrganizationInvitation) return existingInvitation;
          return null;
        },
      ),
      count: jest.fn<Promise<number>, EntityManagerCall>(async (entity) => {
        if (entity === UserOrganizationMembership) return members;
        if (entity === OrganizationInvitation) return pendingInvitations;
        return 0;
      }),
      save: jest.fn(
        async (_entity: unknown, invitation: OrganizationInvitation) => {
          invitation.id = 'inv1';
          invitation.status = 'pending';
          return invitation;
        },
      ),
    };
    const tx = { begin: jest.fn(), commit: jest.fn(), rollback: jest.fn() };
    dataSource.transaction.mockImplementation(
      async (work: (em: typeof manager) => Promise<unknown>) => {
        tx.begin();
        try {
          const result = await work(manager);
          tx.commit();
          return result;
        } catch (error) {
          tx.rollback();
          throw error;
        }
      },
    );
    return { manager, tx };
  };

  // The token leaves the response only when the invitation mail
  // went out — with no SMTP the caller gets the link back to show the invitee.
  const arrangeSuccessfulInvite = () => {
    orgRepo.findOne!.mockResolvedValue({ id: 'o1', name: 'Org' });
    userRepo.findOne!.mockResolvedValue({
      id: 'u1',
      email: 'owner@example.com',
    });
    uomRepo.findOne!.mockResolvedValueOnce({ role: 'creator' });
    uomRepo.findOne!.mockResolvedValueOnce(null);
    // The seat counts, the duplicate lookup and the insert run on the
    // transaction: 1 active user, 0 pending invitations, no existing
    // invitation; the fake insert assigns the id.
    givenInviteTransaction({ members: 1, pendingInvitations: 0 });

    // Team assignments validation
    teamRepo.find!.mockResolvedValue([{ id: 't1' }]);
    // Permify: the creator holds team#add_user on every team of the org.
    authorizationService.canAddTeamMember.mockImplementation(
      async (teamId: string, userId: string) =>
        teamId === 't1' && userId === 'u1',
    );
  };
  const inviteRequest = {
    organizationId: 'o1',
    invitedBy: 'u1',
    email: 'invitee@example.com',
    role: 'member',
    teamAssignments: [{ teamId: 't1', role: 'developer' }],
  } as any;

  it('inviteUserToOrganization creates invite and sends email', async () => {
    arrangeSuccessfulInvite();
    mailService.sendOrganizationInviteEmail.mockResolvedValue(true);

    const res = await service.inviteUserToOrganization(inviteRequest);

    expect(res.id).toBe('inv1');
    expect(res.organizationId).toBe('o1');
    expect(mailService.sendOrganizationInviteEmail).toHaveBeenCalled();
    expect(res.token).toBeNull();
  });

  it('returns the invitation token when no mail was sent', async () => {
    arrangeSuccessfulInvite();
    mailService.sendOrganizationInviteEmail.mockResolvedValue(false);

    const res = await service.inviteUserToOrganization(inviteRequest);

    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.token).toBe(
      mailService.sendOrganizationInviteEmail.mock.calls[0][0].token,
    );
  });

  it('hides the token once the mail is sent', async () => {
    arrangeSuccessfulInvite();
    mailService.sendOrganizationInviteEmail.mockResolvedValue(true);

    const res = await service.inviteUserToOrganization(inviteRequest);

    expect(res.token).toBeNull();
  });

  /**
   * An invitation token is a bearer credential: whoever reads it can accept the
   * invitation. Like every other token of the service, only its SHA-256 is
   * stored, the lookups are by that hash alone, and no log line carries it.
   */
  describe('invitation tokens are stored and looked up as their SHA-256 only', () => {
    const allLogArguments = () =>
      JSON.stringify([
        logger.log.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
        logger.debug.mock.calls,
      ]);

    it('stores the hash of the token it hands out, never the token', async () => {
      arrangeSuccessfulInvite();
      mailService.sendOrganizationInviteEmail.mockResolvedValue(false);
      const { manager } = givenInviteTransaction({
        members: 1,
        pendingInvitations: 0,
      });

      const res = await service.inviteUserToOrganization(inviteRequest);

      const saved = manager.save.mock.calls[0][1] as OrganizationInvitation &
        Record<string, unknown>;
      expect(res.token).toMatch(/^[0-9a-f]{64}$/);
      expect(saved.tokenHash).toBe(tokenHash(res.token));
      expect(saved.token).toBeUndefined();
      expect(JSON.stringify(saved)).not.toContain(res.token);
      // The mail still carries the token itself, once.
      expect(
        mailService.sendOrganizationInviteEmail.mock.calls[0][0].token,
      ).toBe(res.token);
      expect(allLogArguments()).not.toContain(res.token);
    });

    it('accepts by looking the hash up, with the address, and never the token', async () => {
      const TOKEN = 'b'.repeat(64);
      userRepo.findOne!.mockResolvedValue({ id: 'u9', email: 'x@example.com' });
      invRepo.findOne!.mockResolvedValue(null);

      await catchRpc(
        service.acceptInvitationFromOrganization({
          token: TOKEN,
          userId: 'u9',
        }),
      );

      expect(invRepo.findOne).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { tokenHash: tokenHash(TOKEN), email: 'x@example.com' },
        }),
      );
      // The "sent to another address" probe is by hash too.
      expect(invRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: { tokenHash: tokenHash(TOKEN) },
      });
      expect(JSON.stringify(invRepo.findOne.mock.calls)).not.toContain(TOKEN);
    });

    it('logs no token when the accepting user is unknown', async () => {
      const TOKEN = 'c'.repeat(64);
      userRepo.findOne!.mockResolvedValue(null);

      const error = await catchRpc(
        service.acceptInvitationFromOrganization({
          token: TOKEN,
          userId: 'u9',
        }),
      );

      expect(error.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
      expect(logger.warn).toHaveBeenCalled();
      expect(allLogArguments()).not.toContain(TOKEN);
      expect(allLogArguments()).not.toContain(tokenHash(TOKEN));
    });
  });

  const catchRpc = async (promise: Promise<unknown>): Promise<RpcException> => {
    try {
      await promise;
    } catch (error) {
      return error as RpcException;
    }
    throw new Error('expected the call to reject, but it resolved');
  };

  /**
   * The gateway only checks `organization#add_user` on the path organization,
   * which an org `manager` holds. The team seats and the organization role an
   * invitation carries are therefore checked here against its author: an
   * invitation must confer nothing its author could not grant directly.
   */
  describe('inviteUserToOrganization: an invitation confers no more than its author may grant', () => {
    const INVITER = 'inviter-1';

    /**
     * One invitation attempt in organization o1. `inviterRole` is the
     * inviter's user_organization_membership row (null: there is none).
     * `staffable` lists the teams on which Permify grants the inviter
     * `team#add_user`, the check POST /team/:teamId/member runs. Every team of
     * `orgTeams` exists in o1.
     */
    const arrangeInvite = ({
      inviterRole,
      staffable = [],
      orgTeams = [],
    }: {
      inviterRole: string | null;
      staffable?: string[];
      orgTeams?: string[];
    }) => {
      orgRepo.findOne!.mockResolvedValue({ id: 'o1', name: 'Org' });
      userRepo.findOne!.mockResolvedValue({
        id: INVITER,
        email: 'inviter@example.com',
      });
      // The inviter's own membership, and "the invitee is not a member yet".
      uomRepo.findOne!.mockImplementation(async ({ where }: any) =>
        where?.user?.id === INVITER && inviterRole
          ? { role: inviterRole }
          : null,
      );
      // The seat counts, the duplicate lookup and the insert run on the
      // organization-locked transaction: 1 member, 0 pending
      // invitations, no existing invitation.
      const transaction = givenInviteTransaction({
        members: 1,
        pendingInvitations: 0,
      });
      // `where.id` is TypeORM's In(...) operator: answer like the database.
      teamRepo.find!.mockImplementation(async ({ where }: any) =>
        (where.id.value as string[])
          .filter((id) => orgTeams.includes(id))
          .map((id) => ({ id })),
      );
      authorizationService.canAddTeamMember.mockImplementation(
        async (teamId: string, userId: string) =>
          userId === INVITER && staffable.includes(teamId),
      );
      return transaction;
    };

    const invite = (
      role: string,
      teamAssignments: { teamId: string; role: string }[] = [],
    ) =>
      service.inviteUserToOrganization({
        organizationId: 'o1',
        invitedBy: INVITER,
        email: 'invitee@example.com',
        role,
        teamAssignments,
        products: [],
      });

    describe('team assignments', () => {
      it('refuses to seat the invitee in a team its author cannot add members to', async () => {
        // An org manager who is not a member of the target team.
        arrangeInvite({
          inviterRole: 'manager',
          orgTeams: ['unreachable-team'],
        });

        const error = await catchRpc(
          invite('member', [
            { teamId: 'unreachable-team', role: 'team_manager' },
          ]),
        );

        expect(error).toBeInstanceOf(RpcException);
        expect(error.getError()).toEqual({
          code: status.PERMISSION_DENIED,
          message:
            'User not allowed to add members to one or more of the selected teams',
        });
        expect(authorizationService.canAddTeamMember).toHaveBeenCalledWith(
          'unreachable-team',
          INVITER,
        );
        // Refused before the seat transaction even opens.
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(mailService.sendOrganizationInviteEmail).not.toHaveBeenCalled();
      });

      it('refuses the whole invitation when a single assigned team is out of reach', async () => {
        arrangeInvite({
          inviterRole: 'manager',
          staffable: ['own-team'],
          orgTeams: ['own-team', 'unreachable-team'],
        });

        const error = await catchRpc(
          invite('member', [
            { teamId: 'own-team', role: 'developer' },
            { teamId: 'unreachable-team', role: 'read_only' },
          ]),
        );

        expect(error.getError()).toMatchObject({
          code: status.PERMISSION_DENIED,
        });
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('lets whoever may staff a team assign any team role there, team_manager included, as POST /team/:teamId/member does', async () => {
        const { manager } = arrangeInvite({
          inviterRole: 'manager',
          staffable: ['own-team'],
          orgTeams: ['own-team'],
        });

        await invite('member', [{ teamId: 'own-team', role: 'team_manager' }]);

        expect(manager.save).toHaveBeenCalledWith(
          OrganizationInvitation,
          expect.objectContaining({
            teamAssignments: [{ teamId: 'own-team', role: 'team_manager' }],
          }),
        );
      });

      it('rejects a team outside the organization before asking Permify anything', async () => {
        arrangeInvite({ inviterRole: 'creator', orgTeams: [] });

        const error = await catchRpc(
          invite('member', [{ teamId: 'foreign-team', role: 'developer' }]),
        );

        expect(error.getError()).toMatchObject({
          code: status.INVALID_ARGUMENT,
        });
        expect(authorizationService.canAddTeamMember).not.toHaveBeenCalled();
      });
    });

    describe('organization role', () => {
      it.each([
        ['creator', 'administrator'],
        ['creator', 'manager'],
        ['creator', 'member'],
        ['administrator', 'manager'],
        ['administrator', 'member'],
        ['manager', 'member'],
      ])('a %s may invite a %s', async (inviterRole, role) => {
        arrangeInvite({ inviterRole });

        await expect(invite(role)).resolves.toMatchObject({
          organizationRole: role,
        });
      });

      it.each([
        // Nobody mints a second owner.
        ['creator', 'creator'],
        // Administrators are appointed by the creator only.
        ['administrator', 'administrator'],
        ['manager', 'administrator'],
        // A manager invites members only: no manager either.
        ['manager', 'manager'],
        // No `organization#add_user` at all: the gateway already stops them,
        // this service must not depend on it.
        ['billing_manager', 'member'],
        ['member', 'member'],
      ])('a %s may not invite a %s', async (inviterRole, role) => {
        arrangeInvite({ inviterRole });

        const error = await catchRpc(invite(role));

        expect(error.getError()).toEqual({
          code: status.PERMISSION_DENIED,
          message: 'User not allowed to invite with this role',
        });
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(mailService.sendOrganizationInviteEmail).not.toHaveBeenCalled();
      });

      it('refuses an inviter who holds no membership in the organization', async () => {
        arrangeInvite({ inviterRole: null });

        const error = await catchRpc(invite('member'));

        expect(error.getError()).toMatchObject({
          code: status.PERMISSION_DENIED,
        });
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * Invitations live 24 hours, and an inviter may have been demoted, removed,
   * or have lost a team since the invitation was created. What the invitation grants is
   * therefore re-checked against its inviter when it is actually granted.
   */
  describe('acceptInvitationFromOrganization: what an invitation grants is re-checked against its inviter', () => {
    const INVITER = 'inviter-1';
    const INVITEE = { id: 'invitee-1', email: 'invitee@example.com' };

    /**
     * A pending invitation to o1, for `role`, created by INVITER, whose
     * current membership is `inviterRole` (null: none left) and who may still
     * add members to the teams in `staffable`. Like TypeORM, the repository
     * returns a relation only when the query asks for it.
     */
    const arrangeAccept = ({
      teamAssignments = [],
      staffable = [],
      role = 'member',
      inviterRole = 'manager',
    }: {
      teamAssignments?: { teamId: string; role: string }[];
      staffable?: string[];
      role?: string;
      inviterRole?: string | null;
    }) => {
      userRepo.findOne!.mockResolvedValue(INVITEE);
      invRepo.findOne!.mockImplementation(
        async ({ relations = [] }: { relations?: string[] }) => ({
          id: 'inv-1',
          token: 'tok',
          email: INVITEE.email,
          role,
          status: 'pending',
          expiresAt: new Date(Date.now() + 3600 * 1000),
          teamAssignments,
          organization: relations.includes('organization')
            ? { id: 'o1', name: 'Org' }
            : undefined,
          invitedBy: relations.includes('invitedBy')
            ? { id: INVITER }
            : undefined,
        }),
      );
      invRepo.save!.mockImplementation(async (invitation: any) => invitation);
      orgRepo.findOne!.mockResolvedValue({ id: 'o1', name: 'Org' });
      // The inviter's current membership; the invitee is not a member yet.
      uomRepo.findOne!.mockImplementation(async ({ where }: any) =>
        where?.user?.id === INVITER && inviterRole
          ? { role: inviterRole }
          : null,
      );
      uomRepo.save!.mockImplementation(async (membership: any) => membership);
      authorizationService.canAddTeamMember.mockImplementation(
        async (teamId: string, userId: string) =>
          userId === INVITER && staffable.includes(teamId),
      );
    };

    const accept = () =>
      service.acceptInvitationFromOrganization({
        token: 'tok',
        userId: INVITEE.id,
      });

    it('refuses an invitation whose role its inviter can no longer grant, and writes nothing', async () => {
      // A manager handing out manager. (The billing_manager case is the
      // closed edition's: the Community Edition refuses it
      // ROLE_NOT_AVAILABLE before this re-check.)
      arrangeAccept({
        role: 'manager',
        inviterRole: 'manager',
        teamAssignments: [{ teamId: 'own-team', role: 'developer' }],
        staffable: ['own-team'],
      });

      const error = await catchRpc(accept());

      expect(error).toBeInstanceOf(RpcException);
      expect(error.getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation is no longer valid',
      });
      expect(uomRepo.save).not.toHaveBeenCalled();
      expect(authorizationService.organizationAddMember).not.toHaveBeenCalled();
      expect(teamService.addMember).not.toHaveBeenCalled();
      expect(invRepo.save).not.toHaveBeenCalled();
    });

    it('refuses an invitation whose inviter has left the organization', async () => {
      arrangeAccept({ role: 'member', inviterRole: null });

      const error = await catchRpc(accept());

      expect(error.getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation is no longer valid',
      });
      expect(uomRepo.save).not.toHaveBeenCalled();
      expect(invRepo.save).not.toHaveBeenCalled();
    });

    it('seats nobody when another acceptance consumed the invitation first', async () => {
      arrangeAccept({ role: 'member' });
      // The conditional update pending -> accepted matched no row.
      invRepo.update!.mockResolvedValueOnce({ affected: 0 } as never);

      const error = await catchRpc(accept());

      expect(error.getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has already been accepted or canceled',
      });
      expect(invRepo.update).toHaveBeenCalledWith(
        { id: 'inv-1', status: 'pending' },
        expect.objectContaining({ status: 'accepted' }),
      );
      expect(uomRepo.save).not.toHaveBeenCalled();
      expect(authorizationService.organizationAddMember).not.toHaveBeenCalled();
    });

    it('consumes the invitation before seating the member, and reopens it when seating fails', async () => {
      arrangeAccept({ role: 'member' });
      authorizationService.organizationAddMember.mockRejectedValueOnce(
        new RpcException({ code: status.UNAVAILABLE, message: 'down' }),
      );

      const error = await catchRpc(accept());

      expect(error.getError()).toEqual({
        code: status.UNAVAILABLE,
        message: 'down',
      });
      expect(invRepo.update.mock.calls).toEqual([
        [
          { id: 'inv-1', status: 'pending' },
          { status: 'accepted', acceptedAt: null },
        ],
        [
          { id: 'inv-1', status: 'accepted', acceptedAt: IsNull() },
          { status: 'pending', acceptedAt: null },
        ],
      ]);
      // Every role of the user went before the row, so reopening is safe.
      expect(
        authorizationService.organizationRemoveMember,
      ).toHaveBeenCalledWith({
        organizationId: 'o1',
        userId: INVITEE.id,
      });
      expect(
        authorizationService.organizationRemoveMember.mock
          .invocationCallOrder[0],
      ).toBeLessThan(uomRepo.remove.mock.invocationCallOrder[0]);
      // The consuming update ran before the membership was written.
      expect(invRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
        uomRepo.save.mock.invocationCallOrder[0],
      );
    });

    it('does not seat the invitee in a team its inviter cannot add members to', async () => {
      arrangeAccept({
        teamAssignments: [{ teamId: 'unreachable-team', role: 'team_manager' }],
      });

      await expect(accept()).resolves.toMatchObject({
        message: 'Invitation accepted successfully',
      });

      expect(authorizationService.canAddTeamMember).toHaveBeenCalledWith(
        'unreachable-team',
        INVITER,
      );
      expect(teamService.addMember).not.toHaveBeenCalled();
    });

    it('seats the invitee only in the teams its inviter may still staff', async () => {
      arrangeAccept({
        teamAssignments: [
          { teamId: 'own-team', role: 'developer' },
          { teamId: 'unreachable-team', role: 'team_manager' },
        ],
        staffable: ['own-team'],
      });

      await accept();

      expect(teamService.addMember).toHaveBeenCalledTimes(1);
      expect(teamService.addMember).toHaveBeenCalledWith({
        teamId: 'own-team',
        userId: INVITEE.id,
        role: 'developer',
      });
    });

    it('seats nobody when Permify cannot answer, and the invitee still joins the organization', async () => {
      arrangeAccept({
        teamAssignments: [{ teamId: 'own-team', role: 'developer' }],
        staffable: ['own-team'],
      });
      authorizationService.canAddTeamMember.mockRejectedValue(
        new RpcException({
          code: status.UNAVAILABLE,
          message: 'Authorization service unavailable',
        }),
      );

      await expect(accept()).resolves.toMatchObject({
        message: 'Invitation accepted successfully',
      });
      expect(teamService.addMember).not.toHaveBeenCalled();
    });

    /**
     * The Community Edition gives nobody the billing manager role: a pending
     * invitation to it, created before, is refused
     * ROLE_NOT_AVAILABLE and grants nothing. The cloud accepts it as before.
     */
    describe('a pending invitation as billing manager', () => {
      const saved = process.env.CYBEDEFEND_EDITION;
      afterEach(() => {
        if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
        else process.env.CYBEDEFEND_EDITION = saved;
      });

      it('the Community Edition refuses it ROLE_NOT_AVAILABLE and writes nothing', async () => {
        process.env.CYBEDEFEND_EDITION = 'community';
        arrangeAccept({ role: 'billing_manager', inviterRole: 'creator' });

        const error = await catchRpc(accept());

        expect(error.getError()).toEqual({
          code: status.FAILED_PRECONDITION,
          message: 'ROLE_NOT_AVAILABLE',
        });
        expect(uomRepo.save).not.toHaveBeenCalled();
        expect(
          authorizationService.organizationAddMember,
        ).not.toHaveBeenCalled();
        expect(invRepo.save).not.toHaveBeenCalled();
      });

      // The closed edition pins its own acceptance: this tree reads community
      // whatever the variable says.
    });
  });

  /**
   * The invitee opening the link while signed in under another address used to
   * read "Invitation not found", as if the link were dead, with nothing telling
   * them to switch accounts. The refusal must say which of the two it is,
   * without revealing the invited address to whoever holds the account.
   */
  describe('acceptInvitationFromOrganization: a refused token says why', () => {
    const SIGNED_IN = { id: 'user-1', email: 'personal@example.com' };
    const INVITED_EMAIL = 'work@example.com';

    /**
     * Like the table: the acceptance lookup filters on the token AND the
     * address, so it misses an account signed in under another one.
     * `invitationToken` is the token the stored invitation carries (null: none);
     * `state` overrides its lifecycle fields.
     */
    const arrangeInvitation = (
      invitationToken: string | null,
      state: { status?: string; expiresAt?: Date } = {},
    ) => {
      userRepo.findOne!.mockResolvedValue(SIGNED_IN);
      invRepo.findOne!.mockImplementation(
        async ({
          where,
        }: {
          where: { tokenHash?: string; email?: string };
        }) => {
          if (
            invitationToken === null ||
            where.tokenHash !== tokenHash(invitationToken)
          ) {
            return null;
          }
          if (where.email !== undefined && where.email !== INVITED_EMAIL) {
            return null;
          }
          return {
            id: 'inv-1',
            tokenHash: tokenHash(invitationToken),
            email: INVITED_EMAIL,
            role: 'member',
            status: 'pending',
            expiresAt: new Date(Date.now() + 3600 * 1000),
            organization: { id: 'o1', name: 'Org' },
            invitedBy: { id: 'inviter-1' },
            ...state,
          };
        },
      );
    };

    const accept = () =>
      service.acceptInvitationFromOrganization({
        token: 'tok',
        userId: SIGNED_IN.id,
      });

    it('tells an account signed in under another address that the invitation was sent to a different one, and writes nothing', async () => {
      arrangeInvitation('tok');

      const error = await catchRpc(accept());

      expect(error).toBeInstanceOf(RpcException);
      expect(error.getError()).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'This invitation was sent to a different email address',
      });
      expect(JSON.stringify(error.getError())).not.toContain(INVITED_EMAIL);
      expect(uomRepo.save).not.toHaveBeenCalled();
      expect(authorizationService.organizationAddMember).not.toHaveBeenCalled();
      expect(invRepo.save).not.toHaveBeenCalled();
    });

    it('still answers NOT_FOUND for a token no invitation carries', async () => {
      arrangeInvitation(null);

      const error = await catchRpc(accept());

      expect(error.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Invitation not found',
      });
    });

    // Switching accounts cannot revive a settled invitation: saying "wrong
    // address" would only send the invitee on a useless round trip.
    it('refuses an expired invitation sent to another address as expired', async () => {
      arrangeInvitation('tok', { expiresAt: new Date(Date.now() - 1000) });

      const error = await catchRpc(accept());

      expect(error.getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has expired',
      });
    });

    it('refuses a canceled invitation sent to another address as settled', async () => {
      arrangeInvitation('tok', { status: 'canceled' });

      const error = await catchRpc(accept());

      expect(error.getError()).toEqual({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has already been accepted or canceled',
      });
    });
  });

  it('getOrganizationInvitations returns mapped pending invites', async () => {
    invRepo.find!.mockResolvedValue([
      {
        id: 'inv1',
        email: 'a@b',
        status: 'pending',
        organization: { id: 'o1', name: 'Org' },
        role: 'member',
        expiresAt: new Date(),
      },
    ]);
    const res = await service.getOrganizationInvitations({
      organizationId: 'o1',
    } as any);
    expect(res.invitations.length).toBe(1);
    expect(res.invitations[0].organizationName).toBe('Org');
  });

  it('cancelInvitation marks as canceled when invitation belongs to the path org', async () => {
    const invite = {
      id: 'inv1',
      email: 'a@b',
      status: 'pending',
      organization: { id: 'o1', name: 'Org' },
      role: 'member',
      expiresAt: new Date(),
    };
    // Real-DB-like behaviour: returns the invite only when the where filter
    // actually matches BOTH the invite id and the organization id.
    invRepo.findOne!.mockImplementation(async ({ where }: any) => {
      const idMatches = where?.id === invite.id;
      const orgFilter = where?.organization?.id;
      if (!idMatches) return null;
      // If service correctly scopes by org and they match, return the invite.
      // If service forgot the org filter, the row would still come back from
      // SQL — but we want the service to scope, so we DO return it here too,
      // covering the legitimate same-org case.
      if (orgFilter === undefined || orgFilter === invite.organization.id) {
        return invite;
      }
      return null;
    });
    invRepo.save!.mockImplementation(async (i: any) => i);
    const res = await service.cancelInvitation({
      organizationId: 'o1',
      invitationId: 'inv1',
    } as any);
    expect(res.status).toBe('canceled');
  });

  it('cancelInvitation rejects with NOT_FOUND when invitation belongs to a different organization', async () => {
    // Invitation belongs to org 'oB' while the caller passes org 'oA' in the path.
    const inviteOfOrgB = {
      id: 'inv-from-orgB',
      email: 'invitee@b',
      status: 'pending',
      organization: { id: 'oB', name: 'Org B' },
      role: 'member',
      expiresAt: new Date(),
    };
    // Mock simulates a REAL TypeORM repo:
    // - if the service does NOT pass an organization filter, the row is returned (bug)
    // - if the service DOES pass organization.id and it does not match, returns null
    invRepo.findOne!.mockImplementation(async ({ where }: any) => {
      const idMatches = where?.id === inviteOfOrgB.id;
      const orgFilter = where?.organization?.id;
      if (!idMatches) return null;
      if (
        orgFilter !== undefined &&
        orgFilter !== inviteOfOrgB.organization.id
      ) {
        return null;
      }
      return inviteOfOrgB;
    });

    await expect(
      service.cancelInvitation({
        organizationId: 'oA',
        invitationId: 'inv-from-orgB',
      } as any),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ message: 'Invitation not found' }),
    });
    expect(invRepo.save).not.toHaveBeenCalled();
  });

  it('getOrganizationById returns organization info', async () => {
    orgRepo.findOne!.mockResolvedValue({
      id: 'o1',
      name: 'Org',
      industry: 'IT',
      country: 'FR',
      concurrentScanLimit: 1,
    });
    const res = await service.getOrganizationById({
      organizationId: 'o1',
    } as any);
    expect(res.name).toBe('Org');
    expect(res.country).toBe('FR');
  });

  it('getOrganizations returns list for user', async () => {
    orgRepo.find!.mockResolvedValue([
      {
        id: 'o1',
        name: 'Org',
        industry: 'IT',
        country: 'FR',
        concurrentScanLimit: 1,
      },
    ]);
    const res = await service.getOrganizations({ userId: 'u1' } as any);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('o1');
  });

  // An organisation is created with no product and no trial: activating a
  // product happens later, outside this service (closed extension).
  describe('createOrganization (no product, no trial)', () => {
    const validRequest = {
      creatorId: 'user-1',
      name: 'Acme',
      industry: 'IT',
      country: 'FR',
    };

    const setupHappyPath = () => {
      userRepo.findOne!.mockResolvedValue({ id: 'user-1' });
      orgRepo.findOne!.mockResolvedValue(null); // no existing org for creator
      // dataSource.transaction(cb) calls cb with a manager mock
      dataSource.transaction.mockImplementation(async (cb: any) => {
        const createdOrg = {
          id: 'org-new',
          name: validRequest.name,
          industry: validRequest.industry,
          country: validRequest.country,
        };
        const manager: any = {
          create: jest.fn((_entity: any, data: any) => ({ ...data })),
          save: jest.fn().mockResolvedValue(createdOrg),
        };
        return cb(manager);
      });
    };

    // The org-creation form asks for a name only: there is nothing to invoice
    // at creation, so no billing profile is demanded.
    describe('without a billing profile', () => {
      const nameOnlyRequest = { creatorId: 'user-1', name: 'Acme' };

      it('persists non-null values for the NOT NULL industry/country columns', async () => {
        userRepo.findOne!.mockResolvedValue({ id: 'user-1' });
        orgRepo.findOne!.mockResolvedValue(null);
        let capturedCreateArgs: any = null;
        dataSource.transaction.mockImplementation(async (cb: any) => {
          const manager: any = {
            create: jest.fn((_entity: any, data: any) => {
              capturedCreateArgs = data;
              return { ...data };
            }),
            save: jest.fn().mockResolvedValue({ id: 'org-new', name: 'Acme' }),
          };
          return cb(manager);
        });

        await service.createOrganization(nameOnlyRequest as any);

        expect(capturedCreateArgs.industry).toBe('');
        expect(capturedCreateArgs.country).toBe('');
      });

      // The gateway may default the country from the sign-up request. It
      // arrives with no address at all, and must still reach the
      // organization.
      it('keeps a country that comes without any address', async () => {
        userRepo.findOne!.mockResolvedValue({ id: 'user-1' });
        orgRepo.findOne!.mockResolvedValue(null);
        let capturedCreateArgs: any = null;
        dataSource.transaction.mockImplementation(async (cb: any) => {
          const manager: any = {
            create: jest.fn((_entity: any, data: any) => {
              capturedCreateArgs = data;
              return { ...data };
            }),
            save: jest.fn().mockResolvedValue({
              id: 'org-new',
              name: 'Acme',
              country: 'US',
            }),
          };
          return cb(manager);
        });

        await service.createOrganization({
          ...nameOnlyRequest,
          country: 'US',
        } as any);

        expect(capturedCreateArgs.country).toBe('US');
      });
    });

    // The fixture's default ENTITLEMENTS_PORT answers the community creation
    // state (true/false/false/false); the community values are pinned in
    // organization.service.community-creation.spec.ts, the closed edition
    // pins its own.
    it('seeds the organisation product attributes in Permify in one write, from the edition creation state', async () => {
      setupHappyPath();

      await service.createOrganization(validRequest as any);

      expect(
        authorizationService.initializeOrganizationProducts,
      ).toHaveBeenCalledWith('org-new', {
        isActive: true,
        writesBlocked: false,
        vibedefendActive: false,
        memberProducts: false,
      });
      // The read-before-write of is_active alone is replaced by the single
      // write of the product attributes.
      expect(authorizationService.setOrganizationActive).not.toHaveBeenCalled();
    });

    it('rolls the organisation back when Permify refuses its product attributes', async () => {
      setupHappyPath();
      authorizationService.initializeOrganizationProducts.mockRejectedValueOnce(
        new Error('PERMIFY_DOWN'),
      );

      await expect(
        service.createOrganization(validRequest as any),
      ).rejects.toThrow('PERMIFY_DOWN');

      expect(orgRepo.delete).toHaveBeenCalledWith('org-new');
    });

    // With no trial at creation the row stays inactive: a later product
    // activation mirrors isActive back.
    it('never marks the organization active at creation', async () => {
      setupHappyPath();

      await service.createOrganization(validRequest as any);

      const activations = orgRepo.update!.mock.calls.filter(
        ([, patch]) => (patch as Partial<Organization>)?.isActive === true,
      );
      expect(activations).toEqual([]);
    });

    // The side effects of a creation are the edition's:
    // ORGANIZATION_LIFECYCLE_HOOKS. The core awaits them once the default team
    // exists and before it answers.
    it('answers organisation creation with the hooks settled', async () => {
      setupHappyPath();
      const order: string[] = [];
      teamService.createTeam.mockImplementationOnce(async () => {
        order.push('team');
        return { id: 't1', name: 'Default team' };
      });
      let settleHooks!: () => void;
      lifecycleHooks.afterOrganizationCreated.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            order.push('hooks');
            settleHooks = () => {
              order.push('hooks settled');
              resolve();
            };
          }),
      );

      const creation = service
        .createOrganization(validRequest as any)
        .then((response) => {
          order.push('answered');
          return response;
        });
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      expect(order).toEqual(['team', 'hooks']);
      settleHooks();
      await creation;
      expect(order).toEqual(['team', 'hooks', 'hooks settled', 'answered']);
      expect(lifecycleHooks.afterOrganizationCreated).toHaveBeenCalledWith({
        organization: expect.objectContaining({ id: 'org-new' }),
        creator: { id: 'user-1' },
        request: validRequest,
      });
    });

    it('creates an organisation in community mode without growth calls', async () => {
      ({ service, userRepo, orgRepo, dataSource } =
        await buildOrganizationService({
          providers: [...ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS],
        }));
      setupHappyPath();

      await expect(
        service.createOrganization(validRequest as any),
      ).resolves.toEqual({
        message: 'Organization created successfully',
        organizationId: 'org-new',
        name: 'Acme',
        industry: 'IT',
      });
    });

    it('still creates the org when attribution is absent', async () => {
      userRepo.findOne!.mockResolvedValue({ id: 'u1' });
      orgRepo.findOne!.mockResolvedValue(null);
      dataSource.transaction.mockImplementation(async (cb: any) => {
        const createdOrg = { id: 'org-noattr', name: 'NoAttr' };
        const manager: any = {
          create: jest.fn((_entity: any, data: any) => ({ ...data })),
          save: jest.fn().mockResolvedValue(createdOrg),
        };
        return cb(manager);
      });

      const req: any = {
        name: 'NoAttr',
        industry: 'software',
        country: 'FR',
        creatorId: 'u1',
      };
      await expect(service.createOrganization(req)).resolves.toBeDefined();
    });
  });

  // An update re-syncs only what it changed: the Logto organization carries
  // the name alone, so an update that does not change the name does not touch
  // it.
  describe('realtime events', () => {
    it('updateMemberRole publishes MEMBERSHIP_CHANGED with changeType role_changed', async () => {
      // The target u1, and the creator c1 who promotes them.
      uomRepo.findOne!.mockImplementation(async (options: any) =>
        options?.where?.user?.id === 'c1'
          ? { role: 'creator', user: { id: 'c1' } }
          : {
              role: 'member',
              user: { id: 'u1', logtoUserId: null },
              organization: { id: 'o1' },
            },
      );
      uomRepo.save!.mockImplementation(async (m: any) => m);

      await service.updateMemberRole({
        organizationId: 'o1',
        userId: 'u1',
        role: 'administrator',
        updatedBy: 'c1',
      } as any);

      expect(realtimePublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MEMBERSHIP_CHANGED',
          scope: expect.objectContaining({
            organizationId: 'o1',
            userId: 'u1',
          }),
          payload: expect.objectContaining({
            membershipChanged: expect.objectContaining({
              changeType: 'role_changed',
              scopeType: 'organization',
            }),
          }),
        }),
      );
    });

    it('deleteMember publishes MEMBERSHIP_CHANGED with changeType removed', async () => {
      orgRepo.findOne!.mockResolvedValue({
        id: 'o1',
        userMemberships: [
          { user: { id: 'c1', logtoUserId: null }, role: 'creator' },
          {
            user: { id: 'u2', logtoUserId: null },
            role: 'member',
          },
        ],
      });
      uomRepo.remove!.mockResolvedValue(undefined);
      utmRepo.find!.mockResolvedValue([]);

      await service.deleteMember({
        organizationId: 'o1',
        userId: 'u2',
        removedBy: 'c1',
      } as any);

      expect(realtimePublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MEMBERSHIP_CHANGED',
          scope: expect.objectContaining({
            organizationId: 'o1',
            userId: 'u2',
          }),
          payload: expect.objectContaining({
            membershipChanged: expect.objectContaining({
              changeType: 'removed',
              scopeType: 'organization',
            }),
          }),
        }),
      );
    });
  });

  describe('the identity provider mirror', () => {
    const givenNewMember = async () => {
      const t = await buildOrganizationService();
      t.userRepo.findOne!.mockResolvedValue({
        id: 'u2',
        email: 'new-member@example.invalid',
        logtoUserId: 'lu2',
      });
      t.orgRepo.findOne!.mockResolvedValue({
        id: 'o1',
        name: 'Org',
      });
      t.uomRepo.findOne!.mockResolvedValue(null);
      t.uomRepo.save!.mockImplementation(async (m: unknown) => m);
      return t;
    };
    const request = {
      organizationId: 'o1',
      email: 'new-member@example.invalid',
      role: 'member',
    };

    it('asks the identity provider to mirror each membership change', async () => {
      const t = await givenNewMember();

      await t.service.addMemberOrganization(request);

      expect(t.identity.memberAdded).toHaveBeenCalledTimes(1);
      expect(t.identity.memberAdded).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'o1', name: 'Org' }),
        expect.objectContaining({ id: 'u2', logtoUserId: 'lu2' }),
        'member',
      );

      const skipped = await givenNewMember();
      await skipped.service.addMemberOrganization(request, {
        skipLogtoSync: true,
      });

      expect(skipped.identity.memberAdded).not.toHaveBeenCalled();
    });
  });

  describe('cancelAllPendingInvitations', () => {
    it('cancels every pending non-expired invitation for the org and returns the count', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      const invites = [
        {
          id: 'inv-1',
          email: 'a@x',
          status: 'pending',
          organization: { id: 'o1', name: 'Org' },
          role: 'member',
          expiresAt: future,
        },
        {
          id: 'inv-2',
          email: 'b@x',
          status: 'pending',
          organization: { id: 'o1', name: 'Org' },
          role: 'member',
          expiresAt: future,
        },
      ];
      invRepo.find!.mockResolvedValue(invites);
      // cancelInvitation reads each invite by id then saves it
      invRepo.findOne!.mockImplementation(
        async ({ where }: any) =>
          invites.find((i) => i.id === where.id) ?? null,
      );
      invRepo.save!.mockImplementation(async (i: any) => i);

      const res = await service.cancelAllPendingInvitations({
        organizationId: 'o1',
      } as any);

      expect(res.cancelledCount).toBe(2);
      expect(invRepo.save).toHaveBeenCalledTimes(2);
      // Each invite was flipped to 'canceled' before save
      const saved = (invRepo.save as jest.Mock).mock.calls.map(
        (c) => c[0].status,
      );
      expect(saved).toEqual(['canceled', 'canceled']);
    });

    it('returns count 0 when there are no pending invitations', async () => {
      invRepo.find!.mockResolvedValue([]);
      const res = await service.cancelAllPendingInvitations({
        organizationId: 'o1',
      } as any);
      expect(res.cancelledCount).toBe(0);
      expect(invRepo.save).not.toHaveBeenCalled();
    });

    it('continues cancelling siblings when one cancelInvitation throws', async () => {
      const future = new Date(Date.now() + 3600 * 1000);
      const invites = [
        {
          id: 'inv-1',
          email: 'a@x',
          status: 'pending',
          organization: { id: 'o1', name: 'Org' },
          role: 'member',
          expiresAt: future,
        },
        {
          id: 'inv-2',
          email: 'b@x',
          status: 'pending',
          organization: { id: 'o1', name: 'Org' },
          role: 'member',
          expiresAt: future,
        },
      ];
      invRepo.find!.mockResolvedValue(invites);
      invRepo.findOne!.mockImplementation(
        async ({ where }: any) =>
          invites.find((i) => i.id === where.id) ?? null,
      );
      let firstSaveCalled = false;
      invRepo.save!.mockImplementation(async (i: any) => {
        if (!firstSaveCalled) {
          firstSaveCalled = true;
          throw new Error('db blip');
        }
        return i;
      });

      const res = await service.cancelAllPendingInvitations({
        organizationId: 'o1',
      } as any);

      // Only the second invite cancelled successfully
      expect(res.cancelledCount).toBe(1);
      expect(invRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('confirmOrganizationDeletion records its purge jobs', () => {
    const manager = { delete: jest.fn(async () => ({ affected: 1 })) };
    let tx: { committed: boolean; rolledBack: boolean };

    beforeEach(() => {
      manager.delete.mockClear();
      orgRepo.findOne!.mockResolvedValue({ id: 'o1', name: 'Org' });
      teamRepo.find!.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      projectRepo.find!.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      tx = { committed: false, rolledBack: false };
      dataSource.transaction.mockImplementation(async (fn: any) => {
        try {
          const result = await fn(manager);
          tx.committed = true;
          return result;
        } catch (err) {
          tx.rolledBack = true;
          throw err;
        }
      });
    });

    it('reads the team and project ids before deleting the organization', async () => {
      await service.confirmOrganizationDeletion({
        organizationId: 'o1',
      } as any);

      const readTeams = teamRepo.find!.mock.invocationCallOrder[0];
      const readProjects = projectRepo.find!.mock.invocationCallOrder[0];
      const deleted = manager.delete.mock.invocationCallOrder[0];
      expect(readTeams).toBeLessThan(deleted);
      expect(readProjects).toBeLessThan(deleted);
      expect(purgeLedger.enqueueOrganization).toHaveBeenCalledWith(manager, {
        organizationId: 'o1',
        teamIds: ['t1', 't2'],
        projectIds: ['p1', 'p2'],
      });
    });

    it('deletes the organization and records its jobs in one transaction', async () => {
      const res = await service.confirmOrganizationDeletion({
        organizationId: 'o1',
      } as any);

      expect(res.message).toContain('deleted successfully');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(tx.committed).toBe(true);
      expect(manager.delete).toHaveBeenCalledWith(Organization, 'o1');
      expect(
        purgeLedger.enqueueOrganization.mock.invocationCallOrder[0],
      ).toBeGreaterThan(manager.delete.mock.invocationCallOrder[0]);
      expect(orgRepo.delete).not.toHaveBeenCalled();
    });

    it('kicks the purge runner with every job once the transaction is committed', async () => {
      purgeLedger.enqueueOrganization.mockResolvedValueOnce([
        'job-o1',
        'job-p1',
        'job-p2',
      ]);
      // Recorded here, asserted below: the service's own try/catch around
      // the kick would swallow a failing expect.
      let committedAtKick: boolean | null = null;
      purgeRunner.kick.mockImplementation(() => {
        committedAtKick = tx.committed;
      });

      await service.confirmOrganizationDeletion({
        organizationId: 'o1',
      } as any);

      expect(purgeRunner.kick).toHaveBeenCalledTimes(1);
      // Never inside the transaction: a failing kick cannot undo it.
      expect(committedAtKick).toBe(true);
      expect(purgeRunner.kick).toHaveBeenCalledWith([
        'job-o1',
        'job-p1',
        'job-p2',
      ]);
    });

    it('a kick that throws never undoes the organization deletion', async () => {
      purgeRunner.kick.mockImplementation(() => {
        throw new Error('runner down');
      });

      const res = await service.confirmOrganizationDeletion({
        organizationId: 'o1',
      } as any);

      expect(res.message).toContain('deleted successfully');
      expect(tx.committed).toBe(true);
    });

    it('a failing job insert rejects the call and keeps the organization', async () => {
      purgeLedger.enqueueOrganization.mockRejectedValueOnce(
        new Error('ER_LOCK_DEADLOCK'),
      );

      await expect(
        service.confirmOrganizationDeletion({ organizationId: 'o1' } as any),
      ).rejects.toThrow('ER_LOCK_DEADLOCK');

      expect(tx.rolledBack).toBe(true);
      expect(purgeRunner.kick).not.toHaveBeenCalled();
      expect(orgRepo.delete).not.toHaveBeenCalled();
    });

    it('a failing Permify removal deletes nothing and enqueues nothing', async () => {
      (
        authorizationService as unknown as { removeOrganization: jest.Mock }
      ).removeOrganization.mockRejectedValueOnce(new Error('permify down'));

      await expect(
        service.confirmOrganizationDeletion({ organizationId: 'o1' } as any),
      ).rejects.toThrow('permify down');

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(purgeLedger.enqueueOrganization).not.toHaveBeenCalled();
      expect(identity.organizationDeleted).not.toHaveBeenCalled();
    });

    // The integrations are the `integrations` step of the organization job
    // (external-integrations PurgeOrganizationData), never a synchronous
    // best-effort call whose failure would only be logged.
    it('no longer calls the downstream services directly', async () => {
      await service.confirmOrganizationDeletion({
        organizationId: 'o1',
      } as any);

      expect(deleteIntegrationsForOrg).not.toHaveBeenCalled();
    });

    // Organization deletion confirmation: creator only, with the
    // code e-mailed to them, verified and consumed before anything else.
    describe('the confirmation code', () => {
      const asked = {
        organizationId: 'o1',
        requestedBy: 'u-creator',
        confirmationCode: '123456',
      };

      it('loads the creator and checks the code before anything else of the deletion', async () => {
        await service.confirmOrganizationDeletion(asked);

        expect(orgRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'o1' },
          relations: { creator: true },
        });
        expect(deletionCodes.confirm).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'o1' }),
          'u-creator',
          '123456',
        );
        const confirmed = deletionCodes.confirm.mock.invocationCallOrder[0];
        expect(confirmed).toBeLessThan(
          teamRepo.find!.mock.invocationCallOrder[0],
        );
        expect(confirmed).toBeLessThan(
          (
            authorizationService as unknown as {
              removeOrganization: jest.Mock;
            }
          ).removeOrganization.mock.invocationCallOrder[0],
        );
      });

      it.each([
        'NOT_ORGANIZATION_CREATOR',
        'DELETION_CODE_INVALID',
        'DELETION_LOCKED',
      ])(
        'a refusal (%s) deletes nothing: no Permify call, no transaction',
        async (code) => {
          deletionCodes.confirm.mockRejectedValueOnce(
            new RpcException({ code: status.INVALID_ARGUMENT, message: code }),
          );

          await expect(
            service.confirmOrganizationDeletion(asked),
          ).rejects.toThrow(code);

          expect(
            (
              authorizationService as unknown as {
                removeOrganization: jest.Mock;
              }
            ).removeOrganization,
          ).not.toHaveBeenCalled();
          expect(dataSource.transaction).not.toHaveBeenCalled();
          expect(identity.organizationDeleted).not.toHaveBeenCalled();
          expect(purgeLedger.enqueueOrganization).not.toHaveBeenCalled();
          expect(purgeRunner.kick).not.toHaveBeenCalled();
        },
      );

      it('with the real check: a valid code deletes once, and cannot be reused', async () => {
        const store = new InMemoryOrganizationDeletionCodeStore();
        const mail = {
          sendOrganizationDeletionCodeEmail: jest.fn(async () => undefined),
          sendOrganizationDeletionLockedEmail: jest.fn(async () => undefined),
        };
        const creatorOrg = {
          id: 'o1',
          name: 'Org',
          creator: { id: 'u-creator', email: 'creator@example.com' },
        };
        orgRepo.findOne!.mockResolvedValue(creatorOrg);
        const real = new OrganizationDeletionCodeService(
          orgRepo as never,
          store,
          mail as unknown as MailService,
          logger as unknown as Logger,
        );
        (service as unknown as { deletionCodes: unknown }).deletionCodes = real;

        // Without a code, or with a wrong one: nothing happens.
        await expect(
          service.confirmOrganizationDeletion({
            organizationId: 'o1',
            requestedBy: 'u-creator',
            confirmationCode: '',
          }),
        ).rejects.toThrow('DELETION_CODE_INVALID');
        expect(dataSource.transaction).not.toHaveBeenCalled();

        await real.requestCode({
          organizationId: 'o1',
          requestedBy: 'u-creator',
        });
        const code = (
          mail.sendOrganizationDeletionCodeEmail.mock.calls as unknown as [
            { code: string },
          ][]
        )[0][0].code;

        await expect(
          service.confirmOrganizationDeletion({
            organizationId: 'o1',
            requestedBy: 'u-admin',
            confirmationCode: code,
          }),
        ).rejects.toThrow('NOT_ORGANIZATION_CREATOR');
        expect(dataSource.transaction).not.toHaveBeenCalled();

        const res = await service.confirmOrganizationDeletion({
          organizationId: 'o1',
          requestedBy: 'u-creator',
          confirmationCode: code,
        });
        expect(res.message).toContain('deleted successfully');
        expect(dataSource.transaction).toHaveBeenCalledTimes(1);

        await expect(
          service.confirmOrganizationDeletion({
            organizationId: 'o1',
            requestedBy: 'u-creator',
            confirmationCode: code,
          }),
        ).rejects.toThrow('DELETION_CODE_INVALID');
        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      });
    });
  });

  // An older gateway may still call Delete, without a code. It is
  // refused whatever it carries, so that nothing deletes an organization
  // but ConfirmOrganizationDeletion.
  describe('deleteOrganization (the former RPC)', () => {
    it.each([
      [{ organizationId: 'o1' }],
      [
        {
          organizationId: 'o1',
          requestedBy: 'u-creator',
          confirmationCode: '123456',
        },
      ],
    ])(
      'refuses %j with NOT_ORGANIZATION_CREATOR and deletes nothing',
      async (request) => {
        orgRepo.findOne!.mockResolvedValue({
          id: 'o1',
          name: 'Org',
          creator: { id: 'u-creator' },
        });
        const thrown = await service
          .deleteOrganization(request as never)
          .catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(RpcException);
        expect((thrown as RpcException).getError()).toEqual({
          code: status.PERMISSION_DENIED,
          message: 'NOT_ORGANIZATION_CREATOR',
        });
        expect(deletionCodes.confirm).not.toHaveBeenCalled();
        expect(orgRepo.findOne).not.toHaveBeenCalled();
        expect(teamRepo.find).not.toHaveBeenCalled();
        expect(
          (authorizationService as unknown as { removeOrganization: jest.Mock })
            .removeOrganization,
        ).not.toHaveBeenCalled();
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(identity.organizationDeleted).not.toHaveBeenCalled();
        expect(purgeLedger.enqueueOrganization).not.toHaveBeenCalled();
      },
    );
  });

  describe('requestOrganizationDeletionCode', () => {
    it('hands the request to the deletion code service', async () => {
      deletionCodes.requestCode.mockResolvedValueOnce({
        expiresAt: '2026-10-27T10:10:00.000Z',
      });
      await expect(
        service.requestOrganizationDeletionCode({
          organizationId: 'o1',
          requestedBy: 'u-creator',
        }),
      ).resolves.toEqual({ expiresAt: '2026-10-27T10:10:00.000Z' });
      expect(deletionCodes.requestCode).toHaveBeenCalledWith({
        organizationId: 'o1',
        requestedBy: 'u-creator',
      });
    });
  });

  // The gateway checks a /team/:teamId/* route against the features of the
  // team's own organization, which it asks this service for.
  describe('getOrganizationIdByTeamId', () => {
    it('returns the organization the team belongs to', async () => {
      teamRepo.findOne!.mockResolvedValue({
        id: 't1',
        organization: { id: 'o1' },
      });

      await expect(service.getOrganizationIdByTeamId('t1')).resolves.toEqual({
        organizationId: 'o1',
      });
      expect(teamRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' } }),
      );
    });

    it('answers NOT_FOUND for an unknown team', async () => {
      teamRepo.findOne!.mockResolvedValue(null);

      const thrown = await service
        .getOrganizationIdByTeamId('unknown')
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toMatchObject({ code: status.NOT_FOUND });
    });

    it('answers INVALID_ARGUMENT without a team id, before any read', async () => {
      const thrown = await service
        .getOrganizationIdByTeamId('')
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toMatchObject({
        code: status.INVALID_ARGUMENT,
      });
      expect(teamRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // policy-management resolves a project's team for its effective policy
  // through this call rather than a full ProjectService/Get: the query below
  // already loads the team.
  describe('getOrganizationIdByProjectId', () => {
    // The read itself is a QueryBuilder projection.
    const projectRead = () =>
      projectRepo.createQueryBuilder!() as unknown as { getRawOne: jest.Mock };

    it("returns the project's organization and team from one read", async () => {
      projectRead().getRawOne.mockResolvedValue({
        organizationId: 'o1',
        teamId: 't1',
      });

      await expect(service.getOrganizationIdByProjectId('p1')).resolves.toEqual(
        { organizationId: 'o1', teamId: 't1' },
      );
      expect(projectRead().getRawOne).toHaveBeenCalledTimes(1);
    });

    it('answers NOT_FOUND for an unknown project', async () => {
      projectRead().getRawOne.mockResolvedValue(undefined);

      const thrown = await service
        .getOrganizationIdByProjectId('unknown')
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toMatchObject({ code: status.NOT_FOUND });
    });
  });

  // The project → organization reads are projections: `findOne` with
  // relations would issue a `SELECT DISTINCT distinctAlias` pre-query, then a
  // read of the ~110 columns of the project, its team and its organization.
  // These tests run the real TypeORM SQL against a recording query runner.
  describe('project → organization reads', () => {
    let statements: CapturedStatement[];
    let setResponder: (next: CaptureResponder) => void;
    const stored: Record<string, unknown> = {
      organizationId: 'o1',
      teamId: 't1',
      project_id: 'p1',
      team_id: 't1',
      organization_id: 'o1',
      organization_name: 'Org',
      organization_industry: 'IT',
      organization_country: 'FR',
      organization_concurrentScanLimit: 3,
      id: 'p1',
    };

    beforeEach(async () => {
      const capture = await createSqlCaptureDataSource((s) =>
        /^\s*SELECT/i.test(s.sql) ? [rawRow(s.sql, stored)] : [],
      );
      statements = capture.statements;
      setResponder = capture.setResponder;
      const real = capture.dataSource.getRepository(Project);
      projectRepo.findOne = jest.fn((options) => real.findOne(options));
      projectRepo.createQueryBuilder = jest.fn((alias?: string) =>
        real.createQueryBuilder(alias),
      );
    });

    it('getOrganizationIdByProjectId reads only the organization and team ids, with one SELECT', async () => {
      const res = await service
        .getOrganizationIdByProjectId('p1')
        .catch(() => undefined);

      expect(selects(statements)).toHaveLength(1);
      const [read] = selects(statements);
      expect(read.sql).not.toMatch(/DISTINCT/);
      expect(read.sql).toMatch(/INNER JOIN `team`/);
      expect(selectedAliases(read.sql).sort()).toEqual([
        'organizationId',
        'teamId',
      ]);
      expect(read.params).toEqual(['p1']);
      expect(res).toEqual({ organizationId: 'o1', teamId: 't1' });
    });

    it('getOrganizationIdByProjectId still answers NOT_FOUND for an unknown project', async () => {
      setResponder(() => []);

      const thrown = await service
        .getOrganizationIdByProjectId('unknown')
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
      expect(selects(statements)).toHaveLength(1);
    });

    it('getOrganizationByProject reads the project, its team and its organization with one SELECT', async () => {
      const res = await service
        .getOrganizationByProject('p1')
        .catch(() => undefined);

      expect(selects(statements)).toHaveLength(1);
      expect(selects(statements)[0].sql).not.toMatch(/DISTINCT/);
      expect(res).toMatchObject({
        id: 'o1',
        name: 'Org',
        industry: 'IT',
        country: 'FR',
        concurrentScanLimit: 3,
      });
    });

    it('getOrganizationByProject still answers NOT_FOUND for an unknown project', async () => {
      setResponder(() => []);

      const thrown = await service
        .getOrganizationByProject('unknown')
        .catch((e) => e);

      expect(thrown.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
    });
  });
  // The members of an organization are paginated in SQL, never loaded whole
  // (findOne with every membership and its user) then filtered and paginated
  // in JS. billing reads `totalUsers` of GetMembers as the organization's
  // member count, so the COUNT must keep the definition of
  // countMembersInOrganization: every membership of the organization.
  describe('getMembersOrganization in O(page)', () => {
    let statements: CapturedStatement[];
    let setResponder: (next: CaptureResponder) => void;
    const member = (n: number) => ({
      membership_id: `m${n}`,
      membership_role: n === 6 ? 'administrator' : 'member',
      // Per-member products: the administrator's columns are ignored (both
      // products whatever they say), the member's read as they are.
      membership_appsec_access: 0,
      membership_vibedefend_access: 1,
      user_id: `u${n}`,
      user_firstName: `First${n}`,
      user_lastName: `Last${n}`,
      user_email: `u${n}@example.test`,
      user_picture: '',
    });
    const respond =
      ({
        organization = true,
        members = [] as Record<string, unknown>[],
        total = members.length,
        // The organisation's per-member products switch.
        memberProducts = 1,
      } = {}): CaptureResponder =>
      ({ sql }) => {
        if (/^SELECT 1 AS `row_exists`/.test(sql))
          return organization ? [{ row_exists: '1' }] : [];
        // The organisation's own row, for its switch.
        if (
          /FROM `organization` `Organization`/.test(sql) &&
          !/userMemberships/.test(sql) &&
          !/DISTINCT/.test(sql)
        )
          return organization
            ? [
                rawRow(sql, {
                  Organization_id: 'o1',
                  Organization_member_products: memberProducts,
                }),
              ]
            : [];
        if (/COUNT\(/.test(sql)) return [{ cnt: String(total) }];
        if (/FROM `users_organizations_members` `membership`/.test(sql))
          return members;
        // The read this replaces (findOne with relations): its DISTINCT
        // pre-query, then the organization with its memberships.
        if (/^SELECT DISTINCT `distinctAlias`/.test(sql))
          return organization ? [{ ids_Organization_id: 'o1' }] : [];
        return members.map((m) =>
          rawRow(sql, {
            Organization_id: 'o1',
            Organization__Organization_userMemberships_id: m.membership_id,
            Organization__Organization_userMemberships_role: m.membership_role,
            id: m.user_id,
            firstName: m.user_firstName,
            lastName: m.user_lastName,
            email: m.user_email,
            picture: '',
          }),
        );
      };
    const pageRead = () =>
      statements.find(
        (s) =>
          /FROM `users_organizations_members`/.test(s.sql) &&
          !/COUNT\(/.test(s.sql),
      );
    const countRead = () =>
      statements.find((s) =>
        /^SELECT COUNT\(DISTINCT `membership`\.`id`\)/.test(s.sql),
      );

    beforeEach(async () => {
      const capture = await createSqlCaptureDataSource(respond());
      statements = capture.statements;
      setResponder = capture.setResponder;
      for (const [repo, entity] of [
        [orgRepo, Organization],
        [uomRepo, UserOrganizationMembership],
      ] as const) {
        const real = capture.dataSource.getRepository(entity);
        repo.findOne = jest.fn((options) => real.findOne(options));
        repo.count = jest.fn((options) => real.count(options));
        repo.exists = jest.fn((options) => real.exists(options));
        repo.createQueryBuilder = jest.fn((alias?: string) =>
          real.createQueryBuilder(alias),
        );
      }
    });

    it('reads one page in SQL, in an explicit order, and the total from a COUNT', async () => {
      setResponder(respond({ members: [member(6), member(7)], total: 12 }));

      const res = await service.getMembersOrganization({
        organizationId: 'o1',
        page: 2,
        pageSize: 5,
        searchQuery: '',
      });

      const page = pageRead();
      expect(page.sql).not.toMatch(/DISTINCT/);
      expect(page.sql).toMatch(
        /ORDER BY `membership`\.`userId` ASC, `membership`\.`id` ASC LIMIT 5 OFFSET 5$/,
      );
      expect(page.params).toEqual(['o1']);
      // `products` is what the edition's member access port says each member
      // holds in force: in the Community Edition, AppSec, whatever the row.
      expect(res).toEqual({
        users: [
          {
            id: 'u6',
            firstName: 'First6',
            lastName: 'Last6',
            email: 'u6@example.test',
            picture: '',
            role: 'administrator',
            products: ['appsec'],
          },
          {
            id: 'u7',
            firstName: 'First7',
            lastName: 'Last7',
            email: 'u7@example.test',
            picture: '',
            role: 'member',
            products: ['appsec'],
          },
        ],
        totalUsers: 12,
        totalPages: 3,
      });
    });

    // The organisation's switch and each row go to the port, which decides.
    it('hands the organisation switch and each membership to the member access port', async () => {
      setResponder(
        respond({
          members: [member(6), member(7)],
          total: 2,
          memberProducts: 1,
        }),
      );
      const productsInForce = jest
        .spyOn(memberProducts, 'productsInForce')
        .mockReturnValueOnce(['x'])
        .mockReturnValueOnce(['y']);

      const res = await service.getMembersOrganization({
        organizationId: 'o1',
        page: 1,
        pageSize: 5,
        searchQuery: '',
      });

      expect(res.users.map((u) => u.products)).toEqual([['x'], ['y']]);
      expect(productsInForce).toHaveBeenCalledTimes(2);
      expect(productsInForce.mock.calls[0][0]).toBeTruthy();
      expect(productsInForce.mock.calls[1][1]).toEqual(
        expect.objectContaining({ role: 'member' }),
      );
    });

    // Without a product nor the pending invitations, the count is every
    // membership; the Community Edition has no per-member switch.
    it('countMembersInOrganization answers no pending invitation and the per-member switch off', async () => {
      setResponder(respond({ total: 3, organization: false }));

      await expect(
        service.countMembersInOrganization({ organizationId: 'o1' }),
      ).resolves.toEqual({
        totalMembers: 3,
        pendingInvitations: 0,
        memberProducts: false,
      });
    });

    it('counts what countMembersInOrganization counts: every membership of the organization', async () => {
      setResponder(respond({ members: [member(1)], total: 1 }));
      await service.getMembersOrganization({
        organizationId: 'o1',
        page: 1,
        pageSize: 1,
        searchQuery: '',
      });
      const count = countRead();
      statements.length = 0;
      await service.countMembersInOrganization({ organizationId: 'o1' });
      const billingCount = statements.find((s) => /COUNT\(/.test(s.sql));

      // The member count is a filter on the organization and nothing else:
      // its join to the user is a LEFT JOIN, which drops no membership.
      expect(count.params).toEqual(billingCount.params);
      expect(count.params).toEqual(['o1']);
      expect(count.sql).not.toMatch(/INNER JOIN/);
      expect(count.sql).toMatch(/WHERE `membership`\.`organizationId` = \?$/);
      // countMembersInOrganization counts the distinct memberships whose
      // organization is this one (through its join): the same rows.
      expect(billingCount.sql).toMatch(
        /^SELECT COUNT\(DISTINCT `UserOrganizationMembership`\.`id`\)/,
      );
      expect(billingCount.sql).not.toMatch(/`user`/);
    });

    it('searches first name, last name and e-mail with LIKE, its wildcards escaped', async () => {
      await service.getMembersOrganization({
        organizationId: 'o1',
        page: 1,
        pageSize: 5,
        searchQuery: 'a_b%',
      });

      const page = pageRead();
      expect(page.sql).not.toMatch(/UPPER|LOWER/);
      expect(page.sql.match(/ LIKE \?/g)).toHaveLength(3);
      // One pattern per searched column.
      const pattern = '%a\\_b\\%%';
      expect(page.params).toEqual(['o1', pattern, pattern, pattern]);
      // The total follows the search, as before.
      expect(countRead().params).toEqual(['o1', pattern, pattern, pattern]);
    });

    it('still answers NOT_FOUND for an unknown organization', async () => {
      setResponder(respond({ organization: false }));

      const thrown = await service
        .getMembersOrganization({
          organizationId: 'nope',
          page: 1,
          pageSize: 5,
          searchQuery: '',
        })
        .catch((e) => e);

      expect(thrown.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Organization with the provided ID does not exist.',
      });
    });
  });
});
