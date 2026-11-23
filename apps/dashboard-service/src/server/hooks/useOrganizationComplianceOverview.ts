// ============================================================================
// useOrganizationComplianceOverview Hook
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchOrganizationComplianceOverview } from '../services/organizationComplianceService';
import {
  OrganizationComplianceOverviewResponse,
  OrganizationComplianceStats,
  ProjectComplianceData,
  ViolationBreakdownItem,
  ComplianceTrendData,
  ComplianceStatus,
  ComplianceOverviewSortBy,
  SortOrder,
  TrendTimeframe,
} from '../interfaces/OrganizationCompliance';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseOrganizationComplianceOverviewOptions {
  organizationId: string;
  pageSize?: number;
  autoFetch?: boolean;
  initialTimeframe?: TrendTimeframe;
}

interface UseOrganizationComplianceOverviewReturn {
  // Data
  stats: OrganizationComplianceStats | null;
  projects: ProjectComplianceData[];
  violationBreakdown: ViolationBreakdownItem[];
  trend: ComplianceTrendData[];
  
  // Loading & Error
  loading: boolean;
  error: string | null;
  
  // Pagination
  total: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  
  // Filters
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  complianceStatusFilter: ComplianceStatus | undefined;
  setComplianceStatusFilter: (status: ComplianceStatus | undefined) => void;
  startDate: string | undefined;
  setStartDate: (date: string | undefined) => void;
  endDate: string | undefined;
  setEndDate: (date: string | undefined) => void;
  
  // Sorting
  sortBy: ComplianceOverviewSortBy;
  setSortBy: (sortBy: ComplianceOverviewSortBy) => void;
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;
  
  // Trend Timeframe
  timeframe: TrendTimeframe;
  setTimeframe: (timeframe: TrendTimeframe) => void;
  
  // Actions
  refresh: () => Promise<void>;
}

export const useOrganizationComplianceOverview = ({
  organizationId,
  pageSize: initialPageSize = 10,
  autoFetch = true,
  initialTimeframe = 'day',
}: UseOrganizationComplianceOverviewOptions): UseOrganizationComplianceOverviewReturn => {
  // Data State
  const [stats, setStats] = useState<OrganizationComplianceStats | null>(null);
  const [projects, setProjects] = useState<ProjectComplianceData[]>([]);
  const [violationBreakdown, setViolationBreakdown] = useState<ViolationBreakdownItem[]>([]);
  const [trend, setTrend] = useState<ComplianceTrendData[]>([]);
  
  // Loading & Error State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination State
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  
  // Filter State
  const [searchQuery, setSearchQueryState] = useState('');
  const [complianceStatusFilter, setComplianceStatusFilterState] = useState<ComplianceStatus | undefined>(undefined);
  const [startDate, setStartDateState] = useState<string | undefined>(undefined);
  const [endDate, setEndDateState] = useState<string | undefined>(undefined);
  
  // Sort State
  const [sortBy, setSortByState] = useState<ComplianceOverviewSortBy>('blockedCount');
  const [sortOrder, setSortOrderState] = useState<SortOrder>('desc');

  // A filter or sort change shows its first page. The page is reset in the
  // same update as the filter, so the change costs one request: a separate
  // reset effect fetched the current page with the new filter first, then
  // page 1, and the first answer could land last.
  const {
    setSearchQuery,
    setComplianceStatusFilter,
    setStartDate,
    setEndDate,
    setSortBy,
    setSortOrder,
  } = useMemo(() => {
    const onFirstPage =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        set(value);
        setCurrentPage(1);
      };
    return {
      setSearchQuery: onFirstPage(setSearchQueryState),
      setComplianceStatusFilter: onFirstPage(setComplianceStatusFilterState),
      setStartDate: onFirstPage(setStartDateState),
      setEndDate: onFirstPage(setEndDateState),
      setSortBy: onFirstPage(setSortByState),
      setSortOrder: onFirstPage(setSortOrderState),
    };
  }, []);
  
  // Trend Timeframe State
  const [timeframe, setTimeframe] = useState<TrendTimeframe>(initialTimeframe);

  const totalPages = useMemo(() => Math.ceil(total / pageSize), [total, pageSize]);

  // Two changes close together run two requests at once, and the first one can
  // come back last: only the latest request may write the state, loading
  // included.
  const requestSeq = useRef(0);

  const loadData = useCallback(async () => {
    const seq = ++requestSeq.current;
    const isLatest = () => seq === requestSeq.current;

    if (!organizationId) {
      setStats(null);
      setProjects([]);
      setViolationBreakdown([]);
      setTrend([]);
      // A request still in flight is no longer the latest: it will not clear it
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response: OrganizationComplianceOverviewResponse = await fetchOrganizationComplianceOverview({
        organizationId,
        page: currentPage,
        pageSize,
        startDate,
        endDate,
        complianceStatus: complianceStatusFilter,
        search: searchQuery || undefined,
        sortBy,
        sortOrder,
        timeframe,
      });
      if (!isLatest()) return;

      setStats(response.stats);
      setProjects(response.projects);
      setViolationBreakdown(response.violationBreakdown);
      setTrend(response.trend);
      setTotal(response.total);
    } catch (err: any) {
      if (!isLatest()) return;
      console.error('Error fetching organization compliance overview:', err);
      setError(apiErrorText(err));
      setStats(null);
      setProjects([]);
      setViolationBreakdown([]);
      setTrend([]);
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [
    organizationId,
    currentPage,
    pageSize,
    startDate,
    endDate,
    complianceStatusFilter,
    searchQuery,
    sortBy,
    sortOrder,
    timeframe,
  ]);

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (autoFetch && organizationId) {
      loadData();
    }
  }, [loadData, organizationId, autoFetch]);

  return {
    // Data
    stats,
    projects,
    violationBreakdown,
    trend,
    
    // Loading & Error
    loading,
    error,
    
    // Pagination
    total,
    currentPage,
    pageSize,
    totalPages,
    setCurrentPage,
    setPageSize,
    
    // Filters
    searchQuery,
    setSearchQuery,
    complianceStatusFilter,
    setComplianceStatusFilter,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    
    // Sorting
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    
    // Trend Timeframe
    timeframe,
    setTimeframe,
    
    // Actions
    refresh: loadData,
  };
};

export default useOrganizationComplianceOverview;
