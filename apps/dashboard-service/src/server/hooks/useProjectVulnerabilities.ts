import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { productHome } from "@/utils/product";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import useDebouncedValue from "./useDebouncedValue";
import {
  CicdVulnerabilityResult,
  IacVulnerabilityResult,
  SastVulnerabilityResult,
  ScaVulnerabilityResult,
  SecretVulnerabilityResult,
} from "../interfaces/Vulnerability";
import {
  fetchSastResultsForProject,
  fetchIacResultsForProject,
  fetchCicdResultsForProject,
  fetchSecretResultsForProject,
  fetchScaResultsForProject,
} from "../services/resultService";
import { ScanInfo } from "../interfaces/Scan";
import { hookCache } from "./utils/hookCache";
import { profiler } from "@/utils/profiler";
import { useRealtimeStream } from "./useRealtimeStream";
import { useThrottledRealtimeRefresh } from "./useThrottledRealtimeRefresh";
import { features } from "@/utils/featureFlags";
import { getRegionConfig } from "@/utils/function/region";
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseProjectVulnerabilitiesOptions {
  projectId: string;
  type: "sast" | "iac" | "cicd" | "secret" | "sca";
  pageSize: number;
  severity: string[];
  status: string[];
  priority: string[];
  exploitability?: string[];
  /** Filter by scoring source ('static' | 'agent'). Omitted when undefined. */
  scoringSource?: string;
  sort: string;
  order: string;
  searchQuery: string;
  initialPage?: number;
  packageType?: string | string[];
  /** Language filter (multi-value, exact) for sast/iac/cicd/secret. */
  language?: string[];
  /** Source path filter (substring "contains") for sast/iac/cicd/secret. */
  sourcePath?: string;
  packageManager?: string[];
  packageSource?: string[];
  branch?: string;
  /** Filter by secret source: 'head' | 'history' (secret type only) */
  source?: string[];
  /** Filter by commit SHA partial match (secret type only) */
  commitSha?: string;
  /** When true, fetch ONLY malware findings (sca only); default excludes malware. */
  malwareOnly?: boolean;
  /** Whether the hook should fetch data. Useful to wait for dependencies like branches to load first. Defaults to true. */
  enabled?: boolean;
}

interface CommonReturnType {
  projectName: string;
  totalVulnerabilities: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  scanInfo: ScanInfo | null;
  vulnCountByType: {
    sast: number;
    iac: number;
    cicd: number;
    secret: number;
    sca: number;
    container: number;
    aibom?: number;
  };
  /** Whether the project has been parsed for AI features */
  isProjectParsed: boolean;
  reachabilityIgnoredCount: number;
  /**
   * Distinct detection languages for this project/type/branch, surfaced
   * from the list response so the Language filter dropdown needs no extra fetch.
   */
  availableLanguages: string[];
  /** Project-wide total of malware findings (independent of filter/pagination). */
  malwareCount: number;
  goToPage: (page: number) => void;
  refresh: () => void;
}

function useProjectVulnerabilities(
  options: UseProjectVulnerabilitiesOptions & { type: "sast" }
): { vulnerabilities: SastVulnerabilityResult[] } & CommonReturnType;

function useProjectVulnerabilities(
  options: UseProjectVulnerabilitiesOptions & { type: "iac" }
): { vulnerabilities: IacVulnerabilityResult[] } & CommonReturnType;

function useProjectVulnerabilities(
  options: UseProjectVulnerabilitiesOptions & { type: "cicd" }
): { vulnerabilities: CicdVulnerabilityResult[] } & CommonReturnType;

function useProjectVulnerabilities(
  options: UseProjectVulnerabilitiesOptions & { type: "secret" }
): { vulnerabilities: SecretVulnerabilityResult[] } & CommonReturnType;

function useProjectVulnerabilities(
  options: UseProjectVulnerabilitiesOptions & { type: "sca" }
): { vulnerabilities: ScaVulnerabilityResult[] } & CommonReturnType;

