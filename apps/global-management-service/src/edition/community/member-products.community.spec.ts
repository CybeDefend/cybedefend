import type { MemberProductsPort } from '../ports/member-products.port';
import { CommunityMemberProducts } from './member-products.community';

/**
 * The Community Edition has one product: every member holds it, whatever the
 * columns of its row, no invitation takes a seat, and nothing beyond the role
 * is written.
 */
describe('CommunityMemberProducts', () => {
  const port: MemberProductsPort = new CommunityMemberProducts();

  it('lists every member with AppSec, whatever its row says', () => {
    for (const row of [
      { role: 'member', appsecAccess: 0 },
      { role: 'creator' },
      {},
    ]) {
      expect(port.productsInForce(1, row)).toEqual(['appsec']);
      expect(port.productsInForce(0, row)).toEqual(['appsec']);
    }
  });

  it('gives an invitation and an arrival nothing beyond the role', async () => {
    await expect(
      port.resolveInvitation({} as never, {} as never, null),
    ).resolves.toBeUndefined();
    expect(port.invitationColumns(undefined)).toEqual({});
    expect(port.acceptanceGrant({} as never, null)).toBeUndefined();
    await expect(port.insertMembership({} as never)).resolves.toBeNull();
  });

  it('checks no seat and touches no transaction', async () => {
    const manager = { count: jest.fn(), findOne: jest.fn() };
    await expect(
      port.assertInvitationSeat(manager as never, 'o1', {} as never, undefined),
    ).resolves.toBeUndefined();
    expect(manager.count).not.toHaveBeenCalled();
    expect(manager.findOne).not.toHaveBeenCalled();
  });

  it('writes nothing for an arrival, a departure or a role change', async () => {
    await expect(port.memberArrived('o1', 'u1', {})).resolves.toBeUndefined();
    await expect(port.memberLeft('o1', 'u1')).resolves.toBeUndefined();
    await expect(
      port.beforeRoleChange('o1', {} as never, 'administrator'),
    ).resolves.toBeNull();
  });

  it('leaves the member count to the core', async () => {
    await expect(
      port.countMembers({ organizationId: 'o1', product: 'appsec' }),
    ).resolves.toBeNull();
  });
});
