/**
 * Resolves a BullMQ processor concurrency value from an environment variable.
 *
 * Rules:
 * - `envValue` undefined or empty string → return `fallback`
 * - `envValue` not a strict base-10 integer (e.g. "2.5", "3abc") → return `fallback`
 * - Parsed value ≤ 0 → return `fallback`
 * - Otherwise → return the parsed value
 */
export function resolveConcurrency(
  envValue: string | undefined,
  fallback: number,
): number {
  if (!envValue) return fallback;
  // Strict integer only — reject floats/suffixed strings that parseInt would
  // silently coerce ("2.5" → 2, "3abc" → 3).
  if (!/^\d+$/.test(envValue.trim())) return fallback;
  const parsed = parseInt(envValue.trim(), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}
