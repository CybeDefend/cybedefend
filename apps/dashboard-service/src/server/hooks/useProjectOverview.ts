import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GetProjectOverviewResponse, ProjectBranch } from '@/server/interfaces/Vulnerability';
import { getProjectOverview, getProjectBranches, getArchivedBranches, archiveBranch, unarchiveBranch } from '@/server/services/resultService';
import { fetchProject } from '@/server/services/projectService';
import { ParsedBranch } from '@/server/interfaces/Project';
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseProjectOverviewReturn {
  /** Project overview data */
  data: GetProjectOverviewResponse | null;
  /** Loading state */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Available branches for the project (with archived status) */
  branches: ProjectBranch[];
  /** Currently selected branch (null means all branches) */
  selectedBranch: string | null;
  /** Select a branch (null to show all) */
  setSelectedBranch: (branch: string | null) => void;
  /** Refresh the data */
  refresh: () => Promise<void>;
  /** Archive a branch */
  handleArchiveBranch: (branchName: string) => Promise<void>;
  /** Unarchive a branch */
  handleUnarchiveBranch: (branchName: string) => Promise<void>;
}

/**
 * Custom hook to fetch project overview statistics with branch filtering.
 * Provides vulnerability data including severity distribution,
 * state distribution, analysis types, and trends over time.
 * 
 * @param projectId - The project ID to fetch overview for
 * @param initialBranch - Optional initial branch to select
 * @returns Object containing data, loading state, error, branches, and control functions
 */
