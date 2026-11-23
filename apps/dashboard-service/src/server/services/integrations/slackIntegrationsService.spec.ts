import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPost = vi.fn();
vi.mock('../../api/gatewayAPI', () => ({
  default: { post: (...args: any[]) => mockPost(...args) },
  gatewayAPI: { post: (...args: any[]) => mockPost(...args) },
}));

import { createSlackOAuthState, installSlackIntegration } from './slackIntegrationsService';

describe('Slack install — server-issued OAuth state', () => {
  beforeEach(() => mockPost.mockReset());

  it('asks the gateway for a state bound to the organization and returns it', async () => {
    mockPost.mockResolvedValueOnce({ status: 201, data: { state: 'a'.repeat(64) } });

    await expect(createSlackOAuthState('org-1')).resolves.toBe('a'.repeat(64));
    expect(mockPost).toHaveBeenCalledWith('/organization/org-1/slack/install/state');
  });

  it('rejects when the gateway answers an unexpected status', async () => {
    mockPost.mockResolvedValueOnce({ status: 204, data: {} });
    await expect(createSlackOAuthState('org-1')).rejects.toThrow();
  });

  it('sends the state back with the code on the install callback', async () => {
    mockPost.mockResolvedValueOnce({ status: 201, data: { ok: true } });

    await installSlackIntegration('org-1', { code: 'c', redirectUri: 'https://app/cb', state: 's' });

    expect(mockPost).toHaveBeenCalledWith('/organization/org-1/slack/install/callback', {
      code: 'c',
      redirectUri: 'https://app/cb',
      state: 's',
    });
  });
});
