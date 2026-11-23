/**
 * Severity levels a policy rule may name, from the least to the most severe.
 * Findings carry the same levels (in any case). The order is the only one
 * ordered rule operators (gt, gte, lt, lte) may use: comparing the names as
 * strings would sort them alphabetically (CRITICAL < HIGH < LOW < MEDIUM).
 */
export const SEVERITY_LEVELS = [
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/**
 * Normalises a severity name: trimmed and upper-cased. A value that is not a
 * string is returned unchanged so callers can still reject it.
 */
export function normalizeSeverity(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/**
 * Rank of a severity (INFO = 0 … CRITICAL = 4), case-insensitive; undefined
 * for anything that is not one of SEVERITY_LEVELS.
 */
export function severityRank(value: unknown): number | undefined {
  const normalized = normalizeSeverity(value);
  const index = SEVERITY_LEVELS.indexOf(normalized as SeverityLevel);
  return index === -1 ? undefined : index;
}

export function isSeverityLevel(value: unknown): boolean {
  return severityRank(value) !== undefined;
}
