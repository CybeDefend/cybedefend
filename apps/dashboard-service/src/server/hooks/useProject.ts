import { useState, useEffect, useCallback } from 'react';
import { Project } from '../interfaces/Project';
import { fetchProject } from '../services/projectService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Hook to fetch and manage project information
 * @param projectId - Project identifier
 * @returns Object containing project data, loading state, error, and refresh function
 */
export const useProject = (projectId: string | undefined) => {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectData = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const projectData = await fetchProject(projectId);
      setProject(projectData);
    } catch (err: any) {
      console.error('Error fetching project:', err);
      setError(apiErrorText(err));
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  const refresh = useCallback(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  return {
    project,
    loading,
    error,
    refresh,
    // Convenience getters for common project settings
    isAiMergeRequestEnabled: project?.aiMergeRequestEnabled || false,
    isImprovingResultsEnabled: project?.improvingResultsEnabled || false,
    isSortsVulnerabilitiesEnabled: project?.sortsVulnerabilitiesEnabled || false,
    // SCM linking status
    isGithubLinked: project?.isGithubLinked || false,
    isGitlabLinked: project?.isGitlabLinked || false,
    // Jira installation status (org-scoped, supplied by /project/:id payload).
    // null = project still loading, true/false = settled state. Lets callers
    // gate jira-only fetches without re-querying jira/installation.
    isJiraLinked: project ? project.isJiraLinked ?? false : null,
    // Linear installation status, the same way: null while the project loads.
    isLinearLinked: project ? project.isLinearLinked ?? false : null,
  };
};

export default useProject;
