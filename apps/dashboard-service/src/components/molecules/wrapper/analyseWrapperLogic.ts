// Pure presentation logic for AnalyseWrapper's scan-status header.
// Kept out of the component so it can be unit-tested without the wrapper's
// heavy dependency graph (router, redux store, scan service, branch loader…),
// mirroring loaderScanLogic.ts.

import { ScanResponseDto } from "../../../server/interfaces/Scan";
import type { ScanPipelineViewModel } from "@/utils/function/scanPipelineView";

/** Scan states the backend considers terminal — no "in progress" UI for these. */
export const TERMINAL_SCAN_STATES = new Set([
  "failed",
  "completed",
  "completed_degraded",
  "cancelled",
]);

/** Scan states from which a scan can still be cancelled. */
export const CANCELLABLE_SCAN_STATES = new Set(["waiting_for_file", "queued"]);

type ScanLike = Pick<ScanResponseDto, "id" | "state"> | null | undefined;

/**
 * Has this exact scan just been cancelled locally?
 *
 * `handleCancelConfirm` cancels the scan itself (the page that owns `scanData`
 * is not involved), so after a successful cancel the prop still reports the old
 * non-terminal state until the next poll (up to 10s later). Remembering the
 * cancelled scan id lets the header react immediately instead of lingering on
 * "Waiting for File" with a live "Cancel Scan" button.
 */
function isLocallyCancelled(
  scanData: ScanLike,
  cancelledScanId: string | null,
): boolean {
  return Boolean(
    scanData && cancelledScanId && scanData.id === cancelledScanId,
  );
}

/**
 * Whether the "scan in progress" header block should be shown for `scanData`.
 * False for terminal states and for a scan that was just cancelled locally.
 */
export function isScanInProgress(
  scanData: ScanLike,
  cancelledScanId: string | null,
): boolean {
  if (!scanData) return false;
  if (isLocallyCancelled(scanData, cancelledScanId)) return false;
  return !TERMINAL_SCAN_STATES.has(scanData.state ?? "");
}

/**
 * Whether the "Cancel Scan" button should be shown for `scanData`.
 * False once the scan was cancelled locally, removing the only re-clickable
 * cancel entry point (a second cancel would error on an already-cancelled scan).
 */
export function isScanCancellable(
  scanData: ScanLike,
  cancelledScanId: string | null,
): boolean {
  if (!scanData) return false;
  if (isLocallyCancelled(scanData, cancelledScanId)) return false;
  return CANCELLABLE_SCAN_STATES.has(scanData.state ?? "");
}

/**
 * Whether the scan pipeline panel (queue, scanners, AI lane) is shown under the
 * header. It follows the scan the page tracks, a finished one included, so the
 * AI outcome stays readable until the page lets go of the scan. It steps aside
 * while the loader modal covers the page, for the placeholder a starting scan
 * shows before it has an id, and for a scan just cancelled from this page.
 */
export function shouldShowPipelinePanel(
  scanData: ScanLike,
  view: Pick<ScanPipelineViewModel, "isEmpty"> | null,
  showLoader: boolean,
  cancelledScanId: string | null,
): boolean {
  if (!scanData?.id || !view || view.isEmpty || showLoader) return false;
  return !isLocallyCancelled(scanData, cancelledScanId);
}

/**
 * Whether a start is out. A results page shows a placeholder scan — no id,
 * `initializing` — from the moment a start is accepted until the backend has a
 * scan to show (or refuses, which turns the placeholder to `failed`). The start
 * modal reads it to show its button busy: a second submit is ignored by
 * `useStartAnalysis`, and an ignored click must not look like a dead button.
 */
export function isStartOut(scanData: ScanLike): boolean {
  return Boolean(scanData && !scanData.id && scanData.state === "initializing");
}

/**
 * What the branch selector row shows. The results pages render before their
 * branch list has loaded: the row shows a skeleton meanwhile, unless branches
 * are already there (a reload keeps them on screen).
 */
export function branchSelectorRowState(
  branchesCount: number,
  loadingBranches: boolean,
): "ready" | "loading" | "hidden" {
  if (branchesCount > 0) return "ready";
  return loadingBranches ? "loading" : "hidden";
}

/**
 * What the start-scan modal offers: the branch picker for a linked repository
 * with branches, the ZIP upload otherwise. While the branch list loads, the
 * integration is not known yet, so it waits rather than offering an upload.
 */
export function scanModalContent(
  integrationType: string | undefined,
  branchesCount: number,
  loadingBranches: boolean,
): "branch-picker" | "loading" | "upload" {
  if (integrationType && integrationType !== "none" && branchesCount > 0) {
    return "branch-picker";
  }
  return loadingBranches ? "loading" : "upload";
}
