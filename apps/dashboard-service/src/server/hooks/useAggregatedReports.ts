import { useCallback, useRef, useState } from 'react';
import {
  GenerateAggregatedReportResponse,
  GetGeneratedAggregatedReportResponse,
  ProjectBranchSelection,
} from '../interfaces/Vulnerability';
import {
  generateOrganizationReport,
  generateTeamReport,
  generateBatchReport,
  getGeneratedAggregatedReport,
} from '../services/resultService';
import { useRealtimeStream } from './useRealtimeStream';
import { pollReportUntilSettled } from './reportPolling';
import { getRegionConfig } from '@/utils/function/region';
import i18n from '@/i18n';
import { apiErrorText } from '@/utils/function/apiErrorKey';

// Fallback polling cadence — mirrors the per-project reports hooks so they
// converge on the same UX even when the AGGREGATED_REPORT_READY realtime
// event is missed (publisher token-bucket drop, race before SSE connect,
// transient network blip). Aggregated reports are heavier than per-project
// ones (org-wide PDF renders), so the timeout is 10 min, not 5.
const REPORT_POLL_INTERVAL_MS = 4000;
const REPORT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
// The realtime stream is the PRIMARY path for the ready signal. The poll only
// engages after this grace so it acts as a true safety net (dropped event /
// connect race / unusually slow render) instead of an eager parallel poller
// that spams `queued` requests while the stream is already doing its job.
// Sized above a typical org-wide PDF render so the normal case makes zero
// `queued` poll requests. See reportPolling.ts PollOptions.startDelayMs.
const REPORT_SAFETY_NET_DELAY_MS = 30 * 1000;

// Only log to the browser console in dev builds.
const devError = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
};

// Resolve a translation key. Every key below exists in both locales
// and is asserted by `src/i18n/no-fallback.test.ts`, so a missing one is a
// test failure rather than an English string leaking into a French UI.
const tError = (key: string): string => i18n.t(key);

/** Scope of the aggregated report currently being generated. Drives both the
 * realtime subscription URL and the poll route. Batch reports are org-owned,
 * so they subscribe + poll the org route. */
type StreamScope = { type: 'organization' | 'team'; id: string };

/**
 * Hook to manage aggregated reports generation (Organization, Team, and Batch).
 *
 * Async generation: each `generate*` enqueues a job and keeps `loading` true;
 * the org/team `reports` realtime stream delivers AGGREGATED_REPORT_READY,
 * after which we refetch a fresh signed URL and (when `autoDownload`) trigger
 * the browser download. A fallback poll is started alongside each generation —
 * it stops early if the realtime event already claimed the slot, otherwise it
 * resolves the slot itself once the report settles, or surfaces an error on
 * timeout. Identical mechanism to the per-project reports hooks.
 *
 * @returns Object containing loading state, error, and generation functions
 */
