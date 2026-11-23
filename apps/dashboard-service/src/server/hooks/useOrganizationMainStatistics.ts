import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectStatistics } from "../interfaces/Project";
import { fetchOrganizationMainStatistics } from "../services/projectService";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Loads the org-wide home KPI cards from the dedicated
 * GET /organization/:id/main-statistics endpoint, kept OFF the paginated
 * project-list response so the list renders immediately.
 *
 * No SSE of its own — the home page already owns one scoped stream
 * (useOrganizationProjects). Wire `refresh()` to its `onOrgStatsUpdated`, which
 * fires when the recompute worker has persisted new numbers: the endpoint
 * serves that persisted row, so no other event can change what it answers.
 */
export const useOrganizationMainStatistics = (
  organizationId: string,
  enabled: boolean = true,
) => {
  const [mainStatistics, setMainStatistics] =
    useState<ProjectStatistics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const lastOrgRef = useRef<string | null>(null);

  const fetchStats = useCallback(
    async (silent: boolean = false) => {
      if (!organizationId || organizationId.trim() === "") {
        setMainStatistics(null);
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await fetchOrganizationMainStatistics(organizationId);
        setMainStatistics(data);
      } catch (err: any) {
        setMainStatistics(null);
        setError(
          apiErrorText(err),
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (!enabled) return;
    if (!organizationId || organizationId.trim() === "") {
      setMainStatistics(null);
      setLoading(false);
      lastOrgRef.current = null;
      return;
    }
    // When the org changes, clear the previous org's numbers so the cards show
    // a skeleton (cardsLoading) instead of stale values during the refetch.
    if (lastOrgRef.current !== organizationId) {
      lastOrgRef.current = organizationId;
      setMainStatistics(null);
    }
    void fetchStats();
  }, [organizationId, enabled, fetchStats]);

  const refresh = useCallback(() => {
    void fetchStats(true);
  }, [fetchStats]);

  return { mainStatistics, loading, error, refresh };
};

export default useOrganizationMainStatistics;
