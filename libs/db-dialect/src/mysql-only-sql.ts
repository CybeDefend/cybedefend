export interface MysqlOnlyHit {
  line: number;
  pattern: string;
  text: string;
}

/**
 * The MySQL-only constructs a service's `no-mysql-only-sql.spec.ts` fails on.
 * `IF(` is upper case on purpose, so prose « if (…) » does not match, and
 * starts at a word boundary, so `NULLIF(` does not match either; the
 * escaped-backtick pattern only matches an escaped backtick inside a template
 * literal, never the template delimiters themselves. A quoted string holds a
 * backtick without escaping it, so the identifier pattern also matches a
 * backtick-quoted qualified name (`alias`.`column`) wherever it is written.
 */
export const MYSQL_ONLY_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'ON DUPLICATE KEY', re: /ON DUPLICATE KEY/ },
  { name: 'INSERT IGNORE', re: /INSERT IGNORE/ },
  { name: 'GET_LOCK', re: /GET_LOCK/ },
  { name: 'DATE_FORMAT', re: /DATE_FORMAT/ },
  { name: 'DATE_SUB', re: /DATE_SUB/ },
  { name: 'TIMESTAMPDIFF', re: /TIMESTAMPDIFF/ },
  { name: 'FIND_IN_SET', re: /FIND_IN_SET/ },
  { name: 'JSON_REMOVE', re: /JSON_REMOVE/ },
  { name: 'JSON_LENGTH', re: /JSON_LENGTH/ },
  { name: 'ANY_VALUE', re: /ANY_VALUE/ },
  { name: 'CAST AS BINARY', re: /CAST\s*\([^)]*AS\s+BINARY\s*\)/i },
  { name: 'IF(', re: /\bIF\s*\(/ },
  { name: 'escaped backtick', re: /\\`/ },
  { name: 'backtick identifier', re: /`[A-Za-z_][\w$]*`\s*\.\s*`[A-Za-z_][\w$]*`/ },
  { name: 'ER_DUP_ENTRY', re: /ER_DUP_ENTRY/ },
  { name: 'errno 1062', re: /errno\s*===?\s*1062/ },
];

/**
 * Scans source code line by line and reports every MySQL-only pattern found in
 * code, with its 1-based line number. Words inside `//`, `/* … *​/` comments
 * (including ` * ` continuation lines) are ignored; string and template
 * contents are scanned, which is where SQL lives.
 */
export function findMysqlOnlySql(source: string): MysqlOnlyHit[] {
  const hits: MysqlOnlyHit[] = [];
  const lines = source.split('\n');
  let inBlockComment = false;
  let inTemplate = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let code = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const next = line[i + 1];
      if (inBlockComment) {
        if (c === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (inTemplate) {
        code += c;
        if (c === '\\') {
          code += next ?? '';
          i += 2;
          continue;
        }
        if (c === '`') inTemplate = false;
        i += 1;
        continue;
      }
      if (c === '/' && next === '/') break;
      if (c === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (c === '`') {
        inTemplate = true;
        code += c;
        i += 1;
        continue;
      }
      if (c === "'" || c === '"') {
        const quote = c;
        code += c;
        i += 1;
        while (i < line.length) {
          const ch = line[i];
          code += ch;
          if (ch === '\\') {
            code += line[i + 1] ?? '';
            i += 2;
            continue;
          }
          i += 1;
          if (ch === quote) break;
        }
        continue;
      }
      code += c;
      i += 1;
    }
    for (const { name, re } of MYSQL_ONLY_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(code)) hits.push({ line: li + 1, pattern: name, text: line.trim() });
    }
  }
  return hits;
}
