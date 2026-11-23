import type { QueryRunner } from 'typeorm';
import type { Dialect } from '../dialect';

/**
 * Schema parity between the frozen MySQL track and the PostgreSQL baseline:
 * both databases are read back from their catalogues,
 * normalised to one vocabulary, and compared table by table. Keys and indexes
 * are compared by their column lists, never by name.
 */

export interface NormalisedColumn {
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface NormalisedTable {
  columns: Record<string, NormalisedColumn>;
  primaryKey: string[];
  uniques: string[][];
  indexes: string[][];
  foreignKeys: Array<{ columns: string[]; refTable: string; refColumns: string[] }>;
}

export type NormalisedSchema = Record<string, NormalisedTable>;

export type ParityAspect =
  | 'table'
  | 'type'
  | 'nullable'
  | 'default'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey';

/** One accepted difference; `table` or `column` may be '*'. */
export interface ParityAllowance {
  table: string;
  column?: string;
  aspect: ParityAspect;
  reason: string;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const NUMERIC_TYPES = /^(int|smallint|bigint|decimal|double)\b/;
const STRING_TYPES = /^(varchar|char|text|citext|enum)\b/;

/**
 * `varchar(n)` ↔ `character varying(n)` → `varchar(n)`; `int` ↔ `integer` →
 * `int`; `datetime(p)` / `timestamp(p)` ↔ `timestamp(p) without time zone` →
 * `timestamp(p)` (MySQL defaults to 0 digits, PostgreSQL to 6); `text`,
 * `longtext`, `mediumtext` → `text`; `tinyint(1)` ↔ `boolean` → `boolean`;
 * `tinyint` ↔ `smallint` → `smallint`; `json` and `jsonb` stay distinct;
 * `enum('a','b')` → `enum(a,b)` in declared order.
 */
export function normaliseColumnType(raw: string): string {
  const t = raw.trim().toLowerCase();

  const enumMatch = /^enum\((.*)\)$/.exec(t);
  if (enumMatch) {
    const labels = [...raw.trim().slice(5, -1).matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
      m[1].replace(/''/g, "'"),
    );
    return `enum(${labels.join(',')})`;
  }

  const varchar = /^(?:varchar|character varying)\((\d+)\)$/.exec(t);
  if (varchar) return `varchar(${varchar[1]})`;
  const char = /^(?:char|character)\((\d+)\)$/.exec(t);
  if (char) return `char(${char[1]})`;

  const ts = /^(?:datetime|timestamp)(?:\((\d)\))?( without time zone)?$/.exec(t);
  if (ts) {
    const precision = ts[1] ?? (ts[2] ? '6' : '0');
    return `timestamp(${precision})`;
  }

  if (/^tinyint\(1\)$/.test(t) || t === 'boolean' || t === 'bool') return 'boolean';
  if (/^(tinyint|smallint)(\(\d+\))?$/.test(t)) return 'smallint';
  if (/^(int|integer)(\(\d+\))?$/.test(t)) return 'int';
  if (/^bigint(\(\d+\))?$/.test(t)) return 'bigint';
  if (t === 'text' || t === 'longtext' || t === 'mediumtext' || t === 'tinytext') return 'text';
  if (t === 'double' || t === 'double precision' || t === 'float' || t === 'real') {
    return 'double';
  }
  const decimal = /^(?:decimal|numeric)\((\d+),(\d+)\)$/.exec(t.replace(/\s/g, ''));
  if (decimal) return `decimal(${decimal[1]},${decimal[2]})`;
  if (t === 'mediumblob' || t === 'longblob' || t === 'blob' || t === 'bytea') return 'binary';
  return t;
}

/**
 * `CURRENT_TIMESTAMP(p)` and `now()` → `CURRENT_TIMESTAMP(p)` with the
 * column's precision; `'x'::character varying` → `'x'`; a bare literal of a
 * string column → `'x'`; `0`/`false`, `1`/`true` → `false`/`true` on boolean
 * columns; a quoted number on a numeric column loses its quotes.
 */
export function normaliseDefault(raw: string | null, type: string): string | null {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (v === '' || v.toUpperCase() === 'NULL' || /^NULL::/i.test(v)) return null;

  // A quoted literal cast to a type: 'x'::character varying, 'a'::"t_c_enum".
  const cast = /^('(?:[^']|'')*')::.+$/.exec(v);
  if (cast) v = cast[1];

