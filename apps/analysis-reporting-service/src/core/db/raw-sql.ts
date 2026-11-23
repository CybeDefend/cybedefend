import { currentDialect, dialectApi } from '@cybedefend/db-dialect';
import type { Dialect, Sql } from '@cybedefend/db-dialect';

/**
 * A column or alias written into a raw statement (one the query builder does
 * not rewrite). On MySQL it is left as written: MySQL matches column names
 * case-insensitively, and the statement the cloud sends stays today's. On
 * PostgreSQL it goes through `ident`, since an unquoted camelCase name
 * (`projectId`, `as vulnType`) folds to lower case there. The name is checked
 * on both engines.
 */
export function rawIdent(
  name: string,
  dialect: Dialect = currentDialect(),
): string {
  const quoted = dialectApi(dialect).ident(name).text;
  return dialect === 'mysql' ? name : quoted;
}

function template(strings: readonly string[]): TemplateStringsArray {
  return Object.assign([...strings], { raw: [...strings] });
}

/** SQL text written in code (never a value), to splice into `sql`. */
export function rawSql(text: string, dialect: Dialect = currentDialect()): Sql {
  return dialectApi(dialect).sql(template([text]));
}

/** `parts` joined by `separator`, their parameters numbered in order. */
export function joinSql(
  parts: readonly Sql[],
  separator: string,
  dialect: Dialect = currentDialect(),
): Sql {
  if (parts.length === 0) return rawSql('', dialect);
  const strings = ['', ...parts.slice(1).map(() => separator), ''];
  return dialectApi(dialect).sql(template(strings), ...parts);
}

/**
 * An enum column read as a string in a raw expression. A MySQL ENUM already
 * compares as a string (the text stays today's); a PostgreSQL enum refuses a
 * literal outside its values (`NULLIF(col, '')` fails with 22P02), so it is
 * cast to text there.
 */
export function enumAsText(
  expr: string,
  dialect: Dialect = currentDialect(),
): string {
  return dialect === 'mysql' ? expr : `CAST(${expr} AS text)`;
}

/**
 * A boolean literal compared with a boolean column in a raw expression. MySQL
 * stores it as TINYINT(1) (the text stays today's `1` / `0`); PostgreSQL
 * refuses `boolean = integer`.
 */
export function rawBool(
  value: boolean,
  dialect: Dialect = currentDialect(),
): string {
  if (dialect === 'mysql') return value ? '1' : '0';
  return value ? 'true' : 'false';
}

/**
 * The number of rows for which `subquery` returns a row. MySQL sums the
 * EXISTS (0 or 1; the text stays today's); PostgreSQL has no SUM(boolean).
 */
export function sumExists(
  subquery: string,
  dialect: Dialect = currentDialect(),
): string {
  return dialect === 'mysql'
    ? `SUM(EXISTS (${subquery}))`
    : `SUM(CASE WHEN EXISTS (${subquery}) THEN 1 ELSE 0 END)`;
}