export const useAggregatedReports = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Scope currently being generated for — drives the realtime subscription.
  const [streamScope, setStreamScope] = useState<StreamScope | null>(null);
  const streamScopeRef = useRef<StreamScope | null>(null);
  streamScopeRef.current = streamScope;
  const pendingReportIdRef = useRef<string | null>(null);
  // Whether the next ready report should auto-download. The page always passes
  // `true`, but the flag keeps the contract explicit (and testable).
  const autoDownloadRef = useRef<boolean>(true);

  const streamUrl = streamScope
    ? `${getRegionConfig().apiUrl}/v1/realtime/${streamScope.type === 'team' ? 'teams' : 'orgs'}/${streamScope.id}/reports/stream`
    : null;

  /**
   * Downloads a report by navigating to its signed storage URL.
   *
   * The old base64 → atob → Blob path was blocked by the dashboard
   * CSP (data: URLs are not on `connect-src`) and by the 50MB gRPC ceiling
   * for detailed reports. The backend now returns a short-lived signed URL
   * that the object storage (allowed by the CSP) serves directly.
   *
   * @param reportData - object carrying the signed `downloadUrl` + `filename`
   */
  const downloadReport = useCallback(
    (reportData: { downloadUrl: string; filename: string }) => {
      try {
        const link = document.createElement('a');
        link.href = reportData.downloadUrl;
        link.download = reportData.filename;
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err: any) {
        devError('Error downloading report:', err);
        throw new Error(
          tError('errors.reports.downloadFailed'),
        );
      }
    },
    [],
  );

  // Atomically claim the pending slot for a given reportId. Returns false if
  // the slot was already resolved (by the other path), so the report is
  // applied exactly once across the realtime + fallback-poll code paths.
  const claimSlot = useCallback((reportId: string): boolean => {
    if (pendingReportIdRef.current !== reportId) return false;
    pendingReportIdRef.current = null;
    return true;
  }, []);

  // Apply a settled report: surface the error or trigger the auto-download.
  const applyReport = useCallback(
    (report: GetGeneratedAggregatedReportResponse): void => {
      if (report.status === 'failed') {
        setError(
          report.error ||
            tError('errors.reports.orgFailed'),
        );
        return;
      }
      if (autoDownloadRef.current && report.downloadUrl) {
        downloadReport({
          downloadUrl: report.downloadUrl,
          filename: report.filename,
        });
      }
    },
    [downloadReport],
  );

  useRealtimeStream(
    streamUrl,
    {
      AGGREGATED_REPORT_READY: (env: any) => {
        const rr = env?.payload?.aggregatedReportReady;
        const scope = streamScopeRef.current;
        if (!scope || !rr?.reportId) return;
        if (!claimSlot(rr.reportId)) return;

        void (async () => {
          try {
            if (rr.status === 'failed') {
              setError(
                tError('errors.reports.orgFailed'),
              );
              return;
            }
            const report = await getGeneratedAggregatedReport(
              scope,
              rr.reportId,
            );
            applyReport(report);
          } catch (err: any) {
            devError('Error resolving aggregated report:', err);
            setError(
              apiErrorText(err, { fallback: 'errors.reports.orgFailed' }),
            );
          } finally {
            setLoading(false);
          }
        })();
      },
    },
    [streamUrl],
  );

  // Fallback poll, started alongside each generation. Mirrors the per-project
  // reports hooks' fallback poll. Uses the shared
  // `pollReportUntilSettled` helper for the retry/backoff/timeout policy.
  const startFallbackPoll = useCallback(
    (scope: StreamScope, reportId: string) => {
      void (async () => {
        type PollOutcome =
          | (GetGeneratedAggregatedReportResponse & { __sentinel?: undefined })
          | { __sentinel: 'claimedElsewhere'; status: 'ready' };
        let settled: PollOutcome;
        try {
          settled = await pollReportUntilSettled<PollOutcome>(
            async () => {
              if (pendingReportIdRef.current !== reportId) {
                return { __sentinel: 'claimedElsewhere', status: 'ready' };
              }
              return await getGeneratedAggregatedReport(scope, reportId);
            },
            {
              intervalMs: REPORT_POLL_INTERVAL_MS,
              timeoutMs: REPORT_POLL_TIMEOUT_MS,
              startDelayMs: REPORT_SAFETY_NET_DELAY_MS,
            },
          );
        } catch {
          if (!claimSlot(reportId)) return;
          setError(
            tError('pages.reportsPage.errors.generateTimeout'),
          );
          setLoading(false);
          return;
        }
        if (settled.__sentinel === 'claimedElsewhere') return;
        if (!claimSlot(reportId)) return;
        applyReport(settled);
        setLoading(false);
      })();
    },
    [claimSlot, applyReport],
  );

  // Shared post-enqueue wiring for all three generate functions: arm the
  // fallback poll and keep `loading` true until the report settles.
  const afterEnqueue = useCallback(
    (scope: StreamScope, resp: GenerateAggregatedReportResponse) => {
      pendingReportIdRef.current = resp?.reportId ?? null;
      if (resp?.reportId) {
        startFallbackPoll(scope, resp.reportId);
        return;
      }
      // No reportId: without a poll and with no SSE event able to claim the
      // slot, `loading` would otherwise hang forever. Terminate here.
      if (resp?.downloadUrl) {
        // Defensive: a legacy/synchronous-style ready response.
        if (autoDownloadRef.current) {
          downloadReport({
            downloadUrl: resp.downloadUrl,
            filename: resp.filename,
          });
        }
        setLoading(false);
        return;
      }
      setError(
        tError('pages.reportsPage.errors.generateFailed'),
      );
      setLoading(false);
    },
    [startFallbackPoll, downloadReport],
  );

  /**
   * Generates an organization report.
   * @param organizationId - Organization ID
   * @param reportType - "owasp" | "cwe" | "license" | "ai-act"
   * @param format - "json" | "html" | "pdf"
   * @param detailed - Include detailed information
   * @param autoDownload - Automatically download the report when ready
   * @param branchFilter - "all" | "reference" | "selected" branch filter mode
   * @param projectBranchSelections - Per-project branch selections (selected)
   * @returns The queued report response, or null on validation error
   */
  const generateOrgReport = useCallback(
    async (
      organizationId: string,
      reportType: 'owasp' | 'cwe' | 'license' | 'ai-act',
      format: 'json' | 'html' | 'pdf',
      detailed: boolean = true,
      autoDownload: boolean = true,
      branchFilter: string = 'all',
      projectBranchSelections: ProjectBranchSelection[] = [],
    ): Promise<GenerateAggregatedReportResponse | null> => {
      if (!organizationId) {
        setError('Organization ID is required');
        return null;
      }

      setLoading(true);
      setError(null);
      const scope: StreamScope = { type: 'organization', id: organizationId };
      setStreamScope(scope);
      autoDownloadRef.current = autoDownload;

      try {
        const resp = await generateOrganizationReport(
          organizationId,
          reportType,
          format,
          detailed,
          branchFilter,
          projectBranchSelections,
        );
        afterEnqueue(scope, resp);
        return resp;
      } catch (err: any) {
        devError('Error generating organization report:', err);
        setError(
          apiErrorText(err, { fallback: 'errors.reports.orgFailed' }),
        );
        setLoading(false);
        return null;
      }
    },
    [afterEnqueue],
  );

  /**
   * Generates a team report.
   * @param teamId - Team ID
   * @param reportType - "owasp" | "cwe" | "license" | "ai-act"
   * @param format - "json" | "html" | "pdf"
   * @param detailed - Include detailed information
   * @param autoDownload - Automatically download the report when ready
   * @param branchFilter - "all" | "reference" | "selected" branch filter mode
   * @param projectBranchSelections - Per-project branch selections (selected)
   * @param organizationId - Owning organization ID (for permissions)
   * @returns The queued report response, or null on validation error
   */
  const generateTeamReportFn = useCallback(
    async (
      teamId: string,
      reportType: 'owasp' | 'cwe' | 'license' | 'ai-act',
      format: 'json' | 'html' | 'pdf',
      detailed: boolean = true,
      autoDownload: boolean = true,
      branchFilter: string = 'all',
      projectBranchSelections: ProjectBranchSelection[] = [],
      organizationId?: string,
    ): Promise<GenerateAggregatedReportResponse | null> => {
      if (!teamId) {
        setError('Team ID is required');
        return null;
      }

      setLoading(true);
      setError(null);
      const scope: StreamScope = { type: 'team', id: teamId };
      setStreamScope(scope);
      autoDownloadRef.current = autoDownload;

      try {
        const resp = await generateTeamReport(
          teamId,
          reportType,
          format,
          detailed,
          branchFilter,
          projectBranchSelections,
          organizationId,
        );
        afterEnqueue(scope, resp);
        return resp;
      } catch (err: any) {
        devError('Error generating team report:', err);
        setError(
          apiErrorText(err, { fallback: 'errors.reports.teamFailed' }),
        );
        setLoading(false);
        return null;
      }
    },
    [afterEnqueue],
  );

  /**
   * Generates a batch report for selected projects. Batch reports are
   * org-owned, so they subscribe + poll the organization route.
   * @param organizationId - Organization ID (required for permissions)
   * @param projectIds - Array of project IDs
   * @param reportType - "owasp" | "cwe" | "license" | "ai-act"
   * @param format - "json" | "html" | "pdf"
   * @param detailed - Include detailed information
   * @param autoDownload - Automatically download the report when ready
   * @param branchFilter - "all" | "reference" | "selected" branch filter mode
   * @param projectBranchSelections - Per-project branch selections (selected)
   * @returns The queued report response, or null on validation error
   */
  const generateBatchReportFn = useCallback(
    async (
      organizationId: string,
      projectIds: string[],
      reportType: 'owasp' | 'cwe' | 'license' | 'ai-act',
      format: 'json' | 'html' | 'pdf',
      detailed: boolean = true,
      autoDownload: boolean = true,
      branchFilter: string = 'all',
      projectBranchSelections: ProjectBranchSelection[] = [],
    ): Promise<GenerateAggregatedReportResponse | null> => {
      if (!organizationId) {
        setError('Organization ID is required');
        return null;
      }
      if (!projectIds || projectIds.length === 0) {
        setError('At least one project must be selected');
        return null;
      }

      setLoading(true);
      setError(null);
      // Batch is org-owned — subscribe/poll the org route.
      const scope: StreamScope = { type: 'organization', id: organizationId };
      setStreamScope(scope);
      autoDownloadRef.current = autoDownload;

      try {
        const resp = await generateBatchReport(
          organizationId,
          projectIds,
          reportType,
          format,
          detailed,
          branchFilter,
          projectBranchSelections,
        );
        afterEnqueue(scope, resp);
        return resp;
      } catch (err: any) {
        devError('Error generating batch report:', err);
        setError(
          apiErrorText(err, { fallback: 'errors.reports.batchFailed' }),
        );
        setLoading(false);
        return null;
      }
    },
    [afterEnqueue],
  );

  /**
   * Clears any error state.
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    generateOrgReport,
    generateTeamReportFn,
    generateBatchReportFn,
    downloadReport,
    clearError,
  };
};

export default useAggregatedReports;
