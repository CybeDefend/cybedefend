import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Maximize2, Minimize2 } from '@/components/atoms/icon/icons';
import { UseStoredReportsResult } from '../../../server/hooks/useStoredReports';
import StoredReportsList from './StoredReportsList';
import { ReportScopeMeta } from './ReportMetadataPopover';

import { AS_PANEL_TITLE, AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
interface StoredReportsDrawerProps {
  open: boolean;
  onClose: () => void;
  controller: UseStoredReportsResult;
  maxStoredReports?: number;
  retentionDays?: number;
  highlightReportId?: string;
  scopeMeta?: ReportScopeMeta;
}

// Mirrors the vulnerability quick-view drawer: drag the left edge to resize
// (persisted), plus a fullscreen toggle.
const MIN_WIDTH = 420;
const DEFAULT_WIDTH = 720;
const WIDTH_STORAGE_KEY = 'storedReportsDrawerWidth';
const maxWidth = () => Math.round(window.innerWidth * 0.97);

/**
 * Right-side drawer that hosts the full stored-report history. Shares
 * its controller with the page so a delete here also updates the badge / per-
 * card counts. Portaled to <body> so no transformed ancestor clips it. The user
 * can drag the left edge to resize (width persisted) or go fullscreen, matching
 * the vulnerability quick-view drawer.
 */
const StoredReportsDrawer: React.FC<StoredReportsDrawerProps> = ({
  open,
  onClose,
  controller,
  maxStoredReports,
  retentionDays,
  highlightReportId,
  scopeMeta,
}) => {
  const { t } = useTranslation();

  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const draggingRef = useRef(false);

  // Esc exits fullscreen first, else closes. Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, isFullscreen]);

  // Drag-to-resize from the left edge. The drawer is right-anchored, so the
  // width is the distance from the cursor to the right edge of the viewport.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(
        maxWidth(),
        Math.max(MIN_WIDTH, window.innerWidth - e.clientX),
      );
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (isFullscreen) return;
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [isFullscreen],
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        data-testid="stored-reports-drawer-panel"
        style={{ width: isFullscreen ? '100vw' : width }}
        className="absolute right-0 top-0 flex h-full flex-col border-l border-zinc-200 bg-white shadow-[-24px_0_48px_-24px_rgb(0_0_0/0.18)] dark:border-as-line-strong dark:bg-as-surface dark:shadow-[-24px_0_64px_-16px_rgb(0_0_0/0.85)]"
      >
        {/* Drag handle on the left edge (hidden in fullscreen). */}
        {!isFullscreen && (
          <div
            onMouseDown={startDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('pages.reportsPage.storedReports.resize')}
            className="group absolute left-0 top-0 z-[70] h-full w-1.5 -translate-x-1/2 cursor-col-resize"
          >
            <div className="mx-auto h-full w-1 bg-transparent transition-colors duration-[120ms] group-hover:bg-secondary/40" />
          </div>
        )}

        <div className="flex h-14 items-center justify-between gap-3 border-b border-zinc-200 px-4 sm:px-5 dark:border-as-line">
          <h3 className={AS_PANEL_TITLE}>
            {t('pages.reportsPage.storedReports.drawerTitle')}
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              aria-label={t(
                isFullscreen
                  ? 'pages.reportsPage.storedReports.collapse'
                  : 'pages.reportsPage.storedReports.expand',
              )}
              className={`relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('pages.reportsPage.storedReports.close')}
              className={`relative flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <StoredReportsList
            controller={controller}
            maxStoredReports={maxStoredReports}
            retentionDays={retentionDays}
            highlightReportId={highlightReportId}
            scopeMeta={scopeMeta}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default StoredReportsDrawer;
