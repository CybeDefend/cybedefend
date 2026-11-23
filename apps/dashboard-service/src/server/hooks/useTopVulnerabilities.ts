import { useState, useEffect } from 'react';
import { TopVulnerabilityItem, GetTopVulnerabilitiesResponse } from '../interfaces/Vulnerability';
import { fetchTopVulnerabilities } from '../services/resultService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

interface UseTopVulnerabilitiesResult {
  items: TopVulnerabilityItem[];
  isLoading: boolean;
  error: string | null;
}

export const useTopVulnerabilities = (
  projectId: string | undefined,
  limit: number = 5
): UseTopVulnerabilitiesResult => {
  const [items, setItems] = useState<TopVulnerabilityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchTopVulnerabilities(projectId, limit)
      .then((response: GetTopVulnerabilitiesResponse) => {
        if (!cancelled) {
          setItems(response.items);
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
  }, [projectId, limit]);

  return { items, isLoading, error };
};
