/**
 * The "Focus Top 5" entry point must not appear on an empty
 * vulnerability list (a project / list with `total = 0`), where it would only
 * open a blank, misleading modal.
 *
 * This predicate is the single source of truth for that rule, shared by the 6
 * listing pages (SAST / IAC / SCA / Secret / Container / CICD), so the gate
 * stays identical across them instead of being duplicated inline where it
 * could silently drift. Totals can be `undefined`/`null` while the count is
 * still loading — those are treated as "do not offer yet".
 */
export const shouldOfferFocusTop5 = (
  totalIssues: number | null | undefined,
): boolean => typeof totalIssues === 'number' && totalIssues > 0;
