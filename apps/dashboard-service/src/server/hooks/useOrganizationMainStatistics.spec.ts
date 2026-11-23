import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const fetchMock = vi.fn();
vi.mock('@/server/services/projectService', () => ({
  fetchOrganizationMainStatistics: (...args: unknown[]) => fetchMock(...args),
}));

import { useOrganizationMainStatistics } from './useOrganizationMainStatistics';

const mkStats = (o: Record<string, unknown> = {}) => ({
  criticalRiskProjects: 3,
  criticalIssues: 12,
  highIssues: 2,
  ...o,
});

describe('useOrganizationMainStatistics', () => {
  beforeEach(() => fetchMock.mockReset());

  it('fetches org-wide stats and exposes them with loading=false', async () => {
    fetchMock.mockResolvedValue(mkStats());

    const { result } = renderHook(() => useOrganizationMainStatistics('org-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('org-1');
    expect(result.current.mainStatistics?.criticalIssues).toBe(12);
  });

  it('does not fetch and stays null for an empty organizationId', async () => {
    const { result } = renderHook(() => useOrganizationMainStatistics(''));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.mainStatistics).toBeNull();
  });

  it('does not fetch when disabled', async () => {
    renderHook(() => useOrganizationMainStatistics('org-1', false));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh() re-fetches the stats (silent)', async () => {
    fetchMock.mockResolvedValue(mkStats());
    const { result } = renderHook(() => useOrganizationMainStatistics('org-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
