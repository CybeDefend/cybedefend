import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const put = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
  },
}));

import { fetchProject, invalidateProjectCache, updateProjectSecurityContext } from './projectService';

const payload = (environment: string) => ({
  data: {
    projectId: 'p-1',
    name: 'x',
    teamId: 't',
    teamName: 'team',
    createdAt: '',
    updatedAt: '',
    securityContext: { environment, isCustomized: true },
  },
});

/**
 * `useProjectPageData` reads the Security Context
 * (isCustomized, updatedAt) from fetchProject, whose answer is kept 60 s and
 * also returned by useProject. A saved Security Context must not be read
 * back from that cache by the next consumer.
 */
describe('updateProjectSecurityContext', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    invalidateProjectCache();
  });

  it('drops the cached project, so the next read sees the saved Security Context', async () => {
    get.mockResolvedValueOnce(payload('production'));
    expect((await fetchProject('p-1')).securityContext?.environment).toBe('production');

    put.mockResolvedValueOnce({ data: { environment: 'staging' } });
    await updateProjectSecurityContext('p-1', { environment: 'staging' });

    get.mockResolvedValueOnce(payload('staging'));
    expect((await fetchProject('p-1')).securityContext?.environment).toBe('staging');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached project when the save fails', async () => {
    get.mockResolvedValueOnce(payload('production'));
    await fetchProject('p-1');

    put.mockRejectedValueOnce(new Error('403'));
    await expect(updateProjectSecurityContext('p-1', { environment: 'staging' })).rejects.toThrow('403');

    await fetchProject('p-1');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
