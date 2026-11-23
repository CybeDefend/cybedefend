import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDelete = vi.hoisted(() => vi.fn());
vi.mock('../../api/gatewayAPI', () => ({
  default: { delete: (...args: unknown[]) => mockDelete(...args) },
}));

import { disconnectGitlab } from './gitlabIntegrationsService';

describe('disconnectGitlab', () => {
  beforeEach(() => mockDelete.mockReset());

  it('asks the gateway to disconnect GitLab from the organization', async () => {
    mockDelete.mockResolvedValue({ status: 200, data: { success: true } });

    await expect(disconnectGitlab('org-1')).resolves.toBeUndefined();

    expect(mockDelete).toHaveBeenCalledWith(
      '/integrations/gitlab/organization/org-1/disconnect',
    );
  });

  it('fails on an answer that is not a success', async () => {
    mockDelete.mockResolvedValue({ status: 500, data: {} });

    await expect(disconnectGitlab('org-1')).rejects.toThrow();
  });
});
