import { getMetadataArgsStorage } from 'typeorm';
import { UserOrganizationMembership } from './user-organization-membership.entity';
import { UserTeamMembership } from './user-team-membership.entity';
import { OrganizationInvitation } from './organization-invitation.entity';
import { Team } from './team.entity';
import { Project } from './project.entity';

type EntityClass = new () => unknown;

/**
 * Resolves an index's declared columns to an ordered array of property names.
 * TypeORM stores `columns` either as a literal array or as a selector function;
 * for class-level @Index([...]) decorators it is the literal array we passed.
 */
function resolveColumns(entity: EntityClass, columns: unknown): string[] {
  const resolved =
    typeof columns === 'function'
      ? (columns as (o?: unknown) => unknown)(entity.prototype)
      : columns;
  return Array.isArray(resolved) ? (resolved as string[]) : [];
}

function hasCompositeIndex(
  entity: EntityClass,
  expectedColumns: string[],
): boolean {
  const indices = getMetadataArgsStorage().indices.filter(
    (i) => i.target === entity,
  );
  return indices.some((i) => {
    const cols = resolveColumns(entity, i.columns);
    return (
      cols.length === expectedColumns.length &&
      cols.every((c, idx) => c === expectedColumns[idx])
    );
  });
}

function hasNamedCompositeIndex(
  entity: EntityClass,
  name: string,
  expectedColumns: string[],
): boolean {
  const indices = getMetadataArgsStorage().indices.filter(
    (i) => i.target === entity && i.name === name,
  );
  return indices.some((i) => {
    const cols = resolveColumns(entity, i.columns);
    return (
      cols.length === expectedColumns.length &&
      cols.every((c, idx) => c === expectedColumns[idx])
    );
  });
}

describe('global-management performance composite indexes', () => {
  // Columns below are ENTITY PROPERTY names as passed to @Index([...]).
  // Relation properties (organization/user/team) resolve to FK DB columns
  // (organizationId/userId/teamId) at schema-build time; the raw SQL migration
  // creates the indexes on those DB columns.
  const cases: Array<{
    name: string;
    entity: EntityClass;
    indexName: string;
    columns: string[];
  }> = [
    {
      name: 'UserOrganizationMembership',
      entity: UserOrganizationMembership,
      indexName: 'IDX_uom_org_user',
      columns: ['organization', 'user'],
    },
    {
      name: 'UserTeamMembership',
      entity: UserTeamMembership,
      indexName: 'IDX_tm_team_user',
      columns: ['team', 'user'],
    },
    {
      // The acceptance looks up the token's hash (unique), never the token.
      name: 'OrganizationInvitation (tokenHash)',
      entity: OrganizationInvitation,
      indexName: 'UQ_orginv_token_hash',
      columns: ['tokenHash'],
    },
    {
      name: 'OrganizationInvitation (organization, status, expiresAt)',
      entity: OrganizationInvitation,
      indexName: 'IDX_orginv_org_status_exp',
      columns: ['organization', 'status', 'expiresAt'],
    },
    {
      name: 'Team (organization, name)',
      entity: Team,
      indexName: 'IDX_team_org_name',
      columns: ['organization', 'name'],
    },
    {
      name: 'Project (team, name)',
      entity: Project,
      indexName: 'IDX_project_team_name',
      columns: ['team', 'name'],
    },
  ];

  it.each(cases)(
    '$name declares composite index $indexName with the exact ordered columns',
    ({ entity, indexName, columns }) => {
      expect(hasCompositeIndex(entity, columns)).toBe(true);
      expect(hasNamedCompositeIndex(entity, indexName, columns)).toBe(true);
    },
  );
});
