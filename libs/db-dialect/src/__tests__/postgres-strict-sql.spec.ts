import { findPostgresStrictSql } from '../index';

const kinds = (source: string, booleanColumns?: string[]) =>
  findPostgresStrictSql(source, { booleanColumns }).map(
    (h) => `${h.line} ${h.kind} ${h.construct}`,
  );

describe('findPostgresStrictSql', () => {
  it('reports a DISTINCT ordered by an expression outside its select list', () => {
    // The shape of a paginated branch list (42P10).
    const source = [
      'const pageQb = applyFilters(base())',
      "  .select('DISTINCT scan.branch', 'branch')",
      "  .orderBy('CASE WHEN scan.branch = :def THEN 0 ELSE 1 END', 'ASC')",
      "  .addOrderBy('scan.branch', 'ASC');",
      "await ds.query('SELECT DISTINCT a.x FROM a ORDER BY LOWER(a.x)');",
    ].join('\n');

    expect(kinds(source)).toEqual([
      '3 distinct-order-expression CASE WHEN scan.branch = :def THEN 0 ELSE 1 END',
      '5 distinct-order-expression LOWER(a.x)',
    ]);
  });

  it('accepts a DISTINCT ordered by its column, and a grouped CASE order', () => {
    const source = [
      "qb.select('DISTINCT scan.branch', 'branch').orderBy('scan.branch', 'ASC');",
      "qb.select('scan.branch', 'branch').groupBy('scan.branch')",
      "  .orderBy('CASE WHEN scan.branch = :def THEN 0 ELSE 1 END', 'ASC');",
      "qb.select('COUNT(DISTINCT scan.branch)', 'total');",
      "other.orderBy('CASE WHEN x = 1 THEN 0 ELSE 1 END');",
      'await ds.query(`SELECT DISTINCT d.id FROM d ORDER BY d.id DESC LIMIT ${n}`);',
    ].join('\n');

    expect(kinds(source)).toEqual([]);
  });

  it('reports a boolean column compared with 0 or 1: the named ones, and is/has/…Enabled names', () => {
    // The shape of a report-recipients query.
    const source = [
      'const cond = `(org.member_products = 0',
      '  OR EXISTS (SELECT 1 FROM uom uap WHERE uap.appsec_access = 1))`;',
      "qb.where('scan.isDiffScan = 0 AND p.vibeEnabled <> 1');",
      "qb.where('scan.isDiffScan = :d AND x.attempts = 0 AND org.member_products = FALSE', { d: false });",
    ].join('\n');

    expect(kinds(source, ['member_products', 'appsec_access'])).toEqual([
      '1 boolean-as-integer org.member_products = 0',
      '2 boolean-as-integer uap.appsec_access = 1',
      '3 boolean-as-integer scan.isDiffScan = 0',
      '3 boolean-as-integer p.vibeEnabled <> 1',
    ]);
  });

  it('reports MySQL-only functions and LIMIT offset, count in SQL text', () => {
    const source = [
      "await ds.query('SELECT IFNULL(a.x, 0) FROM a LIMIT 10, 20');",
      "qb.addSelect('GROUP_CONCAT(t.name)', 'names');",
      "await ds.query('SELECT a FROM t LIMIT ?, ?', [o, n]);",
      "const msg = 'IFNULL is not SQL here';",
    ].join('\n');

    expect(kinds(source)).toEqual([
      '1 mysql-function IFNULL(',
      '1 mysql-function LIMIT 10, 20',
      '2 mysql-function GROUP_CONCAT(',
      '3 mysql-function LIMIT ?, ?',
    ]);
  });

  it('reports string concatenation with + or || in SQL text', () => {
    const source = [
      "qb.where(\"t.path LIKE '%' + :q + '%'\");",
      "qb.where(\"CONCAT('%', :q, '%') = t.path OR t.a = 1\");",
      "await ds.query(\"SELECT 'a' || t.name FROM t\");",
      "const label = 'Total: ' + count;",
    ].join('\n');

    expect(kinds(source)).toEqual([
      "1 string-concatenation '%' + :q",
      "3 string-concatenation 'a' || t",
    ]);
  });

  it('ignores comments', () => {
    const source = [
      "// qb.select('DISTINCT a.x').orderBy('LOWER(a.x)')",
      '/* WHERE x.isActive = 1 IFNULL( */',
    ].join('\n');

    expect(kinds(source)).toEqual([]);
  });
});