  const precision = /^timestamp\((\d)\)$/.exec(type)?.[1];
  // PostgreSQL stores CURRENT_TIMESTAMP(p) as ('now'::text)::timestamp(p) with time zone.
  if (
    /^(now\(\)|current_timestamp(\(\d\))?)$/i.test(v) ||
    /^\('now'::text\)::timestamp(\(\d\))? with(out)? time zone$/i.test(v)
  ) {
    return `CURRENT_TIMESTAMP(${precision ?? '0'})`;
  }

  if (type === 'boolean') {
    const b = v.replace(/^'(.*)'$/, '$1').toLowerCase();
    if (b === '0' || b === 'false' || b === 'b\'0\'') return 'false';
    if (b === '1' || b === 'true' || b === 'b\'1\'') return 'true';
    return v;
  }

  if (NUMERIC_TYPES.test(type)) {
    return v.replace(/^'(.*)'$/, '$1').replace(/^\((.*)\)$/, '$1');
  }

  if (STRING_TYPES.test(type)) {
    if (v.startsWith("'")) return v;
    // A function call, a cast or an expression is kept as written.
    if (/[()]|::/.test(v)) return v;
    return `'${v.replace(/'/g, "''")}'`;
  }

  return v;
}

// ---------------------------------------------------------------------------
// Reading the catalogues
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function placeholders(dialect: Dialect, n: number, from = 1): string {
  return Array.from({ length: n }, (_, i) => (dialect === 'postgres' ? `$${from + i}` : '?')).join(
    ', ',
  );
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't' || v === 'YES';
}

function emptyTable(): NormalisedTable {
  return { columns: {}, primaryKey: [], uniques: [], indexes: [], foreignKeys: [] };
}

function pgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    return v
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((s) => s !== '')
      .map((s) => s.replace(/^"(.*)"$/, '$1'));
  }
  return [];
}

async function readMysql(runner: QueryRunner, tables: string[]): Promise<NormalisedSchema> {
  const schema: NormalisedSchema = {};
  if (tables.length === 0) return schema;
  const ph = placeholders('mysql', tables.length);

  const columns: Row[] = await runner.query(
    `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS ctype, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS dflt, EXTRA AS extra
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${ph})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    tables,
  );
  for (const c of columns) {
    const table = (schema[String(c.tbl)] ??= emptyTable());
    const type = normaliseColumnType(String(c.ctype));
    let dflt = c.dflt === null || c.dflt === undefined ? null : String(c.dflt);
    if (dflt !== null && STRING_TYPES.test(type) && !/DEFAULT_GENERATED/i.test(String(c.extra))) {
      dflt = `'${dflt.replace(/'/g, "''")}'`;
    }
    table.columns[String(c.col)] = {
      type,
      nullable: bool(c.nullable),
      default: normaliseDefault(dflt, type),
    };
  }

  const fks: Row[] = await runner.query(
    `SELECT TABLE_NAME AS tbl, CONSTRAINT_NAME AS name, COLUMN_NAME AS col,
            REFERENCED_TABLE_NAME AS reftbl, REFERENCED_COLUMN_NAME AS refcol
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${ph})
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    tables,
  );
  const fkNames = new Map<string, Set<string>>();
  const fkByName = new Map<string, { table: string; columns: string[]; refTable: string; refColumns: string[] }>();
  for (const f of fks) {
    const key = `${f.tbl}\u0000${f.name}`;
    let fk = fkByName.get(key);
    if (!fk) {
      fk = { table: String(f.tbl), columns: [], refTable: String(f.reftbl), refColumns: [] };
      fkByName.set(key, fk);
    }
    fk.columns.push(String(f.col));
    fk.refColumns.push(String(f.refcol));
    if (!fkNames.has(String(f.tbl))) fkNames.set(String(f.tbl), new Set());
    fkNames.get(String(f.tbl)).add(String(f.name));
  }
  for (const fk of fkByName.values()) {
    (schema[fk.table] ??= emptyTable()).foreignKeys.push({
      columns: fk.columns,
      refTable: fk.refTable,
      refColumns: fk.refColumns,
    });
  }

  const stats: Row[] = await runner.query(
    `SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS nonunique, COLUMN_NAME AS col
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${ph})
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    tables,
  );
  const indexes = new Map<string, { table: string; name: string; unique: boolean; columns: string[] }>();
  for (const s of stats) {
    const key = `${s.tbl}\u0000${s.name}`;
    let idx = indexes.get(key);
    if (!idx) {
      idx = { table: String(s.tbl), name: String(s.name), unique: !bool(s.nonunique), columns: [] };
      indexes.set(key, idx);
    }
    // Prefix lengths (SUB_PART) are not read: the column list alone is compared.
    idx.columns.push(String(s.col));
  }
  for (const idx of indexes.values()) {
    const table = (schema[idx.table] ??= emptyTable());
    if (idx.name === 'PRIMARY') {
      table.primaryKey = idx.columns;
    } else if (idx.unique) {
      table.uniques.push(idx.columns);
    } else if (!fkNames.get(idx.table)?.has(idx.name)) {
      // InnoDB creates an index named after a foreign key that has none;
      // PostgreSQL never does, so that implicit index is not a declared one.
      table.indexes.push(idx.columns);
    }
  }
  return schema;
}

