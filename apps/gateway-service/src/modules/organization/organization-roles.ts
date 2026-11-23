/**
 * The organisation roles a member can be invited with, added with or moved
 * to. One array, shared by reference with the `@IsIn` and `@ApiProperty`
 * decorators of the member bodies, so a role an edition registers at
 * instantiation time (before main.ts builds the Swagger document) is both
 * accepted and documented, and a role no edition registers is neither.
 * `creator` is never assignable: it is the organisation's first member.
 */
const CORE_ROLES = ['administrator', 'manager', 'member'] as const;

export const ASSIGNABLE_ORGANIZATION_ROLES: string[] = [...CORE_ROLES];

/**
 * Adds a role, before `member` (the roles read from the broadest to the
 * narrowest). Idempotent.
 */
export function registerAssignableOrganizationRole(role: string): void {
  if (ASSIGNABLE_ORGANIZATION_ROLES.includes(role)) return;
  ASSIGNABLE_ORGANIZATION_ROLES.splice(
    ASSIGNABLE_ORGANIZATION_ROLES.indexOf('member'),
    0,
    role,
  );
}

/** Back to the core roles alone (tests). */
export function resetAssignableOrganizationRolesForTests(): void {
  ASSIGNABLE_ORGANIZATION_ROLES.splice(
    0,
    ASSIGNABLE_ORGANIZATION_ROLES.length,
    ...CORE_ROLES,
  );
}
