import { useState, useEffect } from "react";
import useDebouncedValue from "./useDebouncedValue";
import { ContainerDetectedPackage } from "../interfaces/Packages";
import { fetchContainerPackagesForProject } from "../services/resultService";
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface Options {
  projectId: string;
  imageId: string | null;
  pageSize: number;
  searchQuery: string;
  classType: string[];
  enabled?: boolean;
}

interface UseProjectContainerPackagesReturn {
  packages: ContainerDetectedPackage[];
  totalPackages: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  goToPage: (page: number) => void;
  refresh: () => void;
}

export default function useProjectContainerPackages(options: Options): UseProjectContainerPackagesReturn {
  const { projectId, imageId, pageSize, searchQuery, classType, enabled = true } = options;

  const [packages, setPackages] = useState<ContainerDetectedPackage[]>([]);
  const [totalPackages, setTotalPackages] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  // `silent` (realtime-driven): no loading flash, visible data kept on failure.
  const fetchPackages = async (pageToFetch = currentPage, silent = false) => {
    if (!enabled) { if (!silent) setLoading(false); return; }
    // Do nothing while no image is selected
    if (!projectId || !imageId) {
      if (silent) return; // realtime path never touches the visible state
      setPackages([]);
      setTotalPackages(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetchContainerPackagesForProject(projectId, {
        page: pageToFetch,
        limit: pageSize,
        imageId,
        searchQuery: debouncedSearchQuery,
        classType,
      });
      setPackages(response.packages);
      setTotalPackages(response.total);
      setTotalPages(response.totalPages);
      setCurrentPage(response.page);
    } catch (err: any) {
      if (silent) {
        console.warn('Silent container packages refresh failed:', err);
        return;
      }
      setError(apiErrorText(err));
      setPackages([]);
      setTotalPackages(0);
      setTotalPages(0);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchPackages(1);
  }, [projectId, imageId, pageSize, debouncedSearchQuery, classType, refreshFlag, enabled]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    fetchPackages(page);
  };

  const refresh = () => setRefreshFlag(prev => !prev);

  // Realtime subscription (same per-project issues stream as the
  // other Results pages). Container batches and the post-finalization event
  // are routed to it; a throttled SILENT refetch of the current page keeps the
  // list visible instead of flashing the loader. `snapshot-required` fires
  // after a stream reconnect, when events may have been lost.
  // Gated on `enabled` too: a disabled hook (other view mode, gated plan)
  // must not hold an SSE connection open nor issue no-op refetches.
  const realtimeUrl =
    features.realtime.issues && enabled && projectId && projectId.trim() !== ''
      ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/issues/stream`
      : null;
  const throttledRefresh = useThrottledRealtimeRefresh(
    () => {
      void fetchPackages(currentPage, true);
    },
    `${projectId}|${imageId ?? ''}`,
  );
  useRealtimeStream(
    realtimeUrl,
    {
      VULNERABILITY_BATCH_APPENDED: throttledRefresh,
      VULNERABILITY_UPDATED: throttledRefresh,
      SCAN_STATUS_CHANGED: throttledRefresh,
      'snapshot-required': throttledRefresh,
    },
    [projectId],
  );

  return {
    packages,
    totalPackages,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
  };
}