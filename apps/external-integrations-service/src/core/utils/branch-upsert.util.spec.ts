import { EntityManager } from 'typeorm';
import { GithubBranch } from '../../entities/github-branch.entity';
import {
  BRANCH_UPSERT_CHUNK_SIZE,
  BranchUpsertRow,
  upsertBranches,
} from './branch-upsert.util';

type Statement = {
  target: unknown;
  rows: BranchUpsertRow[];
  overwrite: string[];
  conflict: string[];
  updateEntity: boolean;
};

/** A manager whose query builder records every INSERT it executes. */
function recordingManager(): {
  manager: EntityManager;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const createQueryBuilder = jest.fn(() => {
    const statement: Statement = {
      target: undefined,
      rows: [],
      overwrite: [],
      conflict: [],
      updateEntity: true,
    };
    const qb = {
      insert: () => qb,
      into: (target: unknown) => {
        statement.target = target;
        return qb;
      },
      values: (rows: BranchUpsertRow[]) => {
        statement.rows = rows;
        return qb;
      },
      orUpdate: (overwrite: string[], conflict: string[]) => {
        statement.overwrite = overwrite;
        statement.conflict = conflict;
        return qb;
      },
      updateEntity: (enabled: boolean) => {
        statement.updateEntity = enabled;
        return qb;
      },
      execute: async () => {
        statements.push(statement);
        return { identifiers: [], generatedMaps: [], raw: {} };
      },
    };
    return qb;
  });
  return {
    manager: { createQueryBuilder } as unknown as EntityManager,
    statements,
  };
}

const rows = (n: number): BranchUpsertRow[] =>
  Array.from({ length: n }, (_, i) => ({
    repositoryId: 'repo-1',
    name: `b${i}`,
    isProtected: i % 3 === 0,
  }));

describe('upsertBranches', () => {
  it('batches 500 rows per statement', () => {
    expect(BRANCH_UPSERT_CHUNK_SIZE).toBe(500);
  });

  it.each([
    [0, []],
    [1, [1]],
    [500, [500]],
    [501, [500, 1]],
    [1200, [500, 500, 200]],
  ])('writes %i branches in statements of %j rows', async (n, sizes) => {
    const { manager, statements } = recordingManager();

    const issued = await upsertBranches(manager, GithubBranch, rows(n));

    expect(issued).toBe(sizes.length);
    expect(statements.map((s) => s.rows.length)).toEqual(sizes);
  });

  it('keeps every row, in order, across the statements', async () => {
    const { manager, statements } = recordingManager();
    const all = rows(1200);

    await upsertBranches(manager, GithubBranch, all);

    expect(statements.flatMap((s) => s.rows)).toEqual(all);
  });

  it('upserts on (repositoryId, name), like Repository.upsert, without reloading the rows', async () => {
    const { manager, statements } = recordingManager();

    await upsertBranches(manager, GithubBranch, rows(3));

    expect(statements).toEqual([
      expect.objectContaining({
        target: GithubBranch,
        overwrite: ['repositoryId', 'name', 'isProtected'],
        conflict: ['repositoryId', 'name'],
        updateEntity: false,
      }),
    ]);
  });
});
