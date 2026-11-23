import { useCallback, useEffect, useRef, useState } from 'react';
import { getProjectBranchesList, BranchListItem, BranchListResponse } from '@/server/services/resultService';
import { hookCache } from './utils/hookCache';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 300;

/**
 * The default view of a project's branches: page 1, no search, archived off.
 * The branch selector opens on it and the results pages read their branches
 * from it (useProjectPageData), so both ask for the very same request and
 * share it.
 */
export const DEFAULT_BRANCH_LIST_QUERY = {
  search: '',
  page: 1,
  pageSize: PAGE_SIZE,
  includeArchived: false,
} as const;

/**
 * hookCache scope + TTL for the DEFAULT page-1 branch view (no search, archived
 * off). Navigating between sibling issue-list pages (sast → sca → …) remounts
 * this hook; caching the default view in the hookCache singleton (which
 * survives unmounts) lets the BranchSelector hydrate synchronously — the real
 * branch trigger shows immediately instead of flashing its skeleton, and no
 * redundant /branches/list call fires on navigation. Search / archived /
 * load-more always fetch fresh (they happen inside the already-open dropdown,
 * behind the inline `searching` / `loadingMore` spinners). TTL matches
 * useProjectPageData's page-data snapshot.
 */
const BRANCHES_LIST_SCOPE = 'projectBranchesList';
const BRANCHES_LIST_TTL = 2 * 60 * 1000; // 2 minutes

interface BranchesListSnapshot {
  branches: BranchListItem[];
  defaultBranch: string;
  scanBranch: string;
  total: number;
  hasMore: boolean;
  page: number;
}

/** Keeps the default view so the next selector mounted for the project hydrates from it. */
export const cacheDefaultBranchList = (projectId: string, res: BranchListResponse): void => {
  hookCache.set<BranchesListSnapshot>(
    projectId,
    BRANCHES_LIST_SCOPE,
    {
      branches: res.branches,
      defaultBranch: res.defaultBranch,
      scanBranch: res.scanBranch,
      total: res.pagination.total,
      hasMore: res.pagination.hasMore,
      page: res.pagination.page,
    },
    undefined,
    { ttl: BRANCHES_LIST_TTL },
  );
};

