import { useState, useEffect } from "react";
import {
  OrganizationOverviewFilters,
  OrganizationStateDistributionResponse,
} from "@/server/interfaces/Vulnerability";
import { getOrganizationStateDistribution } from "@/server/services/resultService";
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface Return {
  data: OrganizationStateDistributionResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Lazily fetch the org state distribution. Mounted only when the
 * State tab is active, so the request fires on tab open, not page load.
 * Refetches whenever the shared filters change.
 */
export const useOrganizationStateDistribution = (
  organizationId: string | undefined,
  filters: OrganizationOverviewFilters,
): Return => {
  const [data, setData] =
    useState<OrganizationStateDistributionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOrganizationStateDistribution(organizationId, filters)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: any) => {
        if (!cancelled)
          setError(apiErrorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, JSON.stringify(filters)]);

  return { data, loading, error };
};

export default useOrganizationStateDistribution;
