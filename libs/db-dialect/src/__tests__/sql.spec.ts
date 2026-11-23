import { dialectApi } from '../index';

describe('sql', () => {
  for (const d of ['mysql', 'postgres'] as const) {
    describe(d, () => {
      const a = dialectApi(d);

      it('makes every value a parameter', () => {
        const q = a.sql`SELECT * FROM t WHERE id = ${'x'} AND n > ${2}`;
        expect(q.text).toBe(
          d === 'mysql'
            ? 'SELECT * FROM t WHERE id = ? AND n > ?'
            : 'SELECT * FROM t WHERE id = $1 AND n > $2',
        );
        expect(q.params).toEqual(['x', 2]);
        expect(q.dialect).toBe(d);
      });

      it('quotes identifiers, dotted ones per segment', () => {
        const q = a.sql`SELECT ${a.ident('s.createdAt')} AS ${a.ident('createdAt')}`;
        expect(q.text).toBe(
          d === 'mysql'
            ? 'SELECT `s`.`createdAt` AS `createdAt`'
            : 'SELECT "s"."createdAt" AS "createdAt"',
        );
        expect(q.params).toEqual([]);
        expect(() => a.ident('x"; DROP')).toThrow('DB_DIALECT_INVALID_IDENTIFIER');
        expect(() => a.ident('a b')).toThrow('DB_DIALECT_INVALID_IDENTIFIER');
        expect(() => a.ident('1x')).toThrow('DB_DIALECT_INVALID_IDENTIFIER');
        expect(() => a.ident('a..b')).toThrow('DB_DIALECT_INVALID_IDENTIFIER');
      });

      it('expands a list and refuses an empty one', () => {
        const q = a.sql`id IN ${a.inList(['a', 'b'])}`;
        expect(q.text).toBe(d === 'mysql' ? 'id IN (?, ?)' : 'id IN ($1, $2)');
        expect(q.params).toEqual(['a', 'b']);
        const one = a.sql`id IN ${a.inList(['a'])}`;
        expect(one.text).toBe(d === 'mysql' ? 'id IN (?)' : 'id IN ($1)');
        expect(() => a.inList([])).toThrow('DB_DIALECT_EMPTY_LIST');
      });

      it('renumbers spliced fragments', () => {
        const q = a.sql`${a.ilike('name', a.param('%x%'))} AND id = ${'7'}`;
        expect(q.text).toBe(
          d === 'mysql' ? 'name LIKE ? AND id = ?' : 'name ILIKE $1 AND id = $2',
        );
        expect(q.params).toEqual(['%x%', '7']);
      });

      it('renumbers a spliced list inside a bigger statement', () => {
        const q = a.sql`SELECT * FROM t WHERE id IN ${a.inList([1, 2])} OR x = ${3}`;
        expect(q.text).toBe(
          d === 'mysql'
            ? 'SELECT * FROM t WHERE id IN (?, ?) OR x = ?'
            : 'SELECT * FROM t WHERE id IN ($1, $2) OR x = $3',
        );
        expect(q.params).toEqual([1, 2, 3]);
      });

      it('param passes one value where an expression is expected', () => {
        const q = a.sql`SELECT ${a.param(42)}`;
        expect(q.text).toBe(d === 'mysql' ? 'SELECT ?' : 'SELECT $1');
        expect(q.params).toEqual([42]);
      });
    });
  }
});
