import { dialectApi } from '@cybedefend/db-dialect';
import {
  enumAsText,
  joinSql,
  rawBool,
  rawIdent,
  rawSql,
  sumExists,
} from './raw-sql';

describe('rawIdent', () => {
  it("keeps today's unquoted text on MySQL", () => {
    expect(rawIdent('s.projectId', 'mysql')).toBe('s.projectId');
    expect(rawIdent('vulnType', 'mysql')).toBe('vulnType');
  });

  it('quotes every segment on PostgreSQL, where camelCase folds', () => {
    expect(rawIdent('s.projectId', 'postgres')).toBe('"s"."projectId"');
    expect(rawIdent('vulnType', 'postgres')).toBe('"vulnType"');
  });

  it('refuses a name that is not an identifier, on both engines', () => {
    expect(() => rawIdent('a; DROP', 'mysql')).toThrow(
      'DB_DIALECT_INVALID_IDENTIFIER',
    );
    expect(() => rawIdent('a"b', 'postgres')).toThrow(
      'DB_DIALECT_INVALID_IDENTIFIER',
    );
  });
});

describe('rawSql and joinSql', () => {
  it('splice code text with no parameter', () => {
    const q = rawSql('COUNT(*) as cnt', 'postgres');
    expect(q.text).toBe('COUNT(*) as cnt');
    expect(q.params).toEqual([]);
  });

  it('join parts and number their parameters in order on PostgreSQL', () => {
    const pg = dialectApi('postgres');
    const joined = joinSql(
      [
        pg.sql`a IN ${pg.inList([1, 2])}`,
        pg.sql`b = ${3}`,
        rawSql('c IS NULL', 'postgres'),
      ],
      ' AND ',
      'postgres',
    );
    expect(joined.text).toBe('a IN ($1, $2) AND b = $3 AND c IS NULL');
    expect(joined.params).toEqual([1, 2, 3]);
    const outer = pg.sql`SELECT x FROM t WHERE ${joined} AND d = ${4}`;
    expect(outer.text).toBe(
      'SELECT x FROM t WHERE a IN ($1, $2) AND b = $3 AND c IS NULL AND d = $4',
    );
    expect(outer.params).toEqual([1, 2, 3, 4]);
  });

  it('give the same text with ? on MySQL', () => {
    const my = dialectApi('mysql');
    const joined = joinSql(
      [my.sql`a IN ${my.inList([1, 2])}`, my.sql`b = ${3}`],
      ' UNION ALL ',
      'mysql',
    );
    expect(joined.text).toBe('a IN (?, ?) UNION ALL b = ?');
    expect(joined.params).toEqual([1, 2, 3]);
  });

  it('join one part as itself and no part as nothing', () => {
    const pg = dialectApi('postgres');
    expect(joinSql([pg.sql`b = ${3}`], ' AND ', 'postgres').text).toBe(
      'b = $1',
    );
    expect(joinSql([], ' AND ', 'postgres').text).toBe('');
  });
});

describe('enumAsText', () => {
  it('is the expression itself on MySQL, whose ENUM compares as a string', () => {
    expect(enumAsText('vd.effective_severity', 'mysql')).toBe(
      'vd.effective_severity',
    );
  });

  it('casts to text on PostgreSQL, where an enum refuses a value outside it', () => {
    expect(enumAsText('"vd"."effective_severity"', 'postgres')).toBe(
      'CAST("vd"."effective_severity" AS text)',
    );
  });
});

describe('rawBool', () => {
  it("keeps today's 1 / 0 on MySQL, whose boolean is a TINYINT(1)", () => {
    expect(rawBool(true, 'mysql')).toBe('1');
    expect(rawBool(false, 'mysql')).toBe('0');
  });

  it('is a boolean literal on PostgreSQL, where boolean = integer fails', () => {
    expect(rawBool(true, 'postgres')).toBe('true');
    expect(rawBool(false, 'postgres')).toBe('false');
  });
});

describe('sumExists', () => {
  it("keeps today's SUM(EXISTS (...)) on MySQL", () => {
    expect(sumExists('SELECT 1 FROM t', 'mysql')).toBe(
      'SUM(EXISTS (SELECT 1 FROM t))',
    );
  });

  it('counts through a CASE on PostgreSQL, which has no SUM(boolean)', () => {
    expect(sumExists('SELECT 1 FROM t', 'postgres')).toBe(
      'SUM(CASE WHEN EXISTS (SELECT 1 FROM t) THEN 1 ELSE 0 END)',
    );
  });
});
