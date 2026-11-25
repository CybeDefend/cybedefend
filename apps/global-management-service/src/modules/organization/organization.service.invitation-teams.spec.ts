import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { OrganizationInviteRequest } from '@grpc/global-management/organization';
import {
  buildOrganizationService,
  type OrganizationFixture,
} from './organization.service.fixtures';
import { MAX_INVITATION_TEAM_ASSIGNMENTS } from './organization.service';

/**
 * An invitation seats its member in each of its teams one after the other at
 * acceptance, each under a membership lock: the number of teams is bounded.
 */
describe('OrganizationService.inviteUserToOrganization: team seats', () => {
  let t: OrganizationFixture;

  beforeEach(async () => {
    t = await buildOrganizationService();
    t.orgRepo.findOne!.mockResolvedValue({ id: 'o1', name: 'Org' });
    t.userRepo.findOne!.mockResolvedValue({ id: 'u1' });
    t.uomRepo.findOne!.mockImplementation(async ({ where }: never) =>
      (where as { user?: { id?: string } })?.user?.id === 'u1'
        ? { role: 'creator' }
        : null,
    );
  });

  afterEach(async () => {
    await t.module.close();
  });

  it(`refuses an invitation to more than ${MAX_INVITATION_TEAM_ASSIGNMENTS} teams before anything is read or written`, async () => {
    const error = await t.service
      .inviteUserToOrganization({
        organizationId: 'o1',
        invitedBy: 'u1',
        email: 'invitee@example.com',
        role: 'member',
        teamAssignments: Array.from(
          { length: MAX_INVITATION_TEAM_ASSIGNMENTS + 1 },
          (_v, i) => ({ teamId: `t${i}`, role: 'developer' }),
        ),
      } as OrganizationInviteRequest)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(RpcException);
    expect(((error as RpcException).getError() as { code: number }).code).toBe(
      status.INVALID_ARGUMENT,
    );
    expect(t.teamRepo.find).not.toHaveBeenCalled();
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
  });
});
