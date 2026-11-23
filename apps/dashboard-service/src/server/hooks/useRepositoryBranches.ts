import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Branch, GetBranchesResponse } from "../interfaces/Branch";
import { getGithubRepositoryBranches } from "../services/integrations/githubIntegrationsService";
import { getGitlabRepositoryBranches } from "../services/integrations/gitlabIntegrationsService";
import { RootState } from "../store";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Integration type for branch fetching
 */
export type BranchIntegrationType = 'github' | 'gitlab' | 'none';

/**
 * Return type for the useRepositoryBranches hook
 */
export interface UseRepositoryBranchesReturn {
  /** List of available branches */
  branches: Branch[];
  /** Default branch of the repository (e.g., main, master) */
  defaultBranch: string;
  /** Configured scan branch (may be empty if not set) */
  scanBranch: string;
  /** Currently selected branch for operations */
  selectedBranch: string;
  /** Update the selected branch */
  setSelectedBranch: (branch: string) => void;
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh branches from API */
  refresh: () => Promise<void>;
  /** Whether branches have been loaded at least once */
  isLoaded: boolean;
}

/**
 * Hook for fetching and managing repository branches
 * Works with both GitHub and GitLab repositories
 * 
 * @param repositoryId - The internal repository ID (null if not linked)
 * @param integrationType - The type of integration ('github', 'gitlab', or 'none')
 * @returns Branch management state and actions
 * 
 * @example
 * ```tsx
 * const { branches, selectedBranch, setSelectedBranch, loading } = useRepositoryBranches(
 *   linkedRepoId,
 *   'github'
 * );
 * ```
 */
export const useRepositoryBranches = (
  repositoryId: string | null,
  integrationType: BranchIntegrationType
): UseRepositoryBranchesReturn => {
  // Get organizationId from Redux store
  const organization = useSelector((state: RootState) => state.organization);
  const organizationId = organization.selectedOrganization?.id || "";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>('');
  const [scanBranch, setScanBranch] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  /**
   * Fetch branches from the appropriate API based on integration type
   */
  const fetchBranches = useCallback(async () => {
    if (!repositoryId || !organizationId || integrationType === 'none') {
      setBranches([]);
      setDefaultBranch('');
      setScanBranch('');
      setSelectedBranch('');
      // Mark as loaded even when there's no integration (nothing to fetch)
      setIsLoaded(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let data: GetBranchesResponse;

      if (integrationType === 'github') {
        data = await getGithubRepositoryBranches(organizationId, repositoryId);
      } else {
        data = await getGitlabRepositoryBranches(organizationId, repositoryId);
      }

      const branchList = data.branches ?? [];
      setBranches(branchList);
      setDefaultBranch(data.defaultBranch ?? '');
      setScanBranch(data.scanBranch ?? '');
      
      // Set initial selected branch: prefer scanBranch, then defaultBranch, then main/master
      let initialBranch = data.scanBranch || data.defaultBranch || '';
      
      // If no default branch from API, try to find main or master in the branch list
      if (!initialBranch && branchList.length > 0) {
        const mainBranch = branchList.find(b => b.name === 'main');
        const masterBranch = branchList.find(b => b.name === 'master');
        const defaultMarkedBranch = branchList.find(b => b.isDefault);
        
        if (defaultMarkedBranch) {
          initialBranch = defaultMarkedBranch.name;
        } else if (mainBranch) {
          initialBranch = mainBranch.name;
        } else if (masterBranch) {
          initialBranch = masterBranch.name;
        } else {
          // Fall back to first branch
          initialBranch = branchList[0].name;
        }
      }
      
      setSelectedBranch(initialBranch);
      setIsLoaded(true);
    } catch (err: any) {
      console.error('Error fetching repository branches:', err);
      setError(apiErrorText(err));
      setBranches([]);
      setDefaultBranch('');
      setScanBranch('');
      setIsLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [repositoryId, organizationId, integrationType]);

  // Fetch branches when repositoryId, organizationId or integrationType changes
  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  return {
    branches,
    defaultBranch,
    scanBranch,
    selectedBranch,
    setSelectedBranch,
    loading,
    error,
    refresh: fetchBranches,
    isLoaded,
  };
};

export default useRepositoryBranches;
