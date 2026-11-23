import { useState, useEffect, useCallback } from "react";
import { Team } from "../interfaces/Team";
import { fetchOrganizationTeams } from "../services/organizationService";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Custom hook for managing organization teams data with standard pattern
 * Provides teams list, loading state, error handling, and refresh functionality
 * 
 * @param organizationId - The ID of the organization to fetch teams for
 * @returns Object containing teams data, loading state, error, and refresh function
 */
interface UseOrganizationTeamsReturn {
  teams: Team[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const useOrganizationTeams = (organizationId: string, enabled: boolean = true): UseOrganizationTeamsReturn => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetches teams for the specified organization
   * Handles loading states and error management
   */
  const fetchTeams = useCallback(async () => {
    if (!organizationId || organizationId.trim() === "") {
      setLoading(false);
      setError(null);
      setTeams([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetchOrganizationTeams(organizationId);
      // Extract teams from response - backend returns { success: true, teams: [...] }
      const teams = response?.teams || [];
      setTeams(teams);
      
    } catch (error: any) {
      // cybedefend-ignore[CD-SAST-1269]: a developer console message in the user's own browser, naming the organization the user selected
      console.error(`❌ Failed to load teams for organization ${organizationId}:`, error);
      setError(
        apiErrorText(error)
      );
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  /**
   * Public refresh function for manual data reloading
   */
  const refresh = useCallback(() => {
    fetchTeams();
  }, [fetchTeams]);

  // Initial data fetch on mount or organizationId change - only if enabled
  useEffect(() => {
    if (enabled) {
      fetchTeams();
    }
  }, [fetchTeams, enabled]);

  return {
    teams,
    loading,
    error,
    refresh,
  };
};

export default useOrganizationTeams;
