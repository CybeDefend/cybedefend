import { describe, it, expect } from "vitest";
import {
  statusOptions,
  settableStatusOptions,
  filterStatusOptions,
  sanitizeStatusFilter,
} from "./historyVulnData";

describe("historyVulnData status lists", () => {
  it("settableStatusOptions excludes the legacy exploitability statuses", () => {
    const values = settableStatusOptions.map((o) => o.value);
    expect(values).toEqual(["to_verify", "confirmed", "ignored", "resolved"]);
    expect(values).not.toContain("not_exploitable");
    expect(values).not.toContain("proposed_not_exploitable");
  });

  it("statusOptions keeps the 6 legacy values for display only", () => {
    // The colored badge list (HistoryTimeline + status column) must keep every
    // legacy value so historical state-change events still render with a label
    // and color, even though they are no longer offered as filters.
    const values = statusOptions.map((o) => o.value);
    expect(values).toContain("not_exploitable");
    expect(values).toContain("proposed_not_exploitable");
    expect(values).toHaveLength(6);
  });

  it("filterStatusOptions drops the exploitability-derived statuses from the filter dropdown", () => {
    // `not_exploitable` / `proposed_not_exploitable` are exploitability verdicts,
    // not lifecycle states. After migration 1803 no detection row carries them as
    // currentState, so they must not appear as user-selectable status filters.
    const values = filterStatusOptions.map((o) => o.value);
    expect(values).toEqual(["to_verify", "confirmed", "ignored", "resolved"]);
    expect(values).not.toContain("not_exploitable");
    expect(values).not.toContain("proposed_not_exploitable");
    // It must remain a subset of the canonical display list (same option shape).
    for (const opt of filterStatusOptions) {
      expect(statusOptions).toContainEqual(opt);
    }
  });

  describe("sanitizeStatusFilter", () => {
    it("drops retired/unknown statuses while preserving input order", () => {
      // Guards against 400s: persisted localStorage filters and deep-link
      // ?status= params may still carry the retired values after the gateway
      // DTO stops accepting them.
      expect(
        sanitizeStatusFilter([
          "to_verify",
          "proposed_not_exploitable",
          "confirmed",
          "not_exploitable",
          "bogus",
        ]),
      ).toEqual(["to_verify", "confirmed"]);
    });

    it("keeps every still-valid filter status", () => {
      expect(sanitizeStatusFilter(["resolved", "ignored"])).toEqual([
        "resolved",
        "ignored",
      ]);
    });

    it("returns an empty array for empty or non-array input", () => {
      expect(sanitizeStatusFilter([])).toEqual([]);
      expect(sanitizeStatusFilter(undefined as unknown as string[])).toEqual([]);
    });
  });
});
