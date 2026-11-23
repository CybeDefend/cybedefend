import { useState, useEffect } from "react";
import {
  OrganizationOverviewFilters,
  OrganizationSeverityDistributionResponse,
} from "@/server/interfaces/Vulnerability";
import { getOrganizationSeverityDistribution } from "@/server/services/resultService";
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface Return {
  data: OrganizationSeverityDistributionResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Lazily fetch the org severity distribution. Mounted only when the
 * Severity tab is active, so the request fires on tab open, not page load.
 * Refetches whenever the shared filters change.
 */
export const useOrganizationSeverityDistribution = (
  organizationId: string | undefined,
  filters: OrganizationOverviewFilters,
): Return => {
  const [data, setData] =
    useState<OrganizationSeverityDistributionResponse | null>(null);
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
    getOrganizationSeverityDistribution(organizationId, filters)
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

export default useOrganizationSeverityDistribution;
