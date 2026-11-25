import { useState, useCallback, useEffect, useRef } from 'react';
import { GenerateOwaspReportResponse, GenerateCweReportResponse, GetGeneratedReportResponse } from '../interfaces/Vulnerability';
import { generateOwaspReport, generateCweReport, getGeneratedReport } from '../services/resultService';
import { useRealtimeStream } from './useRealtimeStream';
import { pollReportUntilSettled } from './reportPolling';
import { getRegionConfig } from '@/utils/function/region';
import i18n from '@/i18n';
import { apiErrorText } from '@/utils/function/apiErrorKey';
import { isForbidden } from '@/utils/function/isForbidden';

// Only log to the browser console in dev builds — production noise
// is shipped to the OTEL collector through the global error boundary,
// not via verbose console.error spam.
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

// What the gateway client rejects with: the API error body ({ statusCode,
// message }) or an Error. Read without assuming either.
const errorStatus = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  const { statusCode, status } = err as { statusCode?: unknown; status?: unknown };
  if (typeof statusCode === 'number') return statusCode;
  return typeof status === 'number' ? status : undefined;
};
const errorMessage = (err: unknown): string | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  const { message } = err as { message?: unknown };
  return typeof message === 'string' && message ? message : undefined;
};

// The SBOM and the EU AI Act report live in the closed tree; this hook keeps
// the core OWASP and CWE reports.
type ReportSlot = 'owasp' | 'cwe';

// Fallback polling cadence. The realtime REPORT_READY event is the fast path;
// this guarantees the loading state converges even if that event is dropped or
// missed (see reportPolling.ts).
const REPORT_POLL_INTERVAL_MS = 4000;
const REPORT_POLL_TIMEOUT_MS = 5 * 60 * 1000;
// The realtime stream is the PRIMARY path. The poll only engages after this
// grace, so it is a true safety net (dropped event / connect race / slow
// render) rather than an eager poller that spams `queued` requests while the
// stream already delivers. See reportPolling.ts PollOptions.startDelayMs.
const REPORT_SAFETY_NET_DELAY_MS = 20 * 1000;

/**
 * Hook to manage the core project reports (OWASP and CWE). The SBOM, EU AI
 * Act and per-scanner reports are closed: they live in the closed tree.
 *
 * @param projectId - Project identifier
 * @param branch - Optional branch filter applied to the generated reports.
 *                 When `null`/`undefined`, the report aggregates
 *                 vulnerabilities across all branches (legacy behaviour
 *                 preserved for backward compatibility).
 * @returns Object containing report data, loading state, error, and generation functions
 */
