/**
 * CybeRisk Score shared constants and types.
 */

export type CyberRiskLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * Active vulnerability states retained in the score. `proposed_not_exploitable`
 * was an exploitability verdict, not a lifecycle state; migration 1803 remapped
 * it to `to_verify`, so the canonical active set is to_verify + confirmed.
 */
export const ACTIVE_VULN_STATES: readonly string[] = [
  'to_verify',
  'confirmed',
] as const;

/** Fallback scoring branches when a project has no referenceBranch. */
export const DEFAULT_SCORING_BRANCHES = ['main', 'master'] as const;
