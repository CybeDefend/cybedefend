import { useCallback, useEffect, useState, useRef } from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/server/store";
import {
  getProjectBranchesList,
  archiveBranch,
  unarchiveBranch,
  BranchListResponse,
} from "@/server/services/resultService";
import { fetchProject } from "@/server/services/projectService";
import { Branch } from "../interfaces/Branch";
import { ProjectLinkedRepository } from "../interfaces/Project";
import { hookCache } from "./utils/hookCache";
import { DEFAULT_BRANCH_LIST_QUERY, cacheDefaultBranchList } from "./useProjectBranchesList";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * hookCache scope + TTL for the shared project page-data snapshot.
 *
 * The six issue-list pages (sast/iac/sca/secret/container/cicd) are separate
 * routes, so navigating between them remounts this hook from scratch. Caching
 * the resolved snapshot in the hookCache singleton (which survives unmounts)
 * lets a sibling page hydrate synchronously — no full-page skeleton and no
 * redundant project / repos / branches / archived-branches calls.
 *
 * Freshness is NOT driven by re-fetching on navigation: realtime (useScanRealtime)
 * and scan-end handlers call refresh()/refreshPageData() which force a real fetch
 * (bypassing this cache) and rewrite the snapshot. The TTL is only a safety net
 * for out-of-band changes (e.g. another user).
 */
const PAGE_DATA_SCOPE = 'projectPageData';
const PAGE_DATA_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Snapshot of the resolved page data, persisted in hookCache between mounts.
 */
interface ProjectPageDataSnapshot {
  projectName: string;
  loadedProjectId: string | null;
  integrationInfo: ProjectIntegrationInfo;
  linkedGithubRepo: string | null;
  linkedGitlabRepo: string | null;
  isSecurityContextCustomized: boolean | null;
  securityContextUpdatedAt: string | null;
  isJiraLinked: boolean | null;
  isLinearLinked: boolean | null;
  branches: Branch[];
  defaultBranch: string;
}

/**
 * Type of integration linked to a project
 */
export type ProjectIntegrationType = 'github' | 'gitlab' | 'none';

/**
 * Project integration information
 */
export interface ProjectIntegrationInfo {
  type: ProjectIntegrationType;
  repositoryId: string | null;
}

/**
 * Loading state for the page data
 */
export type PageDataLoadingState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Largest page /branches/list serves: the remembered branch is looked up by
 * name among at most this many matches.
 */
const BRANCH_LOOKUP_PAGE_SIZE = 100;

/**
 * Whether the project still has `name`, archived or not, when it is not on the
 * first page of the default view. `?search=` is a substring match, so the
 * answer is checked for the exact name. Over 100 matches without it, or a
 * failed lookup, keep the branch: it cannot be ruled out.
 */
const projectHasBranch = async (projectId: string, name: string): Promise<boolean> => {
  try {
    const res: BranchListResponse = await getProjectBranchesList(projectId, {
      search: name,
      page: 1,
      pageSize: BRANCH_LOOKUP_PAGE_SIZE,
      includeArchived: true,
    });
    return res.branches.some((b) => b.name === name) || res.pagination.hasMore;
  } catch {
    return true;
  }
};

/**
 * One archived branch of the project, if it has any: what the page shows
 * when its default view (archived branches excluded) is empty.
 */
const firstArchivedBranch = async (projectId: string): Promise<Branch[]> => {
  try {
    const res: BranchListResponse = await getProjectBranchesList(projectId, {
      search: '',
      page: 1,
      pageSize: 1,
      includeArchived: true,
    });
    return res.branches.map((b) => ({
      name: b.name,
      isDefault: b.isDefault,
      isProtected: b.isProtected,
      archived: b.archived,
    }));
  } catch {
    return [];
  }
};

/**
 * The branch a page opens on when none is remembered: the one the list names
 * as default, else the one it marks as default, else main, master, the first.
 */
const defaultBranchOf = (list: BranchListResponse, branches: Branch[]): string =>
  list.defaultBranch ||
  branches.find((b) => b.isDefault)?.name ||
  branches.find((b) => b.name === 'main')?.name ||
  branches.find((b) => b.name === 'master')?.name ||
  branches[0]?.name ||
  '';

