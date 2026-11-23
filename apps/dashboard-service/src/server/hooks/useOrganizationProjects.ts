import { useEffect, useState, useRef, useCallback } from "react";
import { PaginatedProjectAalysis, ProjectAnalysis, ProjectStatistics } from "../interfaces/Project";
import { fetchProjectsForOrganization } from "../services/projectService";
import { noteProjectList } from "../services/railSnapshot";
import useDebouncedValue from "./useDebouncedValue";
import { profiler } from "@/utils/profiler";
import { useRealtimeStream } from "./useRealtimeStream";
import { useThrottledRealtimeRefresh } from "./useThrottledRealtimeRefresh";
import { features } from "@/utils/featureFlags";
import { getRegionConfig } from "@/utils/function/region";
import { apiErrorText } from '@/utils/function/apiErrorKey';

// Module-level cache to deduplicate identical requests across component instances
const pendingRequests = new Map<string, Promise<any>>();

/**
 * At most one realtime-driven refetch of the list (and one of the KPI cards)
 * per window, the last event of a burst included: a scan publishes its
 * transitions, and GM one PROJECT_STATE_CHANGED per project whose score moved,
 * in bursts of under a second.
 */
const REALTIME_REFRESH_WINDOW_MS = 2_000;

/**
 * The tab coming back refetches a list older than this only: the stream
 * delivers what changes while the tab is shown, the refetch closes a gap the
 * hidden tab may have left, and a tab switch every few seconds left no gap.
 */
const VISIBILITY_REFRESH_MIN_AGE_MS = 60_000;

/** The PROJECT_STATE_CHANGED the org-statistics worker publishes once it has persisted new KPI numbers. */
const isOrgStatsUpdated = (env: unknown): boolean =>
  (env as { payload?: { projectStateChanged?: { changeType?: unknown } } } | undefined)
    ?.payload?.projectStateChanged?.changeType === "org_stats_updated";

/**
 * Whether what the service resolved with is a list of projects.
 *
 * `fetchProjectsForOrganization` catches the failure of its request and
 * RESOLVES with the error. Read as it comes, a failed request is a list with no
 * project, and a page tells an organisation that has projects to create its
 * first one. Anything that carries no `projects` array is a failure.
 */
const isProjectList = (answer: unknown): answer is PaginatedProjectAalysis =>
  typeof answer === "object" &&
  answer !== null &&
  !(answer instanceof Error) &&
  Array.isArray((answer as { projects?: unknown }).projects);

/** A fixed translated sentence for the failure, never the server's text. */
const failureMessage = (failure: unknown): string => apiErrorText(failure);

