import { buildOrganizationService } from './organization.service.fixtures';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from 'src/edition/community/entitlements.binding';
import type { OrganizationCreationState } from 'src/edition/ports/entitlements.port';
import { ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS } from 'src/edition/community/organization-lifecycle.binding';

/**
 * In the Community Edition an organisation is created active and unswitched.
 * ENTITLEMENTS_PORT is bound to the real CommunityEntitlements, so
 * `organizationCreationState()` answers true/false/false/false: the saved row
 * carries `isActive: true` and `memberProducts: false`, and the Permify
 * seeding writes the same state in one attribute write.
 */
describe('OrganizationService: community creation (ENTITLEMENTS_PORT = CommunityEntitlements)', () => {
  const COMMUNITY_STATE: OrganizationCreationState = {
    isActive: true,
    writesBlocked: false,
    vibedefendActive: false,
    memberProducts: false,
  };

  const validRequest = {
    creatorId: 'user-1',
    name: 'Acme',
    industry: 'IT',
    country: 'FR',
  };

  /**
   * The transaction of createOrganization, with `create`/`save` capturing the
   * row so the test can read what was persisted.
   */
  const givenCreationTransaction = () => {
    const created: Record<string, unknown>[] = [];
    return {
      created,
      setup: (t: Awaited<ReturnType<typeof buildOrganizationService>>) => {
        t.userRepo.findOne!.mockResolvedValue({ id: 'user-1' });
        t.orgRepo.findOne!.mockResolvedValue(null); // no existing org for creator
        t.dataSource.transaction.mockImplementation(
          async (work: (m: unknown) => Promise<unknown>) =>
            work({
              create: jest.fn((_e: unknown, data: Record<string, unknown>) => {
                created.push(data);
                return { ...data };
              }),
              save: jest.fn(async (row: Record<string, unknown>) => ({
                ...row,
                id: 'org-new',
              })),
            }),
        );
      },
    };
  };

  it('creates a community organisation active and unswitched', async () => {
    const t = await buildOrganizationService({
      providers: [...ENTITLEMENTS_COMMUNITY_BINDINGS],
    });
    const tx = givenCreationTransaction();
    tx.setup(t);

    await expect(
      t.service.createOrganization(validRequest as never),
    ).resolves.toMatchObject({ organizationId: 'org-new' });

    // The saved row is active and the per-member products switch is off.
    expect(tx.created[0]).toEqual(
      expect.objectContaining({ isActive: true, memberProducts: false }),
    );
    // The Permify seeding gets the edition's state, in one write.
    expect(
      t.authorizationService.initializeOrganizationProducts,
    ).toHaveBeenCalledTimes(1);
    expect(
      t.authorizationService.initializeOrganizationProducts,
    ).toHaveBeenCalledWith('org-new', COMMUNITY_STATE);
    // The cloud wrapper is not what creation calls any more.
    expect(
      t.authorizationService.initializeOrganizationWithoutProduct,
    ).not.toHaveBeenCalled();
  });

  it('rolls back the organisation when the Permify write fails', async () => {
    const t = await buildOrganizationService({
      providers: [...ENTITLEMENTS_COMMUNITY_BINDINGS],
    });
    const tx = givenCreationTransaction();
    tx.setup(t);
    t.authorizationService.initializeOrganizationProducts.mockRejectedValueOnce(
      new Error('PERMIFY_DOWN'),
    );

    await expect(
      t.service.createOrganization(validRequest as never),
    ).rejects.toThrow('PERMIFY_DOWN');

    expect(t.orgRepo.delete).toHaveBeenCalledWith('org-new');
    expect(t.teamService.createTeam).not.toHaveBeenCalled();
  });

  // The Community Edition's organisation table has the core columns only:
  // whatever else a creation request carries (the gateway's empty fields of
  // a closed extension, or anything a client added) never reaches the row.
  it('writes the core columns only, whatever else the request carries', async () => {
    const t = await buildOrganizationService({
      providers: [
        ...ENTITLEMENTS_COMMUNITY_BINDINGS,
        ...ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS,
      ],
    });
    const tx = givenCreationTransaction();
    tx.setup(t);

    await t.service.createOrganization({
      ...validRequest,
      unrelated: 'value',
      attribution: { first: { source: 'x' } },
    } as never);

    expect(Object.keys(tx.created[0]).sort()).toEqual(
      [
        'concurrentScanLimit',
        'country',
        'creator',
        'industry',
        'isActive',
        'memberProducts',
        'name',
      ].sort(),
    );
  });
});
