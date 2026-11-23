import { currentDialect } from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { enumAsText, rawIdent } from '../../core/db/raw-sql';

/**
 * SQL twin of `resolveEffectiveSeverity` (see severity-from-cvss.ts).
 *
 * Aggregations, filters and sorts must derive the severity band LIVE from the
 * CVSS4 scores — environmental preferred, base as fallback — exactly like the
 * JS read paths (detail mappers, grouped severityBreakdown). The stored
 * `effective_severity` column is NOT trustworthy: paths that update
 * `cvss4_environmental_score` (agent enrichment, context recompute) do not
 * always refresh it, so a row can carry env=8.7 (High) while the column still
 * reads 'critical' (or NULL). Reading the column in SQL therefore shows the
 * stale BASE band; reading the scores live shows the real ENV band.
 *
 * Only when BOTH scores are null does this fall back to the stored
 * `effective_severity`, then the scanner-label `currentSeverity` — mirroring
 * resolveEffectiveSeverity's fallback chain.
 *
 * Both fallback columns are wrapped in `NULLIF(col, '')` because `COALESCE`
 * skips NULL and nothing else: a column written as the EMPTY STRING is a
 * non-null value, so it wins the coalesce and the whole expression evaluates to
 * `''`. That is not a band — DISPLAYABLE_SEVERITIES hides it from every list
 * view, and no `severity=` filter selects it (it is not 'none' either), so the
 * detection becomes unreachable rather than merely unlabelled. Seen in
 * production data: SCA detections carrying `currentSeverity = ''` whose OSV
 * advisory knew the real band all along.
 *
 * Returns a lowercase band literal: 'critical' | 'high' | 'medium' | 'low' |
 * 'none' (or the lowercased stored fallback when no scores exist). The whole
 * expression is parenthesised so callers can drop it inside `IN (...)`,
 * `UPPER(...)`, `GROUP BY`, etc.
 *
 * The columns are quoted on PostgreSQL (`rawIdent`), so the expression also
 * reads them as written inside a raw statement, which the query builder does
 * not rewrite; on MySQL the text is unchanged.
 *
 * @param alias TypeORM query-builder alias of the detection row, e.g. 'vulnDetection'.
 */
export function effectiveSeveritySql(
  alias: string,
  dialect: Dialect = currentDialect(),
): string {
  const col = (name: string) => rawIdent(`${alias}.${name}`, dialect);
  const score = `COALESCE(${col('cvss4_environmental_score')}, ${col('cvss4_base_score')})`;
  return (
    '(CASE ' +
    `WHEN ${score} IS NULL THEN LOWER(COALESCE(NULLIF(${enumAsText(col('effective_severity'), dialect)}, ''), NULLIF(${col('currentSeverity')}, ''))) ` +
    `WHEN ${score} >= 9.0 THEN 'critical' ` +
    `WHEN ${score} >= 7.0 THEN 'high' ` +
    `WHEN ${score} >= 4.0 THEN 'medium' ` +
    `WHEN ${score} > 0.0 THEN 'low' ` +
    "ELSE 'none' END)"
  );
}

/**
 * Band used when `effectiveSeveritySql()` evaluates to NULL — no CVSS score AND
 * both label columns (effective_severity, currentSeverity) NULL or empty. SQL
 * cannot coalesce that away without hiding genuinely unlabelled rows, so the
 * NULL surfaces in `getRawMany()` results and every JS consumer must normalise
 * it. Callers that skip this step crash on the first `.toUpperCase()` /
 * `.localeCompare()` — which is exactly how the project overview started
 * returning 500s. Matches the SQL expression's own `ELSE 'none'` branch.
 */
export const UNLABELLED_SEVERITY = 'none';

/**
 * The severity bands the dashboard can actually display and filter on. A
 * detection whose effective band falls outside this set ('none' from a CVSS
 * score of 0, or a null/empty label) is invisible in every list view, so the
 * per-type tab badges must not count it either (otherwise the badge shows N
 * while the list shows 0). Keep in sync with the dashboard `severityOptions`.
 */
export const DISPLAYABLE_SEVERITIES = [
  'critical',
  'high',
  'medium',
  'low',
] as const;
