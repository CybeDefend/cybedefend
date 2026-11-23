import { describe, it, expect } from "vitest";
import { buildBatchUpdateItems } from "./batchUpdateItems";

/**
 * GRC export: the six results pages each mapped the batch modal's
 * payload onto `BatchUpdateItem[]` inline, and each of them silently dropped
 * any field the copy-pasted spread did not know about. `dismissalReason` is
 * mandatory server-side on `status: 'ignored'`, so a page that drops it turns
 * every bulk dismissal into a 400. One helper, one test.
 */
describe("buildBatchUpdateItems", () => {
  it("stamps the dismissal reason onto every selected finding", () => {
    const items = buildBatchUpdateItems(["a", "b"], {
      status: "ignored",
      dismissalReason: "accepted risk — CISO sign-off",
    });
    expect(items).toEqual([
      {
        vulnerabilityId: "a",
        status: "ignored",
        dismissalReason: "accepted risk — CISO sign-off",
      },
      {
        vulnerabilityId: "b",
        status: "ignored",
        dismissalReason: "accepted risk — CISO sign-off",
      },
    ]);
  });

  it("omits the reason on a non-dismissal status even when one was typed", () => {
    // The fixture MUST supply a reason. Without one the assertion holds no
    // matter what the helper does with a reason — it stayed green with the
    // `status === "ignored"` gate deleted, i.e. it did not test its own name.
    // The input is realistic: `BatchUpdateModal` keeps the typed reason in
    // state when the operator switches the status away from "ignored" (it is
    // only cleared on close), and this helper is the single mapping point for
    // six pages — its gate must hold on its own, not because today's only
    // caller happens to gate first.
    const items = buildBatchUpdateItems(["a"], {
      status: "resolved",
      priority: "low",
      comment: "fixed in PR 42",
      dismissalReason: "leftover from a previous selection",
    });
    expect(items).toEqual([
      {
        vulnerabilityId: "a",
        status: "resolved",
        priority: "low",
        comment: "fixed in PR 42",
      },
    ]);
    expect(items[0]).not.toHaveProperty("dismissalReason");
  });

  it("never attaches a blank reason — the gateway refuses one", () => {
    const items = buildBatchUpdateItems(["a"], {
      status: "ignored",
      dismissalReason: "   ",
    });
    // Sending a blank string is a guaranteed 400; drop it so the failure is
    // the same "reason is required" the API states, not a confusing one.
    expect(items[0]).not.toHaveProperty("dismissalReason");
  });

  it("keeps only the fields the operator actually set", () => {
    expect(buildBatchUpdateItems(["a"], { priority: "low" })).toEqual([
      { vulnerabilityId: "a", priority: "low" },
    ]);
  });

  it("returns one item per id, in order", () => {
    const items = buildBatchUpdateItems(["z", "y", "x"], { comment: "c" });
    expect(items.map((i) => i.vulnerabilityId)).toEqual(["z", "y", "x"]);
  });
});
