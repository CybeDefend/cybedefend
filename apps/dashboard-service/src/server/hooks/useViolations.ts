// ============================================================================
// useViolations Hook - Violation management operations
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchScanViolations,
  fetchProjectViolations,
  fetchViolationStats,
} from '../services/policyService';
import { PolicyViolation, ViolationStats } from '../interfaces/Policy';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseViolationsOptions {
  organizationId: string;
  projectId: string;
  scanId?: string;
  pageSize?: number;
  autoFetch?: boolean;
  autoFetchViolations?: boolean;
  autoFetchStats?: boolean;
}

interface UseViolationsReturn {
  // Violations List
  violations: PolicyViolation[];
  loading: boolean;
  error: string | null;
  total: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  violationsFetched: boolean;
  setCurrentPage: (page: number) => void;
  refresh: () => Promise<void>;
  fetchViolationsOnce: () => Promise<void>;

  // Filters
  severityFilter: string[];
  setSeverityFilter: (values: string[]) => void;

  // Stats
  stats: ViolationStats | null;
  statsLoading: boolean;
  statsError: string | null;
  statsFetched: boolean;
  refreshStats: () => Promise<void>;
  fetchStatsOnce: () => Promise<void>;
}

export const useViolations = ({
  organizationId,
  projectId,
  scanId,
  pageSize = 20,
  autoFetch = true,
  autoFetchViolations,
  autoFetchStats,
}: UseViolationsOptions): UseViolationsReturn => {
  // Determine individual autoFetch flags (fallback to autoFetch if not specified)
  const shouldAutoFetchViolations = autoFetchViolations ?? autoFetch;
  const shouldAutoFetchStats = autoFetchStats ?? autoFetch;

  // Violations State
  const [violations, setViolations] = useState<PolicyViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [violationsFetched, setViolationsFetched] = useState(false);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);

  // Stats State
  const [stats, setStats] = useState<ViolationStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsFetched, setStatsFetched] = useState(false);
  // True from the moment a stats request leaves until it settles. A ref, not
  // state: the page's lazy `fetchStatsOnce` runs in the same commit as the
  // auto-fetch effect, when `statsLoading` still reads false.
  const statsInFlightRef = useRef(false);

  const totalPages = Math.ceil(total / pageSize);

  // ============================================================================
  // Load Violations
  // ============================================================================

  const loadViolations = useCallback(async () => {
    if (!organizationId || !projectId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (scanId) {
        // Fetch violations for a specific scan
        const response = await fetchScanViolations(projectId, scanId);
        setViolations(response.violations);
        setTotal(response.total);
      } else {
        // Fetch all project violations with pagination and filters
        const response = await fetchProjectViolations(projectId, {
          page: currentPage,
          limit: pageSize,
          severity: severityFilter.length > 0 ? severityFilter : undefined,
        });
        setViolations(response.violations);
        setTotal(response.total);
      }
    } catch (err: any) {
      console.error('Error fetching violations:', err);
      setError(apiErrorText(err));
      setViolations([]);
    } finally {
      setLoading(false);
      setViolationsFetched(true);
    }
  }, [organizationId, projectId, scanId, currentPage, pageSize, severityFilter]);

  // Fetch violations only once (lazy loading)
  const fetchViolationsOnce = useCallback(async () => {
    if (!violationsFetched && !loading) {
      await loadViolations();
    }
  }, [violationsFetched, loading, loadViolations]);

  // ============================================================================
  // Load Stats
  // ============================================================================

  const loadStats = useCallback(async () => {
    if (!organizationId || !projectId) {
      return;
    }

    statsInFlightRef.current = true;
    setStatsLoading(true);
    setStatsError(null);

    try {
      const response = await fetchViolationStats(projectId);
      setStats(response.stats);
    } catch (err: any) {
      console.error('Error fetching violation stats:', err);
      setStatsError(apiErrorText(err));
    } finally {
      statsInFlightRef.current = false;
      setStatsLoading(false);
      setStatsFetched(true);
    }
  }, [organizationId, projectId]);

  // Fetch stats only once (lazy loading)
  const fetchStatsOnce = useCallback(async () => {
    if (!statsFetched && !statsLoading && !statsInFlightRef.current) {
      await loadStats();
    }
  }, [statsFetched, statsLoading, loadStats]);

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    if (shouldAutoFetchViolations && organizationId && projectId) {
      loadViolations();
    }
  }, [shouldAutoFetchViolations, loadViolations, organizationId, projectId]);

  useEffect(() => {
    if (shouldAutoFetchStats && organizationId && projectId) {
      loadStats();
    }
  }, [shouldAutoFetchStats, loadStats, organizationId, projectId]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [severityFilter]);

  return {
    // Violations List
    violations,
    loading,
    error,
    total,
    currentPage,
    pageSize,
    totalPages,
    violationsFetched,
    setCurrentPage,
    refresh: loadViolations,
    fetchViolationsOnce,

    // Filters
    severityFilter,
    setSeverityFilter,

    // Stats
    stats,
    statsLoading,
    statsError,
    statsFetched,
    refreshStats: loadStats,
    fetchStatsOnce,
  };
};

export default useViolations;
