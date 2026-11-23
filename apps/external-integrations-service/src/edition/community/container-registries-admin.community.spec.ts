import { CommunityContainerRegistriesAdmin } from './container-registries-admin.community';
import type { ContainerRegistriesAdminPort } from '../ports/container-registries-admin.port';

describe('CommunityContainerRegistriesAdmin', () => {
  // The class takes no parameter, as CommunityEntitlements does: a method
  // with fewer parameters still satisfies the port type.
  const admin: ContainerRegistriesAdminPort =
    new CommunityContainerRegistriesAdmin();

  it('lists no organization: no container registry credential exists', async () => {
    await expect(admin.listOrganizationIds()).resolves.toEqual([]);
  });

  it('counts nothing for an organization', async () => {
    await expect(admin.countForOrg('org-1')).resolves.toBe(0);
  });

  it('deletes nothing and answers 0 rows, fail closed included', async () => {
    await expect(
      admin.deleteForOrg('org-1', { failClosed: true }),
    ).resolves.toBe(0);
  });
});