/**
 * Hook return interface
 */
export interface UseProjectPageDataReturn {
  // Overall loading state
  loadingState: PageDataLoadingState;
  isReady: boolean;

  /**
   * True once `selectedBranch` holds the value the branch-scoped queries
   * should use — which happens well before `isReady`.
   *
   * `isReady` only flips after the whole integration chain has run (project →
   * GitHub/GitLab repos → repo branches → archived branches). The vulnerability
   * lists depend on none of that; the only asynchronous input they need is the
   * branch. Gating them on `isReady` therefore parked the single most expensive
   * request of the page behind ~2 s of calls it does not consume.
   *
   * The branch is settled as soon as any of these holds:
   *   - it came from `?branch=` or localStorage (known synchronously on mount);
   *   - STEP 1 seeded it from the project's `defaultBranch`;
   *   - the load finished, in which case an empty branch is the final answer
   *     (project with no branch at all) — hence the `isReady` fallback.
   */
  isBranchResolved: boolean;

  /**
   * True once the page can render its real layout instead of the full-page
   * skeleton. Unlike `isReady`, it does not wait for the branch list (linked
   * repository branches, archived branches): the table only needs the branch,
   * and the branch selector shows its own skeleton while `isLoadingBranches`.
   *
   * It follows `isBranchResolved` one commit later, so the list queries that
   * the same flip enables have already switched to loading: otherwise the
   * table would paint its empty state for a frame before its skeleton.
   */
  isContentReady: boolean;

  /**
   * True while the branch list is loading on a non-silent load. The branch
   * selector and the scan modal's branch picker show a loading state meanwhile.
   */
  isLoadingBranches: boolean;

  error: string | null;

  // Project display name (from the /project/:id payload). Cached in the
  // snapshot so it hydrates synchronously when navigating between sibling
  // issue-list pages — the header can render the real name immediately
  // instead of flashing a skeleton. Empty string until the project loads.
  projectName: string;

  // The id of the project the API answered for (the payload's own id), null
  // until the project loads or when it could not be loaded. What a page puts
  // in a command it offers to copy, never the id of the address.
  loadedProjectId: string | null;

  // Integration info
  integrationInfo: ProjectIntegrationInfo;
  linkedGithubRepo: string | null;
  linkedGitlabRepo: string | null;

  // Project security context customization flag (from /project/:id payload)
  // null while project data has not loaded yet.
  isSecurityContextCustomized: boolean | null;

  // Last update timestamp of the project's security context. null = project
  // has no customized security context (or fetch failed). Consumers use this
  // to shortcircuit /exploitability-stale-summary calls: when null, no
  // agent verdict can be stale (backend would return 0 anyway).
  securityContextUpdatedAt: string | null;

  // True when the organization has a Jira installation. Sourced from the
  // /project/:id payload (org-scoped, same value for all projects in the org).
  // null while project data has not loaded yet.
  isJiraLinked: boolean | null;

  // True when the organization has a Linear installation. Same source and
  // same meaning as isJiraLinked; null while project data has not loaded yet.
  isLinearLinked: boolean | null;

  // Branch data
  branches: Branch[];
  defaultBranch: string;
  selectedBranch: string;
  setSelectedBranch: (branch: string) => void;

  // Archive handlers
  handleArchiveBranch: (branchName: string) => Promise<void>;
  handleUnarchiveBranch: (branchName: string) => Promise<void>;

  // Refresh — pass true for a silent refresh that does not toggle loadingState.
  refresh: (silent?: boolean) => Promise<void>;
}

/**
 * Unified hook for loading all project page data:
 * 1. Load the project (it names the linked repository) and, alongside it, the
 *    first page of its branches from /branches/list
 * 2. Keep the remembered branch if the project still has it
 * 3. Mark as ready
 *
 * /branches/list is the only branch source: the gateway routes
 * it to the linked repository or to the project's scans and only asks
 * read_scan_result on the project, so a member reads the repository branches
 * too. The integration routes the page used to call need manage_integration,
 * which a member lacks (403, then a second, serial call). The branch selector
 * asks for the same default view and shares the request.
 *
 * The page does not wait for the branch list to render (see isContentReady).
 */
