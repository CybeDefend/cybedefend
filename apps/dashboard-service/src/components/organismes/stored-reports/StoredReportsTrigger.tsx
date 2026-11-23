import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useStoredReports,
  StoredReportsScope,
} from '../../../server/hooks/useStoredReports';
import StoredReportsDrawer from './StoredReportsDrawer';
import { ReportScopeMeta } from './ReportMetadataPopover';
import { Archive } from '@/components/atoms/icon/icons';

import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface StoredReportsTriggerProps {
  scope: StoredReportsScope;
  /** Org-level quota banner (org scope only); hidden when undefined. */
  maxStoredReports?: number;
  retentionDays?: number;
  scopeMeta?: ReportScopeMeta;
  /** Deep-link target — also auto-opens the drawer on mount. */
  highlightReportId?: string;
  /**
   * The navigation that named `highlightReportId` (the router's location key).
   * A new one, even to the same report, opens the drawer and re-reads the list.
   */
  highlightKey?: string;
  defaultOpen?: boolean;
}

/**
 * "Stored reports N" header button that opens the stored-report
 * drawer. Self-contained: owns its useStoredReports controller (count badge +
 * drawer share it). Dropped into the org and project report headers in place of
 * the old mode toggle.
 */
const StoredReportsTrigger: React.FC<StoredReportsTriggerProps> = ({
  scope,
  maxStoredReports,
  retentionDays,
  scopeMeta,
  highlightReportId,
  highlightKey,
  defaultOpen,
}) => {
  const { t } = useTranslation();
  // Larger first page so a deep-linked report (?reportId=…) is on page 1 and the
  // "no longer available" banner isn't shown for a report that merely sits on a
  // later page (mirrors ProjectReportsTemplate's initialPageSize).
  const controller = useStoredReports(scope, { initialPageSize: 100 });
  const [open, setOpen] = useState(!!defaultOpen || !!highlightReportId);

  // On mount the drawer is already open and the list already loading: only a
  // later link to this page, which keeps the page mounted, acts here.
  const seenKey = useRef(highlightKey);
  useEffect(() => {
    if (highlightKey === seenKey.current) return;
    seenKey.current = highlightKey;
    if (!highlightReportId) return;
    setOpen(true);
    controller.refresh();
  }, [highlightKey, highlightReportId, controller]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("relative inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:border-white/[0.2]", AS_FOCUS, AS_TOUCH)}
      >
        <Archive size={16} className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
        {t('pages.reportsPage.storedReports.openButtonLabel')}
        {/* The count as a quiet mono figure after the words: no « · » between them (plan Annex F item 2). */}
        <span className="font-mono text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{controller.total}</span>
      </button>
      <StoredReportsDrawer
        open={open}
        onClose={() => setOpen(false)}
        controller={controller}
        maxStoredReports={maxStoredReports}
        retentionDays={retentionDays}
        highlightReportId={highlightReportId}
        scopeMeta={scopeMeta}
      />
    </>
  );
};

export default StoredReportsTrigger;
