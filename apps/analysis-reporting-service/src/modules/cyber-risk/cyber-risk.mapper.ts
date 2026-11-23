import {
  CyberRiskScore as CyberRiskScoreProto,
  CyberRiskBreakdown,
  CyberRiskScanTypeContribution,
  CyberRiskTopContributor,
} from '@grpc/analysis-reporting/result';

import {
  pointsFromVuln,
  type VulnForScoring,
} from './helpers/points-from-vuln';

/** A scoring vuln carrying the per-detection id + scan type for breakdowns. */
export type ScoredVuln = VulnForScoring & { id: string; scanType: string };

/**
 * Maps a persisted project_cyber_risk row to the proto CyberRiskScore.
 * When a `breakdown` is supplied (detail endpoint), it is attached; listings
 * omit it to keep responses light.
 */
export function persistedCyberRiskToProto(
  row: { score: number; level: string; computedAt: Date } | null,
  breakdown?: CyberRiskBreakdown,
): CyberRiskScoreProto {
  if (!row) return emptyCyberRiskScore();
  return {
    score: row.score,
    level: row.level,
    computedAt: row.computedAt.toISOString(),
    ...(breakdown ? { breakdown } : {}),
  };
}

/** Empty score used when callers cannot compute (e.g. legacy fallback paths). */
export function emptyCyberRiskScore(): CyberRiskScoreProto {
  return {
    score: 0,
    level: 'low',
    computedAt: new Date().toISOString(),
  };
}

/**
 * Groups the active vulns by scan type, counting per-severity and summing the
 * point contribution. Reachability no longer exists in the current formula, so
 * avgReachabilityFactor is neutralized to 0.
 */
export function buildByScanType(vulns: ScoredVuln[]): {
  [key: string]: CyberRiskScanTypeContribution;
} {
  const out: { [key: string]: CyberRiskScanTypeContribution } = {};
  for (const v of vulns) {
    const bucket =
      out[v.scanType] ??
      (out[v.scanType] = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        weightedScore: 0,
        avgReachabilityFactor: 0,
      });
    if (v.severity === 'critical') bucket.critical += 1;
    else if (v.severity === 'high') bucket.high += 1;
    else if (v.severity === 'medium') bucket.medium += 1;
    else if (v.severity === 'low') bucket.low += 1;
    bucket.weightedScore += pointsFromVuln(v);
  }
  for (const key of Object.keys(out)) {
    out[key].weightedScore = Math.round(out[key].weightedScore);
  }
  return out;
}

/**
 * Top 5 contributing vulns by descending point contribution. Reachability and
 * exploitabilityVerdict no longer feed the score, so they are emitted empty.
 */
export function buildTopContributors(
  vulns: ScoredVuln[],
): CyberRiskTopContributor[] {
  return vulns
    .map((v) => ({ v, pts: pointsFromVuln(v) }))
    .filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 5)
    .map(({ v, pts }) => ({
      vulnerabilityId: v.id,
      scanType: v.scanType,
      severity: v.severity ?? 'none',
      reachability: '',
      exploitabilityVerdict: '',
      contribution: pts,
    }));
}

/**
 * Rebuilds the /overview breakdown live from the persisted score + the current
 * active vulns. The deprecated business/exposure multipliers are neutralized to
 * 1 and their context message fields are omitted (proto3 optional).
 */
export function buildBreakdown(
  score: number,
  vulns: ScoredVuln[],
): CyberRiskBreakdown {
  return {
    base: score,
    businessMultiplier: 1,
    exposureMultiplier: 1,
    byScanType: buildByScanType(vulns),
    topContributors: buildTopContributors(vulns),
  } as CyberRiskBreakdown;
}
