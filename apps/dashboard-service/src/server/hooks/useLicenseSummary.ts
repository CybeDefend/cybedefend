import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchLicenseSummary } from '../services/resultService';
import { LicenseSummaryResponse } from '../interfaces/Packages';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseLicenseSummaryOptions {
  projectId: string;
  branch?: string;
  organizationId?: string;
  packageType?: string[];
  enabled?: boolean;
}

interface UseLicenseSummaryReturn {
  data: LicenseSummaryResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export default function useLicenseSummary({
  projectId,
  branch,
  organizationId,
  packageType,
  enabled = true,
}: UseLicenseSummaryOptions): UseLicenseSummaryReturn {
  const [data, setData] = useState<LicenseSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const packageTypeKey = packageType?.join(',') ?? '';
  const stablePackageType = useMemo(() => packageType, [packageTypeKey]);

  const fetchData = useCallback(async () => {
    if (!projectId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLicenseSummary(projectId, branch, organizationId, stablePackageType);
      setData(result);
    } catch (err: any) {
      setError(apiErrorText(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, branch, organizationId, stablePackageType, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}
