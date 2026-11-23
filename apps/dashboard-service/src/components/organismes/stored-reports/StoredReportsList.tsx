import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, Trash2 } from '@/components/atoms/icon/icons';
import { UseStoredReportsResult } from '../../../server/hooks/useStoredReports';
import { StoredReportItem } from '../../../server/services/resultService';
import Skeleton from '../../atoms/skeleton/Skeleton';
import NotFoundElement from '../../molecules/not-found-element/NotFoundElement';
import Pagination from '../../molecules/pagination/Pagination';
import ConfirmationModal from '../../molecules/modal/confirmation-modal/ConfirmationModal';
import ReportMetadataPopover, {
  ReportScopeMeta,
} from './ReportMetadataPopover';

import { AS_THEAD, AS_TH, AS_TD, AS_TD_STRONG, AS_CHIP } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
const DAY_MS = 24 * 60 * 60 * 1000;

interface StoredReportsListProps {
  /** Shared hook state (single source of truth across drawer + cards). */
  controller: UseStoredReportsResult;
  /** From plan entitlements; banner is hidden when undefined. */
  maxStoredReports?: number;
  retentionDays?: number;
  /** Deep-link target (?reportId=…): highlight the row, notice if absent. */
  highlightReportId?: string;
  /** Names resolved on the page, shown in the metadata popover. */
  scopeMeta?: ReportScopeMeta;
}

export const daysLeft = (expiresAtMs: number): number | null => {
  const ms = Number(expiresAtMs);
  if (!ms) return null; // 0 = never expires
  return Math.ceil((ms - Date.now()) / DAY_MS);
};

export const reportLabel = (item: StoredReportItem): string =>
  item.kind || item.reportType || 'report';

/**
 * Presentational stored-report table. Driven by a `controller`
 * (useStoredReports result) so a drawer and the per-card history can share one
 * source of truth. Renders the quota banner, the paginated table with
 * download / delete / metadata-info per row, and the delete confirmation.
 */
