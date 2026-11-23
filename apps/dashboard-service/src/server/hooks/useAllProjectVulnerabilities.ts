import { useState, useEffect } from 'react';
import { VulnerabilityResult } from '../interfaces/Vulnerability';
import {
  fetchSastResultsForProject,
  fetchScaResultsForProject,
  fetchIacResultsForProject,
  fetchContainerResultsForProject
} from '../services/resultService';
import { useRealtimeStream } from './useRealtimeStream';
import { useThrottledRealtimeRefresh } from './useThrottledRealtimeRefresh';
import { features } from '@/utils/featureFlags';
import { getRegionConfig } from '@/utils/function/region';

interface UseAllProjectVulnerabilitiesReturn {
  vulnerabilities: VulnerabilityResult[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch all vulnerabilities for a project from all types (SAST, SCA, IAC, Container)
 * Used specifically for the AI chat vulnerability selection
 */
export const useAllProjectVulnerabilities = (projectId: string): UseAllProjectVulnerabilitiesReturn => {
  const [vulnerabilities, setVulnerabilities] = useState<VulnerabilityResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // When `silent` is true, the global loading/error flags are not toggled —
  // used by realtime handlers so the picker does not flash on each event.
  const fetchAllVulnerabilities = async (silent = false) => {
    if (!projectId) return;

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      // Fetch all types of vulnerabilities in parallel
      const [sastResponse, scaResponse, iacResponse, containerResponse] = await Promise.allSettled([
        fetchSastResultsForProject(projectId, { pageNumber: 1, pageSizeNumber: 100 }),
        fetchScaResultsForProject(projectId, { pageNumber: 1, pageSizeNumber: 100 }),
        fetchIacResultsForProject(projectId, { pageNumber: 1, pageSizeNumber: 100 }),
        fetchContainerResultsForProject(projectId, { page: 1, limit: 100 })
      ]);

      const allVulnerabilities: VulnerabilityResult[] = [];

      // Process SAST results
      if (sastResponse.status === 'fulfilled') {
        allVulnerabilities.push(...sastResponse.value.vulnerabilities);
      }

      // Process SCA results
      if (scaResponse.status === 'fulfilled') {
        allVulnerabilities.push(...scaResponse.value.vulnerabilities);
      }

      // Process IAC results
      if (iacResponse.status === 'fulfilled') {
        allVulnerabilities.push(...iacResponse.value.vulnerabilities);
      }

      // Process Container results
      if (containerResponse.status === 'fulfilled') {
        allVulnerabilities.push(...containerResponse.value.vulnerabilities);
      }

      // Sort vulnerabilities by severity and creation date
      const severityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
      const sortedVulnerabilities = allVulnerabilities.sort((a, b) => {
        // First sort by severity
        const aSeverity = severityOrder[a.currentSeverity?.toLowerCase() as keyof typeof severityOrder] || 0;
        const bSeverity = severityOrder[b.currentSeverity?.toLowerCase() as keyof typeof severityOrder] || 0;
        
        if (aSeverity !== bSeverity) {
          return bSeverity - aSeverity; // Descending order (critical first)
        }

        // Then sort by creation date (newest first)
        const aDate = new Date(a.createdAt || 0).getTime();
        const bDate = new Date(b.createdAt || 0).getTime();
        return bDate - aDate;
      });

      setVulnerabilities(sortedVulnerabilities);
    } catch (err) {
      if (silent) {
        console.warn('Silent vulnerabilities refresh failed:', err);
        return;
      }
      console.error('Error fetching vulnerabilities:', err);
      setError('Failed to fetch vulnerabilities. Please try again.');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchAllVulnerabilities();
  }, [projectId]);

  const refetch = () => {
    fetchAllVulnerabilities();
  };

  // Realtime SSE subscription — only active when feature flag is on and projectId is known
  const realtimeUrl =
    features.realtime.issues && projectId && projectId.trim() !== ""
      ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/issues/stream`
      : null;

  // Throttle the cross-type silent refetch (4 endpoints in parallel) so a
  // burst of vuln/scan events does not produce a burst of fan-out fetches.
  const throttledRefresh = useThrottledRealtimeRefresh(
    () => fetchAllVulnerabilities(true),
    projectId,
  );

  useRealtimeStream(
    realtimeUrl,
    {
      VULNERABILITY_BATCH_APPENDED: throttledRefresh,
      VULNERABILITY_UPDATED: throttledRefresh,
      SCAN_STATUS_CHANGED: throttledRefresh,
      // Stream reconnected — events may have been lost meanwhile; catch up.
      'snapshot-required': throttledRefresh,
    },
    [projectId],
  );

  return {
    vulnerabilities,
    loading,
    error,
    refetch
  };
};
