import { useState, useEffect } from 'react';
import { fetchGroupedContainerImagesForProject } from '../services/resultService';
import { GroupedContainerImage } from '../interfaces/Packages';
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseProjectContainerGroupedImagesOptions {
  projectId: string;
  pageSize?: number;
  branch?: string;
  sort?: string;
  order?: string;
  searchQuery?: string;
  enabled?: boolean;
}

interface UseProjectContainerGroupedImagesReturn {
  groupedImages: GroupedContainerImage[];
  projectName: string;
  totalRepositories: number;
  totalTags: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  goToPage: (page: number) => void;
  refresh: () => void;
}

export default function useProjectContainerGroupedImages({
  projectId,
  pageSize = 10,
  branch,
  sort,
  order,
  searchQuery,
  enabled = true,
}: UseProjectContainerGroupedImagesOptions): UseProjectContainerGroupedImagesReturn {
  const [groupedImages, setGroupedImages] = useState<GroupedContainerImage[]>([]);
  const [projectName, setProjectName] = useState<string>('');
  const [totalRepositories, setTotalRepositories] = useState<number>(0);
  const [totalTags, setTotalTags] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);

  // `silent` (realtime-driven): no loading flash, visible data kept on failure.
  const fetchGroupedImages = async (pageToFetch = currentPage, silent = false) => {
    if (!projectId || !enabled) {
      if (silent) return; // realtime path never touches the visible state
      setGroupedImages([]);
      setTotalRepositories(0);
      setTotalTags(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await fetchGroupedContainerImagesForProject(projectId, {
        page: pageToFetch,
        limit: pageSize,
        branch: branch || undefined,
        sort,
        order,
        searchQuery,
      });

      setGroupedImages(response.groupedImages);
      setProjectName(response.projectName);
      setTotalRepositories(response.totalRepositories);
      setTotalTags(response.totalTags);
      setTotalPages(response.totalPages);
      setCurrentPage(response.currentPage);
    } catch (err: any) {
      if (silent) {
        console.warn('Silent grouped container images refresh failed:', err);
        return;
      }
      console.error('Failed to fetch grouped images:', err);
      setError(apiErrorText(err));
      setGroupedImages([]);
      setTotalRepositories(0);
      setTotalTags(0);
      setTotalPages(0);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (enabled) {
      fetchGroupedImages(1);
    } else {
      setLoading(false);
    }
  }, [projectId, pageSize, branch, sort, order, searchQuery, refreshFlag, enabled]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    fetchGroupedImages(page);
  };

  const refresh = () => {
    setRefreshFlag(prev => !prev);
  };

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
      void fetchGroupedImages(currentPage, true);
    },
    projectId,
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
    groupedImages,
    projectName,
    totalRepositories,
    totalTags,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
  };
}
