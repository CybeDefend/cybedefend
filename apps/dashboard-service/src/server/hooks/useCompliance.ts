// ============================================================================
// useCompliance Hook - Compliance and evaluation operations
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchEffectivePolicy,
  fetchEvaluationStatus,
  fetchComplianceResult,
  fetchComplianceHistory,
} from '../services/policyService';
import {
  EffectivePolicyResponse,
  ComplianceResult,
  ComplianceHistoryResponse,
  EvaluationStatus,
  EvaluationStatusResponse,
} from '../interfaces/Policy';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseComplianceOptions {
  organizationId: string;
  projectId: string;
  scanId?: string;
  autoFetch?: boolean;
  autoFetchEffectivePolicy?: boolean;
  autoFetchHistory?: boolean;
  autoFetchComplianceResult?: boolean;
}

interface UseComplianceReturn {
  // Effective Policy
  effectivePolicy: EffectivePolicyResponse | null;
  effectivePolicyLoading: boolean;
  effectivePolicyError: string | null;
  effectivePolicyFetched: boolean;
  refreshEffectivePolicy: () => Promise<void>;
  fetchEffectivePolicyOnce: () => Promise<void>;

  // Compliance Result
  complianceResult: ComplianceResult | null;
  complianceLoading: boolean;
  complianceError: string | null;
  complianceResultFetched: boolean;
  refreshCompliance: () => Promise<void>;
  fetchComplianceOnce: () => Promise<void>;

  // Compliance History
  complianceHistory: ComplianceHistoryResponse | null;
  historyLoading: boolean;
  historyError: string | null;
  historyFetched: boolean;
  historyPage: number;
  setHistoryPage: (page: number) => void;
  historyPageSize: number;
  setHistoryPageSize: (size: number) => void;
  refreshHistory: () => Promise<void>;
  fetchHistoryOnce: () => Promise<void>;

  // Evaluation
  evaluating: boolean;
  evaluationStatus: EvaluationStatusResponse | null;
  pollEvaluationStatus: (evaluationId: string) => void;
  stopPolling: () => void;
}

