import { useState, useEffect } from 'react';
import { PriorityDecomposition, PriorityDecompositionResponse } from '../interfaces/Vulnerability';
import { fetchPriorityDecomposition } from '../services/resultService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UsePriorityDecompositionResult {
  decomposition: PriorityDecomposition | null;
  isLoading: boolean;
  error: string | null;
}

export const usePriorityDecomposition = (
  projectId: string | undefined,
  vulnerabilityId: string | undefined,
  vulnerabilityType: string | undefined
): UsePriorityDecompositionResult => {
  const [decomposition, setDecomposition] = useState<PriorityDecomposition | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !vulnerabilityId || !vulnerabilityType) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchPriorityDecomposition(projectId, vulnerabilityId, vulnerabilityType)
      .then((response: PriorityDecompositionResponse) => {
        if (!cancelled) {
          setDecomposition(response.decomposition);
          setIsLoading(false);
        }
      })
      .catch((err: { message?: string }) => {
        if (!cancelled) {
          setError(apiErrorText(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, vulnerabilityId, vulnerabilityType]);

  return { decomposition, isLoading, error };
};
