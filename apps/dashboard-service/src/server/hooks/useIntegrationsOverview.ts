import { useState, useCallback, useEffect, useRef } from "react";
import { getIntegrationsOverview } from "../services/integrations/integrationsOverviewService";
import {
  IntegrationsOverviewResponse,
  GithubInstallation,
  GitlabInstallation,
  SlackInstallation,
  JiraInstallation,
  LinearInstallation,
  ContainerRegistryStats,
} from "../interfaces/IntegrationsOverview";
import { Repository } from "../interfaces/IntegrationProvider";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Global cache for integrations overview to prevent duplicate API calls
 * across different hook instances
 */
const globalCache: {
  data: IntegrationsOverviewResponse | null;
  organizationId: string | null;
  timestamp: number;
  promise: Promise<IntegrationsOverviewResponse> | null;
  listeners: Set<() => void>;
} = {
  data: null,
  organizationId: null,
  timestamp: 0,
  promise: null,
  listeners: new Set(),
};

const CACHE_TTL = 30 * 1000; // 30 seconds cache

// Notify all listeners when cache updates
const notifyListeners = () => {
  globalCache.listeners.forEach((listener) => listener());
};

// Invalidate cache globally
export const invalidateIntegrationsCache = (organizationId?: string) => {
  if (!organizationId || globalCache.organizationId === organizationId) {
    globalCache.data = null;
    globalCache.timestamp = 0;
    globalCache.promise = null;
    notifyListeners();
  }
};

interface UseIntegrationsOverviewReturn {
  // Data
  github: GithubInstallation | null;
  gitlab: GitlabInstallation | null;
  slack: SlackInstallation | null;
  jira: JiraInstallation | null;
  linear: LinearInstallation | null;
  containerRegistry: ContainerRegistryStats;

  // Computed states
  isGithubLinked: boolean;
  isGitlabLinked: boolean;
  isSlackLinked: boolean;
  isJiraLinked: boolean;
  isLinearLinked: boolean;
  isGitlabReconnectRequired: boolean;
  githubInstallationOwnerId: string | null;
  gitlabInstallationOwnerId: string | null;

  // Loading & error states
  isLoading: boolean;
  error: string | null;

  // Utility functions
  getRegistryCountByType: (type: string) => number;
  refetch: () => Promise<void>;
  invalidateCache: () => void;
}

/**
 * Hook for fetching consolidated integrations overview.
 * Uses global cache to prevent duplicate API calls across different component instances.
 * Replaces multiple separate API calls with a single consolidated endpoint.
 */
