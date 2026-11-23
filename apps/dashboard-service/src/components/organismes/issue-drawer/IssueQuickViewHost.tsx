import React, { useEffect, useRef } from "react";
import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import IssueQuickViewDrawer, { QuickViewIssueType } from "./IssueQuickViewDrawer";

export interface QuickViewPagination {
  /** 1-based current page. */
  currentPage: number;
  totalPages: number;
  /** Issues per full page (detailed view) — used as the occurrence offset
   * fallback when `occurrenceOffset` isn't provided. */
  pageSize: number;
  /**
   * Total VULNERABILITIES counted across every page: total issues in detailed
   * view, total occurrences in grouped view (each affected file counts as one).
   */
  totalCount: number;
  /**
   * Number of vulnerabilities on all pages before the current one — the counter
   * numerator is `occurrenceOffset + indexOnPage + 1`. Detailed view can omit it
   * (defaults to `(currentPage-1) * pageSize`, exact since pages are uniform);
   * grouped view passes it (occurrences before the page).
   */
  occurrenceOffset?: number;
  onPageChange: (page: number) => void;
}

interface IssueQuickViewHostProps {
  projectId: string | undefined;
  type: QuickViewIssueType;
  /**
   * Navigation units, in display order. One unit per list row: a single
   * `[issueId]` in the detailed view, or all of a group's occurrence ids in the
   * grouped view. prev/next moves unit-to-unit and the open issue is matched by
   * membership, so clicking any occurrence of a group still resolves correctly.
   */
  units: string[][];
  /**
   * Pagination for the current view (its `totalCount`/`pageSize` are unit-based,
   * i.e. issues in detailed view, groups in grouped). Enables the global
   * position label and lazy cross-page prev/next.
   */
  pagination?: QuickViewPagination;
  /** Latest finished scan date for this family (see resolveLastScanAt). */
  lastScanAt?: string | null;
}

/**
 * Wires the `?issue=` search param to the quick-view drawer and owns all
 * navigation: prev/next steps through every occurrence (groups flattened so
 * within-group occurrences aren't skipped), the position label is category-
 * based with an occurrence sub-counter, plus lazy cross-page jumps (a page is
 * fetched only when you step past the current page's edge).
 */
