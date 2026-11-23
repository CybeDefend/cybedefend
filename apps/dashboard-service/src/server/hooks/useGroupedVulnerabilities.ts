import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GetGroupedVulnerabilitiesResponse,
  GetGroupedScaVulnerabilitiesResponse,
  GetGroupedContainerVulnerabilitiesResponse,
  GroupedVulnerability,
  GroupedScaVulnerability,
  GroupedContainerVulnerability,
} from '../interfaces/Vulnerability';
import {
  fetchGroupedSastResults,
  fetchGroupedIacResults,
  fetchGroupedCicdResults,
  fetchGroupedSecretResults,
  fetchGroupedScaResults,
  fetchGroupedContainerResults,
} from '../services/resultService';
import { ScanInfo } from '../interfaces/Scan';
import useDebouncedValue from './useDebouncedValue';
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

export type VulnerabilityType = 'sast' | 'iac' | 'cicd' | 'secret' | 'sca' | 'container';

interface UseGroupedVulnerabilitiesOptions {
  projectId: string;
  scanResultId?: string;
  type: VulnerabilityType;
  page?: number;
  perPage?: number;
  severityFilter?: string[];
  statusFilter?: string[];
  languageFilter?: string[];
  /** Source path filter (substring "contains"). */
  sourcePath?: string;
  priorityFilter?: string[];
  exploitabilityFilter?: string[];
  categoryFilter?: string[];
  /** Container: filter by package class (lang-pkgs | os-pkgs). */
  classTypeFilter?: string[];
  /** Container: scope grouped vulnerabilities to a single image. */
  imageId?: string;
  packageManagerFilter?: string[];
  packageManager?: string[];
  packageSource?: string[];
  fixableFilter?: boolean;
  searchQuery?: string;
  sort?: string;
  order?: string;
  branch?: string;
  /** Filter by secret source: 'head' | 'history' */
  sourceFilter?: string[];
  /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
  scoringSource?: string;
  /** When true, fetch ONLY malware findings (sca only); default excludes malware. */
  malwareOnly?: boolean;
  /** Whether to enable the hook - if false, no API call will be made */
  enabled?: boolean;
}

interface UseGroupedVulnerabilitiesReturn {
  groups: GroupedVulnerability[] | GroupedScaVulnerability[] | GroupedContainerVulnerability[];
  totalGroups: number;
  totalOccurrences: number;
  page: number;
  perPage: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  // Project info from grouped response
  projectName: string;
  scanInfo: ScanInfo | null;
  vulnCountByType: {
    sast: number;
    iac: number;
    cicd: number;
    secret: number;
    sca: number;
    container: number;
  };
  autofixCountByType: {
    sast?: { withAutofix: number; withoutAutofix: number };
    iac?: { withAutofix: number; withoutAutofix: number };
    cicd?: { withAutofix: number; withoutAutofix: number };
    secret?: { withAutofix: number; withoutAutofix: number };
  } | null;
  isProjectParsed: boolean;
  reachabilityIgnoredCount: number;
  /**
   * Distinct detection languages for this project/type/branch, surfaced
   * from the grouped response so the Language filter dropdown needs no extra fetch.
   */
  availableLanguages: string[];
  /** Project-wide total of malware findings (independent of filter/pagination). */
  malwareCount: number;
  goToPage: (page: number) => void;
  refresh: () => void;
}

