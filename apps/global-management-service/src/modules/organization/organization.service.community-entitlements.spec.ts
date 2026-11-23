import { buildOrganizationService } from './organization.service.fixtures';
import { OrganizationInviteRequest } from '@grpc/global-management/organization';
import { Organization } from 'src/entities/organization.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';

/**
 * Community edition: an invitation takes no seat. It is still serialized
 * under the organisation row lock (the duplicate check runs there), but
 * nothing is counted and billing is never asked.
 */
describe('OrganizationService: invitations take no seat (community)', () => {
  let t: Awaited<ReturnType<typeof buildOrganizationService>>;

  beforeEach(async () => {
    t = await buildOrganizationService();
    t.orgRepo.findOne!.mockResolvedValue({
      id: 'o1',
      name: 'Org',
      memberProducts: 1, // the per-member products switch is on
    });
    t.userRepo.findOne!.mockResolvedValue({
      id: 'u1',
      email: 'owner@example.com',
    });
    t.uomRepo.findOne!.mockResolvedValueOnce({ role: 'creator' }); // inviter
    t.uomRepo.findOne!.mockResolvedValueOnce(null); // invitee not a member yet
  });

  /**
   * One transaction whose first statement locks the organisation row, as
   * inviteUserToOrganization runs it: the fake EntityManager
   * answers the lock, the two seat counts, the duplicate-invitation lookup
   * and the insert.
   */
  const givenInviteTransaction = ({
    members = 1,
    pendingInvitations = 0,
  }: { members?: number; pendingInvitations?: number } = {}) => {
    const manager = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === Organization) {
          return { id: 'o1', name: 'Org', memberProducts: 1 };
        }
        if (entity === OrganizationInvitation) return null;
        return null;
      }),
      count: jest.fn(async (entity: unknown) => {
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
    t.dataSource.transaction.mockImplementation(
      async (work: (em: typeof manager) => Promise<unknown>) => work(manager),
    );
    return { manager };
  };

  const invite = (email = 'invitee@example.com') =>
    t.service.inviteUserToOrganization({
      organizationId: 'o1',
      invitedBy: 'u1',
      email,
      role: 'member',
      teamAssignments: [],
      products: [],
    } as OrganizationInviteRequest);

  it('invites without counting or asking billing a seat', async () => {
    const { manager } = givenInviteTransaction({
      members: 2,
      pendingInvitations: 1,
    });

    const res = await invite();

    expect(t.entitlements.canInviteUser).not.toHaveBeenCalled();
    expect(manager.count).not.toHaveBeenCalled();
    // The organisation row is still locked, first, and the invitation saved
    // through the transaction.
    expect(manager.findOne.mock.calls[0][0]).toBe(Organization);
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(res.id).toBe('inv1');
  });

  it('stores no product columns on the invitation', async () => {
    const { manager } = givenInviteTransaction();

    await invite();

    const saved = manager.save.mock.calls[0][1] as OrganizationInvitation;
    // The columns keep their defaults: nothing beyond the role is written.
    expect(saved.appsecAccess).toBeUndefined();
  });
});