const IssueQuickViewHost: React.FC<IssueQuickViewHostProps> = ({
  projectId,
  type,
  units,
  pagination,
  lastScanAt = null,
}) => {
  const { issueId, navigateToIssue, closeIssue } = useIssueQuickView();

  // A cross-page jump changes the page, then opens the first/last unit once the
  // new page's ids have loaded. This ref carries that intent across renders.
  const pendingEdgeRef = useRef<null | "first" | "last">(null);
  // The exact occurrence offset (occurrences before the page) of a page reached
  // by stepping, pinned to its page number. Grouped pages hold a variable number
  // of occurrences, so the even-distribution estimate the template passes is
  // wrong mid-list; once we step onto a page we know its real offset and pin it.
  const trackedOffsetRef = useRef<{ page: number; offset: number } | null>(null);
  // Carries the offset across a cross-page jump: for "first" (next) it is the
  // new page's offset; for "last" (prev) it is the base offset of the page we
  // left, from which the previous page's offset is derived once it loads.
  const pendingOffsetRef = useRef<number | null>(null);
  // The list page AND flat index at which the open issue was last seen. Lets us
  // (a) tell an edit that drops the issue off the *current* page (same page →
  // keep the drawer open) from the user navigating to another page (close it),
  // and (b) keep prev/next working from the remembered slot after the issue is
  // edited off the filter and disappears from `flat`.
  const lastSeenRef = useRef<{ page: number | null; index: number } | null>(null);

  useEffect(() => {
    if (!issueId) {
      lastSeenRef.current = null;
      return;
    }
    if (units.length === 0) return; // page still loading — wait
    if (units.some((u) => u.includes(issueId))) {
      // Still on this page — remember where, to detect later navigation and to
      // anchor prev/next if the issue is later edited off the filter.
      lastSeenRef.current = {
        page: pagination?.currentPage ?? null,
        index: units.flatMap((u) => u).indexOf(issueId),
      };
      return;
    }
    // The open issue is not on the current page.
    if (pendingEdgeRef.current) {
      // Drawer-initiated cross-page: open the first/last *occurrence* of the
      // new page (groups flattened so within-group occurrences aren't skipped).
      const edge = pendingEdgeRef.current;
      pendingEdgeRef.current = null;
      const newFlat = units.flatMap((u) => u);
      // Pin the exact occurrence offset of the page we just landed on so the
      // counter continues seamlessly (46 → 47) instead of snapping to the
      // even-distribution estimate. "first": offset is the carried value;
      // "last": the previous page's offset = base − that page's occurrences.
      if (pagination) {
        const base = pendingOffsetRef.current ?? 0;
        const offset =
          edge === "first" ? base : Math.max(base - newFlat.length, 0);
        trackedOffsetRef.current = { page: pagination.currentPage, offset };
      }
      pendingOffsetRef.current = null;
      const target =
        edge === "first" ? newFlat[0] : newFlat[newFlat.length - 1];
      if (target) navigateToIssue(target);
      return;
    }
    // The issue left the current page's list without a pending cross-page jump.
    // Distinguish the two reasons:
    //  • Same list page → the vuln was EDITED so it no longer matches the active
    //    filter (status/exploitability/priority). KEEP the drawer open
    //    so modifying a vuln never ejects the user from the detail view. prev/next
    //    keep working from the remembered slot (see `lastSeenRef` in the render).
    //  • Different list page → the user navigated the list behind the drawer, so
    //    the shown vuln is unrelated to the new page → close the drawer.
    const navigatedToAnotherPage =
      pagination != null &&
      lastSeenRef.current?.page != null &&
      pagination.currentPage !== lastSeenRef.current.page;
    if (navigatedToAnotherPage) {
      lastSeenRef.current = null;
      closeIssue();
    }
    // else (same page → edited off the filter, or a deep link to an off-page
    // issue that was never in the list) → keep the drawer open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, issueId]);

  if (!projectId) return null;

  const hasPagination = !!pagination && pagination.totalPages > 0;

  // Flatten the units so prev/next visits every occurrence (within a group too)
  // and so each occurrence counts as one vulnerability in the position label.
  const flat = units.flatMap((u) => u);
  const liveIndex = issueId ? flat.indexOf(issueId) : -1;

  // The position is remembered: when the open vuln is edited
  // so it no longer matches the active list filter it drops out of `flat`
  // (liveIndex === -1). Fall back to the slot it held while still in the list
  // (same page) so the position label AND prev/next keep working from there.
  const ghost = lastSeenRef.current;
  const useGhost =
    liveIndex < 0 &&
    !!issueId &&
    !!ghost &&
    (!hasPagination || ghost.page === pagination!.currentPage);
  const navIndex = liveIndex >= 0 ? liveIndex : useGhost ? ghost!.index : -1;
  // When the issue was removed from its slot, everything after it shifted left,
  // so the element now AT that slot is the "next"; when it's still present, the
  // next is the following element.
  const prevIndex = navIndex - 1;
  const nextIndex = useGhost ? navIndex : navIndex + 1;

  // Occurrences on all pages before the current one. Detailed pages are uniform
  // (pageSize issues each) so the template's offset is exact; grouped pages vary,
  // so we prefer the exact offset pinned while stepping (trackedOffsetRef) and
  // fall back to the template's estimate only on a direct jump to an unvisited
  // page.
  const seededOffset = hasPagination
    ? pagination!.occurrenceOffset ??
      (pagination!.currentPage - 1) * pagination!.pageSize
    : 0;
  const occurrenceOffset =
    hasPagination &&
    trackedOffsetRef.current &&
    trackedOffsetRef.current.page === pagination!.currentPage
      ? trackedOffsetRef.current.offset
      : seededOffset;

  let positionText: string | undefined;
  if (navIndex >= 0) {
    if (hasPagination) {
      const position = Math.min(
        occurrenceOffset + navIndex + 1,
        pagination!.totalCount,
      );
      positionText = `${position} / ${pagination!.totalCount}`;
    } else {
      positionText = `${navIndex + 1} / ${flat.length}`;
    }
  }

  const canPrev =
    prevIndex >= 0 ||
    (hasPagination && navIndex >= 0 && pagination!.currentPage > 1);
  const canNext =
    (navIndex >= 0 && nextIndex <= flat.length - 1) ||
    (hasPagination && navIndex >= 0 && pagination!.currentPage < pagination!.totalPages);

  const onPrev = () => {
    // Ignore clicks while a cross-page jump is still loading — otherwise rapid
    // clicks would skip several pages and fire a burst of requests.
    if (pendingEdgeRef.current) return;
    if (navIndex < 0) return;
    if (prevIndex >= 0) {
      navigateToIssue(flat[prevIndex]);
    } else if (hasPagination && pagination!.currentPage > 1) {
      pendingEdgeRef.current = "last";
      // Base for the previous page's offset (= base − its occurrence count).
      pendingOffsetRef.current = occurrenceOffset;
      pagination!.onPageChange(pagination!.currentPage - 1);
    }
  };

  const onNext = () => {
    if (pendingEdgeRef.current) return;
    if (navIndex < 0) return;
    if (nextIndex <= flat.length - 1) {
      navigateToIssue(flat[nextIndex]);
    } else if (hasPagination && pagination!.currentPage < pagination!.totalPages) {
      pendingEdgeRef.current = "first";
      // The next page starts right after this page's last occurrence.
      pendingOffsetRef.current = occurrenceOffset + flat.length;
      pagination!.onPageChange(pagination!.currentPage + 1);
    }
  };

  return (
    <IssueQuickViewDrawer
      projectId={projectId}
      type={type}
      issueId={issueId}
      lastScanAt={lastScanAt}
      onClose={closeIssue}
      onPrev={onPrev}
      onNext={onNext}
      canPrev={canPrev}
      canNext={canNext}
      positionText={positionText}
    />
  );
};

export default IssueQuickViewHost;
