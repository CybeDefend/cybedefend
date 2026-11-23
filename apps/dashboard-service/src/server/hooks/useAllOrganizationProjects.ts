import { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectAnalysis } from '../interfaces/Project';
import { fetchProjectsForOrganization } from '../services/projectService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Hook to fetch ALL projects from an organization
 * Handles pagination automatically to bypass the 20-item limit
 *
 * @param organizationId - The ID of the organization
 * @param enabled - When false, the hook stays inert and produces no network
 *   traffic. Used by an always-mounted caller (e.g. GlobalChatDrawer) to defer
 *   the full multi-page project-list sweep until the chat is actually opened —
 *   on a typical home-page session that's the difference between 4 and 1
 *   /projects requests at load. Defaults to true so existing callers keep
 *   their eager behaviour.
 * @returns Object containing all projects, loading state, error, and refresh function
 */
interface UseAllOrganizationProjectsReturn {
  projects: ProjectAnalysis[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Module-level in-flight cache to deduplicate identical aggregate fetches
// across concurrent consumers. Same pattern as `useOrganizationProjects`'s
// `pendingRequests` map — without it, every component instance that mounts
// the hook fires its own full pagination sweep (page=1, then 2..N in
// parallel), which is multiplied by the number of consumers on screen.
// In practice the `GlobalChatDrawer` mounts this hook twice (directly + via
// `useChatPageContext`), so a 3-page org produced 6 /projects requests
// instead of 3 before this dedup was added.
const pendingAggregateRequests = new Map<string, Promise<ProjectAnalysis[]>>();

/** Test-only: clear the module-level dedup cache between tests. */
export function __resetAllOrganizationProjectsCacheForTests(): void {
  pendingAggregateRequests.clear();
}

const fetchAllProjectsAggregate = async (
  organizationId: string,
): Promise<ProjectAnalysis[]> => {
  const pageSize = 10; // Maximum allowed by backend

  // Fetch first page to learn `totalPages`. We cannot parallelise from the
  // start because the response itself tells us how many pages exist.
  const firstPageData = await fetchProjectsForOrganization(
    organizationId,
    1,
    pageSize,
    '' // No search query
  );

  let allProjects: ProjectAnalysis[] = firstPageData.projects || [];
  const totalPages: number = firstPageData.totalPages || 1;

  if (totalPages > 1) {
    const remainingPagesPromises = [];
    for (let page = 2; page <= totalPages; page++) {
      remainingPagesPromises.push(
        fetchProjectsForOrganization(organizationId, page, pageSize, '')
      );
    }

    const remainingPagesData = await Promise.all(remainingPagesPromises);
    remainingPagesData.forEach((pageData) => {
      allProjects = [...allProjects, ...(pageData.projects || [])];
    });
  }

  return allProjects;
};

const useAllOrganizationProjects = (
  organizationId: string,
  enabled: boolean = true
): UseAllOrganizationProjectsReturn => {
  const [projects, setProjects] = useState<ProjectAnalysis[]>([]);
  // Start with loading=false when disabled so consumers can render their
  // empty/closed state without a perpetual spinner. The first transition to
  // enabled flips loading=true via fetchAllProjects().
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);
  // Track the orgId for which we have a populated `projects` state. Once
  // populated, re-enabling (e.g. user closes then reopens the chat drawer)
  // does NOT re-fetch — only an explicit refresh() or an orgId change does.
  const loadedOrgIdRef = useRef<string | null>(null);
  // Tracks the last value of `refreshFlag` we observed in the effect, so we
  // can distinguish a real refresh() call from an enabled/orgId-driven
  // re-run of the effect.
  const lastSeenRefreshFlagRef = useRef<boolean>(refreshFlag);

  /**
   * Fetches all projects by iterating through pages. Reuses any concurrent
   * in-flight aggregate fetch for the same org via the module-level cache.
   */
  const fetchAllProjects = useCallback(async () => {
    // Lazy gate: a disabled caller never triggers the multi-page fetch. The
    // already-loaded projects (if any) are intentionally kept so a feature
    // toggled off then on again still shows its last known list.
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!organizationId || organizationId.trim() === '') {
      setLoading(false);
      setError(null);
      setProjects([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // The dedup key is per-org. Search/pagination params are constant for
      // this hook (full sweep, no search), so the org is sufficient.
      const dedupKey = organizationId;
      let aggregatePromise = pendingAggregateRequests.get(dedupKey);

      if (!aggregatePromise) {
        aggregatePromise = fetchAllProjectsAggregate(organizationId);
        pendingAggregateRequests.set(dedupKey, aggregatePromise);
        // Whichever consumer initiated the fetch must clear the cache once
        // it settles — otherwise a stale rejected/resolved promise would
        // pin the result forever. We do NOT await here to avoid blocking;
        // the cleanup runs on settle regardless of who's awaiting below.
        void aggregatePromise.finally(() => {
          if (pendingAggregateRequests.get(dedupKey) === aggregatePromise) {
            pendingAggregateRequests.delete(dedupKey);
          }
        });
      }

      const allProjects = await aggregatePromise;
      setProjects(allProjects);
      loadedOrgIdRef.current = organizationId;
    } catch (err: any) {
      console.error(
        // cybedefend-ignore[CD-SAST-1269]: a developer console message in the user's own browser, naming the organization the user selected
        `❌ Failed to load all projects for organization ${organizationId}:`,
        err
      );
      setError(
        apiErrorText(err)
      );
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, enabled]);

  /**
   * Public refresh function for manual data reloading
   */
  const refresh = useCallback(() => {
    setRefreshFlag((prev) => !prev);
  }, []);

  // Fetch policy:
  //   - if disabled → never fetch (no spinner, no network)
  //   - if enabled and not yet loaded for this org → fetch
  //   - if enabled, already loaded, and a refresh was just requested → fetch
  //   - otherwise (re-enable / unrelated rerender) → skip
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const refreshRequested =
      lastSeenRefreshFlagRef.current !== refreshFlag;
    lastSeenRefreshFlagRef.current = refreshFlag;

    const alreadyLoadedForThisOrg =
      loadedOrgIdRef.current === organizationId && organizationId !== '';
    if (alreadyLoadedForThisOrg && !refreshRequested) {
      return;
    }

    fetchAllProjects();
  }, [fetchAllProjects, refreshFlag, enabled, organizationId]);

  return {
    projects,
    loading,
    error,
    refresh,
  };
};

export default useAllOrganizationProjects;
