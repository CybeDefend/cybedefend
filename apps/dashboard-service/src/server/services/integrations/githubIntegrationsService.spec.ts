import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPost = vi.fn();
vi.mock('../../api/gatewayAPI', () => ({
  default: { post: (...args: any[]) => mockPost(...args) },
  gatewayAPI: { post: (...args: any[]) => mockPost(...args) },
}));

import { createGithubInstallState, installGithubIntegration } from './githubIntegrationsService';

describe('GitHub App install — server-issued state', () => {
  beforeEach(() => mockPost.mockReset());

  it('asks the gateway for a state bound to the organization and returns it', async () => {
    mockPost.mockResolvedValueOnce({ status: 201, data: { state: 'a'.repeat(64) } });

    await expect(createGithubInstallState('org-1')).resolves.toBe('a'.repeat(64));
    expect(mockPost).toHaveBeenCalledWith('/organization/org-1/github/install/state');
  });

  it('rejects when the gateway answers an unexpected status', async () => {
    mockPost.mockResolvedValueOnce({ status: 204, data: {} });
    await expect(createGithubInstallState('org-1')).rejects.toThrow();
  });

  it('sends the state back with the code on the install callback', async () => {
    mockPost.mockResolvedValueOnce({ status: 201, data: { returnUri: '/x' } });

    await installGithubIntegration('org-1', { code: 'c', installationId: 42, state: 's' });

    expect(mockPost).toHaveBeenCalledWith('/organization/org-1/github/install/callback', {
      code: 'c',
      installationId: 42,
      state: 's',
    });
  });
});
