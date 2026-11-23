import {
  INTERPOLATION,
  SQL_COMPARISON,
  SQL_KEYWORD,
  lex,
  stripNonIdentifiers,
} from './unquoted-identifiers';

/**
 * Finds SQL that MySQL accepts and PostgreSQL refuses, beyond identifier case
 * (`findUnquotedCamelCaseSql`) and the MySQL-only constructs of
 * `findMysqlOnlySql`. Textual, on the string and template literals that look
 * like SQL, outside comments:
 * - `distinct-order-expression`: a `DISTINCT` select ordered by something
 *   else than a selected column, in one query-builder chain or one raw text
 *   (42P10: « for SELECT DISTINCT, ORDER BY expressions must appear in select
 *   list »);
 * - `boolean-as-integer`: a boolean column compared with 0 or 1 (PostgreSQL
 *   has no `boolean = integer`); boolean columns are the ones the caller
 *   names (`booleanColumns`, read from its entities) and any `isX`, `hasX`,
 *   `canX`, `…Enabled`, `…_enabled`, `…_access` name;
 * - `mysql-function`: `IFNULL(`, `GROUP_CONCAT(`, `LIMIT offset, count`;
 * - `string-concatenation`: `+` or `||` next to a SQL string literal (`+`
 *   adds numbers on both engines, `||` is OR on MySQL): use `CONCAT(`.
 *
 * Not seen, left to the live specs on both engines: a GROUP BY missing a
 * selected column (the select and the group often come from different
 * pieces), and any SQL assembled from pieces that do not look like SQL.
 */

export type PostgresStrictKind =
  | 'distinct-order-expression'
  | 'boolean-as-integer'
  | 'mysql-function'
  | 'string-concatenation';

export interface PostgresStrictHit {
  line: number;
  kind: PostgresStrictKind;
  construct: string;
  text: string;
}

export interface PostgresStrictOptions {
  /** column and property names the caller's entities declare boolean */
  booleanColumns?: Iterable<string>;
}

const BOOLEAN_NAME = /^(is|has|can|should)[A-Z_]\w*$|^\w*(Enabled|_enabled|_access)$/;

/** The first literal argument of each `.<method>(` call in `chain`. */
function firstLiteralArgs(chain: string, methods: string[]): Array<{ method: string; arg: string; at: number }> {
  const out: Array<{ method: string; arg: string; at: number }> = [];
  // cybedefend-ignore[CD-SAST-0434]: the method names are literals of this file; the string body alternatives are disjoint, and the input is the repository's own source
  const re = new RegExp(`\\.(${methods.join('|')})\\(\\s*(['"\`])((?:\\\\.|(?!\\2)[^\\\\])*)\\2`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(chain)) !== null) out.push({ method: m[1], arg: m[3], at: m.index });
  return out;
}

function lineOf(source: string, offset: number): number {
  let n = 1;
  for (let k = 0; k < offset; k++) if (source[k] === '\n') n++;
  return n;
}

export function findPostgresStrictSql(
  source: string,
  options: PostgresStrictOptions = {},
): PostgresStrictHit[] {
  const { commentFree, literals } = lex(source);
  const lines = source.split('\n');
  const booleans = new Set(options.booleanColumns ?? []);
  const hits: PostgresStrictHit[] = [];
  const push = (line: number, kind: PostgresStrictKind, construct: string) =>
    hits.push({ line, kind, construct, text: (lines[line - 1] ?? '').trim() });

  // 1. A DISTINCT select in a query-builder statement (up to its `;`).
  const selectDistinct = /\.(?:select|addSelect)\(\s*(['"`])DISTINCT\s+([^'"`]+?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = selectDistinct.exec(commentFree)) !== null) {
    const end = commentFree.indexOf(';', m.index);
    const chain = commentFree.slice(m.index, end === -1 ? undefined : end);
    const selected = new Set([m[2].trim()]);
    for (const extra of firstLiteralArgs(chain, ['addSelect'])) selected.add(extra.arg.replace(/^DISTINCT\s+/i, '').trim());
    for (const order of firstLiteralArgs(chain, ['orderBy', 'addOrderBy'])) {
      if (!selected.has(order.arg.trim())) push(lineOf(source, m.index + order.at), 'distinct-order-expression', order.arg.trim());
    }
  }

  for (const literal of literals) {
    const plain = literal.text.split(INTERPOLATION).join(' ');
    const lineAt = (offset: number) => literal.line + (literal.text.slice(0, offset).match(/\n/g)?.length ?? 0);
    const text = stripNonIdentifiers(literal.text);

    // 3. MySQL-only functions (unambiguous with their parenthesis, in any
    // literal) and LIMIT offset, count.
    for (const fn of ['IFNULL', 'GROUP_CONCAT']) {
      const at = text.search(new RegExp(`\\b${fn}\\s*\\(`, 'i'));
      if (at >= 0) push(lineAt(at), 'mysql-function', `${fn}(`);
    }
    const limit = /\bLIMIT\s+(\d+|\?|:\w+)\s*,\s*(\d+|\?|:\w+)/i.exec(literal.text);
    if (limit) push(lineAt(limit.index), 'mysql-function', `LIMIT ${limit[1]}, ${limit[2]}`);

    if (!SQL_KEYWORD.test(plain) && !SQL_COMPARISON.test(plain)) continue;

    // 1b. The same in one raw text.
    const raw = /\bSELECT\s+DISTINCT\s+([\s\S]*?)\bFROM\b[\s\S]*?\bORDER\s+BY\s+([^;]+)$/i.exec(plain);
    if (raw) {
      const selected = raw[1].split(',').map((c) => c.trim().split(/\s+AS\s+/i)[0].trim());
      const orderBy = raw[2].replace(/\b(LIMIT|OFFSET|FOR\s+UPDATE)\b[\s\S]*$/i, '');
      for (const item of orderBy.split(/,(?![^(]*\))/)) {
        const expr = item.trim().replace(/\s+(ASC|DESC)(\s+NULLS\s+(FIRST|LAST))?$/i, '').trim();
        if (expr && !selected.includes(expr)) push(lineAt(plain.indexOf(expr)), 'distinct-order-expression', expr);
      }
    }

    // 2. A boolean column compared with 0 or 1.
    const comparison = /(?:\b([A-Za-z_]\w*)\.)?\b([A-Za-z_]\w*)\s*(=|<>|!=)\s*([01])(?![\w.])/g;
    while ((m = comparison.exec(text)) !== null) {
      const column = m[2];
      if (booleans.has(column) || BOOLEAN_NAME.test(column)) {
        push(lineAt(m.index), 'boolean-as-integer', `${m[1] ? `${m[1]}.` : ''}${column} ${m[3]} ${m[4]}`);
      }
    }

    // 4. + or || next to a SQL string literal.
    const concat = /('(?:[^'\\]|\\.)*'\s*(?:\+|\|\|)\s*[:\w]+|[:\w]+\s*(?:\+|\|\|)\s*'(?:[^'\\]|\\.)*')/.exec(literal.text);
    if (concat) push(lineAt(concat.index), 'string-concatenation', concat[1].replace(/\s+/g, ' '));
  }
  return hits.sort((a, b) => a.line - b.line);
}
