import type { OrganizationCreateRequest } from '@grpc/global-management/organization';
import type { Organization } from 'src/entities/organization.entity';
import type { User } from 'src/entities/user.entity';

/**
 * The organisation lifecycle hooks: the fire-and-forget side effects the
 * edition attaches to an organisation's life. The closed edition attaches
 * its own integrations there; the community edition does none of it.
 */
export const ORGANIZATION_LIFECYCLE_HOOKS = 'ORGANIZATION_LIFECYCLE_HOOKS';

export interface OrganizationCreatedContext {
  /** The saved row. */
  organization: Organization;
  creator: User;
  /** The creation request, as received. */
  request: OrganizationCreateRequest;
}

export interface OrganizationLifecycleHooks {
  /**
   * The columns the edition derives from the creation request, merged into
   * the new row inside the creation's transaction. Synchronous; a throw is
   * logged and the row is created without them. Community: none.
   */
  signupColumns(request: OrganizationCreateRequest): Partial<Organization>;
  /**
   * Awaited once the organisation, its IAM relations and its default team
   * exist, before the creation answers; never rejects.
   */
  afterOrganizationCreated(context: OrganizationCreatedContext): Promise<void>;
}