export function useProjectBranchesList(projectId: string | null) {
  // Read the cached default-view snapshot once, on the first render only, so
  // the state below hydrates synchronously when navigating between sibling
  // pages. undefined = not yet looked up; null = looked up, no hit.
  const initialSnapshotRef = useRef<BranchesListSnapshot | null | undefined>(undefined);
  if (initialSnapshotRef.current === undefined) {
    initialSnapshotRef.current = projectId
      ? hookCache.get<BranchesListSnapshot>(projectId, BRANCHES_LIST_SCOPE)
      : null;
  }
  const initialSnapshot = initialSnapshotRef.current;

  const [branches, setBranches] = useState<BranchListItem[]>(initialSnapshot?.branches ?? []);
  const [search, setSearchState] = useState('');
  // The search the list was last asked for, read synchronously by setSearch.
  const searchRef = useRef('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(initialSnapshot?.page ?? 1);
  const [total, setTotal] = useState(initialSnapshot?.total ?? 0);
  const [hasMore, setHasMore] = useState(initialSnapshot?.hasMore ?? false);
  const [defaultBranch, setDefaultBranch] = useState(initialSnapshot?.defaultBranch ?? '');
  const [scanBranch, setScanBranch] = useState(initialSnapshot?.scanBranch ?? '');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reqId = useRef(0);
  // The full-component skeleton (`loading`) must only flash on the very first
  // load for a project. Once branches have loaded once, every subsequent
  // refetch (search, archived toggle) happens inside the already-open dropdown
  // and must use the inline `searching` spinner instead — never the skeleton.
  // A cache hit counts as already-loaded so a navigation never skeletons.
  const initialLoadedRef = useRef(!!initialSnapshot);
  // One-shot guard: skip the page-1 mount fetch when the default view was
  // hydrated from a fresh cache snapshot. Cleared after the first effect run so
  // includeArchived toggles still refetch.
  const skipInitialFetchRef = useRef(!!initialSnapshot);

  const fetchPage = useCallback(
    async (opts: {
      page: number;
      search: string;
      includeArchived: boolean;
      append: boolean;
    }) => {
      if (!projectId) return;
      const id = ++reqId.current;
      if (opts.append) {
        setLoadingMore(true);
      } else if (initialLoadedRef.current) {
        // Subsequent refetch within the open dropdown → inline spinner only.
        setSearching(true);
      } else {
        // First load for this project → full skeleton.
        setLoading(true);
      }
      setError(null);
      try {
        const res = await getProjectBranchesList(projectId, {
          search: opts.search,
          page: opts.page,
          pageSize: PAGE_SIZE,
          includeArchived: opts.includeArchived,
        });
        if (id !== reqId.current) return;
        setBranches((prev) => (opts.append ? [...prev, ...res.branches] : res.branches));
        setPage(res.pagination.page);
        setTotal(res.pagination.total);
        setHasMore(res.pagination.hasMore);
        setDefaultBranch(res.defaultBranch);
        setScanBranch(res.scanBranch);

        // Cache the DEFAULT page-1 view (no search, archived off) so sibling
        // issue-list pages hydrate synchronously on their next mount — no
        // skeleton flash, no redundant fetch on navigation. Search / archived /
        // paged results are intentionally NOT cached as the default view.
        if (
          projectId &&
          !opts.append &&
          opts.page === 1 &&
          opts.search === '' &&
          !opts.includeArchived
        ) {
          cacheDefaultBranchList(projectId, res);
        }
      } catch (e: any) {
        if (id === reqId.current) setError(apiErrorText(e));
      } finally {
        if (id === reqId.current) {
          initialLoadedRef.current = true;
          setLoading(false);
          setLoadingMore(false);
          setSearching(false);
        }
      }
    },
    [projectId],
  );

  // A new project starts fresh: allow the full skeleton on its first load.
  // Runs before the fetch effect below (declaration order), so the fetch sees
  // the reset flag. Toggling `includeArchived` does NOT reset it — that refetch
  // stays inline because the project is already loaded.
  useEffect(() => {
    initialLoadedRef.current = false;
  }, [projectId]);

  // Re-fetch whenever projectId or includeArchived changes (reset to page 1).
  // `search` is intentionally excluded from the deps: changing the project or
  // toggling archived must preserve the current search term (its own debounced
  // path handles search changes), so we read the latest `search` by closure
  // rather than re-running this effect on every keystroke.
  useEffect(() => {
    // Warm-cache first mount: branches were hydrated synchronously above, so
    // skip the network fetch — navigating between issue-list pages must not
    // refetch branches. Mark the default view as loaded so any later refetch
    // uses the inline spinner, not the skeleton. One-shot: includeArchived
    // toggles (which clear the flag's effect by running afterwards) still fetch.
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      initialLoadedRef.current = true;
      return;
    }
    fetchPage({ page: 1, search, includeArchived, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, includeArchived]);

  // Cancel any pending search debounce on unmount so a late timer can't fire a
  // fetch (and bump reqId) after the component is gone.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const setSearch = useCallback(
    (value: string) => {
      // An async Select lifts '' on mount and on every close: the list already
      // holds that view, so there is nothing to fetch.
      if (value === searchRef.current) return;
      searchRef.current = value;
      setSearchState(value);
      setSearching(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchPage({ page: 1, search: value, includeArchived, append: false });
      }, DEBOUNCE_MS);
    },
    [fetchPage, includeArchived],
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore) return;
    await fetchPage({ page: page + 1, search, includeArchived, append: true });
  }, [hasMore, loading, loadingMore, page, search, includeArchived, fetchPage]);

  const toggleArchived = useCallback(() => setIncludeArchived((v) => !v), []);

  // Page 1 of the current view again (search and archived kept): what the
  // selector shows after a branch was archived or unarchived.
  const reload = useCallback(
    () => fetchPage({ page: 1, search: searchRef.current, includeArchived, append: false }),
    [fetchPage, includeArchived],
  );

  return {
    branches,
    search,
    setSearch,
    includeArchived,
    toggleArchived,
    page,
    total,
    hasMore,
    defaultBranch,
    scanBranch,
    loading,
    loadingMore,
    searching,
    error,
    loadMore,
    reload,
  };
}

export default useProjectBranchesList;
