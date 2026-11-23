import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBatchProjectsBranchesMock = vi.fn();

vi.mock('@/server/services/resultService', () => ({
  getBatchProjectsBranches: (...args: unknown[]) =>
    getBatchProjectsBranchesMock(...args),
}));

import { fetchReportBranchMaps } from './reportBranchData';

beforeEach(() => {
  getBatchProjectsBranchesMock.mockReset();
});

describe('fetchReportBranchMaps', () => {
  it('issues a SINGLE batch request for a normal org (no per-project fan-out)', async () => {
    getBatchProjectsBranchesMock.mockResolvedValue({
      projects: [
        { projectId: 'p1', branches: ['main', 'old'], archivedBranches: ['old'] },
        { projectId: 'p2', branches: ['dev'], archivedBranches: [] },
      ],
    });

    const { branchesMap, archivedBranchesMap } = await fetchReportBranchMaps(
      'org-1',
      ['p1', 'p2'],
    );

    // One call, carrying all project ids — not one call per project.
    expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(1);
    expect(getBatchProjectsBranchesMock).toHaveBeenCalledWith('org-1', [
      'p1',
      'p2',
    ]);

    // Active branches exclude anything that is archived; archived map is kept.
    expect(branchesMap).toEqual({ p1: ['main'], p2: ['dev'] });
    expect(archivedBranchesMap).toEqual({ p1: ['old'], p2: [] });
  });

  it('chunks project ids into batches of at most 100 and runs them in parallel', async () => {
    getBatchProjectsBranchesMock.mockImplementation(
      (_org: string, ids: string[]) => ({
        projects: ids.map((id) => ({
          projectId: id,
          branches: [`b-${id}`],
          archivedBranches: [],
        })),
      }),
    );

    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const { branchesMap } = await fetchReportBranchMaps('org-1', ids);

    // 250 / 100 => 3 chunks (100 + 100 + 50), 3 requests total.
    expect(getBatchProjectsBranchesMock).toHaveBeenCalledTimes(3);
    const chunkSizes = getBatchProjectsBranchesMock.mock.calls.map(
      (c) => (c[1] as string[]).length,
    );
    expect(chunkSizes).toEqual([100, 100, 50]);
    // Every project still ends up in the merged map.
    expect(Object.keys(branchesMap)).toHaveLength(250);
    expect(branchesMap['p0']).toEqual(['b-p0']);
    expect(branchesMap['p249']).toEqual(['b-p249']);
  });

  it('returns empty maps without calling the API when there is no org or no project', async () => {
    expect(await fetchReportBranchMaps('', ['p1'])).toEqual({
      branchesMap: {},
      archivedBranchesMap: {},
    });
    expect(await fetchReportBranchMaps('org-1', [])).toEqual({
      branchesMap: {},
      archivedBranchesMap: {},
    });
    expect(getBatchProjectsBranchesMock).not.toHaveBeenCalled();
  });
});
