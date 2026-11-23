/**
 * Shared helpers for the Scoring & Exploitability UI (issue detail page).
 *
 * `getSeverityLabel` maps a numeric CVSS score (0–10) to a severity band
 * plus the Tailwind text class used across the CVSS cards. The thresholds
 * mirror the CVSS v3.1 / v4.0 qualitative severity ratings:
 *   >= 9.0  → Critical
 *   >= 7.0  → High
 *   >= 4.0  → Medium
 *   else    → Low
 *
 * Keeping this in one place avoids the FE-H2 bug where
 * `CvssScoreCard` painted every score in `text-red-600` regardless of the
 * actual severity (a 3.1 score would render red-600 even though it is low).
 */
export const getSeverityLabel = (
  score: number,
): { label: string; colorClass: string } => {
  if (score >= 9.0) return { label: 'Critical', colorClass: 'text-critical-risk' };
  if (score >= 7.0) return { label: 'High', colorClass: 'text-high-risk' };
  if (score >= 4.0) return { label: 'Medium', colorClass: 'text-medium-risk' };
  return { label: 'Low', colorClass: 'text-low-risk' };
};
