import { useEffect, useState, useCallback, useRef } from "react";
import { getGitlabRepositories, linkGitlabRepository } from "@/server/services/integrations/gitlabIntegrationsService";
import { IntegrationHook, Repository } from "@/server/interfaces/IntegrationProvider";
import { GitlabRepository } from "@/server/interfaces/GitlabIntegrations";
import { useIntegrationsOverview } from "./useIntegrationsOverview";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Adapter for GitLab integration to match the common IntegrationHook interface
 * Uses the unified useIntegrationsOverview hook to prevent duplicate API calls
 */
export const useGitlabIntegrationAdapter = (
  organizationId: string,
  options?: { enabled?: boolean }
): IntegrationHook => {
  const { enabled = true } = options || {};

  // Use the unified overview hook (with global cache)
  const { isGitlabLinked, isLoading: isLoadingOverview } = useIntegrationsOverview(
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
    if (!organizationId || !isGitlabLinked) return;

    setIsLoadingRepositories(true);
    setError(null);

    try {
      const data = await getGitlabRepositories(organizationId);

      // Transform GitLab repositories to common Repository interface
      const transformedRepos: Repository[] = data.repositories.map((repo: GitlabRepository) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.nameWithNamespace,
        nameWithNamespace: repo.nameWithNamespace,
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
  }, [organizationId, isGitlabLinked]);

  const linkRepository = useCallback(async (projectId: string, repositoryId: string) => {
    setIsLinkingRepository(true);
    try {
      await linkGitlabRepository(organizationId, projectId, { repositoryId });

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

  // Fetch repositories when GitLab is linked and overview is loaded
  useEffect(() => {
    mountedRef.current = true;

    if (organizationId && enabled && !isLoadingOverview && isGitlabLinked && !fetchedRef.current) {
      fetchRepositories();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [organizationId, enabled, isLoadingOverview, isGitlabLinked, fetchRepositories]);

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
    isLinked: isGitlabLinked,
    isLoadingInstallation: isLoadingOverview,
  };
};
