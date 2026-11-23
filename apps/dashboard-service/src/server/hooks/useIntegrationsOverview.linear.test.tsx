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

const linear = {
  id: 'lin-1',
  linearOrganizationId: 'lo-1',
  workspaceName: 'Acme',
  workspaceUrlKey: 'acme',
  organizationId: 'org',
  installedByUserId: 'user-1',
  needsReconnect: false,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

const overview = (extra: Record<string, unknown> = {}) => ({
  github: null,
  gitlab: null,
  slack: null,
  jira: null,
  containerRegistry: { total: 0, byType: [] },
  ...extra,
});

describe('useIntegrationsOverview isLinearLinked', () => {
  beforeEach(() => {
    getIntegrationsOverview.mockReset();
    invalidateIntegrationsCache();
  });

  it('is true, and exposes the workspace, when the overview has a Linear installation', async () => {
    getIntegrationsOverview.mockResolvedValue(overview({ linear }));

    const { result } = renderHook(() => useIntegrationsOverview('org-linked'));

    await waitFor(() => expect(result.current.isLinearLinked).toBe(true));
    expect(result.current.linear).toEqual(linear);
    expect(result.current.isJiraLinked).toBe(false);
  });

  it('is false when the overview says Linear is not installed', async () => {
    getIntegrationsOverview.mockResolvedValue(overview({ linear: null, jira: { id: 'j' } }));

    const { result } = renderHook(() => useIntegrationsOverview('org-jira-only'));

    await waitFor(() => expect(result.current.isJiraLinked).toBe(true));
    expect(result.current.isLinearLinked).toBe(false);
    expect(result.current.linear).toBeNull();
  });

  it('is false when the field is absent (a gateway older than Linear)', async () => {
    getIntegrationsOverview.mockResolvedValue(overview());

    const { result } = renderHook(() => useIntegrationsOverview('org-old-gateway'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isLinearLinked).toBe(false);
    expect(result.current.linear).toBeNull();
  });
});
