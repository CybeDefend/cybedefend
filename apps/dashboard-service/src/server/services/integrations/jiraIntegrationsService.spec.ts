import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../../api/gatewayAPI', () => ({
  default: {
    get: (...args: any[]) => mockGet(...args),
  },
  gatewayAPI: {
    get: (...args: any[]) => mockGet(...args),
  },
}));

import { getJiraInstallation } from './jiraIntegrationsService';

describe('getJiraInstallation — in-flight deduplication', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('coalesces concurrent calls for the same organizationId into a single HTTP request', async () => {
    let resolveResponse: (value: { status: number; data: any }) => void;
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const first = getJiraInstallation('org-1');
    const second = getJiraInstallation('org-1');

    resolveResponse!({ status: 200, data: { isConnected: true } });

    const [a, b] = await Promise.all([first, second]);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/organization/org-1/jira/installation');
    expect(a).toEqual({ isConnected: true });
    expect(b).toEqual({ isConnected: true });
  });

  it('does not coalesce calls for different organizationIds', async () => {
    mockGet.mockResolvedValueOnce({ status: 200, data: { isConnected: true } });
    mockGet.mockResolvedValueOnce({ status: 200, data: { isConnected: false } });

    const [a, b] = await Promise.all([
      getJiraInstallation('org-1'),
      getJiraInstallation('org-2'),
    ]);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ isConnected: true });
    expect(b).toEqual({ isConnected: false });
  });

  it('allows a fresh HTTP call after the previous one settled', async () => {
    mockGet.mockResolvedValueOnce({ status: 200, data: { isConnected: true } });
    mockGet.mockResolvedValueOnce({ status: 200, data: { isConnected: false } });

    const first = await getJiraInstallation('org-1');
    const second = await getJiraInstallation('org-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ isConnected: true });
    expect(second).toEqual({ isConnected: false });
  });

  it('releases the in-flight entry when the underlying request rejects, so retries are possible', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    mockGet.mockResolvedValueOnce({ status: 200, data: { isConnected: true } });

    await expect(getJiraInstallation('org-1')).rejects.toThrow('boom');

    const retry = await getJiraInstallation('org-1');
    expect(retry).toEqual({ isConnected: true });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
