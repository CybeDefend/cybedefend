import { describe, it, expect } from "vitest";
import {
  ORGANIZATION_ROLE_PERMISSIONS,
  TEAM_ROLE_PERMISSIONS,
  getRolePermissions,
  organizationRolesWith,
} from "./rolePermissions";

describe("rolePermissions", () => {
  it("maps the creator role to the full org permission set", () => {
    expect(ORGANIZATION_ROLE_PERMISSIONS.creator).toEqual(
      expect.arrayContaining([
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
      ])
    );
  });

  it("keeps the manager role limited to non-billing, non-delete org permissions", () => {
    expect(ORGANIZATION_ROLE_PERMISSIONS.manager).not.toContain("billing");
    expect(ORGANIZATION_ROLE_PERMISSIONS.manager).not.toContain("delete_policy");
    expect(ORGANIZATION_ROLE_PERMISSIONS.manager).toContain("create_team");
  });

  it("limits billing_manager to read and billing permissions only", () => {
    expect([...ORGANIZATION_ROLE_PERMISSIONS.billing_manager].sort()).toEqual(
      ["billing", "read"]
    );
  });

  it("limits team read_only to read scopes only", () => {
    expect(TEAM_ROLE_PERMISSIONS.read_only).toEqual(
      expect.arrayContaining([
        "read",
        "read_effective_policy",
        "read_compliance_history",
      ])
    );
    expect(TEAM_ROLE_PERMISSIONS.read_only).not.toContain(
      "change_vulnerability_state"
    );
    expect(TEAM_ROLE_PERMISSIONS.read_only).not.toContain("create_project");
  });

  it("returns team permissions when scope is team", () => {
    expect(getRolePermissions("team", "developer")).toEqual(
      TEAM_ROLE_PERMISSIONS.developer
    );
  });

  it("returns organization permissions when scope is organization", () => {
    expect(getRolePermissions("organization", "member")).toEqual(
      ORGANIZATION_ROLE_PERMISSIONS.member
    );
  });

  it("returns an empty list for unknown roles", () => {
    expect(getRolePermissions("organization", "ghost")).toEqual([]);
    expect(getRolePermissions("team", "ghost")).toEqual([]);
  });
});

describe("organizationRolesWith", () => {
  it("gives the roles of manage_policy as schema.perm grants it: creator and administrator", () => {
    expect(organizationRolesWith("manage_policy")).toEqual(["creator", "administrator"]);
  });

  it("gives the roles of read_policy, managers included", () => {
    expect(organizationRolesWith("read_policy")).toEqual(["creator", "administrator", "manager", "member"]);
  });
});
