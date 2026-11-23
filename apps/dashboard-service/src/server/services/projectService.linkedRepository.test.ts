import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
  default: {
    get: (...a: any[]) => get(...a),
  },
}));

import { fetchProject, invalidateProjectCache } from './projectService';

// fetchProject lists the payload fields it keeps, so a new one is silently
// dropped unless it is added there. The results pages read the linked
// repository's branches with it instead of listing every repository of the org.
describe('linkedRepository mapping', () => {
  beforeEach(() => {
    get.mockReset();
    invalidateProjectCache();
  });

  const payload = (extra: Record<string, unknown>) => ({
    data: {
      projectId: 'p-1', name: 'x', teamId: 't', teamName: 'team',
      createdAt: '', updatedAt: '', isGithubLinked: true,
      ...extra,
    },
  });

  it('keeps the linked repository of the /project payload', async () => {
    get.mockResolvedValue(
      payload({ linkedRepository: { provider: 'github', repositoryId: 'gh-row' } }),
    );

    const p = await fetchProject('p-1');

    expect(p.linkedRepository).toEqual({ provider: 'github', repositoryId: 'gh-row' });
  });

  it('leaves it undefined when the payload has none (older gateway)', async () => {
    get.mockResolvedValue(payload({}));

    const p = await fetchProject('p-1');

    expect(p.linkedRepository).toBeUndefined();
  });
});
