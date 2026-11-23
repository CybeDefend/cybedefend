import { useState, useEffect, useRef, useCallback } from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/server/store";
import useDebouncedValue from "./useDebouncedValue";
import { fetchScaPackagesForProject } from "../services/resultService";
import { PaginatedScaPackagesResults, ScaDetectedPackage } from "../interfaces/Packages";
import { hookCache } from "./utils/hookCache";
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseProjectPackagesOptions {
  projectId: string;
  pageSize: number;
  searchQuery: string;
  packageType?: string | string[];
  branch?: string;
  initialPage?: number;
  enabled?: boolean;
}

interface PackagesReturnType {
  packages: ScaDetectedPackage[];
  totalPackages: number;
  totalPages: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  goToPage: (page: number) => void;
  refresh: () => void;
}

// Cached page of the packages list.
interface CachedPackagesData {
  packages: ScaDetectedPackage[];
  total: number;
  totalPages: number;
}

/**
 * Every cached page of a project's packages list starts with this scope, so
 * refresh() drops them all (it used to invalidate
 * `packages:<project>` while the entries were keyed `packages_<page>_…`).
 */
const packagesScopePrefix = (projectId: string): string => `packages_${projectId}_`;

function useProjectPackages(
  options: UseProjectPackagesOptions
): PackagesReturnType {
  const { projectId, pageSize, searchQuery, packageType, branch, initialPage = 1, enabled = true } = options;
  const [packages, setPackages] = useState<ScaDetectedPackage[]>([]);
  const [totalPackages, setTotalPackages] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // A counter, not a toggle: every refresh() is a new value the effect sees.
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Get organization from Redux store
  const organization = useSelector((state: RootState) => state.organization);
  const organizationId = organization.selectedOrganization?.id || "";

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const packageTypeKey = packageType ? (Array.isArray(packageType) ? packageType.join(',') : packageType) : '';
  const isFirstLoad = useRef(true);
  const prevEnabled = useRef(enabled);
  // Every fetch takes a number; only the latest one may write the state. A
  // fetch in flight no longer swallows the next one (a search typed meanwhile
  // used to be dropped), and an older answer never replaces a newer one.
  const requestIdRef = useRef(0);

  // Single unified effect for fetching packages
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const isLatest = () => requestId === requestIdRef.current;

    // If not enabled, clear data and return
    if (!enabled) {
      setPackages([]);
      setTotalPackages(0);
      setTotalPages(0);
      setLoading(false);
      prevEnabled.current = false;
      return;
    }

    // If missing required data, clear and return
    if (!projectId || !organizationId) {
      setPackages([]);
      setTotalPackages(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }

    // Detect if enabled just became true
    const justEnabled = !prevEnabled.current && enabled;
    prevEnabled.current = enabled;

    // On first activation, reset to initial page
    if (justEnabled || isFirstLoad.current) {
      isFirstLoad.current = false;
      if (currentPage !== initialPage) {
        setCurrentPage(initialPage);
        // The state change will trigger this effect again, so return here
        return;
      }
    }

    // Check cache first (refresh() drops the project's entries)
    const cacheScope = `${packagesScopePrefix(projectId)}${currentPage}_${pageSize}_${debouncedSearchQuery}_${packageTypeKey}_${branch || ''}`;
    const cachedData = hookCache.get<CachedPackagesData>(organizationId, cacheScope);
    if (cachedData) {
      setPackages(cachedData.packages);
      setTotalPackages(cachedData.total);
      setTotalPages(cachedData.totalPages);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchScaPackagesForProject(projectId, {
      pageNumber: currentPage,
      pageSizeNumber: pageSize,
      searchQuery: debouncedSearchQuery,
      ...(packageType && { packageType }),
      ...(branch && { branch }),
    })
      .then((response: PaginatedScaPackagesResults) => {
        // Cache the response
        const dataToCache: CachedPackagesData = {
          packages: response.packages,
          total: response.total,
          totalPages: response.totalPages,
        };
        hookCache.set(organizationId, cacheScope, dataToCache);

        if (!isLatest()) return;
        setPackages(response.packages);
        setTotalPackages(response.total);
        setTotalPages(response.totalPages);
      })
      .catch((err: { message?: string }) => {
        if (!isLatest()) return;
        setError(apiErrorText(err));
        setPackages([]);
        setTotalPackages(0);
        setTotalPages(0);
      })
      .finally(() => {
        if (isLatest()) setLoading(false);
      });
    // packageType is read through packageTypeKey: an equal array passed anew
    // on each render must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, organizationId, currentPage, pageSize, debouncedSearchQuery, packageTypeKey, branch, refreshCounter, enabled, initialPage]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const refresh = useCallback(() => {
    // Drop every cached page of this project's packages
    if (organizationId && projectId) {
      hookCache.invalidate(organizationId, packagesScopePrefix(projectId));
    }
    setRefreshCounter((prev) => prev + 1);
  }, [organizationId, projectId]);

  return {
    packages,
    totalPackages,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
  };
}

export default useProjectPackages;