function useProjectVulnerabilities(
  options: UseProjectVulnerabilitiesOptions &
    ({ type: "sast" } | { type: "iac" } | { type: "cicd" } | { type: "secret" } | { type: "sca" })
): CommonReturnType & {
  vulnerabilities:
    | SastVulnerabilityResult[]
    | IacVulnerabilityResult[]
    | CicdVulnerabilityResult[]
    | SecretVulnerabilityResult[]
    | ScaVulnerabilityResult[];
} {
  const {
    projectId,
    type,
    pageSize,
    severity,
    status,
    priority,
    exploitability,
    scoringSource,
    sort,
    order,
    searchQuery,
    initialPage = 1,
    packageType,
    language,
    sourcePath,
    packageManager,
    packageSource,
    branch,
    source,
    commitSha,
    malwareOnly,
    enabled = true,
  } = options;

  // Stabilize array dependencies by serializing them
  const severityKey = useMemo(() => JSON.stringify(severity.slice().sort()), [JSON.stringify(severity)]);
  const statusKey = useMemo(() => JSON.stringify(status.slice().sort()), [JSON.stringify(status)]);
  const priorityKey = useMemo(() => JSON.stringify(priority.slice().sort()), [JSON.stringify(priority)]);
  const exploitabilityKey = useMemo(() => JSON.stringify((exploitability || []).slice().sort()), [JSON.stringify(exploitability)]);
  const packageTypeKey = useMemo(() =>
    Array.isArray(packageType) ? JSON.stringify(packageType.slice().sort()) : packageType || '',
    [JSON.stringify(packageType)]
  );
  const packageManagerKey = useMemo(
    () => JSON.stringify((packageManager || []).slice().sort()),
    [JSON.stringify(packageManager)],
  );
  const packageSourceKey = useMemo(
    () => JSON.stringify((packageSource || []).slice().sort()),
    [JSON.stringify(packageSource)],
  );
  const sourceKey = useMemo(() => JSON.stringify((source || []).slice().sort()), [JSON.stringify(source)]);
  const languageKey = useMemo(() => JSON.stringify((language || []).slice().sort()), [JSON.stringify(language)]);

  const [vulnerabilities, setVulnerabilities] = useState<
    | IacVulnerabilityResult[]
    | SastVulnerabilityResult[]
    | ScaVulnerabilityResult[]
  >([]);
  const [projectName, setProjectName] = useState<string>("");
  const [totalVulnerabilities, setTotalVulnerabilities] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [vulnCountByType, setVulnCountByType] = useState<{
    sast: number;
    iac: number;
    cicd: number;
    secret: number;
    sca: number;
    container: number;
    aibom?: number;
  }>({
    sast: 0,
    iac: 0,
    cicd: 0,
    secret: 0,
    sca: 0,
    container: 0,
    aibom: 0,
  });
  const [isProjectParsed, setIsProjectParsed] = useState<boolean>(false);
  const [reachabilityIgnoredCount, setReachabilityIgnoredCount] = useState<number>(0);
  // Distinct detection languages embedded in the list response.
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [malwareCount, setMalwareCount] = useState<number>(0);

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const navigate = useNavigate();
  const { t } = useTranslation();
  
  // Refs for tracking state
  const hasRedirectedRef = useRef(false);
  // Every fetch takes a number; only the latest one may write the state, so
  // the answer to a superseded page or filter never replaces a newer one.
  const requestIdRef = useRef(0);
  // An answer that lands after the page is gone must not toast or navigate.
  const mountedRef = useRef(false);
  const lastFetchParamsRef = useRef<string>("");
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
    scoringSource,
    sort,
    order,
    debouncedSearchQuery,
    packageTypeKey,
    packageManagerKey,
    packageSourceKey,
    branch,
    languageKey,
    sourcePath,
    malwareOnly,
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

  // Generate a stable key for current fetch parameters
  const fetchParamsKey = useMemo(() => {
    return JSON.stringify({
      projectId,
      type,
      currentPage,
      pageSize,
      severityKey,
      statusKey,
      priorityKey,
      exploitabilityKey,
      sort,
      order,
      debouncedSearchQuery,
      packageTypeKey,
      packageManagerKey,
      packageSourceKey,
      branch: branch || '',
      sourceKey,
      scoringSource: scoringSource || '',
      commitSha: commitSha || '',
      languageKey,
      sourcePath: sourcePath || '',
      malwareOnly: malwareOnly || false,
      refreshCounter,
    });
  }, [projectId, type, currentPage, pageSize, severityKey, statusKey, priorityKey, exploitabilityKey, scoringSource, sort, order, debouncedSearchQuery, packageTypeKey, packageManagerKey, packageSourceKey, branch, sourceKey, commitSha, languageKey, sourcePath, malwareOnly, refreshCounter]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Single effect for all fetching - this is the ONLY place that fetches
  useEffect(() => {
    // Don't fetch if not enabled
    if (!enabled) {
      return;
    }

    // Don't fetch if no projectId
    if (!projectId) {
      setVulnerabilities([]);
      setTotalVulnerabilities(0);
      setTotalPages(0);
      return;
    }

    // Skip if params haven't changed (prevents duplicate fetches)
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
    const isLatest = () => mountedRef.current && requestId === requestIdRef.current;

    const fetchData = async () => {
      if (!isSilent) {
        setLoading(true);
        setError(null);
      }

      try {
        const commonOptions = {
          pageNumber: currentPage,
          pageSizeNumber: pageSize,
          // The Results pages never show the autofix counts
          // (the AutoFix page does); leaving them out saves five queries.
          excludeAutofixCounts: true,
          severity,
          status,
          priority,
          exploitability,
          sort,
          order,
          searchQuery: debouncedSearchQuery,
          // Do NOT send the UI locale (i18n.language) as the `language`
          // vulnerability filter. The gateway now wires `language` to a real
          // `WHERE detection.language IN (...)` filter, so passing "en"/"fr"
          // would match no detection language (Terraform/YAML/...) and wrongly
          // empty the detailed view. The language filter, when added to this
          // view, must come from an explicit user selection, not the locale.
          ...(scoringSource && { scoringSource }),
          ...(type === "sca" && packageType && { packageType }),
          ...(type === "sca" && packageManager?.length && { packageManager }),
          ...(type === "sca" && packageSource?.length && { packageSource }),
          // `malwareOnly` is SCA-only; when true the backend returns
          // ONLY malware findings, otherwise it excludes them.
          ...(type === "sca" && malwareOnly && { malwareOnly: true }),
          ...(branch && { branch }),
          ...(type === "secret" && source && source.length > 0 && { source }),
          ...(type === "secret" && commitSha && { commitSha }),
          // Language[]/sourcePath apply to sast/iac/cicd/secret (not sca).
          ...(type !== "sca" && language && language.length > 0 && { language }),
          ...(type !== "sca" && sourcePath && { sourcePath }),
        };

        const profiledFetch = profiler(`fetchVulnerabilities_${type}`)(async () => {
          return type === "sast"
            ? await fetchSastResultsForProject(projectId, commonOptions)
            : type === "iac"
            ? await fetchIacResultsForProject(projectId, commonOptions)
            : type === "cicd"
            ? await fetchCicdResultsForProject(projectId, commonOptions)
            : type === "secret"
            ? await fetchSecretResultsForProject(projectId, commonOptions)
            : await fetchScaResultsForProject(projectId, commonOptions);
        });

        const response = await profiledFetch();

        // A newer request (other page, filter or refresh) owns the state.
        if (!isLatest()) {
          return;
        }

        // Update all state
        setScanInfo(response.scanProjectInfo);
        setVulnCountByType(response.vulnCountByType);
        setVulnerabilities(response.vulnerabilities as any);
        setProjectName(response.projectName);
        setTotalVulnerabilities(response.total);
        setTotalPages(response.totalPages);
        setIsProjectParsed(response.isProjectParsed ?? false);
        setReachabilityIgnoredCount(response.reachabilityIgnoredCount ?? 0);
        setAvailableLanguages(response.languages ?? []);
        setMalwareCount(response.malwareCount ?? 0);

      } catch (error: any) {
        // A newer request (other page, filter or refresh) owns the state.
        if (!isLatest()) {
          return;
        }

        // Silent refreshes (realtime-driven) keep the visible state intact on
        // failure — the user keeps seeing stale data and the next user-driven
        // fetch surfaces errors normally.
        if (isSilent) {
          console.warn('Silent vulnerability refresh failed:', error);
          return;
        }

        const errorStatus = error?.response?.status || error?.status || error?.statusCode;

        if ((errorStatus === 403 || errorStatus === 404) && !hasRedirectedRef.current) {
          hasRedirectedRef.current = true;
          toast.error(
            t('errors.projectAccess.noAccess')
          );
          // The results pages are AppSec: leave for its home, not for the
          // root, whose landing rule may pick another space.
          navigate(productHome('appsec'), { replace: true });
        } else {
          setError(
            apiErrorText(error)
          );
        }
        setVulnerabilities([]);
        setTotalVulnerabilities(0);
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
  }, [fetchParamsKey, enabled]); // Only depend on the stable key and enabled

  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const refresh = useCallback((silent = false) => {
    // Clear cache for this project's vulnerabilities
    hookCache.invalidate(projectId, `vulnerabilities-${type}`);
    if (silent) {
      silentRefreshRef.current = true;
    }
    // Increment counter to trigger refetch
    setRefreshCounter((prev) => prev + 1);
  }, [projectId, type]);

  // Realtime SSE subscription — only active when feature flag is on and projectId is known
  const realtimeUrl =
    features.realtime.issues && projectId && projectId.trim() !== ""
      ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/issues/stream`
      : null;

  // Throttle the silent refresh so a burst of vuln/scan events on the same
  // page does not produce a burst of GET /vulnerabilities/* calls.
  const throttledRefresh = useThrottledRealtimeRefresh(
    () => refresh(true),
    `${projectId}|${type}`,
  );

  useRealtimeStream(
    realtimeUrl,
    {
      VULNERABILITY_BATCH_APPENDED: throttledRefresh,
      VULNERABILITY_UPDATED: throttledRefresh,
      SCAN_STATUS_CHANGED: throttledRefresh,
      // The stream reconnected (token expiry, network blip): the gateway does
      // not replay what was published meanwhile, so catch up with one refetch.
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
    vulnCountByType,
    scanInfo,
    isProjectParsed,
    reachabilityIgnoredCount,
    availableLanguages,
    malwareCount,
    loading,
    error,
    goToPage,
    refresh,
  };
}

export default useProjectVulnerabilities;
