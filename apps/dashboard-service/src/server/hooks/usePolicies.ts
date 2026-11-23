// ============================================================================
// usePolicies Hook - Policy CRUD operations
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  togglePolicy,
} from '../services/policyService';
import { Policy, PolicyScope, CreatePolicyDto, UpdatePolicyDto } from '../interfaces/Policy';
import { useRealtimeStream } from './useRealtimeStream';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UsePoliciesOptions {
  organizationId: string;
  scope?: PolicyScope;
  targetId?: string;
  pageSize?: number;
  autoFetch?: boolean;
}

interface UsePoliciesReturn {
  policies: Policy[];
  loading: boolean;
  error: string | null;
  total: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  /** Filters applied by the server; each change goes back to page 1. */
  scopeFilter: PolicyScope | undefined;
  setScopeFilter: (scope: PolicyScope | undefined) => void;
  enabledFilter: boolean | undefined;
  setEnabledFilter: (isEnabled: boolean | undefined) => void;
  setCurrentPage: (page: number) => void;
  refresh: () => Promise<void>;
  create: (data: CreatePolicyDto) => Promise<Policy>;
  update: (policyId: string, data: UpdatePolicyDto) => Promise<Policy>;
  remove: (policyId: string) => Promise<void>;
  toggle: (policyId: string, isEnabled: boolean) => Promise<Policy>;
}

/** The search waits for the typing to stop: one request, not one per key. */
const SEARCH_DEBOUNCE_MS = 300;

export const usePolicies = ({
  organizationId,
  scope,
  targetId,
  pageSize = 20,
  autoFetch = true,
}: UsePoliciesOptions): UsePoliciesReturn => {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  // What the field shows, and the search the list was asked for.
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [scopeFilter, setScopeFilterState] = useState<PolicyScope | undefined>(undefined);
  const [enabledFilter, setEnabledFilterState] = useState<boolean | undefined>(undefined);

  const totalPages = Math.ceil(total / pageSize);

  // Two filters changed close together run two requests at once, and the
  // first one can come back last: only the latest request may write the
  // list, the total and loading (the same guard as the compliance overview).
  const requestSeq = useRef(0);

  const loadPolicies = useCallback(async () => {
    const seq = ++requestSeq.current;
    const isLatest = () => seq === requestSeq.current;

    if (!organizationId) {
      setPolicies([]);
      // A request still in flight is no longer the latest: it will not clear it.
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchPolicies(organizationId, {
        scope: scopeFilter ?? scope,
        targetId,
        isEnabled: enabledFilter,
        page: currentPage,
        pageSize,
        search: appliedSearch || undefined,
      });
      if (!isLatest()) return;
      setPolicies(response.policies);
      setTotal(response.total);
    } catch (err: any) {
      if (!isLatest()) return;
      console.error('Error fetching policies:', err);
      setError(apiErrorText(err));
      setPolicies([]);
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [organizationId, scope, targetId, currentPage, pageSize, appliedSearch, scopeFilter, enabledFilter]);

  // The search and its page 1 are set in the same timer callback, so React
  // renders once and the list is asked for once.
  useEffect(() => {
    if (searchQuery === appliedSearch) return;
    const timer = setTimeout(() => {
      setAppliedSearch(searchQuery);
      setCurrentPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery, appliedSearch]);

  // A filter narrows the list the server pages through: the current page of
  // the previous filter means nothing in the new one.
  const setScopeFilter = useCallback((next: PolicyScope | undefined) => {
    setScopeFilterState(next);
    setCurrentPage(1);
  }, []);
  const setEnabledFilter = useCallback((next: boolean | undefined) => {
    setEnabledFilterState(next);
    setCurrentPage(1);
  }, []);

  // Realtime SSE wiring — project-scoped only (when scope === 'project' and targetId is set).
  // Org-scoped policy lists do not have a dedicated realtime endpoint yet.
  const projectId = scope === 'project' ? targetId : undefined;
  const realtimeUrl = features.realtime.policies && projectId && projectId.trim() !== ''
    ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/policies/stream`
    : null;

  useRealtimeStream(realtimeUrl, {
    POLICY_EVALUATION_COMPLETED: () => loadPolicies(),
  }, [projectId]);

  useEffect(() => {
    if (autoFetch && organizationId) {
      loadPolicies();
    }
  }, [loadPolicies, organizationId, autoFetch]);

  // A mutation reloads the list only where this hook shows one (autoFetch).
  // The create and edit pages navigate away once it is done: reloading a
  // list nobody reads, and waiting for it, delayed that navigation.
  const reloadShownList = async (): Promise<void> => {
    if (autoFetch) await loadPolicies();
  };

  const handleCreate = async (data: CreatePolicyDto): Promise<Policy> => {
    const newPolicy = await createPolicy(organizationId, data);
    await reloadShownList();
    return newPolicy;
  };

  const handleUpdate = async (policyId: string, data: UpdatePolicyDto): Promise<Policy> => {
    const updatedPolicy = await updatePolicy(organizationId, policyId, data);
    await reloadShownList();
    return updatedPolicy;
  };

  const handleDelete = async (policyId: string): Promise<void> => {
    await deletePolicy(organizationId, policyId);
    await reloadShownList();
  };

  const handleToggle = async (policyId: string, isEnabled: boolean): Promise<Policy> => {
    const updatedPolicy = await togglePolicy(organizationId, policyId, isEnabled);
    if (enabledFilter !== undefined) {
      // Under a status filter the toggled policy leaves the list the server
      // returns: ask for that list again rather than show it in the wrong one.
      await reloadShownList();
      return updatedPolicy;
    }
    // Update local state immediately for better UX
    setPolicies((prev) =>
      prev.map((p) => (p.id === policyId ? { ...p, isEnabled } : p))
    );
    return updatedPolicy;
  };

  return {
    policies,
    loading,
    error,
    total,
    currentPage,
    pageSize,
    totalPages,
    searchQuery,
    setSearchQuery,
    scopeFilter,
    setScopeFilter,
    enabledFilter,
    setEnabledFilter,
    setCurrentPage,
    refresh: loadPolicies,
    create: handleCreate,
    update: handleUpdate,
    remove: handleDelete,
    toggle: handleToggle,
  };
};

export default usePolicies;