async function readPostgres(runner: QueryRunner, tables: string[]): Promise<NormalisedSchema> {
  const schema: NormalisedSchema = {};
  if (tables.length === 0) return schema;
  const ph = placeholders('postgres', tables.length);

  const enums: Row[] = await runner.query(
    `SELECT t.typname AS typ, e.enumlabel AS label
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = current_schema()
      ORDER BY t.typname, e.enumsortorder`,
  );
  const enumLabels = new Map<string, string[]>();
  for (const e of enums) {
    const list = enumLabels.get(String(e.typ)) ?? [];
    list.push(String(e.label));
    enumLabels.set(String(e.typ), list);
  }

  const columns: Row[] = await runner.query(
    `SELECT table_name AS tbl, column_name AS col, data_type AS dtype, udt_name AS udt,
            character_maximum_length AS len, datetime_precision AS dprec,
            numeric_precision AS nprec, numeric_scale AS nscale,
            is_nullable AS nullable, column_default AS dflt
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN (${ph})
      ORDER BY table_name, ordinal_position`,
    tables,
  );
  for (const c of columns) {
    const table = (schema[String(c.tbl)] ??= emptyTable());
    const dtype = String(c.dtype);
    let raw: string;
    if (dtype === 'character varying') raw = `varchar(${c.len})`;
    else if (dtype === 'character') raw = `char(${c.len})`;
    else if (dtype.startsWith('timestamp')) raw = `timestamp(${c.dprec}) without time zone`;
    else if (dtype === 'numeric' && c.nprec !== null) raw = `decimal(${c.nprec},${c.nscale})`;
    else if (dtype === 'USER-DEFINED') {
      const labels = enumLabels.get(String(c.udt));
      raw = labels
        ? `enum(${labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(',')})`
        : String(c.udt);
    } else raw = dtype;
    const type = normaliseColumnType(raw);
    table.columns[String(c.col)] = {
      type,
      nullable: bool(c.nullable),
      default: normaliseDefault(c.dflt === null || c.dflt === undefined ? null : String(c.dflt), type),
    };
  }

  const idx: Row[] = await runner.query(
    `SELECT t.relname AS tbl, ix.indisunique AS isunique, ix.indisprimary AS isprimary,
            ARRAY(
              SELECT a.attname::text
                FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
               ORDER BY k.ord
            ) AS cols
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema() AND t.relname IN (${ph})`,
    tables,
  );
  for (const i of idx) {
    const table = (schema[String(i.tbl)] ??= emptyTable());
    const cols = pgArray(i.cols);
    if (bool(i.isprimary)) table.primaryKey = cols;
    else if (bool(i.isunique)) table.uniques.push(cols);
    else table.indexes.push(cols);
  }

  const fks: Row[] = await runner.query(
    `SELECT t.relname AS tbl, rt.relname AS reftbl,
            ARRAY(
              SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
               ORDER BY k.ord
            ) AS cols,
            ARRAY(
              SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
               ORDER BY k.ord
            ) AS refcols
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_class rt ON rt.oid = c.confrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = current_schema() AND t.relname IN (${ph})`,
    tables,
  );
  for (const f of fks) {
    (schema[String(f.tbl)] ??= emptyTable()).foreignKeys.push({
      columns: pgArray(f.cols),
      refTable: String(f.reftbl),
      refColumns: pgArray(f.refcols),
    });
  }
  return schema;
}

/**
 * The normalised schema of `tables` in the runner's current database
 * (MySQL: `TABLE_SCHEMA = DATABASE()`; PostgreSQL: `current_schema()`).
 */
