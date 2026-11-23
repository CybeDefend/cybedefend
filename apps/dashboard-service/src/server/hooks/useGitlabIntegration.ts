import { useCallback, useEffect, useState, useRef } from "react";
import type {
  GitlabCallbackInstallDto,
  GitlabInstallationResponse,
  GitlabRepository
} from "../interfaces/GitlabIntegrations";
import { LinkRepositoryDto } from "../interfaces/Integrations";
import {
  generateGitlabInstallUrl,
  getGitlabRepositories,
  installGitlabIntegration,
  linkGitlabRepository,
  startScanForLastCommitAndProjectGitlab,
  unlinkGitlabProject,
  unlinkGitlabRepository,
} from "../services/integrations/gitlabIntegrationsService";
import { useIntegrationsOverview, invalidateIntegrationsCache } from "./useIntegrationsOverview";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Hook for managing GitLab integration state and operations
 * Uses the unified useIntegrationsOverview hook to prevent duplicate API calls
 */
export const useGitlabIntegration = (
  organizationId: string,
  options?: { fetchRepositoriesOnMount?: boolean }
) => {
  const { fetchRepositoriesOnMount = true } = options || {};
  
  // Use the unified overview hook (with global cache)
  const { 
    gitlab: gitlabInstallation, 
    isGitlabLinked: isGitlabLinkedState, 
    isLoading: isLoadingOverview,
    error: overviewError,
    refetch: refetchOverview,
  } = useIntegrationsOverview(organizationId);
  
  // Map to the expected installation format
  const installation: GitlabInstallationResponse | null = gitlabInstallation ? {
    id: gitlabInstallation.id,
    userId: gitlabInstallation.userId,
    organizationId: gitlabInstallation.organizationId,
    gitlabUserId: gitlabInstallation.gitlabUserId,
    gitlabGroupId: gitlabInstallation.gitlabGroupId || 0,
    createdAt: gitlabInstallation.createdAt,
    updatedAt: gitlabInstallation.updatedAt,
  } : null;

  // Repositories state
  const [repositories, setRepositories] = useState<GitlabRepository[]>([]);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [repositoriesError, setRepositoriesError] = useState<string | null>(null);

  // Action loading states
  const [isGeneratingInstallUrl, setIsGeneratingInstallUrl] = useState(false);
  const [isInstallingCallback, setIsInstallingCallback] = useState(false);
  const [isLinkingRepository, setIsLinkingRepository] = useState(false);
  const [isUnlinkingRepository, setIsUnlinkingRepository] = useState(false);
  const [isStartingScan, setIsStartingScan] = useState(false);
  
  const mountedRef = useRef(true);
  const fetchedRef = useRef(false);

  // Fetch repositories
  const fetchRepositories = useCallback(async () => {
    // Only fetch repositories when GitLab is linked
    if (!organizationId || !isGitlabLinkedState) return;

    setIsLoadingRepositories(true);
    setRepositoriesError(null);

    try {
      const data = await getGitlabRepositories(organizationId);
      setRepositories(data.repositories);
    } catch (error: any) {
      setRepositoriesError(apiErrorText(error));
      setRepositories([]);
    } finally {
      setIsLoadingRepositories(false);
    }
  }, [organizationId, isGitlabLinkedState]);

  // Generate install URL
  const generateInstallUrl = useCallback(async () => {
    if (!organizationId) return;

    setIsGeneratingInstallUrl(true);

    try {
      const data = await generateGitlabInstallUrl(organizationId);
      window.location.href = data.installUrl;
    } catch (error: any) {
      console.error("Error generating GitLab install URL:", error);
    } finally {
      setIsGeneratingInstallUrl(false);
    }
  }, [organizationId]);

  // Install callback
  const installCallback = useCallback(async (payload: GitlabCallbackInstallDto) => {
    if (!organizationId) return;

    setIsInstallingCallback(true);

    try {
      const data = await installGitlabIntegration(organizationId, payload);
      // Invalidate cache and refetch to update installation status
      invalidateIntegrationsCache(organizationId);
      await refetchOverview();
      if (data.returnUri) {
        window.location.href = data.returnUri;
      }
    } catch (error: any) {
      console.error("Error installing GitLab integration:", error);
    } finally {
      setIsInstallingCallback(false);
    }
  }, [organizationId, refetchOverview]);

  // Link repository
  const linkRepositoryAction = useCallback(async (projectId: string, repositoryId: string) => {
    if (!organizationId) return;

    setIsLinkingRepository(true);

    try {
      await linkGitlabRepository(organizationId, projectId, { repositoryId });
      await fetchRepositories(); // Refresh repositories
    } catch (error: any) {
      console.error("Error linking repository:", error);
    } finally {
      setIsLinkingRepository(false);
    }
  }, [organizationId, fetchRepositories]);

  // Unlink repository
  const unlinkRepositoryAction = useCallback(async (projectId: string, repositoryId: string) => {
    if (!organizationId) return;

    setIsUnlinkingRepository(true);

    try {
      await unlinkGitlabRepository(organizationId, projectId, { repositoryId });
      await fetchRepositories(); // Refresh repositories
    } catch (error: any) {
      console.error("Error unlinking repository:", error);
    } finally {
      setIsUnlinkingRepository(false);
    }
  }, [organizationId, fetchRepositories]);

  // Start scan
  const startScan = useCallback(async (projectId: string, repositoryId: string) => {
    setIsStartingScan(true);

    try {
      const data = await startScanForLastCommitAndProjectGitlab(projectId, repositoryId);
    } catch (error: any) {
      console.error("Error starting scan:", error);
    } finally {
      setIsStartingScan(false);
    }
  }, []);

  // Unlink project (different from repository unlink)
  const unlinkProject = useCallback(async (
    // CHANGE: Add organizationId and payload to the function signature
    projectId: string,
    organizationId: string,
    payload: LinkRepositoryDto
  ) => {
    setIsUnlinkingRepository(true); // Reuse the same loading state
    
    try {
      // The service function call is already correct.
      await unlinkGitlabProject(projectId, organizationId, payload);
      await fetchRepositories(); // Refresh repositories
    } catch (error: any) {
      console.error("Error unlinking project:", error);
      throw error; // Re-throw to allow caller to handle
    } finally {
      setIsUnlinkingRepository(false);
    }
  }, [fetchRepositories]);

  // Effects - fetch repositories when GitLab is linked and not loading
  useEffect(() => {
    mountedRef.current = true;
    
    if (fetchRepositoriesOnMount && !isLoadingOverview && isGitlabLinkedState && !fetchedRef.current) {
      fetchRepositories();
      fetchedRef.current = true;
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchRepositoriesOnMount, isLoadingOverview, isGitlabLinkedState, fetchRepositories]);

  // Reset when org changes
  useEffect(() => {
    fetchedRef.current = false;
    setRepositories([]);
    setRepositoriesError(null);
  }, [organizationId]);

  return {
    // Data
    installation,
    repositories,
    isGitlabLinked: isGitlabLinkedState,

    // Loading states
    isLoadingInstallation: isLoadingOverview,
    isLoadingRepositories,
    isGeneratingInstallUrl,
    isInstallingCallback,
    isLinkingRepository,
    isUnlinkingRepository,
    isStartingScan,

    // Error states
    installationError: overviewError,
    repositoriesError,

    // Actions
    generateInstallUrl,
    installCallback,
    linkRepository: linkRepositoryAction,
    unlinkRepository: unlinkRepositoryAction,
    startScan,
    unlinkProject,

    // Refetch functions
    refetchInstallation: refetchOverview,
    refetchRepositories: fetchRepositories,
  };
};

/**
 * Hook for GitLab repositories without requiring installation check
 */
export const useGitlabRepositories = (organizationId: string) => {
  const [repositories, setRepositories] = useState<GitlabRepository[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRepositories = useCallback(async () => {
    if (!organizationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await getGitlabRepositories(organizationId);
      setRepositories(data.repositories);
    } catch (err: any) {
      setError(apiErrorText(err));
      setRepositories([]);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchRepositories();
  }, [fetchRepositories]);

  return {
    repositories,
    isLoading,
    error,
    refetch: fetchRepositories,
  };
};