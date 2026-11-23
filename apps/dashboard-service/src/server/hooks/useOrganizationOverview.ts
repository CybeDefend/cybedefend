import { useState, useEffect, useCallback, useRef } from 'react';
import { GetOrganizationOverviewResponse, OrganizationOverviewFilters } from '@/server/interfaces/Vulnerability';
import { getOrganizationOverview } from '@/server/services/resultService';
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseOrganizationOverviewReturn {
  /** Organization overview data */
  data: GetOrganizationOverviewResponse | null;
  /** Loading state */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Current filters applied */
  filters: OrganizationOverviewFilters;
  /** Update filters */
  setFilters: (filters: OrganizationOverviewFilters) => void;
  /** Update a single filter value */
  updateFilter: <K extends keyof OrganizationOverviewFilters>(
    key: K,
    value: OrganizationOverviewFilters[K]
  ) => void;
  /** Reset all filters to default */
  resetFilters: () => void;
  /** Refresh the data with current filters */
  refresh: () => Promise<void>;
}

const DEFAULT_FILTERS: OrganizationOverviewFilters = {
  sortBy: 'critical_count',
  sortOrder: 'DESC',
  includeTeamStats: true,
};

/** Debounce delay for filter changes (ms) */
const DEBOUNCE_DELAY = 300;

/**
 * At most one realtime-driven relaunch of the aggregate (p95 2.2 s) per
 * window, the last event of a burst included: a scan publishes one
 * VULNERABILITY_BATCH_APPENDED per batch on this stream.
 */
const REALTIME_REFRESH_WINDOW_MS = 10_000;

/**
 * Custom hook to fetch organization-wide overview statistics with filtering.
 * Provides aggregated vulnerability data including severity distribution,
 * state distribution, analysis types, trends, and project/team summaries.
 * Includes debounce for filter changes to avoid excessive API calls.
 * 
 * @param organizationId - The organization ID to fetch overview for
 * @param initialFilters - Optional initial filters to apply
 * @returns Object containing data, loading state, error, filters, and control functions
 */
export const useOrganizationOverview = (
  organizationId: string | undefined,
  initialFilters?: Partial<OrganizationOverviewFilters>
): UseOrganizationOverviewReturn => {
  const [data, setData] = useState<GetOrganizationOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<OrganizationOverviewFilters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });
  
  // Ref for debounce timer
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track if this is the initial mount
  const isInitialMount = useRef(true);
  // Monotonic id of the latest request: only its answer may touch state, so a
  // realtime refresh started before a filter change (or a manual refresh)
  // cannot overwrite the newer answer when it lands last.
  const requestSeqRef = useRef(0);
  // Whether an overview is on screen, read by a failed silent refresh.
  const hasDataRef = useRef(false);

  // When `silent` is true, the global loading/error flags are not toggled —
  // used by realtime handlers so the page does not flash on every event.
  const fetchOverview = useCallback(async (currentFilters?: OrganizationOverviewFilters, silent = false) => {
    if (!organizationId) {
      if (!silent) {
        setLoading(false);
        setError('Organization ID is required');
      }
      return;
    }

    const seq = ++requestSeqRef.current;
    const isLatest = () => seq === requestSeqRef.current;

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const filtersToUse = currentFilters || filters;
      const response = await getOrganizationOverview(organizationId, filtersToUse);
      if (!isLatest()) return;
      hasDataRef.current = response != null;
      setData(response);
    } catch (err: any) {
      if (!isLatest()) return;
      if (silent) {
        console.warn('Silent organization overview refresh failed:', err);
        // Keep what is on screen; but with nothing on screen (a silent
        // refresh superseded the first load), a silent failure would leave
        // a blank page with no error.
        if (!hasDataRef.current) {
          setError(apiErrorText(err));
        }
        return;
      }
      const errorMessage = apiErrorText(err);
      setError(errorMessage);
      hasDataRef.current = false;
      setData(null);
    } finally {
      // The latest request settles the loader, silent or not: a silent
      // refresh that superseded a blocking one still has to clear it.
      if (isLatest()) {
        setLoading(false);
      }
    }
  }, [organizationId, filters]);

  // Realtime SSE wiring — re-fetches on relevant server-push events
  const realtimeUrl = features.realtime.orgOverview && organizationId && organizationId.trim() !== ''
    ? `${getRegionConfig().apiUrl}/v1/realtime/orgs/${organizationId}/overview/stream`
    : null;

  // Realtime-driven refreshes are silent — they update charts/counters in
  // place without flashing the global loader — and throttled, never two at
  // once. The trailing fire reads the latest filters.
  const refreshFromRealtime = useThrottledRealtimeRefresh(
    () => fetchOverview(filters, true),
    organizationId,
    REALTIME_REFRESH_WINDOW_MS,
    { waitForInFlight: true },
  );

  useRealtimeStream(realtimeUrl, {
    STATS_AGGREGATE_CHANGED: refreshFromRealtime,
    SCAN_STATUS_CHANGED: refreshFromRealtime,
    PROJECT_STATE_CHANGED: refreshFromRealtime,
    POLICY_EVALUATION_COMPLETED: refreshFromRealtime,
    // One per ingested batch during a scan (debounced ~1.5 s server-side):
    // the throttle keeps charts/distributions live without relaunching the
    // aggregate on each.
    VULNERABILITY_BATCH_APPENDED: refreshFromRealtime,
    ZERO_DAY_DETECTED: refreshFromRealtime,
  }, [organizationId]);

  const setFilters = useCallback((newFilters: OrganizationOverviewFilters) => {
    setFiltersState(newFilters);
  }, []);

  const updateFilter = useCallback(<K extends keyof OrganizationOverviewFilters>(
    key: K,
    value: OrganizationOverviewFilters[K]
  ) => {
    setFiltersState(prev => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  // Fetch on mount and when filters change (with debounce)
  useEffect(() => {
    // Skip debounce on initial mount - fetch immediately
    if (isInitialMount.current) {
      isInitialMount.current = false;
      fetchOverview(filters);
      return;
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      fetchOverview(filters);
    }, DEBOUNCE_DELAY);

    // Cleanup on unmount or when filters change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [organizationId, filters]);

  return {
    data,
    loading,
    error,
    filters,
    setFilters,
    updateFilter,
    resetFilters,
    refresh: () => fetchOverview(filters),
  };
};

export default useOrganizationOverview;
