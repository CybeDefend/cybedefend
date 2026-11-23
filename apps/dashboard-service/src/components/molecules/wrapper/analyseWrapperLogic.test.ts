import { describe, it, expect } from "vitest";
import {
  isScanInProgress,
  isScanCancellable,
  branchSelectorRowState,
  scanModalContent,
  shouldShowPipelinePanel,
} from "./analyseWrapperLogic";
import type { ScanPipelineViewModel } from "@/utils/function/scanPipelineView";

const scan = (over: { id?: string; state?: string } = {}) =>
  ({ id: "scan-1", state: "waiting_for_file", ...over }) as any;

describe("analyseWrapperLogic – scan activity gating", () => {
  describe("isScanInProgress", () => {
    it("is true for a non-terminal scan (running)", () => {
      expect(isScanInProgress(scan({ state: "running" }), null)).toBe(true);
    });

    it("is false when there is no scan", () => {
      expect(isScanInProgress(null, null)).toBe(false);
    });

    it.each(["failed", "completed", "completed_degraded", "cancelled"])(
      "is false for terminal state %s",
      (state) => {
        expect(isScanInProgress(scan({ state }), null)).toBe(false);
      },
    );

    // After a successful cancel the backend toast already says
    // "Scan Cancelled", but the 10s poll has not flipped scanData.state yet.
    // The optimistic local cancelledScanId must hide the in-progress header
    // immediately so it doesn't keep showing "Waiting for File".
    it("is false once the scan has been locally cancelled", () => {
      expect(
        isScanInProgress(
          scan({ id: "scan-1", state: "waiting_for_file" }),
          "scan-1",
        ),
      ).toBe(false);
    });

    it("is true for a different (newly relaunched) scan after a previous cancel", () => {
      expect(
        isScanInProgress(scan({ id: "scan-2", state: "queued" }), "scan-1"),
      ).toBe(true);
    });
  });

  describe("isScanCancellable", () => {
    it.each(["waiting_for_file", "queued"])(
      "is true for cancellable state %s",
      (state) => {
        expect(isScanCancellable(scan({ state }), null)).toBe(true);
      },
    );

    it.each(["running", "initializing", "completed", "failed", "cancelled"])(
      "is false for non-cancellable state %s",
      (state) => {
        expect(isScanCancellable(scan({ state }), null)).toBe(false);
      },
    );

    it("is false when there is no scan", () => {
      expect(isScanCancellable(null, null)).toBe(false);
    });

    // Gating the Cancel button on the local cancelledScanId removes
    // the only re-clickable cancel entry point, so a second cancel (which would
    // hit the backend on an already-cancelled scan and error) is impossible.
    it("is false once the scan has been locally cancelled", () => {
      expect(
        isScanCancellable(
          scan({ id: "scan-1", state: "waiting_for_file" }),
          "scan-1",
        ),
      ).toBe(false);
    });
  });
});

// The results pages now render before their branch list has loaded, so the
// branch selector and the scan modal need a loading state of their own.
describe("analyseWrapperLogic – branch list loading", () => {
  describe("branchSelectorRowState", () => {
    it("shows the selector once branches are loaded", () => {
      expect(branchSelectorRowState(2, false)).toBe("ready");
    });

    it("keeps showing the loaded branches during a reload", () => {
      expect(branchSelectorRowState(2, true)).toBe("ready");
    });

    it("shows a skeleton while the first branch list loads", () => {
      expect(branchSelectorRowState(0, true)).toBe("loading");
    });

    it("hides the row for a project with no branch at all", () => {
      expect(branchSelectorRowState(0, false)).toBe("hidden");
    });
  });

  describe("scanModalContent", () => {
    it("offers the branch picker for a linked repository with branches", () => {
      expect(scanModalContent("github", 3, false)).toBe("branch-picker");
    });

    it("waits for the branch list instead of offering a ZIP upload for a linked project", () => {
      expect(scanModalContent("none", 0, true)).toBe("loading");
    });

    it("offers the ZIP upload for a project with no linked repository", () => {
      expect(scanModalContent("none", 0, false)).toBe("upload");
    });

    it("offers the ZIP upload when the linked repository has no branch", () => {
      expect(scanModalContent("gitlab", 0, false)).toBe("upload");
    });
  });
});

// The pipeline panel replaces the old agent block: it follows the scan the page
// tracks, from the queue to the AI outcome, but steps aside for the loader
// modal and for a scan cancelled from this page.
describe("analyseWrapperLogic – pipeline panel", () => {
  const view = (isEmpty = false) => ({ isEmpty }) as ScanPipelineViewModel;

  it.each(["queued", "running", "completed", "failed"])(
    "shows the panel for a tracked %s scan",
    (state) => {
      expect(shouldShowPipelinePanel(scan({ state }), view(), false, null)).toBe(true);
    },
  );

  it("hides the panel when the scan has nothing to show yet", () => {
    expect(shouldShowPipelinePanel(scan({ state: "waiting_for_file" }), view(true), false, null)).toBe(false);
  });

  it("hides the panel while the scan loader modal is open", () => {
    expect(shouldShowPipelinePanel(scan({ state: "running" }), view(), true, null)).toBe(false);
  });

  it("hides the panel without a scan, or for the placeholder a starting scan shows", () => {
    expect(shouldShowPipelinePanel(null, null, false, null)).toBe(false);
    expect(shouldShowPipelinePanel(scan({ id: "", state: "" }), view(), false, null)).toBe(false);
  });

  it("hides the panel once the scan was cancelled from this page", () => {
    expect(shouldShowPipelinePanel(scan({ id: "scan-1", state: "queued" }), view(), false, "scan-1")).toBe(false);
  });
});
