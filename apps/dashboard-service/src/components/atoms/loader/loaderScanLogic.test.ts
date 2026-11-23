import { describe, it, expect } from "vitest";
import { AGENT_LABEL, resolveAgentActionLabelKey } from "./loaderScanLogic";

// The scan-progress modal showed "Scan Completed" under the 77%
// progress ring while the scan was still running. Root cause: the agentic
// scanner reports its sub-phases as actions ("agent: parsing completed" →
// action 'done'); the modal mapped 'done'/'decided' to the "Scan Completed"
// label unconditionally, ignoring the overall scan state. An agent finishing a
// sub-phase is NOT the whole scan finishing. The label must only say
// "completed" when the OVERALL scan state is terminal-completed.
describe("resolveAgentActionLabelKey – agent action label gated on scan state", () => {
  it("maps in-progress / start actions to the running label, whatever the state", () => {
    expect(resolveAgentActionLabelKey("in_progress", "running")).toBe(
      AGENT_LABEL.RUNNING,
    );
    expect(resolveAgentActionLabelKey("start", "running")).toBe(
      AGENT_LABEL.RUNNING,
    );
    expect(resolveAgentActionLabelKey("in_progress", "completed")).toBe(
      AGENT_LABEL.RUNNING,
    );
  });

  it("surfaces the completed label for done/decided ONLY when the scan is terminal-completed", () => {
    expect(resolveAgentActionLabelKey("done", "completed")).toBe(
      AGENT_LABEL.COMPLETED,
    );
    expect(resolveAgentActionLabelKey("done", "completed_degraded")).toBe(
      AGENT_LABEL.COMPLETED,
    );
    expect(resolveAgentActionLabelKey("decided", "completed")).toBe(
      AGENT_LABEL.COMPLETED,
    );
  });

  // The bug repro: agent reported its parsing phase done (action 'done') while
  // the SAST container — and therefore the overall scan — was still 'running'.
  it("does NOT say completed when an agent sub-phase finishes but the scan is still running", () => {
    expect(resolveAgentActionLabelKey("done", "running")).toBe(
      AGENT_LABEL.RUNNING,
    );
    expect(resolveAgentActionLabelKey("done", "queued")).toBe(
      AGENT_LABEL.RUNNING,
    );
    expect(resolveAgentActionLabelKey("done", "waiting_for_file")).toBe(
      AGENT_LABEL.RUNNING,
    );
    expect(resolveAgentActionLabelKey("decided", "running")).toBe(
      AGENT_LABEL.RUNNING,
    );
    // Defensive: an unknown/undefined scan state is not "completed".
    expect(resolveAgentActionLabelKey("done", undefined)).toBe(
      AGENT_LABEL.RUNNING,
    );
  });

  it("returns null for unknown actions (caller falls back to the raw action string)", () => {
    expect(resolveAgentActionLabelKey("queued", "running")).toBeNull();
    expect(
      resolveAgentActionLabelKey("some_future_action", "completed"),
    ).toBeNull();
  });

  it("returns null when there is no agent action", () => {
    expect(resolveAgentActionLabelKey(undefined, "running")).toBeNull();
    expect(resolveAgentActionLabelKey("", "completed")).toBeNull();
  });
});
