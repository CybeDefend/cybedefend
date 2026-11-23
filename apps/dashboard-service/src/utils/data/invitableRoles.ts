import { getOrganizationRoles } from './roleData';
import { EDITION } from '@/edition/edition';

/**
 * Billing is the cloud's: the Community Edition offers no « Billing Manager ».
 * A member who already holds it keeps it (the members
 * table names it) and can be removed, but no role change is offered to them.
 */
const NOT_OFFERED: readonly string[] = EDITION === 'community' ? ['billing_manager'] : [];

/**
 * The organisation roles an inviter may give, by the inviter's own role: a
 * copy of global-management's `INVITABLE_ORGANIZATION_ROLES`
 * (`organization.service.ts`), which refuses any other invitation with
 * PERMISSION_DENIED. Administrators are appointed by the creator only, and a
 * manager invites members only. Change both
 * copies together. The server stays the check; this only keeps the invitation
 * modal from offering a role the server would refuse.
 */
const INVITABLE_ORGANIZATION_ROLES = new Map<string, readonly string[]>([
  ['creator', ['administrator', 'manager', 'billing_manager', 'member']],
  ['administrator', ['manager', 'billing_manager', 'member']],
  ['manager', ['member']],
]);

/** The roles of `getOrganizationRoles()` an inviter holding `inviterRole` may give; none for any other or unknown role. */
export function invitableOrganizationRoles(
  inviterRole: string | undefined,
): { value: string; label: string }[] {
  const allowed = INVITABLE_ORGANIZATION_ROLES.get(inviterRole ?? '') ?? [];
  return getOrganizationRoles().filter((role) => allowed.includes(role.value) && !NOT_OFFERED.includes(role.value));
}

/**
 * Whether a member holding `actorRole` may give `role`. Removing a member and
 * changing a member's role are ranked the same way: global-management refuses either unless the actor may give the
 * member's current role (and, for a role change, the new one). Unknown roles
 * give nothing.
 */
export function mayGiveOrganizationRole(
  actorRole: string | undefined,
  role: string | undefined,
): boolean {
  if (!role) return false;
  return (INVITABLE_ORGANIZATION_ROLES.get(actorRole ?? '') ?? []).includes(role);
}

/**
 * Whether a member holding `actorRole` is offered a change of the role of a
 * member holding `memberRole`: as `mayGiveOrganizationRole`, except for a role
 * this edition no longer offers, which stays as it is (shown read-only).
 */
export function mayChangeOrganizationRole(
  actorRole: string | undefined,
  memberRole: string | undefined,
): boolean {
  return mayGiveOrganizationRole(actorRole, memberRole) && !NOT_OFFERED.includes(memberRole ?? '');
}