export const useIntegrationsOverview = (
  organizationId: string | undefined,
  options?: { enabled?: boolean }
): UseIntegrationsOverviewReturn => {
  const { enabled = true } = options || {};
  const [data, setData] = useState<IntegrationsOverviewResponse | null>(() => {
    // Initialize from cache if available and valid
    if (
      globalCache.data &&
      globalCache.organizationId === organizationId &&
      Date.now() - globalCache.timestamp < CACHE_TTL
    ) {
      return globalCache.data;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(() => {
    // If there is no valid cache hit, a fetch will happen in the first effect.
    // Start as loading=true so the UI shows a spinner from frame 0.
    if (!organizationId || !enabled) return false;
    const cacheValid =
      globalCache.data !== null &&
      globalCache.organizationId === organizationId &&
      Date.now() - globalCache.timestamp < CACHE_TTL;
    return !cacheValid;
  });
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchOverview = useCallback(async (forceRefresh = false) => {
    if (!organizationId) return;

    const now = Date.now();
    
    // Check if we have valid cached data
    const cacheValid =
      globalCache.data !== null &&
      globalCache.organizationId === organizationId &&
      now - globalCache.timestamp < CACHE_TTL &&
      !forceRefresh;

    if (cacheValid && globalCache.data) {
      setData(globalCache.data);
      return;
    }

    // If there's already a pending request for this org, wait for it
    if (globalCache.promise && globalCache.organizationId === organizationId && !forceRefresh) {
      try {
        const result = await globalCache.promise;
        if (mountedRef.current) {
          setData(result);
        }
        return;
      } catch {
        // Fall through to make a new request
      }
    }

    setIsLoading(true);
    setError(null);

    // Create the promise and store it in the cache
    const fetchPromise = getIntegrationsOverview(organizationId);
    globalCache.promise = fetchPromise;
    globalCache.organizationId = organizationId;

    try {
      const response = await fetchPromise;
      
      // Update global cache
      globalCache.data = response;
      globalCache.timestamp = Date.now();
      globalCache.promise = null;
      
      if (mountedRef.current) {
        setData(response);
        setIsLoading(false);
      }
      
      // Notify other instances
      notifyListeners();
    } catch (err: any) {
      globalCache.promise = null;
      
      console.error("Failed to fetch integrations overview:", err?.message || err);
      
      if (mountedRef.current) {
        setError(apiErrorText(err));
        // Set default empty state on error
        setData({
          github: null,
          gitlab: null,
          slack: null,
          jira: null,
          containerRegistry: { total: 0, byType: [] },
        });
        setIsLoading(false);
      }
    }
  }, [organizationId]);

  // Subscribe to cache updates from other instances
  useEffect(() => {
    const listener = () => {
      if (
        globalCache.data &&
        globalCache.organizationId === organizationId &&
        mountedRef.current
      ) {
        setData(globalCache.data);
      }
    };
    
    globalCache.listeners.add(listener);
    
    return () => {
      globalCache.listeners.delete(listener);
    };
  }, [organizationId]);

  // Fetch on mount or when organizationId changes
  useEffect(() => {
    mountedRef.current = true;
    
    if (organizationId && enabled) {
      fetchOverview();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [organizationId, enabled, fetchOverview]);

  /**
   * Get the count for a specific registry type
   * @param type - Registry type (gitlab, dockerhub, github, acr, gcr, ecr, quay, harbor, jfrog)
   */
  const getRegistryCountByType = useCallback((type: string): number => {
    if (!data?.containerRegistry?.byType) return 0;
    const found = data.containerRegistry.byType.find(
      (item) => item.type.toLowerCase() === type.toLowerCase()
    );
    return found?.count || 0;
  }, [data]);

  const invalidateCache = useCallback(() => {
    invalidateIntegrationsCache(organizationId);
  }, [organizationId]);

  // Compute derived states
  const isGithubLinked = data?.github !== null && data?.github !== undefined;
  const isGitlabLinked = data?.gitlab !== null && data?.gitlab !== undefined;
  const isSlackLinked = data?.slack !== null && data?.slack !== undefined;
  const isJiraLinked = data?.jira !== null && data?.jira !== undefined;
  // `linear` is absent from a gateway older than the integration: not linked.
  const isLinearLinked = data?.linear !== null && data?.linear !== undefined;
  const isGitlabReconnectRequired = data?.gitlab?.reconnectRequired === true;
  const githubInstallationOwnerId = data?.github?.userId || null;
  const gitlabInstallationOwnerId = data?.gitlab?.userId || null;

  return {
    // Data
    github: data?.github || null,
    gitlab: data?.gitlab || null,
    slack: data?.slack || null,
    jira: data?.jira || null,
    linear: data?.linear || null,
    containerRegistry: data?.containerRegistry || { total: 0, byType: [] },

    // Computed states
    isGithubLinked,
    isGitlabLinked,
    isSlackLinked,
    isJiraLinked,
    isLinearLinked,
    isGitlabReconnectRequired,
    githubInstallationOwnerId,
    gitlabInstallationOwnerId,

    // Loading & error states
    isLoading,
    error,

    // Utility functions
    getRegistryCountByType,
    refetch: () => fetchOverview(true),
    invalidateCache,
  };
};

/**
 * Combined hook for fetching both GitHub and GitLab repositories
 * Uses unified overview to prevent duplicate API calls
 */
export const useCombinedIntegrations = (
  organizationId: string,
  options?: {
    enabled?: boolean;
    fetchGithubRepos?: boolean;
    fetchGitlabRepos?: boolean;
  }
) => {
  const {
    enabled = true,
    fetchGithubRepos = true,
    fetchGitlabRepos = true,
  } = options || {};

  // Use the unified overview hook (this will use the cache)
  const overview = useIntegrationsOverview(organizationId, { enabled });

  const [githubRepositories, setGithubRepositories] = useState<Repository[]>([]);
  const [gitlabRepositories, setGitlabRepositories] = useState<Repository[]>([]);
  const [isLoadingGithubRepos, setIsLoadingGithubRepos] = useState(false);
  const [isLoadingGitlabRepos, setIsLoadingGitlabRepos] = useState(false);
  const [githubReposError, setGithubReposError] = useState<string | null>(null);
  const [gitlabReposError, setGitlabReposError] = useState<string | null>(null);
  
  const mountedRef = useRef(true);
  const githubFetchedRef = useRef(false);
  const gitlabFetchedRef = useRef(false);

  // Fetch GitHub repositories
  const fetchGithubRepositories = useCallback(async () => {
    if (!organizationId || !overview.isGithubLinked || !fetchGithubRepos) return;

    setIsLoadingGithubRepos(true);
    setGithubReposError(null);

    try {
      const { getGithubRepositories } = await import("../services/integrations/githubIntegrationsService");
      const data = await getGithubRepositories(organizationId);
      const allRepos = data.repositories.flatMap((inst) => inst.repository);

      // Transform to common Repository interface
      const transformedRepos: Repository[] = allRepos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        nameWithNamespace: repo.fullName,
        projectId: repo.projectId,
      }));

      if (mountedRef.current) {
        setGithubRepositories(transformedRepos);
        githubFetchedRef.current = true;
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setGithubReposError(apiErrorText(err));
        setGithubRepositories([]);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingGithubRepos(false);
      }
    }
  }, [organizationId, overview.isGithubLinked, fetchGithubRepos]);

  // Fetch GitLab repositories
  const fetchGitlabRepositories = useCallback(async () => {
    if (!organizationId || !overview.isGitlabLinked || !fetchGitlabRepos) return;

    setIsLoadingGitlabRepos(true);
    setGitlabReposError(null);

    try {
      const { getGitlabRepositories } = await import("../services/integrations/gitlabIntegrationsService");
      const data = await getGitlabRepositories(organizationId);

      // Transform to common Repository interface
      const transformedRepos: Repository[] = data.repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.nameWithNamespace,
        nameWithNamespace: repo.nameWithNamespace,
        projectId: repo.projectId,
      }));

      if (mountedRef.current) {
        setGitlabRepositories(transformedRepos);
        gitlabFetchedRef.current = true;
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setGitlabReposError(apiErrorText(err));
        setGitlabRepositories([]);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingGitlabRepos(false);
      }
    }
  }, [organizationId, overview.isGitlabLinked, fetchGitlabRepos]);

  // Fetch repositories when overview is loaded
  useEffect(() => {
    mountedRef.current = true;

    if (!overview.isLoading && enabled) {
      // Fetch GitHub repos if linked and not yet fetched
      if (overview.isGithubLinked && fetchGithubRepos && !githubFetchedRef.current) {
        fetchGithubRepositories();
      }
      // Fetch GitLab repos if linked and not yet fetched
      if (overview.isGitlabLinked && fetchGitlabRepos && !gitlabFetchedRef.current) {
        fetchGitlabRepositories();
      }
    }

    return () => {
      mountedRef.current = false;
    };
  }, [
    overview.isLoading,
    overview.isGithubLinked,
    overview.isGitlabLinked,
    enabled,
    fetchGithubRepos,
    fetchGitlabRepos,
    fetchGithubRepositories,
    fetchGitlabRepositories,
  ]);

  // Reset fetch refs when org changes
  useEffect(() => {
    githubFetchedRef.current = false;
    gitlabFetchedRef.current = false;
    setGithubRepositories([]);
    setGitlabRepositories([]);
  }, [organizationId]);

  // Combined loading state
  const isLoadingAny =
    overview.isLoading ||
    (fetchGithubRepos && overview.isGithubLinked && isLoadingGithubRepos) ||
    (fetchGitlabRepos && overview.isGitlabLinked && isLoadingGitlabRepos);

  return {
    // Overview data
    isGithubLinked: overview.isGithubLinked,
    isGitlabLinked: overview.isGitlabLinked,
    githubInstallation: overview.github,
    gitlabInstallation: overview.gitlab,
    containerRegistry: overview.containerRegistry,
    isLoadingOverview: overview.isLoading,
    overviewError: overview.error,

    // GitHub repositories
    githubRepositories,
    isLoadingGithubRepos,
    githubReposError,
    refetchGithubRepos: fetchGithubRepositories,

    // GitLab repositories
    gitlabRepositories,
    isLoadingGitlabRepos,
    gitlabReposError,
    refetchGitlabRepos: fetchGitlabRepositories,

    // Combined loading
    isLoadingAny,

    // Utilities
    refetchOverview: overview.refetch,
    invalidateCache: overview.invalidateCache,
    getRegistryCountByType: overview.getRegistryCountByType,
  };
};

export default useIntegrationsOverview;
