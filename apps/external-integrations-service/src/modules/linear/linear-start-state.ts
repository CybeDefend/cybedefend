/** A Linear workflow state, as the team query returns it. */
export interface LinearWorkflowState {
  id: string;
  type: string;
  position: number;
}

/**
 * The state a new ticket starts in, always sent explicitly: left to Linear, a
 * ticket of a team with Triage turned on lands in Triage, which CybeDefend
 * never uses.
 *
 * The team's default state unless it is a triage state, else the first
 * `backlog` state by position, else the first `unstarted` one. Null when the
 * team has none of them: the caller creates nothing rather than let Linear
 * choose.
 */
export function resolveStartStateId(
  states: LinearWorkflowState[],
  defaultState: { id: string; type: string } | null,
): string | null {
  if (defaultState?.id && defaultState.type !== 'triage') {
    return defaultState.id;
  }
  const firstOfType = (type: string) =>
    states
      .filter((state) => state.type === type)
      .sort((a, b) => a.position - b.position)[0];
  return (firstOfType('backlog') ?? firstOfType('unstarted'))?.id ?? null;
}
