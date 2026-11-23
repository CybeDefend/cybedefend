import {
  buildOrganizationService,
  OrganizationFixture,
} from './organization.service.fixtures';

/**
 * A member leaving an organisation, removed or of its own accord, is signed
 * out through `IDENTITY_PROVIDER_PORT.memberLeaving` BEFORE anything is
 * removed. If signing out fails, the member stays in place, so the removal
 * can be retried; the other way round, a retry would answer "not a member"
 * and the account would stay signed in for good.
 */
describe('OrganizationService.deleteMember signs the member out first', () => {
  let t: OrganizationFixture;

  beforeEach(async () => {
    t = await buildOrganizationService();
    t.orgRepo.findOne!.mockResolvedValue({
      id: 'o1',
      name: 'Org',
      userMemberships: [
        { id: 'm-c', role: 'creator', user: { id: 'c' } },
        { id: 'm-target', role: 'member', user: { id: 'target' } },
      ],
    });
    t.utmRepo.find!.mockResolvedValue([{ team: { id: 't1' } }]);
    t.uomRepo.remove!.mockResolvedValue(undefined);
  });

  const remove = (removedBy = 'c') =>
    t.service.deleteMember({
      organizationId: 'o1',
      userId: 'target',
      removedBy,
    });

  it('signs the member out before its teams, its role and its row are removed', async () => {
    await remove();

    expect(t.identity.memberLeaving).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1' }),
      expect.objectContaining({ id: 'target' }),
    );
    const signedOutAt = t.identity.memberLeaving.mock.invocationCallOrder[0];
    for (const step of [
      t.teamService.forceRemoveMemberFromTeams,
      t.authorizationService.organizationRemoveMember,
      t.uomRepo.remove,
    ] as jest.Mock[]) {
      expect(signedOutAt).toBeLessThan(step.mock.invocationCallOrder[0]);
    }
  });

  it('a member who leaves is signed out too', async () => {
    await remove('target');

    expect(t.identity.memberLeaving).toHaveBeenCalledTimes(1);
  });

  it('a failed sign-out removes nothing, and a retry completes the removal', async () => {
    t.identity.memberLeaving.mockRejectedValueOnce(new Error('db down'));

    await expect(remove()).rejects.toThrow('db down');
    expect(t.teamService.forceRemoveMemberFromTeams).not.toHaveBeenCalled();
    expect(
      t.authorizationService.organizationRemoveMember,
    ).not.toHaveBeenCalled();
    expect(t.uomRepo.remove).not.toHaveBeenCalled();

    // the member is still in place, so the same removal works again
    await expect(remove()).resolves.toEqual({
      message: 'User removed from organization successfully',
    });
    expect(t.identity.memberLeaving).toHaveBeenCalledTimes(2);
    expect(t.uomRepo.remove).toHaveBeenCalledTimes(1);
  });

  it('a refused removal signs nobody out', async () => {
    await expect(remove('stranger')).rejects.toBeDefined();

    expect(t.identity.memberLeaving).not.toHaveBeenCalled();
  });
});
