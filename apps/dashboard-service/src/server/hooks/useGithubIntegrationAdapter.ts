import { useEffect, useState, useCallback, useRef } from "react";
import { getGithubRepositories, linkGithubRepository } from "@/server/services/integrations/githubIntegrationsService";
import { IntegrationHook, Repository } from "@/server/interfaces/IntegrationProvider";
import { GithubRepository } from "@/server/interfaces/Integrations";
import { useIntegrationsOverview } from "./useIntegrationsOverview";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Adapter for GitHub integration to match the common IntegrationHook interface
 * Uses the unified useIntegrationsOverview hook to prevent duplicate API calls
 */
export const useGithubIntegrationAdapter = (
  organizationId: string,
  options?: { enabled?: boolean }
): IntegrationHook => {
  const { enabled = true } = options || {};
  
  // Use the unified overview hook (with global cache)
  const { isGithubLinked, isLoading: isLoadingOverview } = useIntegrationsOverview(
    organizationId,
    { enabled }
  );
  
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isLinkingRepository, setIsLinkingRepository] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const mountedRef = useRef(true);
  const fetchedRef = useRef(false);

  const fetchRepositories = useCallback(async () => {
    if (!organizationId || !isGithubLinked) return;
    
    setIsLoadingRepositories(true);
    setError(null);
    
    try {
      const data = await getGithubRepositories(organizationId);
      const allRepos = data.repositories.flatMap((inst) => inst.repository);
      
      // Transform GitHub repositories to common Repository interface
      const transformedRepos: Repository[] = allRepos.map((repo: GithubRepository) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        nameWithNamespace: repo.fullName,
        projectId: repo.projectId,
      }));
      
      if (mountedRef.current) {
        setRepositories(transformedRepos);
        fetchedRef.current = true;
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(apiErrorText(err));
        setRepositories([]);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingRepositories(false);
      }
    }
  }, [organizationId, isGithubLinked]);

  const linkRepository = useCallback(async (projectId: string, repositoryId: string) => {
    setIsLinkingRepository(true);
    try {
      await linkGithubRepository(organizationId, projectId, { repositoryId });
      
      // Update the local state to reflect the linking
      setRepositories(prev => 
        prev.map(repo => 
          repo.id === repositoryId 
            ? { ...repo, projectId } 
            : repo
        )
      );
    } catch (error) {
      throw error;
    } finally {
      setIsLinkingRepository(false);
    }
  }, [organizationId]);

  // Fetch repositories when GitHub is linked and overview is loaded
  useEffect(() => {
    mountedRef.current = true;
    
    if (organizationId && enabled && !isLoadingOverview && isGithubLinked && !fetchedRef.current) {
      fetchRepositories();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [organizationId, enabled, isLoadingOverview, isGithubLinked, fetchRepositories]);

  // Reset when org changes
  useEffect(() => {
    fetchedRef.current = false;
    setRepositories([]);
    setError(null);
  }, [organizationId]);

  return {
    repositories,
    isLoadingRepositories: isLoadingOverview || isLoadingRepositories,
    linkRepository,
    isLinkingRepository,
    error,
    refetchRepositories: fetchRepositories,
    isLinked: isGithubLinked,
    isLoadingInstallation: isLoadingOverview,
  };
};
