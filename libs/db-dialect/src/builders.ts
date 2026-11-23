import { Dialect } from './dialect';
import { Sql, SqlPart, buildSql, exprPart, quoteIdent, rowPart } from './sql';

export type Row = Record<string, unknown>;

function normalizeRows(rows: Row | Row[]): Row[] {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) throw new Error('DB_DIALECT_ROW_SHAPE');
  const keys = Object.keys(list[0]);
  for (const row of list) {
    const ks = Object.keys(row);
    if (ks.length !== keys.length || !ks.every((k) => keys.indexOf(k) !== -1)) {
      throw new Error('DB_DIALECT_ROW_SHAPE');
    }
  }
  return list;
}

function insertParts(dialect: Dialect, table: string, list: Row[]): SqlPart[] {
  const q = (s: string) => quoteIdent(dialect, s);
  const keys = Object.keys(list[0]);
  const parts: SqlPart[] = ['INSERT INTO ', q(table), ' (', keys.map((k) => q(k)).join(', '), ') VALUES '];
  list.forEach((row, i) => {
    if (i > 0) parts.push(', ');
    parts.push('(');
    keys.forEach((k, j) => {
      if (j > 0) parts.push(', ');
      parts.push(rowPart(row[k]));
    });
    parts.push(')');
  });
  return parts;
}

export function upsertFor(
  dialect: Dialect,
  table: string,
  rows: Row | Row[],
  opts: { conflict: string[]; update: Record<string, 'excluded' | Sql | string> },
): Sql {
  const list = normalizeRows(rows);
  if (!opts.conflict || opts.conflict.length === 0) throw new Error('DB_DIALECT_CONFLICT_REQUIRED');
  const q = (s: string) => quoteIdent(dialect, s);
  const parts: SqlPart[] = insertParts(dialect, table, list);
  const updates = Object.entries(opts.update);
  if (dialect === 'mysql') {
    parts.push(' ON DUPLICATE KEY UPDATE ');
    updates.forEach(([k, v], i) => {
      if (i > 0) parts.push(', ');
      parts.push(q(k), ' = ');
      parts.push(v === 'excluded' ? `VALUES(${q(k)})` : exprPart(v));
    });
  } else {
    parts.push(
      ' ON CONFLICT (',
      opts.conflict.map((c) => q(c)).join(', '),
      ') DO UPDATE SET ',
    );
    updates.forEach(([k, v], i) => {
      if (i > 0) parts.push(', ');
      parts.push(q(k), ' = ');
      parts.push(v === 'excluded' ? `EXCLUDED.${q(k)}` : exprPart(v));
    });
  }
  return buildSql(dialect, parts);
}

export function insertIgnoreFor(
  dialect: Dialect,
  table: string,
  rows: Row | Row[],
  conflict?: string[],
): Sql {
  const list = normalizeRows(rows);
  const q = (s: string) => quoteIdent(dialect, s);
  // insertParts starts with 'INSERT INTO '; on MySQL the keyword is INSERT IGNORE
  const body = insertParts(dialect, table, list).slice(1);
  if (dialect === 'mysql') {
    return buildSql(dialect, ['INSERT IGNORE INTO ', ...body]);
  }
  const parts: SqlPart[] = ['INSERT INTO ', ...body];
  if (conflict && conflict.length > 0) {
    parts.push(' ON CONFLICT (', conflict.map((c) => q(c)).join(', '), ') DO NOTHING');
  } else {
    parts.push(' ON CONFLICT DO NOTHING');
  }
  return buildSql(dialect, parts);
}

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('DB_DIALECT_INVALID_LIMIT');
}

export function deleteBatchFor(dialect: Dialect, table: string, where: Sql, limit: number): Sql {
  checkLimit(limit);
  const q = quoteIdent(dialect, table);
  if (dialect === 'mysql') {
    return buildSql(dialect, ['DELETE FROM ', q, ' WHERE ', where, ' LIMIT ', { value: limit }]);
  }
  return buildSql(dialect, [
    'DELETE FROM ',
    q,
    ' WHERE ctid IN (SELECT ctid FROM ',
    q,
    ' WHERE ',
    where,
    ' LIMIT ',
    { value: limit },
    ')',
  ]);
}

function setParts(dialect: Dialect, set: Row, alias?: string): SqlPart[] {
  const q = (s: string) => quoteIdent(dialect, s);
  const parts: SqlPart[] = [];
  Object.entries(set).forEach(([k, v], i) => {
    if (i > 0) parts.push(', ');
    parts.push(alias !== undefined ? `${q(alias)}.${q(k)}` : q(k), ' = ', rowPart(v));
  });
  return parts;
}

export function updateBatchFor(
  dialect: Dialect,
  table: string,
  set: Row,
  where: Sql,
  limit: number,
): Sql {
  checkLimit(limit);
  const q = quoteIdent(dialect, table);
  if (dialect === 'mysql') {
    return buildSql(dialect, [
      'UPDATE ',
      q,
      ' SET ',
      ...setParts(dialect, set),
      ' WHERE ',
      where,
      ' LIMIT ',
      { value: limit },
    ]);
  }
  return buildSql(dialect, [
    'UPDATE ',
    q,
    ' SET ',
    ...setParts(dialect, set),
    ' WHERE ctid IN (SELECT ctid FROM ',
    q,
    ' WHERE ',
    where,
    ' LIMIT ',
    { value: limit },
    ')',
  ]);
}

export function updateJoinFor(
  dialect: Dialect,
  q: {
    table: string;
    alias: string;
    join: { table: string; alias: string; on: Sql };
    set: Row;
    where: Sql;
  },
): Sql {
  const qt = quoteIdent(dialect, q.table);
  const qa = quoteIdent(dialect, q.alias);
  const jt = quoteIdent(dialect, q.join.table);
  const ja = quoteIdent(dialect, q.join.alias);
  if (dialect === 'mysql') {
    return buildSql(dialect, [
      'UPDATE ',
      qt,
      ' ',
      qa,
      ' INNER JOIN ',
      jt,
      ' ',
      ja,
      ' ON ',
      q.join.on,
      ' SET ',
      ...setParts(dialect, q.set, q.alias),
      ' WHERE ',
      q.where,
    ]);
  }
  return buildSql(dialect, [
    'UPDATE ',
    qt,
    ' AS ',
    qa,
    ' SET ',
    ...setParts(dialect, q.set),
    ' FROM ',
    jt,
    ' AS ',
    ja,
    ' WHERE ',
    q.join.on,
    ' AND ',
    q.where,
  ]);
}