export const useCompliance = ({
  organizationId,
  projectId,
  scanId,
  autoFetch = true,
  autoFetchEffectivePolicy,
  autoFetchHistory,
  autoFetchComplianceResult,
}: UseComplianceOptions): UseComplianceReturn => {
  // Determine individual autoFetch flags (fallback to autoFetch if not specified)
  const shouldAutoFetchEffectivePolicy = autoFetchEffectivePolicy ?? autoFetch;
  const shouldAutoFetchHistory = autoFetchHistory ?? autoFetch;
  const shouldAutoFetchComplianceResult = autoFetchComplianceResult ?? autoFetch;
  // Effective Policy State
  const [effectivePolicy, setEffectivePolicy] = useState<EffectivePolicyResponse | null>(null);
  const [effectivePolicyLoading, setEffectivePolicyLoading] = useState(false);
  const [effectivePolicyError, setEffectivePolicyError] = useState<string | null>(null);
  const [effectivePolicyFetched, setEffectivePolicyFetched] = useState(false);

  // Compliance Result State
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [complianceResultFetched, setComplianceResultFetched] = useState(false);

  // Compliance History State
  const [complianceHistory, setComplianceHistory] = useState<ComplianceHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFetched, setHistoryFetched] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  // Evaluation State
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationStatus, setEvaluationStatus] = useState<EvaluationStatusResponse | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ============================================================================
  // Effective Policy
  // ============================================================================

  const loadEffectivePolicy = useCallback(async () => {
    if (!organizationId || !projectId) {
      return;
    }

    setEffectivePolicyLoading(true);
    setEffectivePolicyError(null);

    try {
      const response = await fetchEffectivePolicy(projectId);
      setEffectivePolicy(response);
      setEffectivePolicyFetched(true);
    } catch (err: any) {
      console.error('Error fetching effective policy:', err);
      setEffectivePolicyError(apiErrorText(err));
    } finally {
      setEffectivePolicyLoading(false);
    }
  }, [organizationId, projectId]);

  // Fetch effective policy only once (lazy loading)
  const fetchEffectivePolicyOnce = useCallback(async () => {
    if (!effectivePolicyFetched && !effectivePolicyLoading) {
      await loadEffectivePolicy();
    }
  }, [effectivePolicyFetched, effectivePolicyLoading, loadEffectivePolicy]);

  // ============================================================================
  // Compliance Result
  // ============================================================================

  const loadComplianceResult = useCallback(async () => {
    if (!organizationId || !projectId || !scanId) {
      return;
    }

    setComplianceLoading(true);
    setComplianceError(null);

    try {
      const response = await fetchComplianceResult(projectId, scanId);
      setComplianceResult(response);
      setComplianceResultFetched(true);
    } catch (err: any) {
      console.error('Error fetching compliance result:', err);
      setComplianceError(apiErrorText(err));
    } finally {
      setComplianceLoading(false);
    }
  }, [organizationId, projectId, scanId]);

  // Fetch compliance result only once (lazy loading)
  const fetchComplianceOnce = useCallback(async () => {
    if (!complianceResultFetched && !complianceLoading) {
      await loadComplianceResult();
    }
  }, [complianceResultFetched, complianceLoading, loadComplianceResult]);

  // ============================================================================
  // Compliance History
  // ============================================================================

  const loadComplianceHistory = useCallback(async () => {
    if (!organizationId || !projectId) {
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const response = await fetchComplianceHistory(projectId, {
        page: historyPage,
        pageSize: historyPageSize,
      });
      setComplianceHistory(response);
    } catch (err: any) {
      console.error('Error fetching compliance history:', err);
      setHistoryError(apiErrorText(err));
    } finally {
      setHistoryLoading(false);
      setHistoryFetched(true);
    }
  }, [organizationId, projectId, historyPage, historyPageSize]);

  // Fetch history only once (lazy loading)
  const fetchHistoryOnce = useCallback(async () => {
    if (!historyFetched && !historyLoading) {
      await loadComplianceHistory();
    }
  }, [historyFetched, historyLoading, loadComplianceHistory]);

  // ============================================================================
  // Evaluation
  // ============================================================================

  const pollEvaluationStatus = useCallback((evaluationId: string) => {
    if (!organizationId || !projectId || !scanId) {
      return;
    }

    // Clear any existing polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const poll = async () => {
      try {
        const status = await fetchEvaluationStatus(
          projectId,
          scanId,
          evaluationId
        );
        setEvaluationStatus(status);

        if (status.status === EvaluationStatus.COMPLETED || status.status === EvaluationStatus.FAILED) {
          setEvaluating(false);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          // Refresh compliance result after evaluation completes
          loadComplianceResult();
        }
      } catch (err) {
        console.error('Error polling evaluation status:', err);
        setEvaluating(false);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    };

    // Initial poll
    poll();

    // Set up interval for subsequent polls
    pollingIntervalRef.current = setInterval(poll, 3000);
  }, [organizationId, projectId, scanId, loadComplianceResult]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setEvaluating(false);
  }, []);

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    if (shouldAutoFetchEffectivePolicy && organizationId && projectId) {
      loadEffectivePolicy();
    }
  }, [shouldAutoFetchEffectivePolicy, organizationId, projectId, loadEffectivePolicy]);

  useEffect(() => {
    if (shouldAutoFetchHistory && organizationId && projectId) {
      loadComplianceHistory();
    }
  }, [shouldAutoFetchHistory, organizationId, projectId, loadComplianceHistory]);

  // Reload history when page or pageSize changes (after initial fetch)
  useEffect(() => {
    if (historyFetched && organizationId && projectId) {
      loadComplianceHistory();
    }
  }, [historyPage, historyPageSize]);

  useEffect(() => {
    if (shouldAutoFetchComplianceResult && organizationId && projectId && scanId) {
      loadComplianceResult();
    }
  }, [shouldAutoFetchComplianceResult, organizationId, projectId, scanId, loadComplianceResult]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  return {
    // Effective Policy
    effectivePolicy,
    effectivePolicyLoading,
    effectivePolicyError,
    effectivePolicyFetched,
    refreshEffectivePolicy: loadEffectivePolicy,
    fetchEffectivePolicyOnce,

    // Compliance Result
    complianceResult,
    complianceLoading,
    complianceError,
    complianceResultFetched,
    refreshCompliance: loadComplianceResult,
    fetchComplianceOnce,

    // Compliance History
    complianceHistory,
    historyLoading,
    historyError,
    historyFetched,
    historyPage,
    setHistoryPage,
    historyPageSize,
    setHistoryPageSize,
    refreshHistory: loadComplianceHistory,
    fetchHistoryOnce,

    // Evaluation
    evaluating,
    evaluationStatus,
    pollEvaluationStatus,
    stopPolling,
  };
};

export default useCompliance;
