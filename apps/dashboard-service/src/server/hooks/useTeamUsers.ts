import { useState, useEffect, useRef } from 'react';
import useDebouncedValue from './useDebouncedValue';
import { fetchTeamUsers } from '../services/teamService';
import { User } from '../interfaces/User';
import { useRealtimeStream } from './useRealtimeStream';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const useTeamUsers = (
  teamId: string,
  pageSize: number,
  searchQuery: string,
) => {
  const [users, setUsers] = useState<User[]>([]);
  const [totalUsers, setTotalUsers] = useState<number>(0);
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

  // Combined effect to fetch users
  useEffect(() => {
    // Guard: Don't fetch if teamId is not valid
    if (!teamId || teamId.trim() === "") {
      setUsers([]);
      setTotalUsers(0);
      setTotalPages(0);
      setLoading(false); // Ensure loading is off
      isInitialLoad.current = true; // Reset initial load flag if teamId becomes invalid
      return;
    }

    // Mark initial load as complete once we have a valid teamId
    isInitialLoad.current = false;

    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch users for the current page
        const data = await fetchTeamUsers(teamId, currentPage, pageSize, debouncedSearchQuery);
        setUsers(data.users || []); // Ensure array even if undefined
        setTotalUsers(data.totalUsers || 0);
        setTotalPages(data.totalPages || 0);
      } catch (error: any) {
        setUsers([]);
        setTotalUsers(0);
        setTotalPages(0);
        setError(apiErrorText(error));
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();

  }, [
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

  // Realtime SSE wiring — re-fetches on relevant server-push events
  const realtimeUrl = features.realtime.teams && teamId && teamId.trim() !== ''
    ? `${getRegionConfig().apiUrl}/v1/realtime/teams/${teamId}/stream`
    : null;

  useRealtimeStream(realtimeUrl, {
    MEMBERSHIP_CHANGED: () => refresh(),
  }, [teamId]);

  return {
    users,
    totalUsers,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
  };
};

export default useTeamUsers;
