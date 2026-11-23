import { useState, useEffect, useRef } from 'react';
import useDebouncedValue from './useDebouncedValue';
import { fetchAllProjectsTeam } from '../services/projectService';
import { Project } from '../interfaces/Project';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const useTeamProjects = (
  teamId: string,
  pageSize: number,
  searchQuery: string,
  enabled: boolean = true // New parameter to control when to fetch
) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [totalProjects, setTotalProjects] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);
  const isInitialLoad = useRef<boolean>(true); // Ref to track initial load/render

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  // Effect to reset page to 1 when teamId, search query or page size changes (after initial load)
  useEffect(() => {
    if (!isInitialLoad.current) {
      setCurrentPage(1);
    }
  }, [teamId, debouncedSearchQuery, pageSize]);

  // Combined effect to fetch projects
  useEffect(() => {
    // Guard: Don't fetch if not enabled or teamId is not valid
    if (!enabled || !teamId || teamId.trim() === "") {
      setProjects([]);
      setTotalProjects(0);
      setTotalPages(0);
      setLoading(false); // Ensure loading is off
      if (!teamId || teamId.trim() === "") {
        isInitialLoad.current = true; // Reset initial load flag if teamId becomes invalid
      }
      return;
    }

    // Mark initial load as complete once we have a valid teamId and are enabled
    isInitialLoad.current = false;

    const fetchProjects = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch projects for the current page
        const data = await fetchAllProjectsTeam(teamId, currentPage, pageSize, debouncedSearchQuery);
        setProjects(data.projects || []); // Ensure array even if undefined
        setTotalProjects(data.totalProjects || 0);
        setTotalPages(data.totalPages || 0);
      } catch (error: any) {
        setProjects([]);
        setTotalProjects(0);
        setTotalPages(0);
        setError(
          apiErrorText(error)
        );
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();

  }, [
    enabled,
    teamId,
    currentPage,
    pageSize,
    debouncedSearchQuery,
    refreshFlag // Include refreshFlag to trigger re-fetch
  ]);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const refresh = () => {
    setRefreshFlag((prev) => !prev);
  };

  return {
    projects,
    totalProjects,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
  };
};

export default useTeamProjects;