export const useProjectReports = (
  projectId: string | undefined,
  branch?: string | null,
) => {
  const [owaspReportData, setOwaspReportData] = useState<GenerateOwaspReportResponse | null>(null);
  const [cweReportData, setCweReportData] = useState<GenerateCweReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [cweLoading, setCweLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // The gateway refused this role the reports (403): the page shows its
  // « not allowed » state instead of an error per attempt.
  const [forbidden, setForbidden] = useState<boolean>(false);

  // Normalise the branch filter once: `null` means "all branches" and must
  // not be forwarded to the gateway (which interprets any non-empty value as
  // a branch name). We coerce to `undefined` so callers downstream see a
  // single absence signal.
  const branchParam: string | undefined = branch ?? undefined;

  // Async generation: each generate*() enqueues a job and stores the returned
  // reportId here; the persistent reports stream below resolves it. We track
  // the requested format per slot so the final response carries it.
  const pendingRef = useRef<
    Record<ReportSlot, { reportId: string; format: 'json' | 'html' | 'pdf' } | null>
  >({ owasp: null, cwe: null });

  // Subscribe ONCE to the project's persistent reports stream (multiplexed,
  // closed only on unmount by the hook). We never open/close a stream per
  // generation. On REPORT_READY we refetch a fresh signed URL and resolve the
  // matching slot.
  const reportsStreamUrl = projectId
    ? `${getRegionConfig().apiUrl}/v1/realtime/projects/${projectId}/reports/stream`
    : null;

  const setLoadingForSlot = useCallback((slot: ReportSlot, value: boolean) => {
    if (slot === 'owasp') setLoading(value);
    else setCweLoading(value);
  }, []);

  // Atomically claim a pending slot for a given reportId. Returns false if the
  // slot was already resolved (by the realtime event or the fallback poll), so
  // the report is applied exactly once across both paths.
  const claimSlot = useCallback(
    (slot: ReportSlot, reportId: string): boolean => {
      if (pendingRef.current[slot]?.reportId !== reportId) return false;
      pendingRef.current[slot] = null;
      return true;
    },
    [],
  );

  const applyReportToSlot = useCallback(
    (
      slot: ReportSlot,
      report: GetGeneratedReportResponse,
      format: 'json' | 'html' | 'pdf',
    ) => {
      const data = {
        projectId,
        format,
        content: '',
        filename: report.filename,
        contentType: report.contentType,
        downloadUrl: report.downloadUrl,
        expiresAtMs: report.expiresAtMs,
        reportId: report.reportId,
        status: report.status,
      };
      if (slot === 'owasp') setOwaspReportData(data as GenerateOwaspReportResponse);
      else setCweReportData(data as GenerateCweReportResponse);
    },
    [projectId],
  );

  // Fallback poll, started alongside each generation. It stops early (sentinel)
  // if the realtime event already claimed the slot; otherwise it resolves the
  // slot itself once the report settles, or surfaces an error on timeout.
  //
  // [M4] The early-stop signal used to be carried by a `__claimedElsewhere`
  // boolean tacked onto a `GetGeneratedReportResponse` via `as any`. We
  // model it as a proper discriminated union now — the polling generic
  // `pollReportUntilSettled<T extends PollableReport>` already accepts any
  // T with a string `status`, so we union the real response with a
  // sentinel that also satisfies that contract.
  const startFallbackPoll = useCallback(
    (slot: ReportSlot, reportId: string, format: 'json' | 'html' | 'pdf') => {
      if (!projectId) return;
      void (async () => {
        type PollOutcome =
          | (GetGeneratedReportResponse & { __sentinel?: undefined })
          | { __sentinel: 'claimedElsewhere'; status: 'ready' };
        let settled: PollOutcome;
        try {
          settled = await pollReportUntilSettled<PollOutcome>(async () => {
            if (pendingRef.current[slot]?.reportId !== reportId) {
              // The realtime path already claimed this slot — stop polling.
              return { __sentinel: 'claimedElsewhere', status: 'ready' };
            }
            return await getGeneratedReport(projectId, reportId);
          }, {
            intervalMs: REPORT_POLL_INTERVAL_MS,
            timeoutMs: REPORT_POLL_TIMEOUT_MS,
            startDelayMs: REPORT_SAFETY_NET_DELAY_MS,
          });
        } catch {
          if (!claimSlot(slot, reportId)) return;
          setError(tError('errors.reports.timeout'));
          setLoadingForSlot(slot, false);
          return;
        }
        if (settled.__sentinel === 'claimedElsewhere') return;
        if (!claimSlot(slot, reportId)) return;
        if (settled.status === 'failed') {
          setError(settled.error || tError('errors.reports.failed'));
          setLoadingForSlot(slot, false);
          return;
        }
        applyReportToSlot(slot, settled, format);
        setLoadingForSlot(slot, false);
      })();
    },
    [projectId, claimSlot, applyReportToSlot, setLoadingForSlot],
  );

  useRealtimeStream(
    reportsStreamUrl,
    {
      REPORT_READY: (env: any) => {
        const rr = env?.payload?.reportReady;
        if (!rr?.reportId || !projectId) return;
        const slot = (Object.keys(pendingRef.current) as ReportSlot[]).find(
          (s) => pendingRef.current[s]?.reportId === rr.reportId,
        );
        if (!slot) return;
        const format = pendingRef.current[slot]!.format;
        if (!claimSlot(slot, rr.reportId)) return;

        void (async () => {
          try {
            if (rr.status === 'failed') {
              throw new Error(tError('errors.reports.failed'));
            }
            const report = await getGeneratedReport(projectId, rr.reportId);
            if (report.status === 'failed') {
              throw new Error(report.error || tError('errors.reports.failed'));
            }
            applyReportToSlot(slot, report, format);
          } catch (err: any) {
            if (isForbidden(err)) setForbidden(true);
            else setError(apiErrorText(err, { fallback: 'errors.reports.generateFailed' }));
          } finally {
            setLoadingForSlot(slot, false);
          }
        })();
      },
      // A 403 handshake is final (the stream does not reconnect): say so once.
      error: (env: { fatal?: boolean; status?: number } | undefined) => {
        if (env?.fatal && env.status === 403) setForbidden(true);
      },
    },
    [projectId],
  );

  // On unmount, drop any pending slots so in-flight fallback polls stop and
  // never call setState on an unmounted component.
  useEffect(() => {
    return () => {
      pendingRef.current = { owasp: null, cwe: null };
    };
  }, []);

  const generateOwasp = useCallback(
    async (format: 'json' | 'html' | 'pdf', detailed?: boolean) => {
      if (!projectId) {
        setError('Project ID is required');
        return null;
      }

      setLoading(true);
      setError(null);
      setOwaspReportData(null);

      try {
        const data = await generateOwaspReport(projectId, format, detailed, branchParam);
        // Wait for REPORT_READY on the persistent stream; loading stays true.
        // A fallback poll guarantees convergence if that event is missed.
        pendingRef.current.owasp = { reportId: data.reportId!, format };
        startFallbackPoll('owasp', data.reportId!, format);
        return data;
      } catch (err: any) {
        devError('Error generating OWASP report:', err);
        if (isForbidden(err)) setForbidden(true);
        else setError(apiErrorText(err, { fallback: 'errors.reports.owaspFailed' }));
        setOwaspReportData(null);
        setLoading(false);
        return null;
      }
    },
    [projectId, branchParam, startFallbackPoll]
  );

  const generateCwe = useCallback(
    async (format: 'json' | 'html' | 'pdf', detailed?: boolean) => {
      if (!projectId) {
        setError('Project ID is required');
        return null;
      }

      setCweLoading(true);
      setError(null);
      setCweReportData(null);

      try {
        const data = await generateCweReport(projectId, format, detailed, branchParam);
        pendingRef.current.cwe = { reportId: data.reportId!, format };
        startFallbackPoll('cwe', data.reportId!, format);
        return data;
      } catch (err: any) {
        devError('Error generating CWE report:', err);
        if (isForbidden(err)) setForbidden(true);
        else setError(apiErrorText(err, { fallback: 'errors.reports.cweFailed' }));
        setCweReportData(null);
        setCweLoading(false);
        return null;
      }
    },
    [projectId, branchParam, startFallbackPoll]
  );

  const clearOwaspReport = useCallback(() => {
    setOwaspReportData(null);
    setError(null);
  }, []);

  const clearCweReport = useCallback(() => {
    setCweReportData(null);
    setError(null);
  }, []);

  // The gateway returns a short-lived signed storage URL. Navigate to
  // it directly via a synthetic anchor — `fetch('data:...')` is blocked by
  // the dashboard CSP, and we can't rely on the browser to honour a Blob
  // URL conversion for 50MB+ payloads. The signed URL lives 15 minutes,
  // plenty for the user to click through.
  const downloadOwaspReport = useCallback(
    (report: GenerateOwaspReportResponse) => {
      try {
        const link = document.createElement('a');
        link.href = report.downloadUrl;
        link.download = report.filename;
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err: any) {
        devError('Error downloading OWASP report:', err);
        setError(tError('errors.reports.downloadFailed'));
      }
    },
    [],
  );

  const downloadCweReport = useCallback(
    (report: GenerateCweReportResponse) => {
      try {
        const link = document.createElement('a');
        link.href = report.downloadUrl;
        link.download = report.filename;
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err: any) {
        devError('Error downloading CWE report:', err);
        setError(tError('errors.reports.downloadFailed'));
      }
    },
    [],
  );

  return {
    owaspReportData,
    cweReportData,
    loading,
    cweLoading,
    error,
    forbidden,
    generateOwasp,
    generateCwe,
    clearOwaspReport,
    clearCweReport,
    downloadOwaspReport,
    downloadCweReport,
  };
};

export default useProjectReports;
