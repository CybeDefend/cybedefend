import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { fetchProject } from "../services/projectService";
import { Project, ParsedBranch } from "../interfaces/Project";
import { 
  hasParsedBranches, 
  isBranchParsed, 
  getParsedBranches,
  getDefaultParsedBranch,
  getPotpieProjectId
} from "@/utils/function/parsedBranchUtils";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * useCurrentProject
 * - Resolves current projectId from route or query string
 * - Fetches project details
 * - Exposes booleans for AI widget gating based on parsed branches
 * - Supports branch-specific AI availability checking
 */
export const useCurrentProject = () => {
  const location = useLocation();
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const projectIdFromQuery = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("projectId") || undefined;
  }, [location.search]);

  const projectId = (params as any)?.projectId || projectIdFromQuery;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!projectId) {
        setProject(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchProject(projectId);
        if (!cancelled) {
          setProject(data);
        }
      } catch (err: any) {
        if (!cancelled) setError(apiErrorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Check if project has any parsed branches (replaces old ingestionProjectId check)
  const isParsedProject = hasParsedBranches(project);
  const securityChampionEnabled = !!project?.securityChampionEnabled;

  // Get all parsed branches
  const parsedBranches: ParsedBranch[] = getParsedBranches(project);
  
  // Get default parsed branch for convenience
  const defaultParsedBranch = getDefaultParsedBranch(project);

  /**
   * Check if a specific branch is parsed and AI-ready
   * @param branchName - Branch name to check
   * @returns true if the branch is parsed
   */
  const isBranchAIReady = (branchName: string | null | undefined): boolean => {
    if (!project || !securityChampionEnabled) return false;
    if (!branchName) return isParsedProject;
    return isBranchParsed(project, branchName);
  };

  /**
   * Get potpieProjectId for a specific branch
   * @param branchName - Optional branch name
   * @returns potpieProjectId string or undefined
   */
  const getBranchPotpieId = (branchName?: string | null): string | undefined => {
    return getPotpieProjectId(project, branchName);
  };

  return {
    project,
    currentProject: project,
    loading,
    error,
    isParsedProject,
    securityChampionEnabled,
    parsedBranches,
    defaultParsedBranch,
    isBranchAIReady,
    getBranchPotpieId,
  };
};

export default useCurrentProject;
