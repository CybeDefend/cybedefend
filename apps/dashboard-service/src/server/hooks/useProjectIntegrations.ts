import { useCallback, useEffect, useState, useMemo } from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/server/store";
import { useGitlabIntegration } from "./useGitlabIntegration";
import { getGithubRepositories } from "@/server/services/integrations/githubIntegrationsService";
import { hookCache } from "./utils/hookCache";
import { useStableCallback, useEventCallback } from "./utils/memoizationHelpers";
import { apiErrorText } from '@/utils/function/apiErrorKey';

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
  repositoryName?: string;
}

/**
 * Hook return interface
 */
export interface UseProjectIntegrationsReturn {
  // Integration detection
  integrationInfo: ProjectIntegrationInfo;
  isLoadingIntegration: boolean;
  integrationError: string | null;

  // GitHub specific
  linkedGithubRepo: string | null;
  githubRepositories: any[];
  isLoadingGithubRepos: boolean;

  // GitLab specific  
  linkedGitlabRepo: string | null;
  gitlabRepositories: any[];
  isLoadingGitlabRepos: boolean;
  unlinkGitlabProject: (projectId: string, organizationId: string, payload: any) => Promise<void>;

  // Refresh functions
  refetchIntegrations: () => Promise<void>;
}

/**
 * Unified hook for managing project integrations (GitHub & GitLab)
 * Detects which integration is linked to a project. Starting an analysis is
 * `useStartAnalysis`'s business, not this hook's.
 */
export const useProjectIntegrations = (projectId: string): UseProjectIntegrationsReturn => {
  const organization = useSelector((state: RootState) => state.organization);
  const organizationId = organization.selectedOrganization?.id || "";

  // State for integration detection
  const [integrationInfo, setIntegrationInfo] = useState<ProjectIntegrationInfo>({
    type: 'none',
    repositoryId: null,
  });
  // Start with loading=true so pages wait for integration detection
  const [isLoadingIntegration, setIsLoadingIntegration] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

  // GitHub state
  const [linkedGithubRepo, setLinkedGithubRepo] = useState<string | null>(null);
  const [githubRepositories, setGithubRepositories] = useState<any[]>([]);
  const [isLoadingGithubRepos, setIsLoadingGithubRepos] = useState(false);

  // GitLab state (using existing hook)
  const {
    repositories: gitlabRepositories,
    isLoadingRepositories: isLoadingGitlabRepos,
    unlinkProject: unlinkGitlabProject,
    refetchRepositories: refetchGitlabRepositories,
  } = useGitlabIntegration(organizationId);

  // Find linked GitLab repository for this project (memoized)
  const linkedGitlabRepo = useMemo(() => {
    return gitlabRepositories.find(repo => repo.projectId === projectId)?.id || null;
  }, [gitlabRepositories, projectId]);

  // Fetch GitHub repositories with caching
  const fetchGithubRepositories = useStableCallback(async () => {
    if (!organizationId) return;

    // Check cache first
    const cached = hookCache.get<{repositories: any[], linkedRepo: string | null}>(
      organizationId, 
      'github-repos', 
      projectId
    );
    if (cached) {
      setGithubRepositories(cached.repositories);
      setLinkedGithubRepo(cached.linkedRepo);
      return;
    }

    setIsLoadingGithubRepos(true);
    try {
      const response = await getGithubRepositories(organizationId);
      const allRepos = response.repositories.flatMap((inst) => inst.repository);
      setGithubRepositories(allRepos);

      // Find linked GitHub repo for this project
      const linkedRepo = allRepos.find((repo) => repo.projectId === projectId);
      const linkedRepoId = linkedRepo ? linkedRepo.id : null;
      setLinkedGithubRepo(linkedRepoId);

      // Cache the result with project-specific linked repo
      hookCache.set(organizationId, 'github-repos', {
        repositories: allRepos,
        linkedRepo: linkedRepoId,
      }, projectId, { ttl: 5 * 60 * 1000 }); // 5 minutes cache
    } catch (error: any) {
      console.error("Error fetching GitHub repositories:", error);
      setGithubRepositories([]);
      setLinkedGithubRepo(null);
    } finally {
      setIsLoadingGithubRepos(false);
    }
  }, [organizationId, projectId]);

  // Determine integration type and info (optimized with stable dependencies)
  const determineIntegration = useStableCallback(() => {
    setIsLoadingIntegration(true);
    setIntegrationError(null);

    try {
      if (linkedGithubRepo) {
        const githubRepo = githubRepositories.find(repo => repo.id === linkedGithubRepo);
        setIntegrationInfo({
          type: 'github',
          repositoryId: linkedGithubRepo,
          repositoryName: githubRepo?.name || githubRepo?.fullName,
        });
      } else if (linkedGitlabRepo) {
        const gitlabRepo = gitlabRepositories.find(repo => repo.id === linkedGitlabRepo);
        setIntegrationInfo({
          type: 'gitlab',
          repositoryId: linkedGitlabRepo,
          repositoryName: gitlabRepo?.name || gitlabRepo?.nameWithNamespace,
        });
      } else {
        setIntegrationInfo({
          type: 'none',
          repositoryId: null,
        });
      }
    } catch (error: any) {
      setIntegrationError(apiErrorText(error));
      setIntegrationInfo({ type: 'none', repositoryId: null });
    } finally {
      setIsLoadingIntegration(false);
    }
  }, [linkedGithubRepo, linkedGitlabRepo, githubRepositories, gitlabRepositories]);

  // Unified refetch function (optimized)
  const refetchIntegrations = useEventCallback(async () => {
    // Clear cache before refetching
    hookCache.invalidate(organizationId, 'github-repos', projectId);
    
    await Promise.all([
      fetchGithubRepositories(),
      refetchGitlabRepositories?.(),
    ]);
  });

  // Optimized useEffect - fetch GitHub repositories only when organizationId changes
  useEffect(() => {
    if (organizationId) {
      fetchGithubRepositories();
    }
  }, [organizationId]); // Removed fetchGithubRepositories from dependencies

  // Optimized useEffect - determine integration when relevant data changes
  useEffect(() => {
    // Wait for repos loading to finish before determining integration
    if (!isLoadingGithubRepos && !isLoadingGitlabRepos && organizationId) {
      determineIntegration();
    }
  }, [organizationId, githubRepositories.length, gitlabRepositories.length, linkedGithubRepo, linkedGitlabRepo, isLoadingGithubRepos, isLoadingGitlabRepos]); // Optimized dependencies

  return {
    // Integration detection
    integrationInfo,
    isLoadingIntegration: isLoadingIntegration || isLoadingGithubRepos || isLoadingGitlabRepos,
    integrationError,

    // GitHub specific
    linkedGithubRepo,
    githubRepositories,
    isLoadingGithubRepos,

    // GitLab specific
    linkedGitlabRepo,
    gitlabRepositories,
    isLoadingGitlabRepos,
    unlinkGitlabProject,

    // Refresh functions
    refetchIntegrations,
  };
};
