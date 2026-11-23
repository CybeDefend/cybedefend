import { ViolationAction } from '@entities/security-policy.entity';

/**
 * A violation is one broken rule of one policy, with every finding that
 * breaks it. That is the unit stored per project (one row per policy and
 * rule) and counted by the project statistics and the organisation overview.
 * An evaluation's result lists one entry per (rule, finding) match, so its
 * counts are taken over the distinct (policy, rule) pairs of that list, or
 * the same scan would show different totals on different screens.
 */
export interface ViolationCounts {
  total: number;
  blocking: number;
  warning: number;
}

export function countViolatedRules(
  matches: ReadonlyArray<{ policyId?: string; ruleId: string; action: string }>,
): ViolationCounts {
  const actionByRule = new Map<string, string>();
  for (const match of matches) {
    actionByRule.set(
      `${match.policyId ?? ''}\u0000${match.ruleId}`,
      match.action,
    );
  }
  let blocking = 0;
  let warning = 0;
  for (const action of actionByRule.values()) {
    if (action === ViolationAction.BLOCK) blocking++;
    else if (action === ViolationAction.WARN) warning++;
  }
  return { total: actionByRule.size, blocking, warning };
}
