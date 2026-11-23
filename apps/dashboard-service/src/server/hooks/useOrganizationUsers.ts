import { useState, useEffect, useRef } from 'react';
import useDebouncedValue from './useDebouncedValue';
import { fetchOrganizationUsers, fetchOrganizationInvitations } from '../services/organizationService';
import { User } from '../interfaces/User';
import { OrganizationInviteResponseDto } from '../interfaces/Organization';
import { useRealtimeStream } from './useRealtimeStream';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const useOrganizationUsers = (
  organizationId: string,
  pageSize: number,
  searchQuery: string,
) => {
  const [users, setUsers] = useState<User[]>([]);
  const [totalUsers, setTotalUsers] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1); 
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // A counter, not a toggled boolean: two refreshes landing in one render (a
  // mutation's own refresh and its MEMBERSHIP_CHANGED event) toggled the flag
  // back to its value, and the list was not reloaded at all.
  const [refreshCount, setRefreshCount] = useState<number>(0);

  
  const [invitations, setInvitations] = useState<OrganizationInviteResponseDto[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState<boolean>(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const previousOrganizationIdRef = useRef<string | null>(null);
  const previousSearchQueryRef = useRef<string | null>(null);

  const fetchUsers = async (page: number, query: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrganizationUsers(organizationId, page, pageSize, query);
      setUsers(data.users);
      setTotalUsers(data.totalUsers);
      setTotalPages(data.totalPages);
    } catch (error: any) {
      setUsers([]);
      setTotalUsers(0);
      setTotalPages(0);
      setError(apiErrorText(error));
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const fetchInvitationsData = async () => {
    if (!organizationId || organizationId.trim() === "") return;
    setInvitationsLoading(true);
    setInvitationsError(null);
    try {
      
      const invitesData = await fetchOrganizationInvitations(organizationId, 1, 20);
      setInvitations(invitesData.invitations);
    } catch (error:any) {
      setInvitations([]);
      setInvitationsError(apiErrorText(error));
      throw error;
    } finally {
      setInvitationsLoading(false);
    }
  };

  // The members: one request per page, search or page size. A new search (or
  // organization) restarts at page 1; when the list is not on page 1, the page
  // change requests it, so the old page is never fetched with the new query.
  useEffect(() => {
    if (!organizationId) {
      setUsers([]);
      setTotalUsers(0);
      setTotalPages(0);
      return;
    }
    if (
      organizationId !== previousOrganizationIdRef.current ||
      debouncedSearchQuery !== previousSearchQueryRef.current
    ) {
      previousOrganizationIdRef.current = organizationId;
      previousSearchQueryRef.current = debouncedSearchQuery;
      if (currentPage !== 1) {
        setCurrentPage(1);
        return;
      }
    }
    // The failure is already in `error`.
    fetchUsers(currentPage, debouncedSearchQuery).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, currentPage, debouncedSearchQuery, refreshCount, pageSize]);

  // The pending invitations depend on the organization only, not on the page
  // or the search of the member list: requested beside the members, never
  // after them, and only reloaded by a refresh.
  useEffect(() => {
    if (!organizationId) {
      setInvitations([]);
      return;
    }
    // The failure is already in `invitationsError`.
    fetchInvitationsData().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, refreshCount]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const refresh = () => {
    setRefreshCount((count) => count + 1);
  };

  // Realtime SSE wiring — re-fetches on relevant server-push events
  const realtimeUrl = features.realtime.members && organizationId && organizationId.trim() !== ''
    ? `${getRegionConfig().apiUrl}/v1/realtime/orgs/${organizationId}/members/stream`
    : null;

  useRealtimeStream(realtimeUrl, {
    MEMBERSHIP_CHANGED: () => refresh(),
  }, [organizationId]);

  return {
    users,
    totalUsers,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
    invitations,
    invitationsLoading,
    invitationsError,
  };
};

export default useOrganizationUsers;
