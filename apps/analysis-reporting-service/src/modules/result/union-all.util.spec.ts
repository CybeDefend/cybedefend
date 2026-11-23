import { unionAll } from './union-all.util';

const part = (sql: string, params: unknown[]) => ({
  getQueryAndParameters: (): [string, unknown[]] => [sql, params],
});

describe('unionAll', () => {
  it('wraps each part in parentheses and joins them with UNION ALL', () => {
    const [sql] = unionAll([
      part('SELECT 1 FROM a WHERE x = ?', [1]),
      part('SELECT 2 FROM b WHERE y IN (?, ?)', ['p', 'q']),
    ]);

    expect(sql).toBe(
      '(SELECT 1 FROM a WHERE x = ?) UNION ALL (SELECT 2 FROM b WHERE y IN (?, ?))',
    );
  });

  it('concatenates the positional parameters in placeholder order', () => {
    const [sql, params] = unionAll([
      part('SELECT ? , ?', ['a', 'b']),
      part('SELECT ?', ['c']),
      part('SELECT 1', []),
      part('SELECT ?', ['d']),
    ]);

    expect(params).toEqual(['a', 'b', 'c', 'd']);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
  });

  it('refuses an empty list rather than emit an empty query', () => {
    expect(() => unionAll([])).toThrow();
  });

  it("renumbers each part's $n placeholders after the parts before it on PostgreSQL", () => {
    const [sql, params] = unionAll(
      [
        part('SELECT 1 FROM a WHERE x = $1 AND y IN ($2, $3)', [1, 2, 3]),
        part('SELECT 2 FROM b', []),
        part('SELECT 3 FROM c WHERE z = $1 OR w = $2', [4, 5]),
      ],
      'postgres',
    );

    expect(sql).toBe(
      '(SELECT 1 FROM a WHERE x = $1 AND y IN ($2, $3)) UNION ALL (SELECT 2 FROM b) UNION ALL (SELECT 3 FROM c WHERE z = $4 OR w = $5)',
    );
    expect(params).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves MySQL placeholders as they are', () => {
    const [sql] = unionAll(
      [part('SELECT ?', [1]), part('SELECT ?', [2])],
      'mysql',
    );
    expect(sql).toBe('(SELECT ?) UNION ALL (SELECT ?)');
  });
});
