/**
 * Finds camelCase SQL identifiers that PostgreSQL would fold to lower case.
 *
 * MySQL resolves a column name whatever its case; PostgreSQL folds an unquoted
 * name to lower case, while the five dual-engine services create their columns
 * quoted (`"organizationId"`). TypeORM's query builder quotes `alias.property`
 * only for an alias it built from an entity (`createQueryBuilder('p')`, a join
 * on a relation or an entity class, `from(Entity, 'x')`): an alias declared
 * inside a raw string (`EXISTS (SELECT 1 FROM t uom WHERE uom.userId …)`), any
 * `.query()` text and an output alias written `x AS fooBar` reach the engine as
 * written, and PostgreSQL folds them to lower case (42703: `column
 * uom.organizationid does not exist`).
 *
 * The scanner is textual, like `findMysqlOnlySql`: it reads every string and
 * template literal that looks like SQL (an upper-case SQL keyword, or a
 * comparison), outside comments, and reports
 * - `alias-column`: `x.fooBar` unquoted, where `x` is not an alias the file
 *   registers on a query builder, or the literal is the text of a `.query()` /
 *   `sql` template (TypeORM rewrites nothing there);
 * - `output-alias`: `… AS fooBar` unquoted (TypeORM never quotes it inside a
 *   string, so the raw row key comes back as `foobar` on PostgreSQL);
 * - `bare-column`: a bare `fooBar` in a `.query()` / `sql` text;
 * - `backtick-identifier`: a MySQL-quoted `` `name` `` inside a quoted string
 *   (PostgreSQL refuses the backtick; inside a template literal it is escaped
 *   and `findMysqlOnlySql` reports it).
 *
 * Quoted identifiers (`"x"`, `` `x` ``), SQL string literals, `:param`
 * placeholders and `${…}` interpolations are skipped: build identifiers with
 * `ident()` (or a service's `q()` / `c()` over it).
 *
 * Its limits: the aliases are collected per file, so a raw alias that a query
 * builder of the same file also registers is not reported; a bare camelCase
 * word inside a builder string is not reported (update and delete builders
 * quote their entity's property names themselves); SQL assembled from pieces
 * that do not look like SQL on their own is not read. The live specs on both
 * engines cover what it cannot see.
 */

export type UnquotedIdentifierKind =
  | 'alias-column'
  | 'output-alias'
  | 'bare-column'
  | 'backtick-identifier';

export interface UnquotedIdentifierHit {
  line: number;
  kind: UnquotedIdentifierKind;
  identifier: string;
  text: string;
}

export interface Literal {
  start: number;
  line: number;
  /** contents without delimiters; a `${…}` is replaced by INTERPOLATION */
  text: string;
  quote: string;
}

export const INTERPOLATION = '\u00a4';

/** The methods whose argument is raw SQL that TypeORM never rewrites. */
const RAW_CALLS = new Set(['query']);
const RAW_TAGS = new Set(['sql']);

export const SQL_KEYWORD =
  /\b(SELECT|FROM|WHERE|JOIN|AND|OR|ON|AS|IN|IS|NOT|NULL|EXISTS|CASE|WHEN|THEN|ELSE|LIKE|ILIKE|BETWEEN|COUNT|SUM|MAX|MIN|AVG|COALESCE|DISTINCT|GROUP BY|ORDER BY|UPDATE|SET|DELETE|INSERT|INTO|VALUES|LIMIT|OFFSET|HAVING|UNION|LOWER|UPPER|DESC|ASC)\b/;
