import { CommunityContainerRegistriesOverview } from './container-registries-overview.community';
import type { ContainerRegistriesOverviewPort } from '../ports/container-registries-overview.port';

describe('CommunityContainerRegistriesOverview', () => {
  // The class takes no parameter, as CommunityEntitlements does: a method
  // with fewer parameters still satisfies the port type.
  const overview: ContainerRegistriesOverviewPort =
    new CommunityContainerRegistriesOverview();

  it('answers no connected registry, total 0, no type', async () => {
    await expect(
      overview.collectStats('org-1', Promise.resolve(null)),
    ).resolves.toEqual({
      total: 0,
      byType: [],
    });
  });
});
