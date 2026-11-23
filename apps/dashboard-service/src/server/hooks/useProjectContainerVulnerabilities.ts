import { useState, useEffect } from "react";
import useDebouncedValue from "./useDebouncedValue";
import { ContainerVulnerabilityResult } from "../interfaces/Vulnerability";
import { fetchContainerResultsForProject } from "../services/resultService";
import { ScanInfo } from "../interfaces/Scan";
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface Options {
  projectId: string;
  imageId: string | null;
  pageSize: number;
  severity: string[];
  status: string[];
  priority: string[];
  exploitability?: string[];
  /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
  scoringSource?: string;
  classType: string[];
  sort: string;
  order: string;
  searchQuery: string;
  initialPage?: number;
  branch?: string;
  enabled?: boolean;
}

interface UseProjectContainerVulnerabilitiesReturn {
  vulnerabilities: ContainerVulnerabilityResult[];
  projectName: string;
  totalVulnerabilities: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  scanInfo: ScanInfo | null;
  vulnCountByType: { sast: number; iac: number; cicd: number; secret: number; sca: number; container: number; };
  goToPage: (page: number) => void;
  refresh: () => void;
}

export default function useProjectContainerVulnerabilities(options: Options): UseProjectContainerVulnerabilitiesReturn {
  const { projectId, imageId, pageSize, severity, status, priority, exploitability, scoringSource, classType, sort, order, searchQuery, initialPage = 1, branch, enabled = true } = options;

  const [vulnerabilities, setVulnerabilities] = useState<ContainerVulnerabilityResult[]>([]);
  const [projectName, setProjectName] = useState<string>("");
  const [totalVulnerabilities, setTotalVulnerabilities] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [vulnCountByType, setVulnCountByType] = useState({ sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 });

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  // Fetch scan info even when no image is selected (for scan status display)
  const fetchScanInfo = async () => {
    if (!projectId || !enabled) return;
    try {
      const response = await fetchContainerResultsForProject(projectId, {
        page: 1,
        limit: 1, // Minimal request just to get scanInfo
        branch,
      });
      setScanInfo(response.scanProjectInfo || null);
      setVulnCountByType(response.vulnCountByType || { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 });
      setProjectName(response.projectName || "");
    } catch (err: any) {
      // Silently fail - scanInfo is optional for display
      console.error('Error fetching scan info:', err);
    }
  };

  // `silent` (realtime-driven): keep loading/error and the visible data
  // untouched — on failure the user keeps what they see.
  const fetchVulnerabilities = async (pageToFetch = currentPage, silent = false) => {
    if (!enabled) { if (!silent) setLoading(false); return; }
    // When no image is selected, only fetch scan info
    if (!projectId) {
      if (silent) return;
      setVulnerabilities([]);
      setTotalVulnerabilities(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }

    if (!imageId) {
      // No image selected - fetch only scan info, not vulnerabilities.
      // Silent (realtime) path: the scan status is still worth refreshing,
      // but the visible state is never touched.
      if (silent) {
        await fetchScanInfo();
        return;
      }
      setVulnerabilities([]);
      setTotalVulnerabilities(0);
      setTotalPages(0);
      setLoading(false);
      await fetchScanInfo();
      return;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetchContainerResultsForProject(projectId, {
        page: pageToFetch,
        limit: pageSize,
        imageId,
        severity,
        status,
        priority,
        exploitability,
        ...(scoringSource && { scoringSource }),
        classType,
        sort,
        order,
        searchQuery: debouncedSearchQuery,
        branch,
      });

      setProjectName(response.projectName || "");
      setVulnerabilities(response.vulnerabilities as ContainerVulnerabilityResult[]);
      setTotalVulnerabilities(response.total);
      setTotalPages(response.totalPages);
      setCurrentPage(response.page);
      setScanInfo(response.scanProjectInfo || null);
      setVulnCountByType(response.vulnCountByType || { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 });

    } catch (err: any) {
      if (silent) {
        console.warn('Silent container vulnerability refresh failed:', err);
        return;
      }
      setError(apiErrorText(err));
      setVulnerabilities([]);
      setTotalVulnerabilities(0);
      setTotalPages(0);
      setScanInfo(null);
      setVulnCountByType({ sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchVulnerabilities(1);
  }, [projectId, imageId, pageSize, severity, status, priority, exploitability, scoringSource, classType, sort, order, debouncedSearchQuery, branch, refreshFlag, enabled]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    fetchVulnerabilities(page);
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
      void fetchVulnerabilities(currentPage, true);
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
    vulnerabilities,
    projectName,
    totalVulnerabilities,
    totalPages,
    currentPage,
    loading,
    error,
    scanInfo,
    vulnCountByType,
    goToPage,
    refresh,
  };
}