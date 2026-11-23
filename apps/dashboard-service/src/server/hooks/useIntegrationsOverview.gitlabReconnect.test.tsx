import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getIntegrationsOverview = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/integrations/integrationsOverviewService', () => ({
  getIntegrationsOverview,
}));

import {
  invalidateIntegrationsCache,
  useIntegrationsOverview,
} from './useIntegrationsOverview';

const overview = (gitlab: Record<string, unknown> | null) => ({
  github: null,
  gitlab,
  slack: null,
  jira: null,
  containerRegistry: { total: 0, byType: [] },
});

const gitlab = {
  id: 'g-1',
  userId: 'user-1',
  organizationId: 'org',
  gitlabUserId: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('useIntegrationsOverview isGitlabReconnectRequired', () => {
  beforeEach(() => {
    getIntegrationsOverview.mockReset();
    invalidateIntegrationsCache();
  });

  it('is true when the overview says GitLab must be reconnected', async () => {
    getIntegrationsOverview.mockResolvedValue(overview({ ...gitlab, reconnectRequired: true }));

    const { result } = renderHook(() => useIntegrationsOverview('org-reconnect'));

    await waitFor(() => expect(result.current.isGitlabLinked).toBe(true));
    expect(result.current.isGitlabReconnectRequired).toBe(true);
  });

  it('is false when the field is absent (older gateway)', async () => {
    getIntegrationsOverview.mockResolvedValue(overview(gitlab));

    const { result } = renderHook(() => useIntegrationsOverview('org-healthy'));

    await waitFor(() => expect(result.current.isGitlabLinked).toBe(true));
    expect(result.current.isGitlabReconnectRequired).toBe(false);
  });
});
