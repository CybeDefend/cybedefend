import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Info } from '@/components/atoms/icon/icons';
import { StoredReportItem } from '../../../server/services/resultService';

import { AS_FLOATING } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
export interface ReportScopeMeta {
  organizationName?: string;
  teamName?: string;
  projectTitle?: string;
}

interface ReportMetadataPopoverProps {
  item: StoredReportItem;
  scopeMeta?: ReportScopeMeta;
}

const fmtDate = (ms?: number): string =>
  ms ? new Date(Number(ms)).toLocaleString() : '';

/**
 * Small info button + click popover that reveals all metadata of a
 * stored report (type, format, scope, branch, dates, status, id). Built from
 * the LIST summary + the page's scope context — no backend round-trip.
 *
 * The popover is portaled to <body> and positioned `fixed` from the button's
 * rect, so it is never clipped by the scrolling table / drawer overflow.
 */
const ReportMetadataPopover: React.FC<ReportMetadataPopoverProps> = ({
  item,
  scopeMeta,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Anchor the popover's top/right to the button, clamped to the viewport.
  const reposition = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    setPos({
      top: b.bottom + 6,
      right: Math.max(8, window.innerWidth - b.right),
    });
  }, []);

  const toggle = () => {
    if (!open) reposition();
    setOpen((o) => !o);
  };

  // Close on outside click / Escape; keep anchored on scroll / resize.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (btnRef.current?.contains(tgt)) return;
      if (popoverRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReflow = () => reposition();
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    // capture: catch scrolls on any ancestor (the drawer body), not just window
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, reposition]);

  const k = (key: string) => t(`pages.reportsPage.storedReports.metadata.${key}`);

  // Scope line: aggregated reports carry scopeType; per-project reports don't.
  // The kind, then its name after a comma: no separator mark between them.
  const withName = (kind: string, name?: string): React.ReactNode => (name ? `${kind}, ${name}` : kind);
  // A value the report does not carry reads « Unavailable », never a dash.
  const unavailable = t('pages.reportsPage.storedReports.unavailable');
  const scopeValue = (): React.ReactNode => {
    if (item.scopeType === 'organization')
      return withName(k('scopeOrganization'), scopeMeta?.organizationName);
    if (item.scopeType === 'team')
      return withName(k('scopeTeam'), scopeMeta?.teamName);
    if (item.scopeType === 'batch') return k('scopeBatch');
    // per-project
    return withName(k('scopeProject'), scopeMeta?.projectTitle);
  };

  const rows: Array<[string, React.ReactNode]> = [
    [k('type'), item.kind || item.reportType ? (item.kind || item.reportType)!.toUpperCase() : unavailable],
    [k('format'), item.format ? item.format.toUpperCase() : unavailable],
    [k('scope'), scopeValue()],
  ];
  if (scopeMeta?.organizationName && item.scopeType !== 'organization')
    rows.push([k('organization'), scopeMeta.organizationName]);
  if (item.branch) rows.push([k('branch'), item.branch]);
  rows.push([k('generated'), (fmtDate(item.createdAtMs) || unavailable)]);
  rows.push([
    k('expires'),
    item.expiresAtMs
      ? (fmtDate(item.expiresAtMs) || unavailable)
      : t('pages.reportsPage.storedReports.neverExpires'),
  ]);
  rows.push([
    k('status'),
    t(`pages.reportsPage.storedReports.status.${item.status}`),
  ]);
  rows.push([k('id'), item.reportId]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={k('title')}
        title={k('title')}
        className="inline-flex items-center gap-1 rounded-sm text-xs text-zinc-500 transition-colors duration-[120ms] hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <Info size={14} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className={cn(AS_FLOATING, "z-[80] w-80 max-w-[calc(100vw-1rem)] p-3 text-xs")}
          >
            <div className="mb-2 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
              {k('title')}
            </div>
            <dl className="space-y-1.5">
              {rows.map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 break-all text-zinc-700 dark:text-zinc-200">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </>
  );
};

export default ReportMetadataPopover;
