import { getMetadataArgsStorage } from 'typeorm';
import { GithubRepository } from './github-repository.entity';
import { GitlabRepository } from './gitlab-repository.entity';
import { GithubIntegration } from './github-integration.entity';
import { GitlabIntegration } from './gitlab-integration.entity';

type EntityClass = new () => unknown;

/**
 * Resolves an index's columns to an ordered string[] regardless of whether
 * TypeORM stored them as a literal array or a property-selector function.
 */
function resolveColumns(
  entity: EntityClass,
  columns: unknown,
): string[] | null {
  const cols =
    typeof columns === 'function'
      ? (columns as (o?: unknown) => unknown)(entity.prototype)
      : columns;
  if (!Array.isArray(cols)) {
    return null;
  }
  return cols as string[];
}

function hasCompositeIndex(
  entity: EntityClass,
  expected: string[],
  opts: { name?: string } = {},
): boolean {
  const indices = getMetadataArgsStorage().indices.filter(
    (i) => i.target === entity,
  );
  return indices.some((i) => {
    if (opts.name && i.name !== opts.name) {
      return false;
    }
    const cols = resolveColumns(entity, i.columns);
    if (!cols || cols.length !== expected.length) {
      return false;
    }
    return expected.every((c, idx) => cols[idx] === c);
  });
}

describe('external-integrations performance indexes', () => {
  it('GithubRepository declares an index on projectId', () => {
    expect(
      hasCompositeIndex(GithubRepository, ['projectId'], {
        name: 'IDX_gh_repo_projectId',
      }),
    ).toBe(true);
  });

  it('GitlabRepository declares an index on projectId', () => {
    expect(
      hasCompositeIndex(GitlabRepository, ['projectId'], {
        name: 'IDX_gl_repo_projectId',
      }),
    ).toBe(true);
  });

  it('GithubIntegration declares an index on organizationId', () => {
    expect(
      hasCompositeIndex(GithubIntegration, ['organizationId'], {
        name: 'IDX_gh_integ_organizationId',
      }),
    ).toBe(true);
  });

  it('GitlabIntegration declares an index on organizationId', () => {
    expect(
      hasCompositeIndex(GitlabIntegration, ['organizationId'], {
        name: 'IDX_gl_integ_organizationId',
      }),
    ).toBe(true);
  });
});