export const SQL_COMPARISON = /[\w"`]\s*(=|<>|!=|<=|>=)\s*(:|\$\d|[\w"`(])/;

function isCamel(name: string): boolean {
  return /^[a-z_][A-Za-z0-9_]*$/.test(name) && /[A-Z]/.test(name);
}

/** Whether the `/` at `at` opens a regular expression, not a division. */
function startsRegex(source: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t' || source[k] === '\n' || source[k] === '\r')) k--;
  if (k < 0) return true;
  const prev = source[k];
  if ('(,=:[!&|?{};+-*%<>~^'.includes(prev)) return true;
  const word = /([A-Za-z_$][\w$]*)$/.exec(source.slice(Math.max(0, k - 20), k + 1));
  return !!word && ['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'yield', 'await'].includes(word[1]);
}

/**
 * Splits the source into comment-free code (`code`, same length, comments and
 * literal contents blanked, newlines kept) and its string / template literals.
 */
export function lex(source: string): { code: string; commentFree: string; literals: Literal[] } {
  const code = source.split('');
  const commentFree = source.split('');
  const literals: Literal[] = [];
  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  const lineAt = (pos: number) => {
    let n = 1;
    for (let k = 0; k < pos; k++) if (source[k] === '\n') n++;
    return n;
  };

  // A stack of open template literals: each entry holds the literal being
  // built and the brace depth of its current `${…}` (−1 while in its text).
  const templates: Array<{ start: number; parts: string[]; braceDepth: number }> = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const top = templates[templates.length - 1];
    if (top && top.braceDepth < 0) {
      // inside a template's text
      const c = source[i];
      if (c === '\\') {
        top.parts.push(source.slice(i, i + 2));
        code[i] = ' ';
        if (source[i + 1] !== '\n') code[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === '`') {
        templates.pop();
        literals.push({ start: top.start, line: lineAt(top.start), text: top.parts.join(''), quote: '`' });
        i += 1;
        continue;
      }
      if (c === '$' && source[i + 1] === '{') {
        top.parts.push(INTERPOLATION);
        top.braceDepth = 0;
        i += 2;
        continue;
      }
      top.parts.push(c);
      if (c !== '\n') code[i] = ' ';
      i += 1;
      continue;
    }
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(code, i, stop);
      blank(commentFree, i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(code, i, stop);
      blank(commentFree, i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && startsRegex(source, i)) {
      // a regular expression literal: its quotes open no string
      let k = i + 1;
      let inClass = false;
      while (k < n && source[k] !== '\n') {
        const ch = source[k];
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        k += 1;
      }
      blank(code, i + 1, k);
      i = k + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      let text = '';
      while (k < n && source[k] !== c && source[k] !== '\n') {
        if (source[k] === '\\') {
          text += source.slice(k, k + 2);
          k += 2;
          continue;
        }
        text += source[k];
        k += 1;
      }
      literals.push({ start: i, line: lineAt(i), text, quote: c });
      blank(code, i + 1, k);
      i = k + 1;
      continue;
    }
    if (c === '`') {
      templates.push({ start: i, parts: [], braceDepth: -1 });
      i += 1;
      continue;
    }
    if (top) {
      if (c === '{') top.braceDepth += 1;
      else if (c === '}') {
        if (top.braceDepth === 0) {
          top.braceDepth = -1;
          i += 1;
          continue;
        }
        top.braceDepth -= 1;
      }
    }
    i += 1;
  }
  return { code: code.join(''), commentFree: commentFree.join(''), literals };
}

/** The aliases the file registers on a query builder from an entity. */
function entityAliases(commentFree: string): Set<string> {
  const aliases = new Set<string>();
  const q = `['"\`]`;
  const patterns = [
    // createQueryBuilder('x') / createQueryBuilder(Entity, 'x')
    new RegExp(`createQueryBuilder\\(\\s*(?:[A-Z][\\w.]*\\s*,\\s*)?${q}(\\w+)${q}`, 'g'),
    // innerJoin('a.relation', 'x') / leftJoinAndSelect(Entity, 'x') / innerJoin(() => Entity, 'x')
    new RegExp(
      `\\.(?:inner|left)Join(?:AndSelect)?\\(\\s*(?:${q}[\\w.]+${q}|[A-Z][\\w.]*|\\(\\)\\s*=>\\s*[A-Z][\\w.]*)\\s*,\\s*${q}(\\w+)${q}`,
      'g',
    ),
    // innerJoinAndMapOne('x.prop', Entity, 'x')
    new RegExp(
      `\\.(?:inner|left)JoinAndMap(?:One|Many)\\(\\s*${q}[\\w.]+${q}\\s*,\\s*(?:${q}[\\w.]+${q}|[A-Z][\\w.]*)\\s*,\\s*${q}(\\w+)${q}`,
      'g',
    ),
    // from(Entity, 'x') / from('table_name', 'x'): TypeORM finds an entity by
    // its table name too
    new RegExp(`\\.from\\(\\s*(?:[A-Z][\\w.]*|${q}[\\w.]+${q})\\s*,\\s*${q}(\\w+)${q}`, 'g'),
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(commentFree)) !== null) aliases.add(m[1]);
  }
  return aliases;
}

