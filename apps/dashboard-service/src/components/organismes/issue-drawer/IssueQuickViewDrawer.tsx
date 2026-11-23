import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from '@/components/atoms/icon/icons';
import IssueDetailView from "@/pages/project-pages/issue-page/IssueDetailView";
import { cn } from "@/utils/function/utils";
import { SHEET_EASE, SHEET_SECONDS } from '@/components/atoms/side-sheet/SideSheet';
import { AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
import { Slot } from "@/edition/slots";

export type QuickViewIssueType = "sast" | "iac" | "cicd" | "secret" | "sca" | "container";

interface IssueQuickViewDrawerProps {
  projectId: string;
  type: QuickViewIssueType;
  /** Open issue id, or null when the drawer is closed. */
  issueId: string | null;
  onClose: () => void;
  /** Move to the previous / next vulnerability (host handles cross-page). */
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  /** Global position across all pages, e.g. "5 / 275". */
  positionText?: string;
  /** Latest finished scan date for the family, forwarded to the detail view. */
  lastScanAt?: string | null;
}

/*
  The sheet, a panel that slides in from right to left: flush with the top, right and bottom edges,
  a hairline on its left edge, a scrim over the page, sliding in from the
  right in 240 ms on an ease-out curve and leaving the same way, the scrim
  fading with it. Under reduced motion nothing moves: sheet and scrim are
  simply there, and simply gone. The values are the shared `SideSheet`'s,
  which every other record detail of both spaces opens in.
*/

const MIN_WIDTH = 420;
const DEFAULT_WIDTH = 600;
const WIDTH_STORAGE_KEY = "issueQuickViewWidth";

const maxWidth = () => Math.round(window.innerWidth * 0.97);

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
};

const DrawerPanel: React.FC<Omit<IssueQuickViewDrawerProps, "issueId"> & { issueId: string }> = ({
  projectId,
  type,
  issueId,
  onClose,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
  positionText,
  lastScanAt,
}) => {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const bodyRef = useRef<HTMLDivElement>(null);

  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const draggingRef = useRef(false);

  // Scroll the panel (not the window) back to the top when switching issues.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [issueId]);

  // Keyboard: Esc closes (or exits fullscreen first), arrows move between issues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
      } else if (e.key === "ArrowLeft" && canPrev) {
        onPrev?.();
      } else if (e.key === "ArrowRight" && canNext) {
        onNext?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, canPrev, canNext, isFullscreen]);

  // Drag-to-resize from the left edge. The drawer is right-anchored, so the
  // width is the distance from the cursor to the right edge of the viewport.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(maxWidth(), Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      // Track the live value on the ref too: a move+up in the same tick (tests,
      // very fast drags) reads onUp before React re-renders the state-derived ref.
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if (isFullscreen) return;
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [isFullscreen],
  );

  // Memoize the (heavy) detail subtree so resizing — which updates `width` on
  // every mousemove — doesn't re-render it; only an issue change does.
  const body = useMemo(
    () => (
      <IssueDetailView
        projectId={projectId}
        issueId={issueId}
        type={type}
        embedded
        onBack={onClose}
        lastScanAt={lastScanAt}
      />
    ),
    [projectId, issueId, type, onClose, lastScanAt],
  );

  const sheetMotion = reducedMotion
    ? { initial: false as const }
    : { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } };
  const scrimMotion = reducedMotion
    ? { initial: false as const }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  const sheetTransition = { duration: SHEET_SECONDS, ease: SHEET_EASE };

  return (
    <>
      {/* The scrim: the page steps back while the sheet is open; a click on it closes the sheet. */}
      <motion.div
        key="issue-quick-view-scrim"
        aria-hidden="true"
        onClick={onClose}
        {...scrimMotion}
        transition={sheetTransition}
        className="fixed inset-0 z-40 bg-zinc-950/20 dark:bg-black/55"
        data-testid="issue-quick-view-scrim"
      />
      <motion.aside
        key="issue-quick-view"
        role="dialog"
        aria-modal="false"
        aria-label={t("components.issueDrawer.ariaLabel")}
        {...sheetMotion}
        transition={sheetTransition}
        style={{ width: isFullscreen ? "100vw" : width }}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex flex-col max-w-[100vw] max-md:!w-full",
          "border-l border-zinc-200 bg-white",
          "dark:border-as-line-strong dark:bg-as-surface",
        )}
        data-testid="issue-quick-view-drawer"
      >
        {/* Drag handle on the left edge (hidden in fullscreen). */}
        {!isFullscreen && (
          <div
            onMouseDown={startDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("components.issueDrawer.resize")}
            className="group absolute left-0 top-0 z-50 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
          >
            <div className="mx-auto h-full w-1 bg-transparent transition-colors group-hover:bg-secondary/40" />
          </div>
        )}

        {/* Chrome: close · position · prev/next | fullscreen · open full page */}
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-5 border-b border-zinc-200 dark:border-as-line">
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              aria-label={t("components.issueDrawer.close")}
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 disabled:opacity-30 disabled:pointer-events-none ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              <X className="w-4 h-4" />
            </button>
            {positionText && (
              <span className="px-1 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap tabular-nums">
                {positionText}
              </span>
            )}
            <button
              onClick={() => onPrev?.()}
              disabled={!canPrev}
              aria-label={t("components.issueDrawer.previous")}
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 disabled:opacity-30 disabled:pointer-events-none ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNext?.()}
              disabled={!canNext}
              aria-label={t("components.issueDrawer.next")}
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 disabled:opacity-30 disabled:pointer-events-none ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {/* « Ask Cybe » on the open finding: a `finding.actions`
                registration of the active edition (the chat's, in a private
                build); empty in a community build. */}
            <Slot
              name="finding.actions"
              context={{ projectId, findingId: issueId, vulnerabilityType: type }}
            />
            <button
              onClick={() => setIsFullscreen((v) => !v)}
              aria-label={
                isFullscreen
                  ? t("components.issueDrawer.exitFullscreen")
                  : t("components.issueDrawer.fullscreen")
              }
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 disabled:opacity-30 disabled:pointer-events-none ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Body: the full vulnerability detail (content + update actions). */}
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto custom-scrollbar bg-white dark:bg-as-surface"
        >
          {body}
        </div>
      </motion.aside>
    </>
  );
};

/**
 * Right-hand quick-view drawer for vulnerability list pages. Hosts the full
 * `IssueDetailView` (same content + update actions as the dedicated page) so
 * triage stays on the list. Navigation (prev/next, cross-page, the global
 * position label) is computed by the host and passed in; the panel can be
 * dragged wider from its left edge and expanded fullscreen. The dedicated issue
 * page remains reachable via "Open full details" and deep links.
 */
const IssueQuickViewDrawer: React.FC<IssueQuickViewDrawerProps> = ({ issueId, ...rest }) => (
  <AnimatePresence>
    {issueId && <DrawerPanel key="issue-quick-view" issueId={issueId} {...rest} />}
  </AnimatePresence>
);

export default IssueQuickViewDrawer;
