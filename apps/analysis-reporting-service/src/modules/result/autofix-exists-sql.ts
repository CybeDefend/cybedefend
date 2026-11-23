import { currentDialect } from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { rawBool, rawIdent } from 'src/core/db/raw-sql';

/**
 * The raw subqueries the lists, the grouped views and the counts put in an
 * EXISTS to say whether a detection has an autofix. On MySQL the text stays
 * today's; on PostgreSQL the camelCase columns are quoted (they fold to lower
 * case unquoted) and the boolean is compared with a boolean.
 *
 * `detection` is the detection's id as the caller's query names it
 * (`vulnDetection.id`, which the query builder rewrites, or a quoted id).
 */
export function codeAutofixExistsSql(
  detection: string,
  dialect: Dialect = currentDialect(),
): string {
  return `SELECT 1 FROM autofix_records afr WHERE ${rawIdent('afr.detectionId', dialect)} = ${detection}`;
}

/** An SCA autofix record with a fix available for the detection. */
export function scaFixAvailableExistsSql(
  detection: string,
  dialect: Dialect = currentDialect(),
): string {
  return (
    `SELECT 1 FROM sca_autofix_records sar WHERE ${rawIdent('sar.scaVulnerabilityDetectionId', dialect)} = ${detection}` +
    ` AND ${rawIdent('sar.hasFixAvailable', dialect)} = ${rawBool(true, dialect)}`
  );
}
