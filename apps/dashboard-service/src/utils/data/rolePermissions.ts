export type RoleScope = "organization" | "team";

export type OrganizationRoleKey =
  | "creator"
  | "administrator"
  | "manager"
  | "billing_manager"
  | "member";

export type TeamRoleKey =
  | "team_manager"
  | "analyst_developer"
  | "developer"
  | "read_only";

export type RoleKey = OrganizationRoleKey | TeamRoleKey;

const CREATOR_ADMINISTRATOR_PERMISSIONS: string[] = [
  "read",
  "billing",
  "manage_integration",
  "manage",
  "read_user",
  "update_user_role",
  "add_user",
  "remove_user",
  "create_team",
  "read_policy",
  "manage_policy",
  "delete_policy",
];

export const ORGANIZATION_ROLE_PERMISSIONS: Record<OrganizationRoleKey, string[]> = {
  creator: CREATOR_ADMINISTRATOR_PERMISSIONS,
  administrator: CREATOR_ADMINISTRATOR_PERMISSIONS,
  manager: [
    "read",
    "manage_integration",
    "read_user",
    "add_user",
    "remove_user",
    "create_team",
    "read_policy",
  ],
  billing_manager: ["read", "billing"],
  member: ["read", "read_user", "read_policy"],
};

export const TEAM_ROLE_PERMISSIONS: Record<TeamRoleKey, string[]> = {
  team_manager: [
    "read",
    "manage",
    "update_user_role",
    "add_user",
    "remove_user",
    "create_project",
    "read_log",
    "read_scan_result",
    "change_vulnerability_state",
    "read_report",
    "create_report",
    "archive_report",
    "start_scan",
    "read_effective_policy",
    "read_compliance_history",
    "read_policy_violation",
  ],
  analyst_developer: [
    "read",
    "read_scan_result",
    "change_vulnerability_state",
    "read_report",
    "create_report",
    "start_scan",
    "read_effective_policy",
    "read_compliance_history",
    "read_policy_violation",
  ],
  developer: [
    "read",
    "read_scan_result",
    "change_vulnerability_state",
    "start_scan",
    "read_effective_policy",
    "read_compliance_history",
    "read_policy_violation",
  ],
  read_only: ["read", "read_effective_policy", "read_compliance_history"],
};

const isOrganizationRoleKey = (role: string): role is OrganizationRoleKey =>
  role in ORGANIZATION_ROLE_PERMISSIONS;

const isTeamRoleKey = (role: string): role is TeamRoleKey =>
  role in TEAM_ROLE_PERMISSIONS;

export const getRolePermissions = (scope: RoleScope, role: string): string[] => {
  if (scope === "organization") {
    return isOrganizationRoleKey(role) ? ORGANIZATION_ROLE_PERMISSIONS[role] : [];
  }
  return isTeamRoleKey(role) ? TEAM_ROLE_PERMISSIONS[role] : [];
};

/**
 * The organization roles granted `permission` by the table above, the mirror
 * of `entity organization` in charts/cybedefend/files/schema.perm. For a page
 * that only shows what its endpoint's permission allows; the gateway's
 * PermissionsGuard remains the check.
 */
export const organizationRolesWith = (permission: string): OrganizationRoleKey[] =>
  (Object.keys(ORGANIZATION_ROLE_PERMISSIONS) as OrganizationRoleKey[]).filter((role) =>
    ORGANIZATION_ROLE_PERMISSIONS[role].includes(permission),
  );
