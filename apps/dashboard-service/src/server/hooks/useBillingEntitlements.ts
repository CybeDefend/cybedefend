import { useState, useEffect, useCallback } from 'react';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import { apiErrorText } from '@/utils/function/apiErrorKey';

/** The plan's limits the core pages read (the stored reports); the billing pages read the whole answer. */
export interface ReportEntitlements {
  maxStoredReports?: number;
  reportRetentionDays?: number;
}

/**
 * The organisation's entitlements, as the edition's plan serves them
 * (`ACTIVE_EXTENSIONS.billing`). Without a plan (the Community Edition) there
 * is none: `entitlements` stays null, nothing is asked, and no limit applies.
 */
const useBillingEntitlements = <T extends object = ReportEntitlements>(organizationId: string) => {
  const [entitlements, setEntitlements] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const fetchBillingEntitlements = ACTIVE_EXTENSIONS.billing?.fetchEntitlements ?? null;

  const fetchEntitlements = useCallback(async () => {
    if (!fetchBillingEntitlements) return;
    if (!organizationId) {
      setError('Organization ID is required');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const data = await fetchBillingEntitlements(organizationId);
      setEntitlements(data as T);
    } catch (err: any) {
      const errorMessage = apiErrorText(err);
      setError(errorMessage);
      setEntitlements(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, fetchBillingEntitlements]);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements]);

  const refresh = useCallback(() => {
    fetchEntitlements();
  }, [fetchEntitlements]);

  return {
    entitlements,
    loading,
    error,
    refresh,
  };
};

export default useBillingEntitlements;
