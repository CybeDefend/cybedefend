import { useCallback, useEffect, useRef, useState } from 'react';
import { getRegionConfig } from '@/utils/function/region';
import { useRealtimeStream } from './useRealtimeStream';
import {
  StoredReportItem,
  ReportUsage,
  listProjectReports,
  listOrganizationReports,
  listTeamReports,
  deleteProjectReport,
  deleteOrganizationReport,
  deleteTeamReport,
  getGeneratedReport,
  getGeneratedAggregatedReport,
  getProjectReportUsage,
  getOrganizationReportUsage,
} from '../services/resultService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Scope of the stored-report history. Per-project reports live in a
 * disjoint list from aggregated (org/team) reports, mirroring the backend.
 */
export type StoredReportsScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'team'; teamId: string };

export interface UseStoredReportsResult {
  items: StoredReportItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  deletingId: string | null;
  /**
   * Org-wide shared stored-report usage (project + org reports count
   * against one common pool). null for team scope / before it loads. Re-fetched
   * after a delete so the banner stays accurate.
   */
  usage: ReportUsage | null;
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  refresh: () => void;
  deleteReport: (reportId: string) => Promise<void>;
  downloadReport: (reportId: string) => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 10;

const scopeIdentity = (scope: StoredReportsScope | null): string | null => {
  if (!scope) return null;
  if (scope.kind === 'project') return `project:${scope.projectId}`;
  if (scope.kind === 'organization')
    return `organization:${scope.organizationId}`;
  return `team:${scope.teamId}`;
};

/**
 * The reports stream of a scope: a project report announces itself on its
 * project's stream (REPORT_READY), an organisation or batch report on the
 * organisation's, a team report on the team's (AGGREGATED_REPORT_READY).
 */
const reportsStreamUrl = (scope: StoredReportsScope | null): string | null => {
  if (!scope) return null;
  const base = `${getRegionConfig().apiUrl}/v1/realtime`;
  if (scope.kind === 'project') return `${base}/projects/${scope.projectId}/reports/stream`;
  if (scope.kind === 'organization') return `${base}/orgs/${scope.organizationId}/reports/stream`;
  return `${base}/teams/${scope.teamId}/reports/stream`;
};

/**
 * Paginated stored-report history for a scope, with download (re-signs on
 * demand) and delete (frees a quota slot, then refreshes). `refresh()` is the
 * single source of truth — after a delete we reload rather than mutate locally,
 * since the server owns the count.
 */
export const useStoredReports = (
  scope: StoredReportsScope | null,
  opts?: { initialPageSize?: number },
): UseStoredReportsResult => {
  const [items, setItems] = useState<StoredReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    opts?.initialPageSize ?? DEFAULT_PAGE_SIZE,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [usage, setUsage] = useState<ReportUsage | null>(null);

  const scopeKey = scopeIdentity(scope);

  // Request-sequencing guards: rapid page/pageSize/scope changes fire
  // overlapping fetches, and a slower earlier response must not overwrite a
  // faster later one with stale data. Each fetch stamps a monotonic seq and
  // only commits its result if it is still the latest of its kind.
  const pageSeq = useRef(0);
  const usageSeq = useRef(0);

  // Org-wide shared usage (the same count for the project AND the org drawer).
  // Team scope has no usage route — the banner just won't show there.
  const fetchUsage = useCallback(async () => {
    if (!scope || scope.kind === 'team') {
      usageSeq.current += 1; // invalidate any in-flight usage fetch
      setUsage(null);
      return;
    }
    const seq = ++usageSeq.current;
    try {
      const u =
        scope.kind === 'project'
          ? await getProjectReportUsage(scope.projectId)
          : await getOrganizationReportUsage(scope.organizationId);
      if (seq !== usageSeq.current) return; // superseded
      setUsage(u);
    } catch {
      if (seq !== usageSeq.current) return;
      setUsage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const fetchPage = useCallback(async () => {
    if (!scope) return;
    const seq = ++pageSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res =
        scope.kind === 'project'
          ? await listProjectReports(scope.projectId, page, pageSize)
          : scope.kind === 'organization'
            ? await listOrganizationReports(scope.organizationId, page, pageSize)
            : await listTeamReports(scope.teamId, page, pageSize);
      if (seq !== pageSeq.current) return; // a newer fetch has taken over
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      if (seq !== pageSeq.current) return;
      setError(apiErrorText(err));
      setItems([]);
      setTotal(0);
    } finally {
      if (seq === pageSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, page, pageSize]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // The list and the shared usage both change when a report is stored: a
  // generation only enqueues a row, the report lands later from the worker.
  const refresh = useCallback(() => {
    void fetchPage();
    void fetchUsage();
  }, [fetchPage, fetchUsage]);

  // A report of this scope became ready (or failed), or the stream reconnected
  // and may have missed one: read the list and the usage again.
  const streamUrl = reportsStreamUrl(scope);
  useRealtimeStream(
    streamUrl,
    {
      REPORT_READY: refresh,
      AGGREGATED_REPORT_READY: refresh,
      'snapshot-required': refresh,
    },
    [streamUrl],
  );

  const deleteReport = useCallback(
    async (reportId: string) => {
      if (!scope) return;
      setDeletingId(reportId);
      try {
        if (scope.kind === 'project')
          await deleteProjectReport(scope.projectId, reportId);
        else if (scope.kind === 'organization')
          await deleteOrganizationReport(scope.organizationId, reportId);
        else await deleteTeamReport(scope.teamId, reportId);
        // Stepping back a page when the last row on a non-first page is removed
        // re-triggers fetchPage via the page change; otherwise reload in place.
        if (items.length === 1 && page > 1) setPage((p) => p - 1);
        else await fetchPage();
        // A delete frees a slot in the shared pool — refresh the banner count.
        await fetchUsage();
      } catch (err) {
        setError(apiErrorText(err));
        throw err;
      } finally {
        setDeletingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey, items.length, page, fetchPage, fetchUsage],
  );

  const downloadReport = useCallback(
    async (reportId: string) => {
      if (!scope) return;
      let url: string | undefined;
      if (scope.kind === 'project') {
        const r = await getGeneratedReport(scope.projectId, reportId);
        url = r?.downloadUrl;
      } else {
        const r = await getGeneratedAggregatedReport(
          {
            type: scope.kind,
            id:
              scope.kind === 'organization'
                ? scope.organizationId
                : scope.teamId,
          },
          reportId,
        );
        url = r?.downloadUrl;
      }
      if (url) window.open(url, '_blank', 'noopener');
      else throw new Error('Report not available');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey],
  );

  return {
    items,
    total,
    page,
    pageSize,
    loading,
    error,
    deletingId,
    usage,
    setPage,
    setPageSize,
    refresh,
    deleteReport,
    downloadReport,
  };
};

export default useStoredReports;
