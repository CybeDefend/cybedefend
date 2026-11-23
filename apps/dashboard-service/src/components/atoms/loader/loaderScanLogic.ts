// Pure presentation logic for the scan-progress modal (LoaderScan).
// Kept out of the component so it can be unit-tested without a render/i18n.

/** i18n keys for the short status label shown under the progress ring. */
export const AGENT_LABEL = {
  RUNNING: "components.loaderScan.stateRunning",
  COMPLETED: "components.loaderScan.stateCompleted",
} as const;

/** Scan states the backend considers terminal-completed (success or degraded). */
const TERMINAL_COMPLETED_STATES = new Set(["completed", "completed_degraded"]);

/**
 * Resolve the i18n key for the agentic scanner's action label.
 *
 * The agent reports its sub-phases as actions: "agent: parsing completed" is
 * parsed to action `'done'`, prioritization yields `'decided'`, etc. A finished
 * sub-phase is NOT a finished scan — so `'done'`/`'decided'` may only surface
 * the "Scan Completed" label when the OVERALL scan state is terminal-completed.
 * While the scan is still running (e.g. SAST in flight after the agent parsed),
 * we keep showing the in-progress label.
 *
 * @returns an `AGENT_LABEL` i18n key, or `null` when there is no agent action
 *          or the action is unknown (the caller then falls back to the raw
 *          action / overall scan-state text).
 */
export function resolveAgentActionLabelKey(
  agentAction: string | undefined | null,
  scanState: string | undefined | null,
): (typeof AGENT_LABEL)[keyof typeof AGENT_LABEL] | null {
  if (!agentAction) return null;

  switch (agentAction) {
    case "in_progress":
    case "start":
      return AGENT_LABEL.RUNNING;
    case "done":
    case "decided":
      return TERMINAL_COMPLETED_STATES.has(String(scanState))
        ? AGENT_LABEL.COMPLETED
        : AGENT_LABEL.RUNNING;
    default:
      return null;
  }
}
