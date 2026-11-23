/**
 * Pure helper shared between the runtime PriorityCalculatorService and the
 * one-off backfill script (scripts/backfill-priority-score.ts).
 *
 * Both callers MUST produce the same composite score for the same inputs so
 * that the first runtime recalc after a backfill does not shift priorities.
 *
 * Key invariants (identical to PriorityCalculatorService.computeComposite):
 *   - EPSS signal is the UNIFORM percentile rank (0..1), NOT the raw
 *     probability. Raw probabilities are heavily skewed toward 0 (median
 *     ~0.0003) and would collapse the contribution of the EPSS dimension.
 *   - When the EPSS percentile is null/NaN/Infinity, the three remaining
 *     weights (CVSS, exploit, context) are renormalized by (1 - W_EPSS) so
 *     they sum to 1.0 and the composite stays in [0, 1].
 */

export interface BackfillPriorityWeights {
  /** CVSS weight. */
  w1: number;
  /** EPSS percentile weight. */
  w2: number;
  /** Exploitability weight. */
  w3: number;
  /** Context modifier weight. */
  w4: number;
}

export interface BackfillRow {
  currentSeverity: string | null;
  cvss4_base_score: number | null;
  cvss4_environmental_score: number | null;
  /** Raw EPSS probability (unused in the composite — kept for diagnostics). */
  epss_score: number | null;
  /** Uniform EPSS percentile rank in [0, 1]. Source of truth for the composite. */
  epss_percentile: number | null;
  exploitability_score: number | null;
  /** SCA only: 'used' | 'unused' | null. */
  reachability: string | null;
}

export interface BackfillPriorityResult {
  /** Internal 0-1 weighted composite score. */
  compositeScore: number;
  /** User-facing 0-100 priority score (composite * 100, 1 decimal). */
  priorityScore: number;
  /** Individual weight × normalized-signal contributions. */
  cvss4Contribution: number;
  epssContribution: number;
  exploitContribution: number;
  contextContribution: number;
  /**
   * Effective weights actually applied. Equal to the configured weights when
   * EPSS is present; renormalized w1/w3/w4 (and w2=0) when EPSS is absent.
   */
  effectiveW1: number;
  effectiveW2: number;
  effectiveW3: number;
  effectiveW4: number;
}

const SEVERITY_CVSS_DEFAULTS: Record<string, number> = {
  CRITICAL: 9.0,
  HIGH: 7.0,
  MEDIUM: 4.0,
  LOW: 2.0,
};

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCvss(row: BackfillRow): number {
  const raw =
    toFiniteNumber(row.cvss4_environmental_score) ??
    toFiniteNumber(row.cvss4_base_score) ??
    SEVERITY_CVSS_DEFAULTS[(row.currentSeverity ?? '').toUpperCase()] ??
    4.0;
  return raw / 10;
}

function resolveExploitability(row: BackfillRow): number {
  if ((row.reachability ?? '').toLowerCase() === 'unused') {
    return 0;
  }
  return toFiniteNumber(row.exploitability_score) ?? 0.5;
}

function toPriorityScore(compositeScore: number): number {
  const bounded = Math.max(0, Math.min(1, compositeScore));
  return Math.round(bounded * 1000) / 10;
}

/**
 * Compute the composite priority score for a row, honoring the EPSS-absent
 * renormalization rule.
 *
 * @param weights Configured priority weights (must sum to 1.0; enforced at
 *                runtime by PriorityCalculatorService).
 * @param row     Detection row with CVSS, EPSS and exploitability signals.
 * @param context Context modifier in [0, 1]. The backfill passes 0.5 (neutral)
 *                because it does not know the per-project Security Context;
 *                the next runtime recalc overwrites with the real value.
 */
export function computeBackfillPriority(
  weights: BackfillPriorityWeights,
  row: BackfillRow,
  context: number,
): BackfillPriorityResult {
  const cvssNorm = normalizeCvss(row);
  const exploit = resolveExploitability(row);

  const epssPercentile = toFiniteNumber(row.epss_percentile);

  if (epssPercentile != null) {
    const cvss4Contribution = weights.w1 * cvssNorm;
    const epssContribution = weights.w2 * epssPercentile;
    const exploitContribution = weights.w3 * exploit;
    const contextContribution = weights.w4 * context;
    const compositeScore =
      cvss4Contribution +
      epssContribution +
      exploitContribution +
      contextContribution;
    return {
      compositeScore,
      priorityScore: toPriorityScore(compositeScore),
      cvss4Contribution,
      epssContribution,
      exploitContribution,
      contextContribution,
      effectiveW1: weights.w1,
      effectiveW2: weights.w2,
      effectiveW3: weights.w3,
      effectiveW4: weights.w4,
    };
  }

  const denom = weights.w1 + weights.w3 + weights.w4;
  const effectiveW1 = weights.w1 / denom;
  const effectiveW3 = weights.w3 / denom;
  const effectiveW4 = weights.w4 / denom;
  const cvss4Contribution = effectiveW1 * cvssNorm;
  const exploitContribution = effectiveW3 * exploit;
  const contextContribution = effectiveW4 * context;
  const compositeScore =
    cvss4Contribution + exploitContribution + contextContribution;
  return {
    compositeScore,
    priorityScore: toPriorityScore(compositeScore),
    cvss4Contribution,
    epssContribution: 0,
    exploitContribution,
    contextContribution,
    effectiveW1,
    effectiveW2: 0,
    effectiveW3,
    effectiveW4,
  };
}
