import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

import {
  buildOrganizationService,
  OrganizationFixture,
} from './organization.service.fixtures';

/**
 * Removing a member and changing a member's role are ranked like an
 * invitation: the actor, named by the gateway from the token, must be allowed
 * to invite the role at stake (`INVITABLE_ORGANIZATION_ROLES`):
 *   creator       → administrator, manager, billing_manager, member;
 *   administrator → manager, billing_manager, member;
 *   manager       → member.
 * Permify's `remove_user` / `update_user_role` only say the actor may act on
 * SOME member; this is the per-target rank. An older gateway names no actor:
 * refused (fail closed).
 *
 * And a member leaves no team tuple behind: a removal whose team tuples
 * could not be deleted fails, and changes nothing.
 */
describe('OrganizationService: members are removed and re-ranked like invited', () => {
  let t: OrganizationFixture;

  beforeEach(async () => {
    t = await buildOrganizationService();
  });

  const errorOf = async (promise: Promise<unknown>) => {
    const thrown = await promise.then(
      () => {
        throw new Error('expected a rejection, the call resolved');
      },
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(RpcException);
    return (thrown as RpcException).getError() as {
      code: number;
      message: string;
    };
  };

  // ── Removal ─────────────────────────────────────────────────────────────

  describe('deleteMember', () => {
    /** One organisation: the actor `actor`, the target `target`, the creator `c`. */
    const givenOrganization = (
      roles: Record<string, string>,
      teams: { team: { id: string } }[] = [],
    ) => {
      t.orgRepo.findOne!.mockResolvedValue({
        id: 'o1',
        userMemberships: Object.entries(roles).map(([id, role]) => ({
          id: `m-${id}`,
          role,
          user: { id, logtoUserId: null },
        })),
      });
      t.utmRepo.find!.mockResolvedValue(teams);
      t.uomRepo.remove!.mockResolvedValue(undefined);
    };
    const remove = (userId: string, removedBy?: string) =>
      t.service.deleteMember({
        organizationId: 'o1',
        userId,
        removedBy: removedBy ?? '',
      });
    const expectNothingRemoved = () => {
      expect(
        t.authorizationService.organizationRemoveMember,
      ).not.toHaveBeenCalled();
      expect(
        t.authorizationService.removeMemberProducts,
      ).not.toHaveBeenCalled();
      expect(t.uomRepo.remove).not.toHaveBeenCalled();
      expect(t.teamService.forceRemoveMemberFromTeams).not.toHaveBeenCalled();
    };

    it.each([
      ['manager', 'administrator'],
      ['manager', 'manager'],
      ['manager', 'billing_manager'],
      ['administrator', 'administrator'],
      ['member', 'member'],
      ['billing_manager', 'member'],
    ])(
      'a %s may not remove a %s: PERMISSION_DENIED, nothing removed',
      async (actorRole, targetRole) => {
        givenOrganization(
          { c: 'creator', actor: actorRole, target: targetRole },
          [{ team: { id: 't1' } }],
        );

        expect(await errorOf(remove('target', 'actor'))).toEqual({
          code: status.PERMISSION_DENIED,
          message: 'User not allowed to remove a member with this role',
        });
        expectNothingRemoved();
      },
    );

    it.each([
      ['creator', 'administrator'],
      ['creator', 'manager'],
      ['creator', 'billing_manager'],
      ['creator', 'member'],
      ['administrator', 'manager'],
      ['administrator', 'billing_manager'],
      ['administrator', 'member'],
      ['manager', 'member'],
    ])('a %s removes a %s', async (actorRole, targetRole) => {
      givenOrganization({
        ...(actorRole === 'creator' ? {} : { c: 'creator' }),
        actor: actorRole,
        target: targetRole,
      });

      await expect(remove('target', 'actor')).resolves.toEqual({
        message: 'User removed from organization successfully',
      });
      expect(
        t.authorizationService.organizationRemoveMember,
      ).toHaveBeenCalledWith({ organizationId: 'o1', userId: 'target' });
      expect(t.uomRepo.remove).toHaveBeenCalled();
    });

    it.each(['administrator', 'manager', 'billing_manager', 'member'])(
      'a %s may leave: removing themself needs no rank',
      async (role) => {
        givenOrganization({ c: 'creator', actor: role });

        await expect(remove('actor', 'actor')).resolves.toEqual({
          message: 'User removed from organization successfully',
        });
        expect(t.uomRepo.remove).toHaveBeenCalled();
      },
    );

    it('the creator is never removed, not even by themself', async () => {
      givenOrganization({ c: 'creator' });

      expect(await errorOf(remove('c', 'c'))).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'Creator cannot be removed',
      });
      expectNothingRemoved();
    });

    it('no actor named (an older gateway): refused, fail closed', async () => {
      givenOrganization({ c: 'creator', target: 'member' });

      expect(await errorOf(remove('target'))).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'User not allowed to remove a member with this role',
      });
      expectNothingRemoved();
    });

    it('an actor who is not a member of the organisation: refused', async () => {
      givenOrganization({ c: 'creator', target: 'member' });

      expect((await errorOf(remove('target', 'stranger'))).code).toBe(
        status.PERMISSION_DENIED,
      );
      expectNothingRemoved();
    });

    it('a removal Logto made (its webhook) mirrors it: no actor to rank', async () => {
      givenOrganization({ c: 'creator', target: 'administrator' });

      await expect(
        t.service.deleteMember(
          { organizationId: 'o1', userId: 'target', removedBy: '' },
          { skipLogtoSync: true, fromLogto: true },
        ),
      ).resolves.toEqual({
        message: 'User removed from organization successfully',
      });
      expect(t.uomRepo.remove).toHaveBeenCalled();
    });

    // A membership the identity provider kept would come back at its next
    // sync, with the role it had there.
    describe('the identity provider', () => {
      it('drops the membership before anything changes here', async () => {
        givenOrganization({ c: 'creator', target: 'member' }, [
          { team: { id: 't1' } },
        ]);

        await remove('target', 'c');

        expect(t.identity.removeMember).toHaveBeenCalledTimes(1);
        expect(t.identity.removeMember).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'o1' }),
          expect.objectContaining({ id: 'target' }),
        );
        const providerAt = t.identity.removeMember.mock.invocationCallOrder[0];
        for (const local of [
          t.teamService.forceRemoveMemberFromTeams,
          t.authorizationService.organizationRemoveMember,
          t.uomRepo.remove!,
        ]) {
          expect(providerAt).toBeLessThan(local.mock.invocationCallOrder[0]);
        }
      });

      it('refusing fails the removal, which changes nothing', async () => {
        givenOrganization({ c: 'creator', target: 'member' }, [
          { team: { id: 't1' } },
        ]);
        t.identity.removeMember.mockRejectedValueOnce(
          new RpcException({
            code: status.UNAVAILABLE,
            message: 'Member not removed, retry',
          }),
        );

        expect(await errorOf(remove('target', 'c'))).toEqual({
          code: status.UNAVAILABLE,
          message: 'Member not removed, retry',
        });
        expectNothingRemoved();
        expect(t.realtimePublisher.publish).not.toHaveBeenCalled();
      });

      it('is not asked before the actor is ranked', async () => {
        givenOrganization({
          c: 'creator',
          actor: 'manager',
          target: 'manager',
        });

        await errorOf(remove('target', 'actor'));

        expect(t.identity.removeMember).not.toHaveBeenCalled();
      });

      it('is not asked when the removal is its own (its webhook)', async () => {
        givenOrganization({ c: 'creator', target: 'member' });

        await t.service.deleteMember(
          { organizationId: 'o1', userId: 'target', removedBy: '' },
          { skipLogtoSync: true, fromLogto: true },
        );

        expect(t.identity.removeMember).not.toHaveBeenCalled();
        expect(t.uomRepo.remove).toHaveBeenCalled();
      });
    });

    // A team tuple left behind would keep reading the team's projects.
    describe('the member’s team tuples', () => {
      it('are deleted before the organisation role, the product tuples and the row', async () => {
        givenOrganization({ c: 'creator', target: 'member' }, [
          { team: { id: 't1' } },
          { team: { id: 't2' } },
        ]);

        await remove('target', 'c');

        expect(t.teamService.forceRemoveMemberFromTeams).toHaveBeenCalledWith({
          userId: 'target',
          teamIds: ['t1', 't2'],
        });
        const teamsAt =
          t.teamService.forceRemoveMemberFromTeams.mock.invocationCallOrder[0];
        expect(teamsAt).toBeLessThan(
          t.authorizationService.organizationRemoveMember.mock
            .invocationCallOrder[0],
        );
        expect(teamsAt).toBeLessThan(
          t.uomRepo.remove!.mock.invocationCallOrder[0],
        );
      });

      it('a failure there fails the removal, which changes nothing else', async () => {
        givenOrganization({ c: 'creator', target: 'member' }, [
          { team: { id: 't1' } },
        ]);
        t.teamService.forceRemoveMemberFromTeams.mockRejectedValueOnce(
          new RpcException({
            code: status.UNAVAILABLE,
            message: 'Team access not removed, retry',
          }),
        );

        expect(await errorOf(remove('target', 'c'))).toEqual({
          code: status.UNAVAILABLE,
          message: 'Team access not removed, retry',
        });
        expect(
          t.authorizationService.organizationRemoveMember,
        ).not.toHaveBeenCalled();
        expect(
          t.authorizationService.removeMemberProducts,
        ).not.toHaveBeenCalled();
        expect(t.uomRepo.remove).not.toHaveBeenCalled();
        expect(t.realtimePublisher.publish).not.toHaveBeenCalled();
      });
    });
  });

  // ── Role change ─────────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    /** The memberships by user id; `findOne` answers by `where.user.id`. */
    const givenMembers = (roles: Record<string, string>) => {
      t.uomRepo.findOne!.mockImplementation(
        async (options: { where: { user: { id: string } } }) => {
          const id = options?.where?.user?.id;
          const role = roles[id];
          if (!role) return null;
          return {
            id: `m-${id}`,
            role,
            appsecAccess: true,
            vibedefendAccess: true,
            user: { id, logtoUserId: null },
            organization: {
              id: 'o1',
              memberProducts: false,
            },
          };
        },
      );
      t.uomRepo.update!.mockResolvedValue({ affected: 1 });
    };
    const change = (userId: string, role: string, updatedBy?: string) =>
      t.service.updateMemberRole({
        organizationId: 'o1',
        userId,
        role,
        updatedBy: updatedBy ?? '',
      });
    const expectNothingChanged = () => {
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
      expect(t.entitlements.canInviteUser).not.toHaveBeenCalled();
      expect(
        t.authorizationService.updateOrganizationRole,
      ).not.toHaveBeenCalled();
      expect(t.uomRepo.update).not.toHaveBeenCalled();
      expect(t.realtimePublisher.publish).not.toHaveBeenCalled();
    };

    it.each([
      // An administrator appoints no administrator (the creator does)…
      ['administrator', 'member', 'administrator'],
      ['administrator', 'manager', 'administrator'],
      // …and demotes none.
      ['administrator', 'administrator', 'member'],
      ['administrator', 'administrator', 'manager'],
      // A manager gives members only.
      ['manager', 'member', 'manager'],
      // ('manager', 'member', 'billing_manager') moved to the cloud spec: in
      // the Community Edition the refusal comes earlier, ROLE_NOT_AVAILABLE.
      ['manager', 'manager', 'member'],
      ['manager', 'billing_manager', 'member'],
      // Roles that invite nobody give no role.
      ['billing_manager', 'member', 'manager'],
      ['member', 'member', 'manager'],
    ])(
      'a %s may not turn a %s into a %s: PERMISSION_DENIED, nothing changed',
      async (actorRole, currentRole, newRole) => {
        givenMembers({ c: 'creator', actor: actorRole, target: currentRole });

        expect(await errorOf(change('target', newRole, 'actor'))).toEqual({
          code: status.PERMISSION_DENIED,
          message: 'User not allowed to give this role',
        });
        expectNothingChanged();
      },
    );

    it.each([
      ['creator', 'member', 'administrator'],
      ['creator', 'administrator', 'member'],
      ['creator', 'administrator', 'manager'],
      ['creator', 'billing_manager', 'administrator'],
      ['administrator', 'member', 'manager'],
      // ('administrator', 'member', 'billing_manager') is the closed
      // edition's: this tree gives nobody billing_manager.
      ['administrator', 'manager', 'member'],
      ['administrator', 'billing_manager', 'manager'],
    ])('a %s turns a %s into a %s', async (actorRole, currentRole, newRole) => {
      givenMembers({ c: 'creator', actor: actorRole, target: currentRole });
      // A promotion to administrator writes both products in a transaction.
      t.dataSource.transaction.mockImplementation(
        async (work: (em: unknown) => Promise<unknown>) =>
          work({
            findOne: jest.fn(async () => ({ id: 'o1', memberProducts: false })),
            update: jest.fn(async () => ({ affected: 1 })),
            count: jest.fn(async () => 0),
          }),
      );

      await expect(change('target', newRole, 'actor')).resolves.toEqual({
        message: 'User role updated successfully',
      });
      expect(
        t.authorizationService.updateOrganizationRole,
      ).toHaveBeenCalledWith({
        organizationId: 'o1',
        userId: 'target',
        role: newRole,
      });
      expect(t.uomRepo.update).toHaveBeenCalledWith(
        { id: 'm-target' },
        { role: newRole },
      );
    });

    it('no actor named (an older gateway): refused, fail closed', async () => {
      givenMembers({ c: 'creator', target: 'member' });

      expect(await errorOf(change('target', 'manager'))).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'User not allowed to give this role',
      });
      expectNothingChanged();
    });

    it('an actor who is not a member of the organisation: refused', async () => {
      givenMembers({ c: 'creator', target: 'member' });

      expect(
        (await errorOf(change('target', 'manager', 'stranger'))).code,
      ).toBe(status.PERMISSION_DENIED);
      expectNothingChanged();
    });

    it.each(['creator', 'owner', ''])(
      '%j is never a role one can give: INVALID_ARGUMENT, even from the creator',
      async (role) => {
        givenMembers({ c: 'creator', target: 'member' });

        expect(await errorOf(change('target', role, 'c'))).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'Unknown organization role',
        });
        expectNothingChanged();
      },
    );

    it("the creator's own role cannot be changed", async () => {
      givenMembers({ c: 'creator' });

      expect(await errorOf(change('c', 'member', 'c'))).toEqual({
        code: status.PERMISSION_DENIED,
        message: 'Creator role cannot be modified',
      });
      expectNothingChanged();
    });
  });
});
