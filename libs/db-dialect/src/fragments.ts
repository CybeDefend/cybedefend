import { Dialect } from './dialect';
import { Sql, SqlExpr, SqlPart, buildSql, exprPart } from './sql';

function frag(dialect: Dialect, parts: readonly SqlPart[]): Sql {
  return buildSql(dialect, parts);
}

export function dateBucketFor(dialect: Dialect, expr: SqlExpr, unit: 'day' | 'month'): Sql {
  const e = exprPart(expr);
  if (dialect === 'mysql') {
    return frag(dialect, ['DATE_FORMAT(', e, unit === 'day' ? ", '%Y-%m-%d')" : ", '%Y-%m')"]);
  }
  return frag(dialect, ['to_char(', e, unit === 'day' ? ", 'YYYY-MM-DD')" : ", 'YYYY-MM')"]);
}

export function nowPreciseFor(dialect: Dialect, p: 0 | 3 | 6): Sql {
  return frag(dialect, [dialect === 'mysql' ? `NOW(${p})` : `CURRENT_TIMESTAMP(${p})`]);
}

const INTERVAL_UNITS = { day: 'DAY', hour: 'HOUR', minute: 'MINUTE' } as const;
const PG_INTERVAL_UNITS = { day: 'days', hour: 'hours', minute: 'minutes' } as const;

export function intervalAgoFor(
  dialect: Dialect,
  n: number,
  unit: 'day' | 'hour' | 'minute',
): Sql {
  if (!Number.isInteger(n) || n < 0) throw new Error('DB_DIALECT_INVALID_INTERVAL');
  if (dialect === 'mysql') {
    return frag(dialect, [`(NOW() - INTERVAL ${n} ${INTERVAL_UNITS[unit]})`]);
  }
  return frag(dialect, [
    `(CURRENT_TIMESTAMP - INTERVAL '${n} ${PG_INTERVAL_UNITS[unit]}')`,
  ]);
}

export function diffDaysFor(dialect: Dialect, a: SqlExpr, b: SqlExpr): Sql {
  const ea = exprPart(a);
  const eb = exprPart(b);
  if (dialect === 'mysql') return frag(dialect, ['TIMESTAMPDIFF(DAY, ', ea, ', ', eb, ')']);
  return frag(dialect, [
    'CAST(TRUNC(EXTRACT(EPOCH FROM ((',
    eb,
    ') - (',
    ea,
    '))) / 86400) AS integer)',
  ]);
}

export function diffSecondsFor(dialect: Dialect, a: SqlExpr, b: SqlExpr): Sql {
  const ea = exprPart(a);
  const eb = exprPart(b);
  if (dialect === 'mysql') return frag(dialect, ['TIMESTAMPDIFF(SECOND, ', ea, ', ', eb, ')']);
  return frag(dialect, [
    'CAST(TRUNC(EXTRACT(EPOCH FROM ((',
    eb,
    ') - (',
    ea,
    ')))) AS integer)',
  ]);
}

export function ifThenFor(dialect: Dialect, c: SqlExpr, a: SqlExpr, b: SqlExpr): Sql {
  const ec = exprPart(c);
  const ea = exprPart(a);
  const eb = exprPart(b);
  if (dialect === 'mysql') return frag(dialect, ['IF(', ec, ', ', ea, ', ', eb, ')']);
  return frag(dialect, ['CASE WHEN ', ec, ' THEN ', ea, ' ELSE ', eb, ' END']);
}

export function jsonArrayLengthFor(dialect: Dialect, expr: SqlExpr): Sql {
  const e = exprPart(expr);
  return frag(dialect, [dialect === 'mysql' ? 'JSON_LENGTH(' : 'jsonb_array_length(', e, ')']);
}

const JSON_KEY = /^[A-Za-z0-9_]+$/;

export function jsonRemoveKeyFor(dialect: Dialect, expr: SqlExpr, key: string): Sql {
  if (!JSON_KEY.test(key)) throw new Error('DB_DIALECT_INVALID_JSON_KEY');
  const e = exprPart(expr);
  if (dialect === 'mysql') return frag(dialect, ['JSON_REMOVE(', e, `, '$.${key}')`]);
  return frag(dialect, ['(', e, ` - '${key}')`]);
}

export function inCsvFor(dialect: Dialect, expr: SqlExpr, csv: SqlExpr): Sql {
  const e = exprPart(expr);
  const c = exprPart(csv);
  if (dialect === 'mysql') return frag(dialect, ['FIND_IN_SET(', e, ', ', c, ')']);
  return frag(dialect, ['(', e, ' = ANY(string_to_array(', c, ", ',')))"]);
}

export function ilikeFor(dialect: Dialect, expr: SqlExpr, pattern: SqlExpr): Sql {
  const e = exprPart(expr);
  const p = exprPart(pattern);
  return frag(dialect, [e, dialect === 'mysql' ? ' LIKE ' : ' ILIKE ', p]);
}

export function caseSensitiveEqualsFor(dialect: Dialect, a: SqlExpr, b: SqlExpr): Sql {
  const ea = exprPart(a);
  const eb = exprPart(b);
  if (dialect === 'mysql') return frag(dialect, ['CAST(', ea, ' AS BINARY) = ', eb]);
  return frag(dialect, ['(', ea, ' COLLATE "C") = ', eb]);
}

export function anyValueFor(dialect: Dialect, expr: SqlExpr): Sql {
  const e = exprPart(expr);
  return frag(dialect, [dialect === 'mysql' ? 'ANY_VALUE(' : 'MIN(', e, ')']);
}

export function uuidExprFor(dialect: Dialect): Sql {
  return frag(dialect, [dialect === 'mysql' ? 'UUID()' : 'gen_random_uuid()::text']);
}

export function castIntFor(dialect: Dialect, expr: SqlExpr): Sql {
  const e = exprPart(expr);
  return frag(dialect, ['CAST(', e, dialect === 'mysql' ? ' AS SIGNED)' : ' AS integer)']);
}
