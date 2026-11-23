import type {
  OrganizationCreateRequest,
  OrganizationUpdateRequest,
} from '@grpc/global-management/organization';
import type { Organization } from 'src/entities/organization.entity';

/**
 * The organisation fields an edition adds: to the organisation answers
 * (GetOrganizationById, GetOrganizations, GetOrganizationByProjectId) and to
 * the row a creation or an update writes. The core answers with and writes
 * the organisation's identity and scan limits only.
 */
export const ORGANIZATION_PROFILE_PORT = 'ORGANIZATION_PROFILE_PORT';

export interface OrganizationProfilePort {
  /**
   * The edition's own fields of one organisation's answer, merged after the
   * core ones. Synchronous, reads the row only. Community: none.
   */
  answerFields(organization: Organization): Record<string, unknown>;
  /**
   * The edition's own columns of a new organisation, read from the creation
   * request and merged into the row. Called before anything is written: a
   * request the edition refuses throws an RpcException (INVALID_ARGUMENT)
   * and nothing is created. Community: none, whatever the request carries.
   */
  creationColumns(request: OrganizationCreateRequest): Partial<Organization>;
  /**
   * The edition's own columns an update request sets (a field left out or
   * null changes nothing). Community: none, whatever the request carries.
   */
  updateColumns(request: OrganizationUpdateRequest): Partial<Organization>;
}
