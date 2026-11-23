import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PolicyScope } from '../interfaces/Policy';

/**
 * The policies list: the create page loads no list, the
 * search is debounced, and the scope and status filters are applied by the
 * server, so the pages and the total are those of the filtered list.
 */

const { policyService } = vi.hoisted(() => ({
  policyService: {
    fetchPolicies: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
    togglePolicy: vi.fn(),
  },
}));

vi.mock('../services/policyService', () => policyService);
vi.mock('./useRealtimeStream', () => ({ useRealtimeStream: vi.fn() }));

import { usePolicies } from './usePolicies';

const page = { policies: [], total: 45, page: 1, pageSize: 20 };

/** Let every request a render scheduled go out. */
const settle = (ms = 50) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe('usePolicies', () => {
  beforeEach(() => {
    Object.values(policyService).forEach((fn) => fn.mockReset());
    policyService.fetchPolicies.mockResolvedValue(page);
    policyService.createPolicy.mockResolvedValue({ id: 'p-1' });
    policyService.updatePolicy.mockResolvedValue({ id: 'p-1' });
  });

  it('loads no list for a page that shows none, not even after a create or an update', async () => {
    const { result } = renderHook(() =>
      usePolicies({ organizationId: 'org-1', autoFetch: false }),
    );
    await settle();

    await act(async () => {
      await result.current.create({ yamlContent: 'name: p' } as never);
      await result.current.update('p-1', { yamlContent: 'name: p' } as never);
    });
    await settle();

    expect(policyService.createPolicy).toHaveBeenCalledTimes(1);
    expect(policyService.updatePolicy).toHaveBeenCalledTimes(1);
    expect(policyService.fetchPolicies).not.toHaveBeenCalled();
  });

  it('still reloads the list it shows after a create', async () => {
    const { result } = renderHook(() => usePolicies({ organizationId: 'org-1' }));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.create({ yamlContent: 'name: p' } as never);
    });

    expect(policyService.fetchPolicies).toHaveBeenCalledTimes(2);
  });

  it('searches once the typing stops, from page 1, with one request', async () => {
    const { result } = renderHook(() => usePolicies({ organizationId: 'org-1' }));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(1));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(2));
    policyService.fetchPolicies.mockClear();

    act(() => result.current.setSearchQuery('s'));
    act(() => result.current.setSearchQuery('se'));
    act(() => result.current.setSearchQuery('sec'));
    // The field shows what is typed at once.
    expect(result.current.searchQuery).toBe('sec');
    await settle(100);
    expect(policyService.fetchPolicies).not.toHaveBeenCalled();

    await settle(400);
    expect(policyService.fetchPolicies.mock.calls).toEqual([
      ['org-1', expect.objectContaining({ search: 'sec', page: 1 })],
    ]);
    expect(result.current.currentPage).toBe(1);
  });

  it('asks the server for the scope and the status, from page 1, with one request', async () => {
    const { result } = renderHook(() => usePolicies({ organizationId: 'org-1' }));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(1));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(2));
    policyService.fetchPolicies.mockClear();

    act(() => result.current.setScopeFilter(PolicyScope.TEAM));
    await settle();
    act(() => result.current.setEnabledFilter(false));
    await settle();

    expect(policyService.fetchPolicies.mock.calls).toEqual([
      ['org-1', expect.objectContaining({ scope: PolicyScope.TEAM, page: 1 })],
      [
        'org-1',
        expect.objectContaining({ scope: PolicyScope.TEAM, isEnabled: false, page: 1 }),
      ],
    ]);
    expect(policyService.fetchPolicies.mock.calls[0][1].isEnabled).toBeUndefined();

    act(() => {
      result.current.setScopeFilter(undefined);
      result.current.setEnabledFilter(undefined);
    });
    await settle();
    const last = policyService.fetchPolicies.mock.calls.at(-1)![1];
    expect(last.scope).toBeUndefined();
    expect(last.isEnabled).toBeUndefined();
  });

  it('keeps the answer of the latest request when an older one comes back last', async () => {
    const { result } = renderHook(() => usePolicies({ organizationId: 'org-1' }));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveTeam!: (value: unknown) => void;
    let resolveProject!: (value: unknown) => void;
    policyService.fetchPolicies
      .mockImplementationOnce(() => new Promise((r) => { resolveTeam = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveProject = r; }));
    const teamPolicy = { id: 'team-policy', scope: PolicyScope.TEAM };
    const projectPolicy = { id: 'project-policy', scope: PolicyScope.PROJECT };

    // Two filters picked in quick succession: two requests in flight.
    act(() => result.current.setScopeFilter(PolicyScope.TEAM));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(2));
    act(() => result.current.setScopeFilter(PolicyScope.PROJECT));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(3));

    // The latest answers first, then the older one.
    await act(async () => {
      resolveProject({ policies: [projectPolicy], total: 1, page: 1, pageSize: 20 });
    });
    expect(result.current.loading).toBe(false);
    await act(async () => {
      resolveTeam({ policies: [teamPolicy], total: 7, page: 1, pageSize: 20 });
    });

    expect(result.current.policies).toEqual([projectPolicy]);
    expect(result.current.total).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('stays loading while the latest request is in flight, whatever an older one does', async () => {
    const { result } = renderHook(() => usePolicies({ organizationId: 'org-1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let resolveFirst!: (value: unknown) => void;
    policyService.fetchPolicies
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise(() => undefined));

    act(() => result.current.setScopeFilter(PolicyScope.TEAM));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(2));
    act(() => result.current.setScopeFilter(PolicyScope.PROJECT));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(3));

    await act(async () => {
      resolveFirst({ policies: [], total: 0, page: 1, pageSize: 20 });
    });

    expect(result.current.loading).toBe(true);
  });

  it('asks for the filtered list again when a toggle moves a policy out of it', async () => {
    policyService.togglePolicy.mockResolvedValue({ id: 'p-1', isEnabled: false });
    const { result } = renderHook(() => usePolicies({ organizationId: 'org-1' }));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(1));
    act(() => result.current.setEnabledFilter(true));
    await waitFor(() => expect(policyService.fetchPolicies).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.toggle('p-1', false);
    });

    expect(policyService.fetchPolicies).toHaveBeenCalledTimes(3);
    expect(policyService.fetchPolicies.mock.calls[2][1]).toEqual(
      expect.objectContaining({ isEnabled: true }),
    );
  });
});
