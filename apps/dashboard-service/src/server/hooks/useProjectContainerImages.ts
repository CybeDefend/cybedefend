import { useState, useEffect } from 'react';
import { fetchContainerImagesForProject } from '../services/resultService';
import { ContainerImage } from '../interfaces/Packages';
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseProjectContainerImagesOptions {
  projectId: string;
  pageSize?: number;
  branch?: string;
  enabled?: boolean;
}

interface UseProjectContainerImagesReturn {
  images: ContainerImage[];
  projectName: string;
  totalImages: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  goToPage: (page: number) => void;
  refresh: () => void;
}

export default function useProjectContainerImages({
  projectId,
  pageSize = 10,
  branch,
  enabled = true,
}: UseProjectContainerImagesOptions): UseProjectContainerImagesReturn {
  const [images, setImages] = useState<ContainerImage[]>([]);
  const [projectName, setProjectName] = useState<string>('');
  const [totalImages, setTotalImages] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);

  // `silent` (realtime-driven): no loading flash, visible data kept on failure.
  const fetchImages = async (pageToFetch = currentPage, silent = false) => {
    if (!projectId || !enabled) {
      if (silent) return; // realtime path never touches the visible state
      setImages([]);
      setTotalImages(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await fetchContainerImagesForProject(projectId, {
        page: pageToFetch,
        limit: pageSize,
        branch: branch || undefined,
      });

      setImages(response.images);
      setProjectName(response.projectName);
      setTotalImages(response.totalImages || response.images.length);
      setTotalPages(response.totalPages || Math.ceil((response.totalImages || response.images.length) / pageSize));
      setCurrentPage(pageToFetch);
    } catch (err: any) {
      if (silent) {
        console.warn('Silent container images refresh failed:', err);
        return;
      }
      console.error('Failed to fetch images:', err);
      setError(apiErrorText(err));
      setImages([]);
      setTotalImages(0);
      setTotalPages(0);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (enabled) {
      fetchImages(1);
    } else {
      setLoading(false);
    }
  }, [projectId, pageSize, branch, refreshFlag, enabled]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    fetchImages(page);
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
      void fetchImages(currentPage, true);
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
    images,
    projectName,
    totalImages,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
  };
}