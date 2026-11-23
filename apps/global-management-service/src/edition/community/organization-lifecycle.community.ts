import { Injectable } from '@nestjs/common';
import type { Organization } from 'src/entities/organization.entity';
import type { OrganizationLifecycleHooks } from '../ports/organization-lifecycle.port';

/**
 * The community organisation lifecycle: no closed integration is attached,
 * so a creation stores nothing the request carries beyond the organisation
 * itself, and its hooks resolve at once with nothing done.
 */
@Injectable()
export class CommunityOrganizationLifecycle implements OrganizationLifecycleHooks {
  signupColumns(): Partial<Organization> {
    return {};
  }

  async afterOrganizationCreated(): Promise<void> {}
}