export const useProjectPageData = (projectId: string): UseProjectPageDataReturn => {
  const organization = useSelector((state: RootState) => state.organization);
  const organizationId = organization.selectedOrganization?.id || "";

  // Read the cached snapshot once, on the first render only, so the initial
  // state below can hydrate synchronously when navigating between sibling
  // issue-list pages. undefined = not yet looked up; null = looked up, no hit.
  const initialSnapshotRef = useRef<ProjectPageDataSnapshot | null | undefined>(undefined);
  if (initialSnapshotRef.current === undefined) {
    initialSnapshotRef.current = organizationId
      ? hookCache.get<ProjectPageDataSnapshot>(organizationId, PAGE_DATA_SCOPE, projectId)
      : null;
  }
  const initialSnapshot = initialSnapshotRef.current;

  // Loading state machine — start 'ready' when a warm snapshot exists so the
  // page renders its real content (and the table's own skeleton) instead of
  // the full-page AnalysePageSkeleton.
  const [loadingState, setLoadingState] = useState<PageDataLoadingState>(
    initialSnapshot ? 'ready' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);

  // Project display name — hydrated synchronously from the snapshot so a
  // sibling issue-list page shows the real name on its first commit.
  const [projectName, setProjectName] = useState<string>(
    initialSnapshot?.projectName ?? '',
  );
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(
    initialSnapshot?.loadedProjectId ?? null,
  );

  // Integration state
  const [integrationInfo, setIntegrationInfo] = useState<ProjectIntegrationInfo>(
    initialSnapshot?.integrationInfo ?? {
      type: 'none',
      repositoryId: null,
    },
  );
  const [linkedGithubRepo, setLinkedGithubRepo] = useState<string | null>(
    initialSnapshot?.linkedGithubRepo ?? null,
  );
  const [linkedGitlabRepo, setLinkedGitlabRepo] = useState<string | null>(
    initialSnapshot?.linkedGitlabRepo ?? null,
  );
  const [isSecurityContextCustomized, setIsSecurityContextCustomized] = useState<boolean | null>(
    initialSnapshot?.isSecurityContextCustomized ?? null,
  );
  const [securityContextUpdatedAt, setSecurityContextUpdatedAt] = useState<string | null>(
    initialSnapshot?.securityContextUpdatedAt ?? null,
  );
  const [isJiraLinked, setIsJiraLinked] = useState<boolean | null>(
    initialSnapshot?.isJiraLinked ?? null,
  );
  const [isLinearLinked, setIsLinearLinked] = useState<boolean | null>(
    initialSnapshot?.isLinearLinked ?? null,
  );

  // Branch state - initialize from URL query param, then localStorage
  const [branches, setBranches] = useState<Branch[]>(
    initialSnapshot?.branches ?? [],
  );
  const [defaultBranch, setDefaultBranch] = useState<string>(
    initialSnapshot?.defaultBranch ?? '',
  );
  const [selectedBranch, setSelectedBranchState] = useState<string>(() => {
    // Priority: URL ?branch= param > localStorage
    const urlBranch = new URLSearchParams(window.location.search).get('branch');
    if (urlBranch) {
      if (projectId) localStorage.setItem(`selectedBranch_${projectId}`, urlBranch);
      return urlBranch;
    }
    if (projectId) {
      const stored = localStorage.getItem(`selectedBranch_${projectId}`);
      return stored || '';
    }
    return '';
  });

  const isBranchResolved = loadingState === 'ready' || selectedBranch !== '';
  // Latched: once the page shows its content, a later reload never brings the
  // full-page skeleton back.
  const [isContentReady, setIsContentReady] = useState(isBranchResolved);
  useEffect(() => {
    if (isBranchResolved) setIsContentReady(true);
  }, [isBranchResolved]);

  // Wrapper to persist selected branch to localStorage
  const setSelectedBranch = useCallback((branch: string) => {
    setSelectedBranchState(branch);
    if (projectId && branch) {
      localStorage.setItem(`selectedBranch_${projectId}`, branch);
    }
  }, [projectId]);

  // Refs to prevent duplicate fetches
  const isLoadingRef = useRef(false);
  const lastProjectIdRef = useRef<string | null>(null);
  const lastOrgIdRef = useRef<string | null>(null);
  // Ref to track current selected branch for refresh preservation
  const selectedBranchRef = useRef<string>(selectedBranch);
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedBranchRef.current = selectedBranch;
  }, [selectedBranch]);

  /**
   * Load all data in sequence. When `silent` is true, the global
   * `loadingState` is not toggled to 'loading' — used by realtime / scan-end
   * handlers so the page does not flash while refreshing in the background.
   */
  const loadAllData = useCallback(async (silent = false, force = false) => {
    if (!projectId || !organizationId) {
      setLoadingState('ready');
      return;
    }

    // Prevent duplicate loads
    if (isLoadingRef.current) {
      return;
    }

    // Cross-page navigation: when a fresh snapshot is cached and this is not a
    // forced reload (realtime/scan-end/manual refresh always force), hydrate
    // from cache and skip the network entirely. The lazy initial state already
    // hydrated on mount; we re-assert here for the org/project-switch case and
    // resolve loadingState to 'ready'.
    if (!force) {
      const cached = hookCache.get<ProjectPageDataSnapshot>(
        organizationId,
        PAGE_DATA_SCOPE,
        projectId,
      );
      if (cached) {
        setProjectName(cached.projectName);
        setLoadedProjectId(cached.loadedProjectId ?? null);
        setIntegrationInfo(cached.integrationInfo);
        setLinkedGithubRepo(cached.linkedGithubRepo);
        setLinkedGitlabRepo(cached.linkedGitlabRepo);
        setIsSecurityContextCustomized(cached.isSecurityContextCustomized);
        setSecurityContextUpdatedAt(cached.securityContextUpdatedAt);
        setIsJiraLinked(cached.isJiraLinked);
        setIsLinearLinked(cached.isLinearLinked ?? null);
        setBranches(cached.branches);
        setDefaultBranch(cached.defaultBranch);
        lastProjectIdRef.current = projectId;
        lastOrgIdRef.current = organizationId;
        setLoadingState('ready');
        return;
      }
    }

    // Check if we already loaded for this project/org combo
    if (lastProjectIdRef.current === projectId && lastOrgIdRef.current === organizationId && loadingState === 'ready') {
      // For silent refreshes we still want to refetch — skip the early-return.
      if (!silent) {
        return;
      }
    }

    isLoadingRef.current = true;
    // Another project: the id the previous one loaded is no longer this page's.
    if (!silent && lastProjectIdRef.current !== projectId) setLoadedProjectId(null);
    lastProjectIdRef.current = projectId;
    lastOrgIdRef.current = organizationId;

    if (!silent) {
      setLoadingState('loading');
      setError(null);
    }

    try {
      // The branch list only needs the project id: request it alongside the
      // project instead of after it.
      const branchListPromise: Promise<BranchListResponse | null> = getProjectBranchesList(
        projectId,
        DEFAULT_BRANCH_LIST_QUERY,
      ).catch((e: unknown) => {
        console.warn('Project branches unavailable:', e);
        return null;
      });

      // ========== STEP 1: Get project data (name, linked repository, security context) ==========
      let linkedRepository: ProjectLinkedRepository | null | undefined;
      // Captured for the cache snapshot written at the end of a successful load.
      let snapProjectName = '';
      let snapLoadedProjectId: string | null = null;
      let snapIsSecurityContextCustomized: boolean | null = null;
      let snapSecurityContextUpdatedAt: string | null = null;
      let snapIsJiraLinked: boolean | null = null;
      let snapIsLinearLinked: boolean | null = null;

      try {
        const projectData = await fetchProject(projectId);
        linkedRepository = projectData.linkedRepository;
        snapProjectName = projectData.name ?? '';
        snapLoadedProjectId = projectData.projectId ?? null;
        setLoadedProjectId(snapLoadedProjectId);
        snapIsSecurityContextCustomized = projectData.securityContext?.isCustomized ?? false;
        snapSecurityContextUpdatedAt = projectData.securityContext?.updatedAt ?? null;
        snapIsJiraLinked = projectData.isJiraLinked ?? false;
        snapIsLinearLinked = projectData.isLinearLinked ?? false;
        setProjectName(snapProjectName);
        setIsSecurityContextCustomized(snapIsSecurityContextCustomized);
        setSecurityContextUpdatedAt(snapSecurityContextUpdatedAt);
        setIsJiraLinked(snapIsJiraLinked);
        setIsLinearLinked(snapIsLinearLinked);

        // Set selectedBranch early from parsedBranches default so code graph
        // doesn't fire with an empty branch before the branch list loads.
        if (projectData.defaultBranch && !selectedBranchRef.current && !localStorage.getItem(`selectedBranch_${projectId}`)) {
          setSelectedBranch(projectData.defaultBranch);
        }
      } catch (e) {
        // Silently fail - project may not be accessible
      }

      // ========== STEP 2: The repository linked to this project ==========
      // The /project payload names it; the organization's repository lists are
      // not read (they need manage_integration).
      const detectedIntegration: ProjectIntegrationInfo = linkedRepository?.repositoryId
        ? { type: linkedRepository.provider, repositoryId: linkedRepository.repositoryId }
        : { type: 'none', repositoryId: null };
      // The link is a property of the project: set it now, whatever happens
      // to the branch list below.
      const detectedGithubRepo = detectedIntegration.type === 'github' ? detectedIntegration.repositoryId : null;
      const detectedGitlabRepo = detectedIntegration.type === 'gitlab' ? detectedIntegration.repositoryId : null;
      setIntegrationInfo(detectedIntegration);
      setLinkedGithubRepo(detectedGithubRepo);
      setLinkedGitlabRepo(detectedGitlabRepo);

      // Captured for the cache snapshot. Default ([] / '') matches the
      // failure path below.
      let snapBranches: Branch[] = [];
      let snapDefaultBranch = '';

      // ========== STEP 3: Branches, and the branch the page shows ==========
      const branchList = await branchListPromise;
      if (branchList) {
        let firstPage: Branch[] = branchList.branches.map((b) => ({
          name: b.name,
          isDefault: b.isDefault,
          isProtected: b.isProtected,
          archived: b.archived,
        }));
        // The default view leaves the archived branches out. When it is empty
        // they may be all there is: the page must still know branches exist
        // (selector row, scan modal), so look for one. Never asked otherwise.
        if (branchList.pagination.total === 0) {
          firstPage = await firstArchivedBranch(projectId);
        }
        const defaultBranchName = defaultBranchOf(branchList, firstPage);
        snapBranches = firstPage;
        snapDefaultBranch = defaultBranchName;
        setBranches(firstPage);
        setDefaultBranch(defaultBranchName);
        // The selector of this page (or of the next one) hydrates from it.
        cacheDefaultBranchList(projectId, branchList);

        // Priority for branch selection:
        // 1. Current in-memory selected branch (if the project still has it)
        // 2. localStorage stored branch (same condition)
        // 3. The repository's scan branch, then the default branch
        // A branch beyond the first page (or archived) is looked up by name.
        const currentBranch = selectedBranchRef.current; // Get current in-memory value via ref
        const storedBranch = localStorage.getItem(`selectedBranch_${projectId}`);
        const stillExists = async (name: string): Promise<boolean> =>
          firstPage.some((b) => b.name === name) || (await projectHasBranch(projectId, name));

        if (currentBranch && (await stillExists(currentBranch))) {
          // Keep the current selection - don't change anything
          // Just ensure localStorage is in sync
          localStorage.setItem(`selectedBranch_${projectId}`, currentBranch);
        } else if (storedBranch && storedBranch !== currentBranch && (await stillExists(storedBranch))) {
          setSelectedBranchState(storedBranch);
        } else {
          const initialBranch = branchList.scanBranch || defaultBranchName;
          if (initialBranch) {
            setSelectedBranch(initialBranch);
          } else {
            setSelectedBranchState('');
          }
        }
      } else if (silent) {
        // A background refresh whose branch list failed keeps what is on
        // screen, and does not cache an empty list over the good one.
        return;
      } else {
        // No branches available, continue without them
        setBranches([]);
        setDefaultBranch('');
        setSelectedBranchState('');
      }

      // ========== STEP 5: Cache the resolved snapshot ==========
      // Persist so sibling issue-list pages hydrate synchronously on their next
      // mount instead of refetching. Forced reloads (realtime/scan-end/manual)
      // reach here too, keeping the cached snapshot authoritative.
      hookCache.set<ProjectPageDataSnapshot>(
        organizationId,
        PAGE_DATA_SCOPE,
        {
          projectName: snapProjectName,
          loadedProjectId: snapLoadedProjectId,
          integrationInfo: detectedIntegration,
          linkedGithubRepo: detectedGithubRepo,
          linkedGitlabRepo: detectedGitlabRepo,
          isSecurityContextCustomized: snapIsSecurityContextCustomized,
          securityContextUpdatedAt: snapSecurityContextUpdatedAt,
          isJiraLinked: snapIsJiraLinked,
          isLinearLinked: snapIsLinearLinked,
          branches: snapBranches,
          defaultBranch: snapDefaultBranch,
        },
        projectId,
        { ttl: PAGE_DATA_TTL },
      );

      // ========== STEP 6: Mark as ready ==========
      // For silent refreshes the state was already 'ready'; leaving it
      // untouched avoids a flash. We re-assert 'ready' for the loud path
      // so error → ready transitions still resolve correctly.
      if (!silent) {
        setLoadingState('ready');
      }

    } catch (err: any) {
      console.error('Error loading project page data:', err);
      if (silent) {
        // Keep the existing branches/integration state on a silent failure.
        console.warn('Silent project page data refresh failed:', err);
        return;
      }
      setError(apiErrorText(err));
      setLoadingState('error');
    } finally {
      isLoadingRef.current = false;
    }
  }, [projectId, organizationId, setSelectedBranch]);

  // Trigger load when projectId or organizationId changes
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Refresh all data. When `silent` is true, the global loadingState is not
  // toggled — the page keeps rendering with stale data while the refetch
  // happens in the background.
  const refresh = useCallback(async (silent = false) => {
    lastProjectIdRef.current = null; // Force reload
    await loadAllData(silent, true); // force = true: bypass the navigation cache
  }, [loadAllData]);

  // Archive a branch
  const handleArchiveBranch = useCallback(async (branchName: string) => {
    if (!projectId) return;
    try {
      await archiveBranch(projectId, branchName);
      // If the archived branch was selected, reset to default
      if (selectedBranch === branchName && defaultBranch) {
        setSelectedBranch(defaultBranch);
      }
      // Refresh to reload branches with updated archived status
      lastProjectIdRef.current = null;
      await loadAllData(false, true); // force = true: bypass the navigation cache
    } catch (err) {
      console.error('Failed to archive branch:', err);
      throw err;
    }
  }, [projectId, selectedBranch, defaultBranch, setSelectedBranch, loadAllData]);

  // Unarchive a branch
  const handleUnarchiveBranch = useCallback(async (branchName: string) => {
    if (!projectId) return;
    try {
      await unarchiveBranch(projectId, branchName);
      // Refresh to reload branches with updated archived status
      lastProjectIdRef.current = null;
      await loadAllData(false, true); // force = true: bypass the navigation cache
    } catch (err) {
      console.error('Failed to unarchive branch:', err);
      throw err;
    }
  }, [projectId, loadAllData]);

  return {
    loadingState,
    isReady: loadingState === 'ready',
    isBranchResolved,
    isContentReady,
    isLoadingBranches: loadingState === 'idle' || loadingState === 'loading',
    error,
    projectName,
    loadedProjectId,
    integrationInfo,
    linkedGithubRepo,
    linkedGitlabRepo,
    isSecurityContextCustomized,
    securityContextUpdatedAt,
    isJiraLinked,
    isLinearLinked,
    branches,
    defaultBranch,
    selectedBranch,
    setSelectedBranch,
    handleArchiveBranch,
    handleUnarchiveBranch,
    refresh,
  };
};

export default useProjectPageData;