/** `query` for `x.query('…')`, `sql` for sql`…`, else the call or null. */
export function contextOf(code: string, start: number): string | null {
  // a tagged template: the identifier right before the backtick
  const tag = /([\w$]+)\s*$/.exec(code.slice(Math.max(0, start - 40), start));
  if (code[start] === '`' && tag && RAW_TAGS.has(tag[1])) return tag[1];
  let depth = 0;
  for (let k = start - 1; k >= 0; k--) {
    const ch = code[k];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      if (depth === 0) {
        const m = /([\w$]+)\s*$/.exec(code.slice(Math.max(0, k - 60), k));
        return m ? m[1] : null;
      }
      depth -= 1;
    } else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) {
      return null;
    }
  }
  return null;
}

/** Removes what is never an unquoted identifier: quoted names, literals, params. */
export function stripNonIdentifiers(text: string): string {
  return text
    .replace(/\\`[^`]*?\\`/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\\"[^"]*?\\"/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/\\'[^']*?\\'/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/::?(?:\.\.\.)?[A-Za-z_]\w*/g, ' ')
    .replace(/\$\d+/g, ' ');
}

export function findUnquotedCamelCaseSql(source: string): UnquotedIdentifierHit[] {
  const { code, commentFree, literals } = lex(source);
  const aliases = entityAliases(commentFree);
  const lines = source.split('\n');
  const hits: UnquotedIdentifierHit[] = [];
  for (const literal of literals) {
    const textWithoutInterpolations = literal.text.split(INTERPOLATION).join(' ');
    if (!SQL_KEYWORD.test(textWithoutInterpolations) && !SQL_COMPARISON.test(textWithoutInterpolations)) {
      continue;
    }
    const context = contextOf(code, literal.start);
    const raw = context !== null && (RAW_CALLS.has(context) || RAW_TAGS.has(context));
    const text = stripNonIdentifiers(literal.text);
    const seen = new Set<string>();
    const report = (kind: UnquotedIdentifierKind, identifier: string, offset: number) => {
      const key = `${kind}:${identifier}`;
      if (seen.has(key)) return;
      seen.add(key);
      const line = literal.line + (literal.text.slice(0, offset).match(/\n/g)?.length ?? 0);
      hits.push({ line, kind, identifier, text: (lines[line - 1] ?? '').trim() });
    };

    if (literal.quote !== '`') {
      const backtick = /`[A-Za-z_]\w*`/.exec(literal.text);
      if (backtick) report('backtick-identifier', backtick[0], backtick.index);
    }

    const dotted = /(^|[^\w.$])([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    const dottedSpans: Array<[number, number]> = [];
    while ((m = dotted.exec(text)) !== null) {
      const at = m.index + m[1].length;
      dottedSpans.push([at, at + m[2].length + 1 + m[3].length]);
      if (!isCamel(m[3])) continue;
      if (!raw && aliases.has(m[2])) continue;
      report('alias-column', `${m[2]}.${m[3]}`, at);
    }

    const asAlias = /\bAS\s+([A-Za-z_]\w*)/g;
    while ((m = asAlias.exec(text)) !== null) {
      if (isCamel(m[1])) report('output-alias', m[1], m.index);
    }

    if (raw) {
      const bare = /(^|[^\w.$@])([a-z_][A-Za-z0-9_]*)(?![\w.]|\s*\()/g;
      while ((m = bare.exec(text)) !== null) {
        const at = m.index + m[1].length;
        if (!isCamel(m[2])) continue;
        if (dottedSpans.some(([a, b]) => at >= a && at < b)) continue;
        report('bare-column', m[2], at);
      }
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
