import { useState, useEffect, useCallback } from 'react';
import { fetchProjectsForOrganization } from '../services/projectService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Lightweight hook that returns the total number of projects in an organization
 * without paginating through every page.
 *
 * The backend's paginated projects endpoint already carries `totalProjects` in
 * page 1 (`PaginatedProjectsAllInformationsResponseDto`). Callers that only
 * need the count — e.g. the billing page's "X / Y projects" indicator — would
 * otherwise pull the full list via useAllOrganizationProjects, which issues N
 * extra requests purely to load data we never read.
 *
 * Uses pageSize=1 to minimise transferred bytes; the count itself comes from
 * the wrapper, not from the projects array length.
 */
interface UseOrganizationProjectsCountReturn {
  count: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const useOrganizationProjectsCount = (
  organizationId: string,
): UseOrganizationProjectsCountReturn => {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);

  const fetchCount = useCallback(async () => {
    if (!organizationId || organizationId.trim() === '') {
      setLoading(false);
      setError(null);
      setCount(0);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const page = await fetchProjectsForOrganization(organizationId, 1, 1, '');
      setCount(page.totalProjects ?? 0);
    } catch (err: any) {
      setError(apiErrorText(err));
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const refresh = useCallback(() => {
    setRefreshFlag((prev) => !prev);
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount, refreshFlag]);

  return { count, loading, error, refresh };
};

export default useOrganizationProjectsCount;
