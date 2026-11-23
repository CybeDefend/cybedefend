import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

import {
  buildOrganizationService,
  OrganizationFixture,
} from './organization.service.fixtures';

/**
 * Billing belongs to the closed edition, so the Community Edition gives
 * nobody the `billing_manager` role: an invitation or a role change
 * to it is refused FAILED_PRECONDITION `ROLE_NOT_AVAILABLE` (a refusal of the
 * closed list, which the gateway answers as 400 with `body.code`), before
 * anything is read or written. A member who already holds the role keeps it,
 * and may be moved to another role. The cloud is unchanged.
 */
describe('OrganizationService: the billing manager role per edition', () => {
  let t: OrganizationFixture;
  const saved = process.env.CYBEDEFEND_EDITION;

  beforeEach(async () => {
    t = await buildOrganizationService();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
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

  const REFUSED = {
    code: status.FAILED_PRECONDITION,
    message: 'ROLE_NOT_AVAILABLE',
  };

  const invite = () =>
    t.service.inviteUserToOrganization({
      organizationId: 'o1',
      email: 'bea@example.test',
      role: 'billing_manager',
      invitedBy: 'c',
    } as never);

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
          user: { id, logtoUserId: null },
          organization: {
            id: 'o1',
            memberProducts: false,
          },
        };
      },
    );
    t.uomRepo.update!.mockResolvedValue({ affected: 1 });
    t.dataSource.transaction.mockImplementation(
      async (work: (em: unknown) => Promise<unknown>) =>
        work({
          findOne: jest.fn(async () => ({ id: 'o1', memberProducts: false })),
          update: jest.fn(async () => ({ affected: 1 })),
          count: jest.fn(async () => 0),
        }),
    );
  };
  const change = (userId: string, role: string) =>
    t.service.updateMemberRole({
      organizationId: 'o1',
      userId,
      role,
      updatedBy: 'c',
    });

  describe('Community Edition', () => {
    beforeEach(() => {
      process.env.CYBEDEFEND_EDITION = 'community';
    });

    it('refuses an invitation as billing manager before reading anything', async () => {
      expect(await errorOf(invite())).toEqual(REFUSED);
      expect(t.orgRepo.findOne).not.toHaveBeenCalled();
    });

    it('refuses turning a member into a billing manager, and changes nothing', async () => {
      givenMembers({ c: 'creator', target: 'member' });

      expect(await errorOf(change('target', 'billing_manager'))).toEqual(
        REFUSED,
      );
      expect(t.uomRepo.update).not.toHaveBeenCalled();
      expect(
        t.authorizationService.updateOrganizationRole,
      ).not.toHaveBeenCalled();
    });

    it('lets a billing manager who keeps the role be moved to another role', async () => {
      givenMembers({ c: 'creator', target: 'billing_manager' });

      await expect(change('target', 'manager')).resolves.toEqual({
        message: 'User role updated successfully',
      });
    });
  });

  // The closed edition pins its own cases: this tree reads community whatever
  // the variable says.
});
