import React, { useEffect } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RebacProvider, useRebac } from 'react-rebac';

vi.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) =>
    select({ organization: { selectedOrganization: { id: 'org-1' } } }),
}));
vi.mock('@/server/services/projectService', () => ({
  fetchProject: vi.fn().mockResolvedValue({ projectId: 'p', teamId: 'team-1' }),
}));

import { IMAGE_DELETE_ROLES, REPORT_ROLES, useProjectRoleAccess, type ProjectRoleRule } from './useProjectRoleAccess';

const PROJECT = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

type Entity = { id: string; type: string; relation: string };

/** The roles the application loads at sign-in, as `App` sets them. */
const Roles: React.FC<{ entities: Entity[]; children: React.ReactNode }> = ({ entities, children }) => {
  const { setUser } = useRebac();
  useEffect(() => setUser(entities), [entities, setUser]);
  return <>{children}</>;
};

const accessFor = async (entities: Entity[], rule: ProjectRoleRule) => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RebacProvider>
      <Roles entities={entities}>{children}</Roles>
    </RebacProvider>
  );
  const { result } = renderHook(() => useProjectRoleAccess(PROJECT, rule), { wrapper });
  await waitFor(() => expect(result.current).not.toBeUndefined());
  return result.current;
};

const member = { id: 'org-1', type: 'organization', relation: 'member' };
const onTeam = (relation: string) => ({ id: 'team-1', type: 'team', relation });

/** The rules mirror the project permissions of the authorization schema. */
describe('useProjectRoleAccess', () => {
  it.each([
    ['a team developer', [member, onTeam('developer')], false],
    ['a team read-only member', [member, onTeam('read_only')], false],
    ['a team analyst developer', [member, onTeam('analyst_developer')], true],
    ['a team manager', [member, onTeam('team_manager')], true],
    ['an organization administrator', [{ ...member, relation: 'administrator' }], true],
    ['the organization creator', [{ ...member, relation: 'creator' }], true],
    ['a manager of another team', [member, { id: 'team-2', type: 'team', relation: 'team_manager' }], false],
  ])('reports: %s → %s', async (_who, entities, expected) => {
    expect(await accessFor(entities as Entity[], REPORT_ROLES)).toBe(expected);
  });

  it.each([
    ['a team analyst developer', [member, onTeam('analyst_developer')], false],
    ['a team developer', [member, onTeam('developer')], false],
    ['a team manager', [member, onTeam('team_manager')], true],
    ['an organization administrator', [{ ...member, relation: 'administrator' }], true],
  ])('image delete: %s → %s', async (_who, entities, expected) => {
    expect(await accessFor(entities as Entity[], IMAGE_DELETE_ROLES)).toBe(expected);
  });

  it('is undefined, not false, without the roles store (the API stays the authority)', () => {
    const { result } = renderHook(() => useProjectRoleAccess(PROJECT, REPORT_ROLES));
    expect(result.current).toBeUndefined();
  });
});
