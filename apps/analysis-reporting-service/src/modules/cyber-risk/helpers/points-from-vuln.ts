/**
 * Pure function: maps a single vulnerability to its CybeRisk point contribution.
 *
 * The CybeRisk Score is the unbounded sum of
 * pointsFromVuln(v) over all active vulnerabilities of a project.
 *
 * Formula (linear interpolation inside each CVSS band, anchored on
 * user-stated values 8.9 → 10 and 6.9 → 4):
 *   Critical [9.0, 10.0] :  15 + (cvss − 9) × 5
 *   High     [7.0, 9.0)  :  5  + (cvss − 7) × (5 / 1.9)
 *   Medium   [4.0, 7.0)  :  2  + (cvss − 4) × (2 / 2.9)
 *   Low      [0.1, 4.0)  :  1  (constant)
 *   None     0 / absent  :  0
 *
 * Source priority: cvssEnvironmental → cvss4 → cvss3 → severity-midpoint → 0.
 * The severity-midpoint fallback is used for findings that have no
 * CVSS at all (SAST, Secrets, IaC); the value is the midpoint of the
 * corresponding band: Critical=17.5, High=7.5, Medium=3, Low=1.
 */
export type VulnForScoring = {
  cvssEnvironmental?: number | null;
  cvss4?: number | null;
  cvss3?: number | null;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'none' | null;
};

export function pointsFromVuln(v: VulnForScoring): number {
  const cvss = pickEffectiveCvss(v);
  if (cvss !== null) {
    return pointsFromCvss(cvss);
  }
  return pointsFromSeverityFallback(v.severity ?? null);
}

function pickEffectiveCvss(v: VulnForScoring): number | null {
  if (typeof v.cvssEnvironmental === 'number') return v.cvssEnvironmental;
  if (typeof v.cvss4 === 'number') return v.cvss4;
  if (typeof v.cvss3 === 'number') return v.cvss3;
  return null;
}

function pointsFromCvss(rawCvss: number): number {
  // Clamp negative values to 0 and >10 to 10 (defensive: feeds occasionally
  // ship odd values).
  const cvss = Math.min(10, Math.max(0, rawCvss));
  if (cvss === 0) return 0;
  if (cvss >= 9.0) return 15 + (cvss - 9) * 5;
  if (cvss >= 7.0) return 5 + (cvss - 7) * (5 / 1.9);
  if (cvss >= 4.0) return 2 + (cvss - 4) * (2 / 2.9);
  return 1; // [0.1, 4.0)
}

function pointsFromSeverityFallback(
  severity: VulnForScoring['severity'],
): number {
  switch (severity) {
    case 'critical':
      return 17.5;
    case 'high':
      return 7.5;
    case 'medium':
      return 3;
    case 'low':
      return 1;
    default:
      return 0;
  }
}