export function readSchema(
  runner: QueryRunner,
  dialect: Dialect,
  tables: string[],
): Promise<NormalisedSchema> {
  return dialect === 'postgres' ? readPostgres(runner, tables) : readMysql(runner, tables);
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

interface Difference {
  table: string;
  column?: string;
  aspect: ParityAspect;
  /** the columns a key or index difference involves */
  involves: string[];
  text: string;
}

function fmt(v: string | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  return `'${v}'`;
}

const listKey = (cols: string[]) => `(${cols.join(',')})`;
const fkKey = (fk: NormalisedTable['foreignKeys'][number]) =>
  `${listKey(fk.columns)}->${fk.refTable}${listKey(fk.refColumns)}`;

function keyListDiff(
  table: string,
  aspect: ParityAspect,
  mysql: string[],
  postgres: string[],
  involves: string[],
): Difference | null {
  const a = [...new Set(mysql)].sort();
  const b = [...new Set(postgres)].sort();
  if (a.join('|') === b.join('|')) return null;
  return {
    table,
    aspect,
    involves,
    text: `${table} ${aspect}: mysql=[${a.join(', ')}] postgres=[${b.join(', ')}]`,
  };
}

function colsOf(keys: string[]): string[] {
  return keys.flatMap((k) => k.replace(/^\(|\).*$/g, '').split(','));
}

function symmetric(a: string[], b: string[]): string[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...a.filter((x) => !sb.has(x)), ...b.filter((x) => !sa.has(x))];
}

function tableDifferences(name: string, m: NormalisedTable, p: NormalisedTable): Difference[] {
  const out: Difference[] = [];
  const columns = [...new Set([...Object.keys(m.columns), ...Object.keys(p.columns)])].sort();
  for (const column of columns) {
    const a = m.columns[column];
    const b = p.columns[column];
    const at = `${name}.${column}`;
    if (!a || !b) {
      out.push({
        table: name,
        column,
        aspect: 'type',
        involves: [column],
        text: `${at} type: mysql=${a ? fmt(a.type) : 'missing'} postgres=${b ? fmt(b.type) : 'missing'}`,
      });
      continue;
    }
    if (a.type !== b.type) {
      out.push({
        table: name,
        column,
        aspect: 'type',
        involves: [column],
        text: `${at} type: mysql=${fmt(a.type)} postgres=${fmt(b.type)}`,
      });
    }
    if (a.nullable !== b.nullable) {
      out.push({
        table: name,
        column,
        aspect: 'nullable',
        involves: [column],
        text: `${at} nullable: mysql=${fmt(a.nullable)} postgres=${fmt(b.nullable)}`,
      });
    }
    if (a.default !== b.default) {
      out.push({
        table: name,
        column,
        aspect: 'default',
        involves: [column],
        text: `${at} default: mysql=${fmt(a.default)} postgres=${fmt(b.default)}`,
      });
    }
  }

  const pk = keyListDiff(name, 'primaryKey', [listKey(m.primaryKey)], [listKey(p.primaryKey)], [
    ...m.primaryKey,
    ...p.primaryKey,
  ]);
  if (pk) out.push(pk);

  for (const [aspect, a, b] of [
    ['unique', m.uniques.map(listKey), p.uniques.map(listKey)],
    ['index', m.indexes.map(listKey), p.indexes.map(listKey)],
    ['foreignKey', m.foreignKeys.map(fkKey), p.foreignKeys.map(fkKey)],
  ] as Array<[ParityAspect, string[], string[]]>) {
    const d = keyListDiff(name, aspect, a, b, colsOf(symmetric(a, b)));
    if (d) out.push(d);
  }
  return out;
}

function matches(allow: ParityAllowance, d: Difference): boolean {
  if (allow.aspect !== d.aspect) return false;
  if (allow.table !== '*' && allow.table !== d.table) return false;
  if (allow.column === undefined || allow.column === '*') return true;
  return d.column !== undefined ? d.column === allow.column : d.involves.includes(allow.column);
}

/**
 * Every difference between the two schemas, minus those an allowance names,
 * and the allowances that named nothing (a stale allowance hides the next
 * real difference, so the parity spec fails on it too). Sorted.
 */
export function diffSchemas(
  mysql: NormalisedSchema,
  postgres: NormalisedSchema,
  allow: ParityAllowance[],
): { differences: string[]; unusedAllowances: ParityAllowance[] } {
  const all: Difference[] = [];
  const tables = [...new Set([...Object.keys(mysql), ...Object.keys(postgres)])].sort();
  for (const name of tables) {
    const m = mysql[name];
    const p = postgres[name];
    if (!m || !p) {
      all.push({
        table: name,
        aspect: 'table',
        involves: [],
        text: `${name} table: mysql=${m ? 'present' : 'missing'} postgres=${p ? 'present' : 'missing'}`,
      });
      continue;
    }
    all.push(...tableDifferences(name, m, p));
  }

  const used = new Set<ParityAllowance>();
  const differences: string[] = [];
  for (const d of all) {
    const hit = allow.filter((a) => matches(a, d));
    if (hit.length === 0) differences.push(d.text);
    for (const a of hit) used.add(a);
  }
  return {
    differences: differences.sort(),
    unusedAllowances: allow.filter((a) => !used.has(a)),
  };
}
