import { getMetadataArgsStorage } from 'typeorm';
import { PolicyViolation } from './policy-violation.entity';
import { PolicyEvaluation } from './policy-evaluation.entity';

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

describe('policy-management performance indexes', () => {
  it('PolicyViolation declares a composite index on (organizationId, actionTaken, createdAt)', () => {
    expect(
      hasCompositeIndex(
        PolicyViolation,
        ['organizationId', 'actionTaken', 'createdAt'],
        { name: 'IDX_policy_violations_org_action_createdAt' },
      ),
    ).toBe(true);
  });

  it('PolicyEvaluation declares a composite index on (projectId, status)', () => {
    expect(
      hasCompositeIndex(PolicyEvaluation, ['projectId', 'status'], {
        name: 'IDX_policy_evaluations_projectId_status',
      }),
    ).toBe(true);
  });
});
