import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The organization settings page lists the members and the pending
 * invitations. The invitations used to be requested only once the members
 * had answered, and again on every page or search of the member list,
 * although they depend on neither.
 */

const { fetchOrganizationUsers, fetchOrganizationInvitations } = vi.hoisted(() => ({
  fetchOrganizationUsers: vi.fn(),
  fetchOrganizationInvitations: vi.fn(),
}));

vi.mock('../services/organizationService', () => ({
  fetchOrganizationUsers,
  fetchOrganizationInvitations,
}));
vi.mock('./useRealtimeStream', () => ({ useRealtimeStream: vi.fn() }));

import useOrganizationUsers from './useOrganizationUsers';

const membersPage = { users: [], totalUsers: 12, totalPages: 3 };
const invitationsPage = { invitations: [], total: 0 };

/** A promise the test settles itself. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('useOrganizationUsers', () => {
  beforeEach(() => {
    fetchOrganizationUsers.mockReset();
    fetchOrganizationInvitations.mockReset();
    fetchOrganizationUsers.mockResolvedValue(membersPage);
    fetchOrganizationInvitations.mockResolvedValue(invitationsPage);
  });

  it('asks for the invitations without waiting for the members', async () => {
    const members = deferred<typeof membersPage>();
    fetchOrganizationUsers.mockReturnValueOnce(members.promise);

    renderHook(() => useOrganizationUsers('org-1', 5, ''));

    await waitFor(() => expect(fetchOrganizationInvitations).toHaveBeenCalledTimes(1));
    // The members request is still in flight.
    expect(fetchOrganizationUsers).toHaveBeenCalledTimes(1);

    await act(async () => members.resolve(membersPage));
  });

  it('pages through the members without reloading the invitations', async () => {
    const { result } = renderHook(() => useOrganizationUsers('org-1', 5, ''));
    await waitFor(() => expect(fetchOrganizationInvitations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.goToPage(2));

    await waitFor(() =>
      expect(fetchOrganizationUsers).toHaveBeenLastCalledWith('org-1', 2, 5, ''),
    );
    expect(fetchOrganizationUsers).toHaveBeenCalledTimes(2);
    expect(fetchOrganizationInvitations).toHaveBeenCalledTimes(1);
  });

  it('searches with one members request, from any page, and leaves the invitations alone', async () => {
    const { result, rerender } = renderHook(
      ({ query }) => useOrganizationUsers('org-1', 5, query),
      { initialProps: { query: '' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.goToPage(2));
    await waitFor(() => expect(fetchOrganizationUsers).toHaveBeenCalledTimes(2));
    fetchOrganizationUsers.mockClear();

    rerender({ query: 'ada' });

    await waitFor(() => expect(fetchOrganizationUsers).toHaveBeenCalledWith('org-1', 1, 5, 'ada'));
    // Let any follow-up render run its request.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchOrganizationUsers.mock.calls).toEqual([['org-1', 1, 5, 'ada']]);
    expect(result.current.currentPage).toBe(1);
    expect(fetchOrganizationInvitations).toHaveBeenCalledTimes(1);
  });

  it('reloads members and invitations once per refresh, even two refreshes in one batch', async () => {
    const { result } = renderHook(() => useOrganizationUsers('org-1', 5, ''));
    await waitFor(() => expect(fetchOrganizationInvitations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A mutation refreshes the list, and its MEMBERSHIP_CHANGED event does
    // too: the two can land in the same render.
    act(() => {
      result.current.refresh();
      result.current.refresh();
    });

    await waitFor(() => expect(fetchOrganizationUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchOrganizationInvitations).toHaveBeenCalledTimes(2));
  });
});
