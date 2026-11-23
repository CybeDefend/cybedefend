import { currentDialect } from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';

/**
 * Several TypeORM SELECTs sent as ONE round-trip:
 * `(q1) UNION ALL (q2) ...`, their positional parameters concatenated in
 * placeholder order. Each part keeps its own aliases and filters; only the
 * selected columns must line up (same count, same meaning, same order).
 *
 * A part's ORDER BY is meaningless inside a UNION (MySQL drops it): order the
 * union as a whole, or sort the rows in JS.
 */
export function unionAll(
  parts: ReadonlyArray<{ getQueryAndParameters(): [string, unknown[]] }>,
  dialect: Dialect = currentDialect(),
): [string, unknown[]] {
  if (parts.length === 0) {
    throw new Error('unionAll needs at least one query');
  }
  const queries: string[] = [];
  const parameters: unknown[] = [];
  for (const part of parts) {
    const [sql, params] = part.getQueryAndParameters();
    // PostgreSQL numbers each part's placeholders from $1: shift them past the
    // parameters of the parts before it. The builders' text holds no other
    // `$<digits>` (no string literal of theirs carries one).
    const offset = parameters.length;
    const text =
      dialect === 'postgres' && offset > 0
        ? sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`)
        : sql;
    queries.push(`(${text})`);
    parameters.push(...params);
  }
  return [queries.join(' UNION ALL '), parameters];
}