export const useGroupedVulnerabilities = (
  options: UseGroupedVulnerabilitiesOptions
): UseGroupedVulnerabilitiesReturn => {
  const [groups, setGroups] = useState<GroupedVulnerability[] | GroupedScaVulnerability[] | GroupedContainerVulnerability[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalOccurrences, setTotalOccurrences] = useState(0);
  const [currentPage, setCurrentPage] = useState(options.page || 1);
  const [perPage, setPerPage] = useState(options.perPage || 50);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  
  // Project info state (same as useProjectVulnerabilities)
  const [projectName, setProjectName] = useState<string>('');
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [vulnCountByType, setVulnCountByType] = useState<{
    sast: number;
    iac: number;
    cicd: number;
    secret: number;
    sca: number;
    container: number;
  }>({
    sast: 0,
    iac: 0,
    cicd: 0,
    secret: 0,
    sca: 0,
    container: 0,
  });
  const [autofixCountByType, setAutofixCountByType] = useState<{
    sast?: { withAutofix: number; withoutAutofix: number };
    iac?: { withAutofix: number; withoutAutofix: number };
    cicd?: { withAutofix: number; withoutAutofix: number };
    secret?: { withAutofix: number; withoutAutofix: number };
  } | null>(null);
  const [isProjectParsed, setIsProjectParsed] = useState<boolean>(false);
  const [reachabilityIgnoredCount, setReachabilityIgnoredCount] = useState<number>(0);
  // Distinct detection languages embedded in the grouped response.
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [malwareCount, setMalwareCount] = useState<number>(0);

  // Debounce search query like useProjectVulnerabilities does
  const debouncedSearchQuery = useDebouncedValue(options.searchQuery || '', 300);

  // Stabilize array dependencies by serializing them
  const severityKey = useMemo(() => JSON.stringify((options.severityFilter || []).slice().sort()), [JSON.stringify(options.severityFilter)]);
  const statusKey = useMemo(() => JSON.stringify((options.statusFilter || []).slice().sort()), [JSON.stringify(options.statusFilter)]);
  const priorityKey = useMemo(() => JSON.stringify((options.priorityFilter || []).slice().sort()), [JSON.stringify(options.priorityFilter)]);
  const exploitabilityKey = useMemo(() => JSON.stringify((options.exploitabilityFilter || []).slice().sort()), [JSON.stringify(options.exploitabilityFilter)]);
  const languageKey = useMemo(() => JSON.stringify((options.languageFilter || []).slice().sort()), [JSON.stringify(options.languageFilter)]);
  const categoryKey = useMemo(() => JSON.stringify((options.categoryFilter || []).slice().sort()), [JSON.stringify(options.categoryFilter)]);
  const classTypeKey = useMemo(() => JSON.stringify((options.classTypeFilter || []).slice().sort()), [JSON.stringify(options.classTypeFilter)]);
  const packageManagerKey = useMemo(() => JSON.stringify((options.packageManagerFilter || []).slice().sort()), [JSON.stringify(options.packageManagerFilter)]);
  const packageManagerEcoKey = useMemo(
    () => JSON.stringify((options.packageManager || []).slice().sort()),
    [JSON.stringify(options.packageManager)],
  );
  const packageSourceKey = useMemo(
    () => JSON.stringify((options.packageSource || []).slice().sort()),
    [JSON.stringify(options.packageSource)],
  );
  const sourceKey = useMemo(() => JSON.stringify((options.sourceFilter || []).slice().sort()), [JSON.stringify(options.sourceFilter)]);

  const lastFetchParamsRef = useRef<string>('');
  // Every fetch takes a number; only the latest one may write the state, so
  // the answer to a superseded page or filter never replaces a newer one.
  const requestIdRef = useRef(0);
  // When true, the next effect-driven fetch skips the global loader so
  // realtime-driven refreshes don't flash the page.
  const silentRefreshRef = useRef<boolean>(false);
  // True while a visible (non-silent) load has not settled.
  const visibleLoadPendingRef = useRef<boolean>(false);

  // Every filter whose change sends the list back to page 1.
  const filtersKey = JSON.stringify([
    severityKey,
    statusKey,
    priorityKey,
    exploitabilityKey,
    languageKey,
    options.sourcePath,
    categoryKey,
    classTypeKey,
    packageManagerKey,
    packageManagerEcoKey,
    packageSourceKey,
    options.sort,
    options.order,
    debouncedSearchQuery,
    options.branch,
    options.fixableFilter,
    sourceKey,
    options.scoringSource,
    options.malwareOnly,
  ]);

  // Reset to page 1 in the same render as the filter change (not on the
  // initial mount): an effect would first send the new filter on the old page,
  // then page 1, i.e. two requests for one change.
  const [pageFiltersKey, setPageFiltersKey] = useState(filtersKey);
  if (pageFiltersKey !== filtersKey) {
    setPageFiltersKey(filtersKey);
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }

  // Generate stable key for fetch parameters
  const fetchParamsKey = useMemo(() => {
    return JSON.stringify({
      projectId: options.projectId,
      scanResultId: options.scanResultId,
      type: options.type,
      currentPage,
      perPage: options.perPage || 50,
      severityKey,
      statusKey,
      priorityKey,
      exploitabilityKey,
      languageKey,
      categoryKey,
      classTypeKey,
      imageId: options.imageId || '',
      packageManagerKey,
      packageManagerEcoKey,
      packageSourceKey,
      fixableFilter: options.fixableFilter,
      sort: options.sort,
      order: options.order,
      branch: options.branch || '',
      sourceKey,
      scoringSource: options.scoringSource || '',
      sourcePath: options.sourcePath || '',
      malwareOnly: options.malwareOnly || false,
      debouncedSearchQuery,
      refreshCounter,
    });
  }, [
    options.projectId,
    options.scanResultId,
    options.type,
    currentPage,
    options.perPage,
    severityKey,
    statusKey,
    priorityKey,
    exploitabilityKey,
    languageKey,
    options.sourcePath,
    categoryKey,
    classTypeKey,
    options.imageId,
    packageManagerKey,
    packageManagerEcoKey,
    packageSourceKey,
    options.fixableFilter,
    options.sort,
    options.order,
    options.branch,
    sourceKey,
    options.scoringSource,
    options.malwareOnly,
    debouncedSearchQuery,
    refreshCounter,
  ]);

  // Single effect for fetching
  useEffect(() => {
    // Don't fetch if not enabled or no projectId
    if (options.enabled === false || !options.projectId) {
      setLoading(false);
      return;
    }

    // Skip if params haven't changed
    if (fetchParamsKey === lastFetchParamsRef.current) {
      return;
    }
    lastFetchParamsRef.current = fetchParamsKey;

    // Consume the silent flag once per effect run. A silent refresh that
    // supersedes a visible load still in flight takes over its role: its
    // error must reach the page, which has nothing on screen yet.
    const isSilent = silentRefreshRef.current && !visibleLoadPendingRef.current;
    silentRefreshRef.current = false;
    if (!isSilent) {
      visibleLoadPendingRef.current = true;
    }

    const requestId = ++requestIdRef.current;
    const isLatest = () => requestId === requestIdRef.current;

    const fetchData = async () => {
      if (!isSilent) {
        setLoading(true);
        setError(null);
      }

      try {
        let response: GetGroupedVulnerabilitiesResponse | GetGroupedScaVulnerabilitiesResponse | GetGroupedContainerVulnerabilitiesResponse;

        // The SAST/IaC/CICD/Secret calls below ask for no
        // autofix counts: a Results page never shows them (the AutoFix page
        // does), and leaving them out saves five queries per call.
        const commonOptions = {
          page: currentPage,
          perPage: options.perPage || 50,
          severityFilter: options.severityFilter,
          statusFilter: options.statusFilter,
          searchQuery: debouncedSearchQuery || undefined,
          sort: options.sort,
          order: options.order,
          branch: options.branch,
          ...(options.scoringSource && { scoringSource: options.scoringSource }),
        };

        switch (options.type) {
          case 'sast':
            response = await fetchGroupedSastResults(
              options.projectId,
              options.scanResultId,
              {
                ...commonOptions,
                excludeAutofixCounts: true,
                languageFilter: options.languageFilter,
                sourcePath: options.sourcePath,
                priorityFilter: options.priorityFilter,
                exploitabilityFilter: options.exploitabilityFilter,
                categoryFilter: options.categoryFilter,
              }
            );
            break;
          case 'iac':
            response = await fetchGroupedIacResults(
              options.projectId,
              options.scanResultId,
              {
                ...commonOptions,
                excludeAutofixCounts: true,
                languageFilter: options.languageFilter,
                sourcePath: options.sourcePath,
                priorityFilter: options.priorityFilter,
                categoryFilter: options.categoryFilter,
              }
            );
            break;
          case 'cicd':
            response = await fetchGroupedCicdResults(
              options.projectId,
              options.scanResultId,
              {
                ...commonOptions,
                excludeAutofixCounts: true,
                languageFilter: options.languageFilter,
                sourcePath: options.sourcePath,
                priorityFilter: options.priorityFilter,
                categoryFilter: options.categoryFilter,
              }
            );
            break;
          case 'secret':
            response = await fetchGroupedSecretResults(
              options.projectId,
              options.scanResultId,
              {
                ...commonOptions,
                excludeAutofixCounts: true,
                languageFilter: options.languageFilter,
                sourcePath: options.sourcePath,
                priorityFilter: options.priorityFilter,
                categoryFilter: options.categoryFilter,
                source: options.sourceFilter,
              }
            );
            break;
          case 'sca':
            response = await fetchGroupedScaResults(
              options.projectId,
              options.scanResultId,
              {
                ...commonOptions,
                priorityFilter: options.priorityFilter,
                exploitabilityFilter: options.exploitabilityFilter,
                packageManagerFilter: options.packageManagerFilter,
                packageManager: options.packageManager,
                packageSource: options.packageSource,
                fixableFilter: options.fixableFilter,
                malwareOnly: options.malwareOnly,
              }
            );
            break;
          case 'container':
            response = await fetchGroupedContainerResults(
              options.projectId,
              options.scanResultId,
              {
                ...commonOptions,
                priorityFilter: options.priorityFilter,
                exploitabilityFilter: options.exploitabilityFilter,
                classTypeFilter: options.classTypeFilter,
                fixableFilter: options.fixableFilter,
                imageId: options.imageId,
              }
            );
            break;
          default:
            throw new Error(`Unknown vulnerability type: ${options.type}`);
        }

        if (!isLatest()) return;

        // Extract data from API response
        setGroups(response.groupedVulnerabilities || []);
        setTotalGroups(response.total || 0);
        setTotalOccurrences(response.totalOccurrences || 0);
        setPerPage(response.limit || 50);
        setTotalPages(response.totalPages || 0);
        setProjectName(response.projectName || '');
        setScanInfo(response.scanProjectInfo || null);
        setVulnCountByType(response.vulnCountByType || {
          sast: 0,
          iac: 0,
          cicd: 0,
          secret: 0,
          sca: 0,
          container: 0,
        });
        setAutofixCountByType(response.autofixCountByType || null);
        setIsProjectParsed(response.isProjectParsed ?? false);
        if ('reachabilityIgnoredCount' in response) {
          setReachabilityIgnoredCount((response as GetGroupedScaVulnerabilitiesResponse).reachabilityIgnoredCount ?? 0);
        }
        // Only sast/iac/cicd/secret grouped responses carry `languages`.
        setAvailableLanguages('languages' in response ? response.languages ?? [] : []);
        if ('malwareCount' in response) {
          setMalwareCount((response as GetGroupedScaVulnerabilitiesResponse).malwareCount ?? 0);
        }
      } catch (err: any) {
        if (!isLatest()) return;
        // Silent refreshes (realtime-driven) keep the visible state intact on
        // failure — the user keeps seeing stale data and the next user-driven
        // fetch surfaces errors normally.
        if (isSilent) {
          console.warn('Silent grouped vulnerability refresh failed:', err);
          return;
        }
        console.error('Failed to fetch grouped vulnerabilities:', err);
        setError(apiErrorText(err));
        setGroups([]);
        setTotalGroups(0);
        setTotalOccurrences(0);
        setTotalPages(0);
      } finally {
        // The latest request settles the loader, silent or not: a silent
        // refresh can supersede a visible load that set it.
        if (isLatest()) {
          visibleLoadPendingRef.current = false;
          setLoading(false);
        }
      }
    };

    fetchData();
  }, [fetchParamsKey, options.enabled]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const refresh = useCallback((silent = false) => {
    if (silent) {
      silentRefreshRef.current = true;
    }
    setRefreshCounter((prev) => prev + 1);
  }, []);

  // Realtime SSE subscription — only active when feature flag is on and projectId is known.
  // Mirrors useProjectVulnerabilities (detailed view); both views subscribe to the same
  // project issues stream so SCAN_STATUS_CHANGED + VULNERABILITY_BATCH_APPENDED events
  // refresh whichever view the user is currently looking at. The scan-in-progress pill
  // (driven by scanInfo.state) updates live because refresh() refetches the meta block.
  const realtimeUrl =
    features.realtime.issues && options.projectId && options.projectId.trim() !== ''
      ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${options.projectId}/issues/stream`
      : null;

  // Throttle the silent refresh so a burst of vuln/scan events does not
  // produce a burst of grouped-list fetches.
  const throttledRefresh = useThrottledRealtimeRefresh(
    () => refresh(true),
    `${options.projectId ?? ''}|${options.type ?? ''}`,
  );

  useRealtimeStream(
    realtimeUrl,
    {
      VULNERABILITY_BATCH_APPENDED: throttledRefresh,
      VULNERABILITY_UPDATED: throttledRefresh,
      SCAN_STATUS_CHANGED: throttledRefresh,
      // Stream reconnected — events may have been lost meanwhile; catch up.
      'snapshot-required': throttledRefresh,
    },
    [options.projectId],
  );

  return {
    groups,
    totalGroups,
    totalOccurrences,
    page: currentPage,
    perPage,
    totalPages,
    currentPage,
    loading,
    error,
    projectName,
    scanInfo,
    vulnCountByType,
    autofixCountByType,
    isProjectParsed,
    reachabilityIgnoredCount,
    availableLanguages,
    malwareCount,
    goToPage,
    refresh,
  };
};

export default useGroupedVulnerabilities;