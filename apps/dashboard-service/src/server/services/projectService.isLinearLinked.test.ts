import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
  default: {
    get: (...a: any[]) => get(...a),
  },
}));

import { fetchProject, invalidateProjectCache } from './projectService';

const payload = (extra: Record<string, unknown> = {}) => ({
  data: {
    projectId: 'p-1',
    name: 'x',
    teamId: 't',
    teamName: 'team',
    createdAt: '',
    updatedAt: '',
    ...extra,
  },
});

describe('isLinearLinked mapping', () => {
  beforeEach(() => {
    get.mockReset();
    invalidateProjectCache();
  });

  it('fetchProject hands over isLinearLinked: true as the backend sent it', async () => {
    get.mockResolvedValue(payload({ isLinearLinked: true, isJiraLinked: false }));

    const project = await fetchProject('p-1');

    expect(project.isLinearLinked).toBe(true);
    expect(project.isJiraLinked).toBe(false);
  });

  it('fetchProject leaves isLinearLinked absent when the backend does not send it', async () => {
    get.mockResolvedValue(payload());

    const project = await fetchProject('p-1');

    expect(project.isLinearLinked).toBeUndefined();
  });
});