export const useProjectOverview = (
  projectId: string | undefined,
  initialBranch?: string | null
): UseProjectOverviewReturn => {
  const [data, setData] = useState<GetProjectOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<ProjectBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(initialBranch ?? null);
  const branchesRequestIdRef = useRef(0);

  // Fetch available branches - try API first, then fallback to parsedBranches.
  // The archived list only needs the project id: it is requested alongside
  // the branch list instead of after it.
  const fetchBranchesData = useCallback(async () => {
    if (!projectId) return;
    // Only the latest branch load may write them: the branches of a project
    // the user already left never replace those of the one on screen.
    const requestId = ++branchesRequestIdRef.current;

    const archivedPromise = getArchivedBranches(projectId)
      .then((archivedResponse: { branches?: string[] }) => archivedResponse.branches || [])
      .catch(() => {
        // Archived endpoint may not be available yet
        console.log('Archived branches endpoint not available');
        return [] as string[];
      });

    let normalizedBranches: ProjectBranch[] = [];

    try {
      // First try the dedicated branches endpoint
      const response = await getProjectBranches(projectId);
      if (response.branches && response.branches.length > 0) {
        // Handle both string[] and ProjectBranch[] formats
        normalizedBranches = response.branches.map((branch: any, index: number) => {
          if (typeof branch === 'string') {
            return {
              name: branch,
              isDefault: branch === 'main' || branch === 'master' || index === 0,
            };
          }
          return branch;
        });
      }
    } catch (err) {
      console.log('Branches endpoint not available, trying parsedBranches...');
    }

    // Fallback: try to get branches from project's parsedBranches
    if (normalizedBranches.length === 0) {
      try {
        const project = await fetchProject(projectId);
        if (project.parsedBranches && project.parsedBranches.length > 0) {
          normalizedBranches = project.parsedBranches.map((pb: ParsedBranch, index: number) => ({
            name: pb.branch,
            isDefault: pb.branch === 'main' || pb.branch === 'master' || index === 0,
          }));
        }
      } catch (err) {
        console.error('Failed to fetch branches from project:', err);
      }
    }

    // Merge archived status
    const archivedNames = await archivedPromise;

    // Remove duplicates and merge archived status
    const archivedSet = new Set(archivedNames);
    const uniqueBranches = normalizedBranches
      .filter((branch, idx, arr) => arr.findIndex(b => b.name === branch.name) === idx)
      .map(branch => ({
        ...branch,
        archived: archivedSet.has(branch.name),
      }));

    // Also add archived branches that aren't in the main list (e.g., no longer in scans)
    for (const archivedName of archivedNames) {
      if (!uniqueBranches.find(b => b.name === archivedName)) {
        uniqueBranches.push({
          name: archivedName,
          isDefault: false,
          archived: true,
        });
      }
    }

    if (requestId !== branchesRequestIdRef.current) return;
    setBranches(uniqueBranches);
  }, [projectId]);

  // "All branches" excludes the archived ones: the request names the other
  // branches, but only when at least one branch is archived. Keyed by value,
  // so a branch list that lands without an archived branch (the usual case)
  // does not fetch the overview a second time.
  const allBranchesFilterKey = useMemo(() => {
    const nonArchived = branches.filter(b => !b.archived).map(b => b.name);
    return nonArchived.length > 0 && branches.some(b => b.archived)
      ? JSON.stringify(nonArchived)
      : '';
  }, [branches]);

  // Every fetch takes a number; only the latest one may write the state, so
  // an answer to a superseded request (older filter, earlier realtime
  // refresh) never replaces a newer one.
  const requestIdRef = useRef(0);
  // True while a visible (non-silent) load has not settled. A silent refresh
  // that supersedes it takes over its role: its error must reach the page,
  // or a first load superseded then failed would leave it empty, no error.
  const visibleLoadPendingRef = useRef(false);

  // Fetch overview data. When `silent` is true, the global loading/error flags
  // are not toggled — used by realtime handlers so the page does not flash.
  const fetchOverview = useCallback(async (requestedSilent = false) => {
    const requestId = ++requestIdRef.current;
    const isLatest = () => requestId === requestIdRef.current;
    const silent = requestedSilent && !visibleLoadPendingRef.current;
    if (!silent) {
      visibleLoadPendingRef.current = true;
    }

    if (!projectId) {
      if (!silent) {
        visibleLoadPendingRef.current = false;
        setLoading(false);
        setError('Project ID is required');
      }
      return;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      let response: GetProjectOverviewResponse;
      if (selectedBranch) {
        // Specific branch selected
        response = await getProjectOverview(projectId, selectedBranch);
      } else if (allBranchesFilterKey) {
        // "All branches" — exclude archived branches
        response = await getProjectOverview(
          projectId,
          undefined,
          JSON.parse(allBranchesFilterKey) as string[],
        );
      } else {
        // No archived branches — fetch all (no filter)
        response = await getProjectOverview(projectId);
      }
      if (!isLatest()) return;
      setData(response);
    } catch (err: any) {
      if (!isLatest()) return;
      if (silent) {
        console.warn('Silent project overview refresh failed:', err);
        return;
      }
      const errorMessage = apiErrorText(err);
      setError(errorMessage);
      setData(null);
    } finally {
      // The latest request settles the loader, silent or not: a silent
      // refresh can supersede a visible load that would otherwise leave the
      // loader on for good.
      if (isLatest()) {
        visibleLoadPendingRef.current = false;
        setLoading(false);
      }
    }
  }, [projectId, selectedBranch, allBranchesFilterKey]);

  // Realtime SSE wiring — re-fetches on relevant server-push events
  const realtimeUrl = features.realtime.projectStats && projectId && projectId.trim() !== ''
    ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/stats/stream`
    : null;

  // Realtime-driven refreshes are silent — they update the page in place
  // without flashing the global loader — and throttled, never two at once: a
  // scan publishes one VULNERABILITY_BATCH_APPENDED per ingested batch, and
  // each relaunched the whole overview. The trailing fire reads
  // the latest branch selection.
  const refreshFromRealtime = useThrottledRealtimeRefresh(
    () => fetchOverview(true),
    projectId,
    undefined,
    { waitForInFlight: true },
  );

  useRealtimeStream(realtimeUrl, {
    STATS_AGGREGATE_CHANGED: refreshFromRealtime,
    SCAN_STATUS_CHANGED: refreshFromRealtime,
    VULNERABILITY_BATCH_APPENDED: refreshFromRealtime,
    POLICY_EVALUATION_COMPLETED: refreshFromRealtime,
  }, [projectId]);

  // Fetch branches on mount
  useEffect(() => {
    fetchBranchesData();
  }, [fetchBranchesData]);

  // Fetch overview on mount and when branch changes
  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Archive a branch
  const handleArchiveBranch = useCallback(async (branchName: string) => {
    if (!projectId) return;
    try {
      await archiveBranch(projectId, branchName);
      // If the archived branch was selected, reset selection
      if (selectedBranch === branchName) {
        setSelectedBranch(null);
      }
      // Refresh branches to reflect new archived status
      await fetchBranchesData();
    } catch (err) {
      console.error('Failed to archive branch:', err);
      throw err;
    }
  }, [projectId, selectedBranch, fetchBranchesData]);

  // Unarchive a branch
  const handleUnarchiveBranch = useCallback(async (branchName: string) => {
    if (!projectId) return;
    try {
      await unarchiveBranch(projectId, branchName);
      // Refresh branches to reflect new archived status
      await fetchBranchesData();
    } catch (err) {
      console.error('Failed to unarchive branch:', err);
      throw err;
    }
  }, [projectId, fetchBranchesData]);

  return {
    data,
    loading,
    error,
    branches,
    selectedBranch,
    setSelectedBranch,
    refresh: fetchOverview,
    handleArchiveBranch,
    handleUnarchiveBranch,
  };
};

export default useProjectOverview;
