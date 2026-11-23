import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const patch = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
  default: {
    get: (...a: any[]) => get(...a),
    patch: (...a: any[]) => patch(...a),
  },
}));

import {
  fetchProject,
  updateProject,
  invalidateProjectCache,
} from './projectService';

// Both remaps in projectService list their fields explicitly, so a new field is
// silently dropped unless it is added to each one.
describe('scanOnCommitEnabled mapping', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    invalidateProjectCache();
  });

  it('fetchProject defaults scanOnCommitEnabled to true when the backend payload omits it', async () => {
    get.mockResolvedValue({
      data: {
        projectId: 'p-1', name: 'x', teamId: 't', teamName: 'team',
        createdAt: '', updatedAt: '',
      },
    });
    const p = await fetchProject('p-1');
    expect(p.scanOnCommitEnabled).toBe(true);
  });

  it('fetchProject passes through an explicit scanOnCommitEnabled: false', async () => {
    get.mockResolvedValue({
      data: {
        projectId: 'p-2', name: 'x', teamId: 't', teamName: 'team',
        createdAt: '', updatedAt: '', scanOnCommitEnabled: false,
      },
    });
    const p = await fetchProject('p-2');
    expect(p.scanOnCommitEnabled).toBe(false);
  });

  it('updateProject defaults scanOnCommitEnabled to true when the backend payload omits it', async () => {
    patch.mockResolvedValue({
      data: {
        success: true,
        message: 'ok',
        projectInformations: {
          projectId: 'p-3', name: 'x', teamId: 't', teamName: 'team',
          createdAt: '', updatedAt: '',
        },
      },
    });
    const p = await updateProject('p-3', {});
    expect(p.scanOnCommitEnabled).toBe(true);
  });

  it('updateProject passes through an explicit scanOnCommitEnabled: false', async () => {
    patch.mockResolvedValue({
      data: {
        success: true,
        message: 'ok',
        projectInformations: {
          projectId: 'p-4', name: 'x', teamId: 't', teamName: 'team',
          createdAt: '', updatedAt: '', scanOnCommitEnabled: false,
        },
      },
    });
    const p = await updateProject('p-4', {});
    expect(p.scanOnCommitEnabled).toBe(false);
  });

  it('updateProject sends scanOnCommitEnabled: false in the PATCH body', async () => {
    patch.mockResolvedValue({
      data: {
        success: true,
        message: 'ok',
        projectInformations: {
          projectId: 'p-5', name: 'x', teamId: 't', teamName: 'team',
          createdAt: '', updatedAt: '', scanOnCommitEnabled: false,
        },
      },
    });
    await updateProject('p-5', { scanOnCommitEnabled: false });
    expect(patch).toHaveBeenCalledWith('/project/p-5', {
      scanOnCommitEnabled: false,
    });
  });
});