const useOrganizationProjects = (
  organizationId: string,
  pageSize: number,
  searchQuery: string,
  enabled: boolean = true,
  // Optional side-channel so the home page can refresh the (separately fetched)
  // org KPI cards from the SAME stream — keeping ONE scoped SSE per page. It is
  // called on `org_stats_updated` only: the cards are read from the persisted
  // organisation statistics, which nothing else changes.
  onOrgStatsUpdated?: () => void
) => {
  const [projects, setProjects] = useState<ProjectAnalysis[]>([]);
  const [mainStatistics, setProjectStatistics] = useState<ProjectStatistics | null>(null);
  const [totalProjects, setTotalProjects] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasActiveScans, setHasActiveScans] = useState<boolean>(false);
  const isInitialLoad = useRef<boolean>(true);
  const lastFetchedParams = useRef<string | null>(null);
  // The organisation whose list was last answered, or refused. `loading` is
  // false for the commit that precedes the first request, and stays false while
  // this instance waits on a request another instance started: an empty
  // `projects` means « no project » only once this is the organisation asked about.
  const [answeredOrganizationId, setAnsweredOrganizationId] = useState<string | null>(null);
  const currentOrganizationId = useRef(organizationId);
  currentOrganizationId.current = organizationId;

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  // Always call the latest onOrgStatsUpdated without re-subscribing the SSE.
  const onOrgStatsUpdatedRef = useRef(onOrgStatsUpdated);
  onOrgStatsUpdatedRef.current = onOrgStatsUpdated;
  // When this instance last asked for its list, for the tab-focus refetch.
  const lastRequestedAtRef = useRef(0);

  // Track previous values to detect filter changes
  const prevDebouncedSearchQuery = useRef(debouncedSearchQuery);
  const prevPageSize = useRef(pageSize);

  const fetchProjectsInternal = useCallback(profiler('fetchOrganizationProjects')(async (fetchKey: string, silent: boolean = false) => {
    if (!organizationId || organizationId.trim() === "") {
      setProjectStatistics(null);
      setProjects([]);
      setTotalProjects(0);
      setTotalPages(0);
      setHasActiveScans(false);
      setLoading(false);
      return;
    }

    // An answer that comes back after the organisation changed says nothing of
    // the current one: neither its projects nor its failure are shown as the
    // current organisation's.
    const isCurrentOrganization = () => currentOrganizationId.current === organizationId;
    const markAnswered = () => {
      if (isCurrentOrganization()) {
        setAnsweredOrganizationId(organizationId);
      }
    };

    const showList = (data: PaginatedProjectAalysis) => {
      setProjects(data.projects);
      setProjectStatistics(data.mainStatistics || null);
      // Kept for the AppSec rail (railSnapshot), which shows what the pages
      // read and never asks the API itself. The projects only: the
      // `mainStatistics` of this response is global-management's
      // EMPTY_MAIN_STATISTICS, a stub of zeros (the real rollup is the
      // dedicated main-statistics route, noted by useOrganizationMainStatistics),
      // and noting it showed « 0 Critical » to an organisation with hundreds of
      // findings.
      noteProjectList(organizationId, data.projects);
      setTotalProjects(data.totalProjects || 0);
      setTotalPages(data.totalPages || 0);
      setHasActiveScans(data.projects.some((project: ProjectAnalysis) => project.isScanning));
    };

    const showFailure = (failure: unknown) => {
      setProjects([]);
      setProjectStatistics(null);
      setTotalProjects(0);
      setTotalPages(0);
      setHasActiveScans(false);
      setError(failureMessage(failure));
    };

    /** What a request settled with: a list, or a failure the service returned or threw. */
    const showAnswerOf = async (request: Promise<unknown>) => {
      try {
        const data = await request;
        if (!isCurrentOrganization()) return;
        if (isProjectList(data)) showList(data);
        else showFailure(data);
      } catch (failure) {
        if (isCurrentOrganization()) showFailure(failure);
      }
    };

    lastRequestedAtRef.current = Date.now();

    // Check if there's already a pending request with the same key
    const pending = pendingRequests.get(fetchKey);
    if (pending) {
      try {
        await showAnswerOf(pending);
      } finally {
        markAnswered();
        if (!silent) {
          setLoading(false);
        }
      }
      return;
    }

    if (!silent) {
      setLoading(true);
    }
    setError(null);

    const requestPromise = fetchProjectsForOrganization(
      organizationId,
      currentPage,
      pageSize,
      debouncedSearchQuery
    );

    pendingRequests.set(fetchKey, requestPromise);

    try {
      await showAnswerOf(requestPromise);
    } finally {
      pendingRequests.delete(fetchKey);
      markAnswered();
      if (!silent) {
        setLoading(false);
      }
    }
  }), [organizationId, currentPage, pageSize, debouncedSearchQuery]);

  // Public fetchProjects for polling - uses timestamp to force refresh.
  // `silent=true` suppresses the loading skeleton so background refetches
  // (realtime SSE, polling fallback) don't hide the rows already on screen.
  const fetchProjects = useCallback(async (silent: boolean = false) => {
    const pollingKey = `${organizationId}_${currentPage}_${pageSize}_${debouncedSearchQuery}_polling_${Date.now()}`;
    await fetchProjectsInternal(pollingKey, silent);
  }, [fetchProjectsInternal, organizationId, currentPage, pageSize, debouncedSearchQuery]);

  // Realtime SSE subscription — only active when feature flag is on, the org
  // is known and the list is enabled (a disabled instance shows nothing).
  const realtimeUrl =
    enabled && features.realtime.projectList && organizationId && organizationId.trim() !== ""
      ? `${getRegionConfig().apiUrl}/v1/realtime/orgs/${organizationId}/projects/stream`
      : null;

  const refreshListFromRealtime = useThrottledRealtimeRefresh(
    () => fetchProjects(true),
    organizationId,
    REALTIME_REFRESH_WINDOW_MS,
    { waitForInFlight: true },
  );
  const refreshOrgStatsFromRealtime = useThrottledRealtimeRefresh(
    () => onOrgStatsUpdatedRef.current?.(),
    organizationId,
    REALTIME_REFRESH_WINDOW_MS,
  );

  useRealtimeStream(
    realtimeUrl,
    {
      SCAN_STATUS_CHANGED: refreshListFromRealtime,
      // Every change type may move a row (created, updated, deleted, its
      // CybeRisk score, or the counts once the org recompute ran).
      PROJECT_STATE_CHANGED: (env?: unknown) => {
        refreshListFromRealtime();
        if (isOrgStatsUpdated(env)) refreshOrgStatsFromRealtime();
      },
      // The stream reconnected (token expiry, network blip): the gateway
      // replays nothing, so an `org_stats_updated` published meanwhile is
      // lost. Catch up on both, or the cards keep their numbers until the
      // next recompute.
      'snapshot-required': () => {
        refreshListFromRealtime();
        refreshOrgStatsFromRealtime();
      },
    },
    [organizationId],
  );

  useEffect(() => {

    if (!enabled) {
      return;
    }
    if (!organizationId || organizationId.trim() === "") {
      setProjectStatistics(null);
      setProjects([]);
      setTotalProjects(0);
      setTotalPages(0);
      setHasActiveScans(false);
      setLoading(false);
      isInitialLoad.current = true;
      return;
    }

    // Detect if search query or page size changed (filter change)
    const searchChanged = prevDebouncedSearchQuery.current !== debouncedSearchQuery;
    const pageSizeChanged = prevPageSize.current !== pageSize;
    prevDebouncedSearchQuery.current = debouncedSearchQuery;
    prevPageSize.current = pageSize;

    // If filters changed and not initial load, reset to page 1
    if (!isInitialLoad.current && (searchChanged || pageSizeChanged)) {
      if (currentPage !== 1) {
        setCurrentPage(1);
        // The state change will trigger this effect again, so return here
        return;
      }
    }

    // Create a unique key for this fetch request to deduplicate
    const fetchKey = `${organizationId}_${currentPage}_${pageSize}_${debouncedSearchQuery}`;

    // Skip if we already fetched with these exact parameters
    if (lastFetchedParams.current === fetchKey) {
      return;
    }

    lastFetchedParams.current = fetchKey;
    isInitialLoad.current = false;

    fetchProjectsInternal(fetchKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    organizationId,
    currentPage,
    pageSize,
    debouncedSearchQuery,
    enabled
  ]);

  // No periodic polling fallback: useRealtimeStream (above) is the sole periodic
  // refresh trigger. The only remaining extra trigger is a tab-focus refetch:
  // browsers throttle hidden tabs and may drop the SSE connection, so re-showing
  // the tab silently refetches to close any gap left while it was backgrounded.
  useEffect(() => {
    if (!enabled || !organizationId || organizationId.trim() === "") {
      return;
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRequestedAtRef.current < VISIBILITY_REFRESH_MIN_AGE_MS) return;
      void fetchProjects(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, organizationId, fetchProjects]);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Forces an immediate refetch, bypassing the dedup guard in the main fetch effect.
  // Used after explicit user actions (e.g. project creation) and by realtime events.
  const refresh = useCallback(() => {
    void fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    mainStatistics,
    totalProjects,
    totalPages,
    currentPage,
    loading,
    // True once the current organisation's list was answered or refused.
    hasLoaded: answeredOrganizationId === organizationId,
    error,
    goToPage,
    refresh,
    hasActiveScans
  };
};

export default useOrganizationProjects;
