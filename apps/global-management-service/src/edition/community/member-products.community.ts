import { Injectable } from '@nestjs/common';
import type { CountMembersInOrganizationResponse } from '@grpc/global-management/organization';
import type { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import type { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import type {
  MemberGrant,
  MemberProductsPort,
} from '../ports/member-products.port';

/** The one product of the Community Edition. */
const EDITION_PRODUCTS: readonly string[] = ['appsec'];

/**
 * The Community Edition's member access: every member holds the edition's
 * one product, an invitation takes no seat, and a member write writes the
 * role alone.
 */
@Injectable()
export class CommunityMemberProducts implements MemberProductsPort {
  // Unused parameters are omitted: an interface method may be implemented
  // with fewer parameters than it declares.
  productsInForce(): string[] {
    return [...EDITION_PRODUCTS];
  }

  async resolveInvitation(): Promise<MemberGrant> {
    return undefined;
  }

  async assertInvitationSeat(): Promise<void> {
    // No seat to take.
  }

  invitationColumns(): Partial<OrganizationInvitation> {
    return {};
  }

  acceptanceGrant(): MemberGrant {
    return undefined;
  }

  async insertMembership(): Promise<UserOrganizationMembership | null> {
    return null;
  }

  async memberArrived(): Promise<void> {
    // The role is all a member holds.
  }

  async memberLeft(): Promise<void> {
    // Nothing beyond the role to remove.
  }

  async beforeRoleChange(): Promise<(() => Promise<void>) | null> {
    return null;
  }

  async countMembers(): Promise<CountMembersInOrganizationResponse | null> {
    return null;
  }
}
