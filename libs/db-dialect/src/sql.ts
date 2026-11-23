import { Dialect } from './dialect';

/** A rendered statement: `text` uses `?` on MySQL and `$1…$n` on PostgreSQL. */
export interface Sql {
  readonly dialect: Dialect;
  readonly text: string;
  readonly params: unknown[];
  readonly parts: readonly SqlPart[];
}

/** A raw SQL expression written in code (`'s.createdAt'`, `':pattern'`), or a built Sql. Never a value. */
export type SqlExpr = string | Sql;

export type SqlPart = string | { value: unknown } | Sql;

export function isSql(x: unknown): x is Sql {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as Sql).dialect !== undefined &&
    typeof (x as Sql).text === 'string' &&
    Array.isArray((x as Sql).params) &&
    Array.isArray((x as Sql).parts)
  );
}

interface RenderState {
  n: number;
}

function render(dialect: Dialect, parts: readonly SqlPart[], state: RenderState): { text: string; params: unknown[] } {
  let text = '';
  const params: unknown[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part;
    } else if (isSql(part)) {
      // re-render the nested statement with the outer counter, so $n numbering is global
      const sub = render(dialect, part.parts, state);
      text += sub.text;
      params.push(...sub.params);
    } else {
      state.n += 1;
      params.push(part.value);
      text += dialect === 'mysql' ? '?' : `$${state.n}`;
    }
  }
  return { text, params };
}

export function buildSql(dialect: Dialect, parts: readonly SqlPart[]): Sql {
  const { text, params } = render(dialect, parts, { n: 0 });
  return { dialect, text, params, parts };
}

export function sqlTag(dialect: Dialect, strings: TemplateStringsArray, values: readonly unknown[]): Sql {
  const parts: SqlPart[] = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]);
    if (i < values.length) {
      const v = values[i];
      parts.push(isSql(v) ? v : { value: v });
    }
  }
  return buildSql(dialect, parts);
}

const IDENT_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdent(dialect: Dialect, name: string): string {
  const segments = name.split('.');
  for (const segment of segments) {
    if (!IDENT_SEGMENT.test(segment)) {
      throw new Error('DB_DIALECT_INVALID_IDENTIFIER');
    }
  }
  const q = dialect === 'mysql' ? '`' : '"';
  return segments.map((s) => `${q}${s}${q}`).join('.');
}

export function identSql(dialect: Dialect, name: string): Sql {
  return buildSql(dialect, [quoteIdent(dialect, name)]);
}

export function inListSql(dialect: Dialect, values: readonly unknown[]): Sql {
  if (values.length === 0) throw new Error('DB_DIALECT_EMPTY_LIST');
  const parts: SqlPart[] = ['('];
  values.forEach((v, i) => {
    if (i > 0) parts.push(', ');
    parts.push({ value: v });
  });
  parts.push(')');
  return buildSql(dialect, parts);
}

export function paramSql(dialect: Dialect, value: unknown): Sql {
  return buildSql(dialect, [{ value }]);
}

/** A fragment or builder argument: raw SQL text written in code, or a built Sql. */
export function exprPart(expr: SqlExpr): SqlPart {
  return typeof expr === 'string' ? expr : expr;
}

/** A Row cell: a value, or an Sql spliced as an expression. */
export function rowPart(cell: unknown): SqlPart {
  return isSql(cell) ? cell : { value: cell };
}