const StoredReportsList: React.FC<StoredReportsListProps> = ({
  controller,
  maxStoredReports,
  retentionDays,
  highlightReportId,
  scopeMeta,
}) => {
  const { t } = useTranslation();
  const {
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
    deleteReport,
    downloadReport,
  } = controller;

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleDownload = async (reportId: string) => {
    setDownloadingId(reportId);
    try {
      await downloadReport(reportId);
    } catch {
      toast.error(t('pages.reportsPage.storedReports.downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  };

  // The quota is an org-wide SHARED pool across project + org reports. The only
  // authoritative "used" count is `controller.usage` (it counts BOTH tables for
  // the org, so project and org drawers agree). This scope's `total` is NOT
  // comparable to the org-wide max, so we NEVER substitute it for `used`.
  // Once `usage` has LOADED it is authoritative — including limit < 0, which
  // means unlimited OR billing-unavailable (the backend fails open). In both
  // cases we must NOT fall back to the entitlement `maxStoredReports` and pair
  // it with the real used count, or a transient billing outage on a finite plan
  // near quota would render a false "quota reached" banner. Only use the
  // entitlement as the limit WHILE usage has not loaded yet; until it arrives
  // `used` is unknown (shown as an ellipsis).
  const quotaLimit = usage
    ? usage.limit
    : typeof maxStoredReports === 'number'
      ? maxStoredReports
      : -1;
  const quotaUsed = usage ? usage.used : null;
  const quotaKnown = quotaLimit >= 0;
  const quotaFull = quotaKnown && quotaUsed !== null && quotaUsed >= quotaLimit;

  const highlightMissing =
    !!highlightReportId &&
    !loading &&
    !items.some((i) => i.reportId === highlightReportId);

  const onConfirmDelete = async () => {
    if (!confirmId) return;
    try {
      await deleteReport(confirmId);
    } catch {
      /* error surfaced via hook state */
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div className="space-y-4">
      {quotaKnown && (
        <div
          className={`relative flex flex-wrap items-center justify-between gap-2 rounded-lg border border-as-line py-2.5 px-3 text-[13px] text-zinc-700''] dark:text-zinc-200 ${
            quotaFull
              ? 'before:bg-red-500'
              : 'before:bg-zinc-400 dark:before:bg-zinc-500'
          }`}
        >
          <span>
            {t('pages.reportsPage.storedReports.quota.used', {
              used: quotaUsed === null ? '…' : quotaUsed,
              limit: quotaLimit,
            })}
          </span>
          {typeof retentionDays === 'number' && retentionDays > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('pages.reportsPage.storedReports.quota.retention', {
                days: retentionDays,
              })}
            </span>
          )}
          {quotaFull && (
            <span className="w-full text-xs">
              {t('pages.reportsPage.storedReports.quota.full')}
            </span>
          )}
        </div>
      )}

      {highlightMissing && (
        <div className="relative rounded-lg border border-as-line py-2.5 px-3 text-[13px] text-zinc-700''] dark:text-zinc-200">
          {t('pages.reportsPage.storedReports.notFound')}
        </div>
      )}

      {error && (
        <div className="relative rounded-lg border border-as-line py-2.5 px-3 text-[13px] text-zinc-700''] dark:text-zinc-200">
          {error}
        </div>
      )}

      {loading ? (
        <Skeleton type="table" rows={5} columns={5} />
      ) : items.length === 0 ? (
        <NotFoundElement
          title={t('pages.reportsPage.storedReports.empty.title')}
          description={t('pages.reportsPage.storedReports.empty.description')}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-as-line">
            <table className="w-full">
              <thead>
                <tr className={cn("border-b border-zinc-200 text-left dark:border-as-line", AS_THEAD)}>
                  <th className={AS_TH}>
                    {t('pages.reportsPage.storedReports.table.name')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.reportsPage.storedReports.table.type')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.reportsPage.storedReports.table.format')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.reportsPage.storedReports.table.created')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.reportsPage.storedReports.table.expires')}
                  </th>
                  <th className={cn(AS_TH, "text-right")}>
                    {t('pages.reportsPage.storedReports.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const dl = daysLeft(item.expiresAtMs);
                  const isHighlight = item.reportId === highlightReportId;
                  const downloadable = item.status === 'ready';
                  return (
                    <tr
                      key={item.reportId}
                      className={`border-b border-zinc-100 last:border-0 dark:border-as-line ${
                        isHighlight
                          ? 'bg-secondary/[0.06] dark:bg-secondary/[0.1]'
                          : 'transition-colors duration-[120ms] hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className={cn(AS_TD, AS_TD_STRONG)}>
                        <div className="flex items-center gap-2">
                          <span
                            className="block max-w-[16rem] truncate"
                            title={item.filename || item.reportId}
                          >
                            {item.filename || item.reportId}
                          </span>
                          {item.branch ? (
                            <span className="shrink-0 font-mono text-xs font-normal text-zinc-500 dark:text-zinc-400">
                              {item.branch}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={AS_TD}>
                        <span className={cn(AS_CHIP, "uppercase bg-zinc-100 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300")}>
                          {reportLabel(item)}
                        </span>
                      </td>
                      <td className={cn(AS_TD, "text-xs uppercase")}>
                        {item.format}
                      </td>
                      <td className={cn(AS_TD, "font-mono text-xs tabular-nums")}>
                        {item.createdAtMs
                          ? new Date(
                              Number(item.createdAtMs),
                            ).toLocaleDateString()
                          : t('pages.reportsPage.storedReports.unavailable')}
                      </td>
                      <td className={cn(AS_TD, "text-xs")}>
                        {dl === null ? (
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {t('pages.reportsPage.storedReports.neverExpires')}
                          </span>
                        ) : (
                          <span
                            className={
                              dl < 7
                                ? 'inline-flex h-5 items-center rounded-md bg-amber-100 px-1.5 font-medium tabular-nums text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                : 'text-zinc-500 dark:text-zinc-400'
                            }
                          >
                            {t('pages.reportsPage.storedReports.expiresIn', {
                              count: Math.max(0, dl),
                            })}
                          </span>
                        )}
                      </td>
                      <td className={AS_TD}>
                        <div className="flex items-center justify-end gap-3">
                          <ReportMetadataPopover
                            item={item}
                            scopeMeta={scopeMeta}
                          />
                          {downloadable ? (
                            <button
                              type="button"
                              onClick={() => handleDownload(item.reportId)}
                              disabled={downloadingId === item.reportId}
                              className="inline-flex items-center gap-1 text-xs font-medium text-secondary dark:text-secondary-light hover:underline disabled:opacity-50"
                              title={t(
                                'pages.reportsPage.storedReports.download',
                              )}
                            >
                              <Download size={14} />
                              {t('pages.reportsPage.storedReports.download')}
                            </button>
                          ) : (
                            <span className="text-xs italic text-zinc-500 dark:text-zinc-400">
                              {t(
                                `pages.reportsPage.storedReports.status.${item.status}`,
                              )}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setConfirmId(item.reportId)}
                            disabled={deletingId === item.reportId}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                            title={t('pages.reportsPage.storedReports.delete')}
                          >
                            <Trash2 size={14} />
                            {t('pages.reportsPage.storedReports.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      {confirmId && (
        <ConfirmationModal
          text={t('pages.reportsPage.storedReports.deleteConfirm')}
          isLoading={deletingId === confirmId}
          onConfirm={onConfirmDelete}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
};

export default StoredReportsList;
