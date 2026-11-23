import { describe, it, expect, vi, beforeEach } from 'vitest';

import gatewayAPI from '@/server/api/gatewayAPI';

vi.mock('@/server/api/gatewayAPI', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import { getBatchProjectsBranches } from './resultService';

const mockedGet = gatewayAPI.get as unknown as ReturnType<typeof vi.fn>;
const mockedPost = gatewayAPI.post as unknown as ReturnType<typeof vi.fn>;

describe('resultService.getBatchProjectsBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs projectIds in the JSON body (not the query string) and returns active + archived branches', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        projects: [
          { projectId: 'p1', branches: ['main'], archivedBranches: ['legacy'] },
          { projectId: 'p2', branches: ['dev'], archivedBranches: [] },
        ],
      },
    });

    const res = await getBatchProjectsBranches('org-1', ['p1', 'p2']);

    // Body carries projectIds — no GET, no comma-joined query param.
    expect(mockedGet).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledWith(
      '/organization/org-1/projects/branches',
      { projectIds: ['p1', 'p2'] },
    );
    expect(res.projects).toEqual([
      { projectId: 'p1', branches: ['main'], archivedBranches: ['legacy'] },
      { projectId: 'p2', branches: ['dev'], archivedBranches: [] },
    ]);
  });

  it('short-circuits to an empty payload without hitting the API when there are no projectIds', async () => {
    const res = await getBatchProjectsBranches('org-1', []);
    expect(res.projects).toEqual([]);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('short-circuits when the organization id is missing', async () => {
    const res = await getBatchProjectsBranches('', ['p1']);
    expect(res.projects).toEqual([]);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
