/** Display rank for the rated severities; lower = higher in the list. */
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
  INFO: 5,
};

/**
 * Orders severity buckets for the distribution cards.
 *
 * Rated severities come first, sorted by count desc with the canonical
 * severity rank as a tie-break. Any UNRATED bucket — chiefly "UNKNOWN", the
 * label the backend gives findings with no CVSS/severity (mostly SCA
 * dependency advisories) — always sinks to the bottom regardless of its count,
 * so a large unknown count can never displace CRITICAL/HIGH from the top.
 *
 * Returns a new array; the input is not mutated.
 */
export function orderSeverities<T extends { severity: string; count: number }>(
  data: T[],
): T[] {
  return [...data].sort((a, b) => {
    const aRank = SEVERITY_RANK[a.severity];
    const bRank = SEVERITY_RANK[b.severity];
    const aUnrated = aRank === undefined;
    const bUnrated = bRank === undefined;

    // Unrated (UNKNOWN, etc.) always after rated, whatever the count.
    if (aUnrated !== bUnrated) return aUnrated ? 1 : -1;

    const countDiff = b.count - a.count;
    if (countDiff !== 0) return countDiff;

    return (aRank ?? 99) - (bRank ?? 99);
  });
}
