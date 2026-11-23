/**
 * Shared value colours for the compact issue-drawer headers (CVSS / priority /
 * status). Uses the app's semantic risk palette so the meta values read at a
 * glance. Keyword-based so it tolerates the various strings the scanners and
 * the API emit (urgent/high, false_positive/resolved, …).
 */

const NEUTRAL = "text-gray-700 dark:text-gray-300";

/** Colour a CVSS-style numeric score by band. */
export const cvssScoreColorClass = (score: number): string =>
  score >= 9
    ? "text-critical-risk"
    : score >= 7
      ? "text-high-risk"
      : score >= 4
        ? "text-medium-risk"
        : "text-low-risk";

/** Colour a priority value (urgent/important/normal/low and variants). */
export const priorityColorClass = (priority?: string | null): string => {
  const v = (priority || "").toLowerCase();
  if (v.includes("urgent") || v.includes("critical")) return "text-critical-risk";
  if (v.includes("import") || v.includes("high")) return "text-high-risk";
  if (v.includes("normal") || v.includes("medium") || v.includes("moderate")) return "text-medium-risk";
  if (v.includes("low")) return "text-low-risk";
  return NEUTRAL;
};

/** Colour a vulnerability status (to_verify/confirmed/false_positive/…). */
export const statusColorClass = (status?: string | null): string => {
  const v = (status || "").toLowerCase();
  if (v.includes("false") || v.includes("resolved") || v.includes("fixed") || v.includes("not_exploitable"))
    return "text-fixed";
  if (v.includes("confirm") || v.includes("true_positive")) return "text-critical-risk";
  if (v.includes("verify") || v.includes("progress") || v.includes("review") || v.includes("open"))
    return "text-secondary";
  return NEUTRAL;
};
