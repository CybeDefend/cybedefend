import { MYSQL_ONLY_PATTERNS, findMysqlOnlySql } from '../index';

const SRC = [
  'const a = 1;', // 1
  'await q(`UPDATE t SET x = 1 ON DUPLICATE KEY UPDATE x = x`);', // 2
  'await q(`INSERT IGNORE INTO t VALUES (1)`);', // 3
  "await q(`SELECT GET_LOCK('x', 1)`);", // 4
  "await q(`SELECT DATE_FORMAT(d, '%Y')`);", // 5
  'await q(`SELECT DATE_SUB(NOW(), INTERVAL 1 DAY)`);', // 6
  'await q(`SELECT TIMESTAMPDIFF(SECOND, a, b)`);', // 7
  "await q(`SELECT FIND_IN_SET(x, 'a,b')`);", // 8
  "await q(`SELECT JSON_REMOVE(m, '$.k')`);", // 9
  'await q(`SELECT JSON_LENGTH(m)`);', // 10
  'await q(`SELECT ANY_VALUE(x)`);', // 11
  'await q(`SELECT CAST(x AS BINARY)`);', // 12
  'if (x) { await q(`SELECT IF(a, b, c)`); }', // 13
  'await q(`SELECT \\`x\\``);', // 14
  "if (e.code === 'ER_DUP_ENTRY') return;", // 15
  'if (e.errno === 1062) return;', // 16
  '// ON DUPLICATE KEY INSERT IGNORE GET_LOCK DATE_FORMAT in a line comment', // 17
  '/* DATE_SUB TIMESTAMPDIFF FIND_IN_SET', // 18
  ' * JSON_REMOVE JSON_LENGTH ANY_VALUE CAST(x AS BINARY)', // 19
  ' */ const ok = 1;', // 20
  'const url = "https://example.com/a";', // 21 no false positive on //
].join('\n');

describe('findMysqlOnlySql', () => {
  it('exposes the pattern table', () => {
    expect(MYSQL_ONLY_PATTERNS.map((p) => p.name)).toEqual([
      'ON DUPLICATE KEY',
      'INSERT IGNORE',
      'GET_LOCK',
      'DATE_FORMAT',
      'DATE_SUB',
      'TIMESTAMPDIFF',
      'FIND_IN_SET',
      'JSON_REMOVE',
      'JSON_LENGTH',
      'ANY_VALUE',
      'CAST AS BINARY',
      'IF(',
      'escaped backtick',
      'backtick identifier',
      'ER_DUP_ENTRY',
      'errno 1062',
    ]);
  });

  it('finds one sample of each pattern with its line number', () => {
    const hits = findMysqlOnlySql(SRC);
    expect(hits.map((h) => [h.line, h.pattern])).toEqual([
      [2, 'ON DUPLICATE KEY'],
      [3, 'INSERT IGNORE'],
      [4, 'GET_LOCK'],
      [5, 'DATE_FORMAT'],
      [6, 'DATE_SUB'],
      [7, 'TIMESTAMPDIFF'],
      [8, 'FIND_IN_SET'],
      [9, 'JSON_REMOVE'],
      [10, 'JSON_LENGTH'],
      [11, 'ANY_VALUE'],
      [12, 'CAST AS BINARY'],
      [13, 'IF('],
      [14, 'escaped backtick'],
      [15, 'ER_DUP_ENTRY'],
      [16, 'errno 1062'],
    ]);
    expect(hits[0].text).toContain('ON DUPLICATE KEY');
  });

  it('ignores the same words inside comments', () => {
    const hits = findMysqlOnlySql(SRC);
    const lines = hits.map((h) => h.line);
    for (const commentLine of [17, 18, 19, 20, 21]) {
      expect(lines).not.toContain(commentLine);
    }
  });

  it('reports the trimmed source line as text', () => {
    const hits = findMysqlOnlySql('  await q(`SELECT GET_LOCK(1, 2)`);\n');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      line: 1,
      pattern: 'GET_LOCK',
      text: 'await q(`SELECT GET_LOCK(1, 2)`);',
    });
  });

  it('returns no hit on portable SQL', () => {
    const src = [
      'const q = sql`SELECT ${ident("createdAt")} FROM t WHERE id = ${1}`;',
      'const u = upsert("t", { a: 1 }, { conflict: ["a"], update: { a: "excluded" } });',
    ].join('\n');
    expect(findMysqlOnlySql(src)).toEqual([]);
  });
});

describe('the IF( pattern', () => {
  it('does not match NULLIF( nor other names ending in IF', () => {
    expect(findMysqlOnlySql('await q(`SELECT NULLIF(a, b)`);')).toEqual([]);
    expect(findMysqlOnlySql('await q(`SELECT COALESCE(NULLIF (a, 0), 1)`);')).toEqual([]);
  });

  it('still matches a bare IF( after a comma, a parenthesis or a space', () => {
    expect(findMysqlOnlySql('await q(`SELECT x,IF(a, b, c)`);').map((h) => h.pattern)).toEqual(['IF(']);
    expect(findMysqlOnlySql('await q(`SELECT (IF(a, b, c))`);').map((h) => h.pattern)).toEqual(['IF(']);
  });
});

describe('a backtick inside a quoted string', () => {
  // MySQL quotes an identifier with backticks; PostgreSQL reads one as a
  // syntax error. A JavaScript string in quotes holds a backtick without
  // escaping it, so the template-literal pattern alone misses it.
  it('is found in a single-quoted string', () => {
    const hits = findMysqlOnlySql(
      "qb.andWhere(`EXISTS (${sub('`vulnDetection`.`id`')})`);",
    );
    expect(hits.map((h) => h.pattern)).toEqual(['backtick identifier']);
  });

  it('is found in a double-quoted string', () => {
    expect(
      findMysqlOnlySql('const col = "`t`.`createdAt`";').map((h) => h.pattern),
    ).toEqual(['backtick identifier']);
  });

  it('is not reported for quotes around a template literal', () => {
    expect(findMysqlOnlySql("const a = 'x' + `y` + 'z';")).toEqual([]);
    expect(findMysqlOnlySql("const b = `it's ${v}`;")).toEqual([]);
    expect(findMysqlOnlySql("// 'a `b` c' in a comment")).toEqual([]);
  });
});
