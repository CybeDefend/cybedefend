import { Injectable } from '@nestjs/common';
import type { ContainerRegistriesOverviewPort } from '../ports/container-registries-overview.port';

/**
 * Community Edition: no container registry is ever connected (the
 * registries are shown greyed out, « Available on Cloud only »), so the
 * overview always answers an empty stats object.
 */
@Injectable()
export class CommunityContainerRegistriesOverview implements ContainerRegistriesOverviewPort {
  async collectStats(): Promise<{
    total: number;
    byType: { type: string; count: number }[];
  }> {
    return { total: 0, byType: [] };
  }
}
