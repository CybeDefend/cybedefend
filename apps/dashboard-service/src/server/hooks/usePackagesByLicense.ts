import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchPackagesByLicense } from '../services/resultService';
import { LicenseDetailResponse } from '../interfaces/Packages';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UsePackagesByLicenseOptions {
  projectId: string;
  spdxId: string;
  branch?: string;
  organizationId?: string;
  packageType?: string[];
  enabled?: boolean;
}

interface UsePackagesByLicenseReturn {
  data: LicenseDetailResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export default function usePackagesByLicense({
  projectId,
  spdxId,
  branch,
  organizationId,
  packageType,
  enabled = true,
}: UsePackagesByLicenseOptions): UsePackagesByLicenseReturn {
  const [data, setData] = useState<LicenseDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const packageTypeKey = packageType?.join(',') ?? '';
  const stablePackageType = useMemo(() => packageType, [packageTypeKey]);

  const fetchData = useCallback(async () => {
    if (!projectId || !spdxId || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPackagesByLicense(projectId, spdxId, branch, organizationId, stablePackageType);
      setData(result);
    } catch (err: any) {
      setError(apiErrorText(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, spdxId, branch, organizationId, stablePackageType, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}
