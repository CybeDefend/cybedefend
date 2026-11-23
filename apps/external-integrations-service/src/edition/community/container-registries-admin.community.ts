import { Injectable } from '@nestjs/common';
import type { ContainerRegistriesAdminPort } from '../ports/container-registries-admin.port';

/**
 * Community Edition: the container registry integrations do not exist
 * (container results arrive as a SARIF import). No registry credential
 * table is ever read or written: the admin surface answers empty and zero,
 * so IntegrationsAdminService reports no container registry integration and
 * org deletions and the orphan sweep never look for any.
 */
@Injectable()
export class CommunityContainerRegistriesAdmin implements ContainerRegistriesAdminPort {
  async listOrganizationIds(): Promise<string[]> {
    return [];
  }

  async countForOrg(): Promise<number> {
    return 0;
  }

  async deleteForOrg(): Promise<number> {
    return 0;
  }
}
