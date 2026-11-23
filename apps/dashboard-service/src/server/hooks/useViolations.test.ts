import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

const fetchViolationStatsMock = vi.fn();
const fetchProjectViolationsMock = vi.fn();
const fetchScanViolationsMock = vi.fn();
vi.mock('../services/policyService', () => ({
  fetchViolationStats: (...args: unknown[]) => fetchViolationStatsMock(...args),
  fetchProjectViolations: (...args: unknown[]) => fetchProjectViolationsMock(...args),
  fetchScanViolations: (...args: unknown[]) => fetchScanViolationsMock(...args),
}));

import { useViolations } from './useViolations';

const stats = { complianceStatus: 'Compliant' };

/**
 * The project Compliance page loads the stats on mount (`autoFetchStats`, for
 * the header badge) and its violations tab asks for them again with
 * `fetchStatsOnce` from an effect of the same commit. Both
 * read `statsFetched === false` and `statsLoading === false`, so
 * violation-stats was requested twice on every visit.
 */
const useCompliancePageShape = () => {
  const violations = useViolations({
    organizationId: 'org-1',
    projectId: 'p1',
    autoFetch: false,
    autoFetchStats: true,
  });
  const { fetchStatsOnce } = violations;
  useEffect(() => {
    fetchStatsOnce();
  }, [fetchStatsOnce]);
  return violations;
};

describe('useViolations — violation stats', () => {
  beforeEach(() => {
    fetchViolationStatsMock.mockReset();
    fetchViolationStatsMock.mockResolvedValue({ stats });
  });

  it('requests the stats once when the page asks for them while the auto-fetch is in flight', async () => {
    const { result } = renderHook(() => useCompliancePageShape());

    await waitFor(() => expect(result.current.statsFetched).toBe(true));
    expect(result.current.stats).toEqual(stats);
    expect(fetchViolationStatsMock).toHaveBeenCalledTimes(1);
  });

  it('still refetches on an explicit refreshStats', async () => {
    const { result } = renderHook(() => useCompliancePageShape());
    await waitFor(() => expect(result.current.statsFetched).toBe(true));

    await result.current.refreshStats();

    expect(fetchViolationStatsMock).toHaveBeenCalledTimes(2);
  });
});
