import type { EntityManager } from 'typeorm';
import type {
  CountMembersInOrganizationResponse,
  OrganizationInviteRequest,
} from '@grpc/global-management/organization';
import type { Organization } from 'src/entities/organization.entity';
import type { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import type { User } from 'src/entities/user.entity';
import type { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';

/**
 * The member access port: what a member, or a pending invitation, is given
 * beyond its role, and the seats that costs. The core asks it at every member
 * write (invitation, arrival, role change, departure) and when it lists
 * members. The community edition gives every member every product of the
 * edition, checks no seat and writes nothing beyond the role.
 */
export const MEMBER_PRODUCTS_PORT = 'MEMBER_PRODUCTS_PORT';

/**
 * What an invitation or an arrival gives, as the edition decided it. Opaque
 * to the core, which only hands it back to the port. `undefined`: nothing
 * beyond the role.
 */
export type MemberGrant = readonly string[] | undefined;

/**
 * A member or an invitation row, as the edition reads it: its role and
 * whatever columns the edition stores what it gives in.
 */
export type MemberAccessRow = object & { role?: string | null };

export interface MemberArrival {
  organization: Organization;
  user: User;
  role: string;
  grant: MemberGrant;
  /** An arrival through single sign-on: no inviter decided the grant. */
  sso: boolean;
}

export interface MemberProductsPort {
  /**
   * The products a listed member holds in force (the members page, the
   * profile). `organizationSwitch` is the organisation row's own column.
   */
  productsInForce(organizationSwitch: unknown, row: MemberAccessRow): string[];

  /** Before the invitation is serialised: what it gives. May refuse. */
  resolveInvitation(
    request: OrganizationInviteRequest,
    organization: Organization,
    inviter: UserOrganizationMembership | null,
  ): Promise<MemberGrant>;

  /**
   * On the invitation's transaction, which holds the organisation row lock,
   * before the insert: the seat the invitation takes. May refuse.
   */
  assertInvitationSeat(
    manager: EntityManager,
    organizationId: string,
    lockedOrganization: Organization,
    grant: MemberGrant,
  ): Promise<void>;

  /** The columns the invitation row stores for `grant`. */
  invitationColumns(grant: MemberGrant): Partial<OrganizationInvitation>;

  /** What an accepted invitation gives its new member. */
  acceptanceGrant(
    invitation: OrganizationInvitation,
    inviter: UserOrganizationMembership | null,
  ): MemberGrant;

  /**
   * Inserts the arriving member's membership, or answers null for the core
   * to save it with the role alone.
   */
  insertMembership(
    arrival: MemberArrival,
  ): Promise<UserOrganizationMembership | null>;

  /** Before the role relation is written: what the member holds, written. */
  memberArrived(
    organizationId: string,
    userId: string,
    membership: MemberAccessRow,
  ): Promise<void>;

  /** The member left (or its arrival failed): what it held, removed. */
  memberLeft(organizationId: string, userId: string): Promise<void>;

  /**
   * Before a role change is written. Answers what puts the member back as it
   * was should the role write fail, or null when nothing changed.
   */
  beforeRoleChange(
    organizationId: string,
    membership: UserOrganizationMembership,
    role: string,
  ): Promise<(() => Promise<void>) | null>;

  /**
   * CountMembersInOrganization, when the edition counts by product; null for
   * the core count (every member, and the pending invitations when asked).
   */
  countMembers(request: {
    organizationId: string;
    product?: string;
    includePendingInvitations?: boolean;
  }): Promise<CountMembersInOrganizationResponse | null>;
}
