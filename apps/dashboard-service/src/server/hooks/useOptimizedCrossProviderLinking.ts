import { useCallback, useEffect, useState } from "react";
import { getGithubRepositories } from "@/server/services/integrations/githubIntegrationsService";
import { getGitlabRepositories } from "@/server/services/integrations/gitlabIntegrationsService";
import { IntegrationProvider } from "@/server/interfaces/IntegrationProvider";
import { GithubRepository } from "@/server/interfaces/Integrations";
import { GitlabRepository } from "@/server/interfaces/GitlabIntegrations";
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface CrossProviderLinkInfo {
  [projectId: string]: {
    isLinked: boolean;
    provider: IntegrationProvider;
    repositoryName?: string;
  };
}

/**
 * Optimised hook checking cross-provider links.
 * Loads only the LINKED repositories of the other provider (not all of them).
 */
export const useOptimizedCrossProviderLinking = (
  organizationId: string,
  currentProvider: IntegrationProvider
) => {
  const [crossProviderLinks, setCrossProviderLinks] = useState<CrossProviderLinkInfo>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOtherProviderLinks = useCallback(async () => {
    if (!organizationId) return;

    setIsLoading(true);
    setError(null);

    try {
      let linkedProjects: CrossProviderLinkInfo = {};

      if (currentProvider === 'gitlab') {
        // On GitLab: load the projects linked to GitHub
        try {
          const githubData = await getGithubRepositories(organizationId);
          const allGithubRepos = githubData.repositories.flatMap((inst) => inst.repository);
          const linkedGithubRepos = allGithubRepos.filter((repo: GithubRepository) => repo.projectId);
          
          linkedGithubRepos.forEach((repo: GithubRepository) => {
            if (repo.projectId) {
              linkedProjects[repo.projectId] = {
                isLinked: true,
                provider: 'github',
                repositoryName: repo.fullName,
              };
            }
          });
        } catch (githubError) {
          // If GitHub cannot be reached, carry on without an error
          console.warn('Could not fetch GitHub repositories for cross-provider check:', githubError);
        }
      } else if (currentProvider === 'github') {
        // On GitHub: load the projects linked to GitLab
        try {
          const gitlabData = await getGitlabRepositories(organizationId);
          const linkedGitlabRepos = gitlabData.repositories.filter((repo: GitlabRepository) => repo.projectId);
          
          linkedGitlabRepos.forEach((repo: GitlabRepository) => {
            if (repo.projectId) {
              linkedProjects[repo.projectId] = {
                isLinked: true,
                provider: 'gitlab',
                repositoryName: repo.nameWithNamespace,
              };
            }
          });
        } catch (gitlabError) {
          // If GitLab cannot be reached, carry on without an error
          console.warn('Could not fetch GitLab repositories for cross-provider check:', gitlabError);
        }
      }

      setCrossProviderLinks(linkedProjects);
    } catch (err: any) {
      setError(apiErrorText(err));
      setCrossProviderLinks({});
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, currentProvider]);

  useEffect(() => {
    fetchOtherProviderLinks();
  }, [fetchOtherProviderLinks]);

  const isProjectLinkedToOtherProvider = useCallback((projectId: string) => {
    return crossProviderLinks[projectId] || { isLinked: false };
  }, [crossProviderLinks]);

  return {
    isProjectLinkedToOtherProvider,
    crossProviderLinks,
    isLoading,
    error,
    refetch: fetchOtherProviderLinks,
  };
};
