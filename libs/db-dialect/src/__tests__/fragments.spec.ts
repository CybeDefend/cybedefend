import { dialectApi } from '../index';

describe('fragments', () => {
  for (const d of ['mysql', 'postgres'] as const) {
    describe(d, () => {
      const a = dialectApi(d);

      it('dateBucket day and month', () => {
        expect(a.dateBucket('s.createdAt', 'day').text).toBe(
          d === 'mysql'
            ? "DATE_FORMAT(s.createdAt, '%Y-%m-%d')"
            : "to_char(s.createdAt, 'YYYY-MM-DD')",
        );
        expect(a.dateBucket('s.createdAt', 'month').text).toBe(
          d === 'mysql'
            ? "DATE_FORMAT(s.createdAt, '%Y-%m')"
            : "to_char(s.createdAt, 'YYYY-MM')",
        );
      });

      it('dateBucket splices an Sql expression', () => {
        const q = a.dateBucket(a.ident('createdAt'), 'day');
        expect(q.text).toBe(
          d === 'mysql'
            ? "DATE_FORMAT(`createdAt`, '%Y-%m-%d')"
            : 'to_char("createdAt", \'YYYY-MM-DD\')',
        );
        expect(q.params).toEqual([]);
      });

      it('nowPrecise', () => {
        expect(a.nowPrecise(0).text).toBe(d === 'mysql' ? 'NOW(0)' : 'CURRENT_TIMESTAMP(0)');
        expect(a.nowPrecise(3).text).toBe(d === 'mysql' ? 'NOW(3)' : 'CURRENT_TIMESTAMP(3)');
        expect(a.nowPrecise(6).text).toBe(d === 'mysql' ? 'NOW(6)' : 'CURRENT_TIMESTAMP(6)');
      });

      it('intervalAgo', () => {
        expect(a.intervalAgo(5, 'day').text).toBe(
          d === 'mysql' ? '(NOW() - INTERVAL 5 DAY)' : "(CURRENT_TIMESTAMP - INTERVAL '5 days')",
        );
        expect(a.intervalAgo(3, 'hour').text).toBe(
          d === 'mysql' ? '(NOW() - INTERVAL 3 HOUR)' : "(CURRENT_TIMESTAMP - INTERVAL '3 hours')",
        );
        expect(a.intervalAgo(10, 'minute').text).toBe(
          d === 'mysql'
            ? '(NOW() - INTERVAL 10 MINUTE)'
            : "(CURRENT_TIMESTAMP - INTERVAL '10 minutes')",
        );
        expect(() => a.intervalAgo(-1, 'day')).toThrow('DB_DIALECT_INVALID_INTERVAL');
        expect(() => a.intervalAgo(1.5, 'day')).toThrow('DB_DIALECT_INVALID_INTERVAL');
        expect(() => a.intervalAgo(Number.NaN, 'hour')).toThrow('DB_DIALECT_INVALID_INTERVAL');
      });

      it('diffDays', () => {
        expect(a.diffDays('a', 'b').text).toBe(
          d === 'mysql'
            ? 'TIMESTAMPDIFF(DAY, a, b)'
            : 'CAST(TRUNC(EXTRACT(EPOCH FROM ((b) - (a))) / 86400) AS integer)',
        );
      });

      it('diffSeconds', () => {
        expect(a.diffSeconds('a', 'b').text).toBe(
          d === 'mysql'
            ? 'TIMESTAMPDIFF(SECOND, a, b)'
            : 'CAST(TRUNC(EXTRACT(EPOCH FROM ((b) - (a)))) AS integer)',
        );
      });

      it('ifThen', () => {
        expect(a.ifThen('c', 'x', 'y').text).toBe(
          d === 'mysql' ? 'IF(c, x, y)' : 'CASE WHEN c THEN x ELSE y END',
        );
      });

      it('jsonArrayLength', () => {
        expect(a.jsonArrayLength('meta').text).toBe(
          d === 'mysql' ? 'JSON_LENGTH(meta)' : 'jsonb_array_length(meta)',
        );
      });

      it('jsonRemoveKey validates the key', () => {
        expect(a.jsonRemoveKey('metadata', 'registryAuth').text).toBe(
          d === 'mysql' ? "JSON_REMOVE(metadata, '$.registryAuth')" : "(metadata - 'registryAuth')",
        );
        expect(() => a.jsonRemoveKey('metadata', "a'b")).toThrow('DB_DIALECT_INVALID_JSON_KEY');
        expect(() => a.jsonRemoveKey('metadata', 'a-b')).toThrow('DB_DIALECT_INVALID_JSON_KEY');
      });

      it('inCsv carries its params', () => {
        const q = a.inCsv('x', a.param('a,b'));
        expect(q.text).toBe(
          d === 'mysql' ? 'FIND_IN_SET(x, ?)' : "(x = ANY(string_to_array($1, ',')))",
        );
        expect(q.params).toEqual(['a,b']);
      });

      it('ilike', () => {
        expect(a.ilike('name', 'p').text).toBe(d === 'mysql' ? 'name LIKE p' : 'name ILIKE p');
      });

      it('caseSensitiveEquals', () => {
        expect(a.caseSensitiveEquals('a', 'b').text).toBe(
          d === 'mysql' ? 'CAST(a AS BINARY) = b' : '(a COLLATE "C") = b',
        );
      });

      it('anyValue', () => {
        expect(a.anyValue('x').text).toBe(d === 'mysql' ? 'ANY_VALUE(x)' : 'MIN(x)');
      });

      it('uuidExpr', () => {
        expect(a.uuidExpr().text).toBe(d === 'mysql' ? 'UUID()' : 'gen_random_uuid()::text');
      });

      it('castInt', () => {
        expect(a.castInt('x').text).toBe(d === 'mysql' ? 'CAST(x AS SIGNED)' : 'CAST(x AS integer)');
      });
    });
  }
});
