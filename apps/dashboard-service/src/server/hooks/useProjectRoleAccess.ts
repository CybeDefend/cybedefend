import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useRebac } from 'react-rebac';
import { fetchProject } from '@/server/services/projectService';

/** The organization roles and the team roles that hold a project permission. */
export interface ProjectRoleRule {
  organization: readonly string[];
  team: readonly string[];
}

/**
 * `read_report` and `create_report` on a project, as the authorization schema
 * grants them: the organization's creator or administrators, or the project
 * team's manager or analyst developers.
 */
export const REPORT_ROLES: ProjectRoleRule = {
  organization: ['creator', 'administrator'],
  team: ['team_manager', 'analyst_developer'],
};

/**
 * Deleting a container image needs both `delete` and
 * `change_vulnerability_state` on the project: the organization's creator or
 * administrators, or the project team's manager.
 */
export const IMAGE_DELETE_ROLES: ProjectRoleRule = {
  organization: ['creator', 'administrator'],
  team: ['team_manager'],
};

interface OrganizationState {
  organization?: { selectedOrganization?: { id?: string } | null };
}

/**
 * The selected organization, or undefined when the component renders outside
 * the application's store. The store's presence never changes between two
 * renders of a component, so the hooks called stay the same.
 */
const useOrganizationId = (): string | undefined => {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSelector((state: OrganizationState) => state?.organization?.selectedOrganization?.id);
  } catch {
    return undefined;
  }
};

/** The roles store, or null when the page renders without one. */
const useRolesStore = (): ReturnType<typeof useRebac> | null => {
  try {
    return useRebac();
  } catch {
    return null;
  }
};

/**
 * Whether the signed-in member holds `rule` on the project, from the roles the
 * application loaded at sign-in (the organization role and each team role) and
 * the project's team: `true`, `false`, or `undefined` while that is not known.
 * UX only: the API refuses whatever this says, and a caller keeps handling its
 * refusal.
 */
export function useProjectRoleAccess(projectId: string | undefined, rule: ProjectRoleRule): boolean | undefined {
  const rebac = useRolesStore();
  const organizationId = useOrganizationId();
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setTeamId(undefined);
    fetchProject(projectId)
      .then((project) => {
        if (!cancelled) setTeamId(project.teamId ?? null);
      })
      .catch(() => {
        if (!cancelled) setTeamId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!rebac || !organizationId) return undefined;
  const byOrganization = rebac.hasAccess(organizationId, 'organization', [...rule.organization]);
  if (byOrganization === undefined) return undefined;
  if (byOrganization) return true;
  if (teamId === undefined) return undefined;
  if (teamId === null) return false;
  return rebac.hasAccess(teamId, 'team', [...rule.team]) === true;
}
