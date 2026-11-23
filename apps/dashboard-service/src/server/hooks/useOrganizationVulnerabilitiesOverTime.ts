import { useState, useEffect } from "react";
import {
  OrganizationOverviewFilters,
  OrganizationVulnerabilitiesOverTimeResponse,
} from "@/server/interfaces/Vulnerability";
import { getOrganizationVulnerabilitiesOverTime } from "@/server/services/resultService";
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface Return {
  data: OrganizationVulnerabilitiesOverTimeResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Lazily fetch the org vulnerability trends over time. Mounted only
 * when the Trends tab is active, so the request fires on tab open, not page
 * load. Refetches whenever the shared filters change.
 */
export const useOrganizationVulnerabilitiesOverTime = (
  organizationId: string | undefined,
  filters: OrganizationOverviewFilters,
): Return => {
  const [data, setData] =
    useState<OrganizationVulnerabilitiesOverTimeResponse | null>(null);
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
    getOrganizationVulnerabilitiesOverTime(organizationId, filters)
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

export default useOrganizationVulnerabilitiesOverTime;
