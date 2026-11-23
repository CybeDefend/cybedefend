import type { QueryRunner } from 'typeorm';
import { runnerDialect } from './dialect';

export async function ensureExtension(
  runner: QueryRunner,
  name: 'citext',
): Promise<void> {
  if (runnerDialect(runner) === 'postgres') {
    await runner.query(`CREATE EXTENSION IF NOT EXISTS "${name}"`);
  }
}

export async function createUpdatedAtTrigger(
  runner: QueryRunner,
  table: string,
  column: string,
): Promise<void> {
  if (runnerDialect(runner) !== 'postgres') return;
  const q = (s: string) => `"${s}"`;
  const fn = `cd_touch_${column}`;
  const trg = `trg_${table}_${column}`;
  await runner.query(
    `CREATE OR REPLACE FUNCTION ${q(fn)}() RETURNS trigger AS $$\n` +
      `BEGIN\n` +
      `  IF NEW.${q(column)} IS NOT DISTINCT FROM OLD.${q(column)} AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN NEW.${q(column)} = CURRENT_TIMESTAMP; END IF;\n` +
      `  RETURN NEW;\n` +
      `END;\n` +
      `$$ LANGUAGE plpgsql`,
  );
  await runner.query(
    `CREATE TRIGGER ${q(trg)} BEFORE UPDATE ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION ${q(fn)}()`,
  );
}

export async function addEnumValue(
  runner: QueryRunner,
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  if (runnerDialect(runner) === 'postgres') {
    const type = `"${table}_${column}_enum"`;
    for (const value of values) {
      await runner.query(
        `ALTER TYPE ${type} ADD VALUE IF NOT EXISTS '${value.replace(/'/g, "''")}'`,
      );
    }
    return;
  }
  await addMysqlEnumValues(runner, table, column, values);
}

type MysqlColumnRow = {
  columnType: string;
  isNullable: string;
  columnDefault: string | null;
  charset: string | null;
  collation: string | null;
  comment: string | null;
  extra: string | null;
};

/**
 * MySQL: one `ALTER TABLE … MODIFY` built from the live column definition.
 * TypeORM's changeColumn is not used: on a column with an explicit collation
 * it writes `enum COLLATE "…" ('a', …)`, which MySQL refuses (ER_PARSE_ERROR).
 * The new values go after the existing ones, so stored rows keep their index
 * and MySQL can extend the enum in place. A value already present is skipped,
 * and nothing is issued when none is missing.
 */
async function addMysqlEnumValues(
  runner: QueryRunner,
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  const ident = (name: string) => {
    if (name.includes('`')) throw new Error(`DB_DIALECT_BAD_IDENTIFIER: ${name}`);
    return '`' + name + '`';
  };
  const tableIdent = ident(table);
  const columnIdent = ident(column);
  const rows = (await runner.query(
    'SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault, ' +
      'CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, COLUMN_COMMENT AS comment, EXTRA AS extra ' +
      'FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  )) as MysqlColumnRow[];
  const live = rows?.[0];
  if (!live) throw new Error(`DB_DIALECT_UNKNOWN_COLUMN: ${table}.${column}`);
  const existing = parseMysqlEnum(live.columnType);
  if (!existing) {
    throw new Error(`DB_DIALECT_NOT_AN_ENUM: ${table}.${column} is ${live.columnType}`);
  }
  const missing = [...new Set(values)].filter((v) => !existing.includes(v));
  if (missing.length === 0) return;
  if (live.columnDefault !== null && /DEFAULT_GENERATED/i.test(live.extra ?? '')) {
    throw new Error(
      `DB_DIALECT_UNSUPPORTED_DEFAULT: ${table}.${column} has an expression default; extend it by hand`,
    );
  }
  // the MODIFY below restates only the type, character set, collation,
  // nullability, default and comment: anything else EXTRA reports (INVISIBLE,
  // a generation expression…) would be silently dropped, so refuse it
  const extra = (live.extra ?? '').replace(/DEFAULT_GENERATED/gi, '').trim();
  if (extra) {
    throw new Error(
      `DB_DIALECT_UNSUPPORTED_COLUMN: ${table}.${column} has ${extra}; extend it by hand`,
    );
  }

  const name = (n: string) => {
    if (!/^[A-Za-z0-9_]+$/.test(n)) throw new Error(`DB_DIALECT_BAD_IDENTIFIER: ${n}`);
    return n;
  };
  const parts = [
    `ALTER TABLE ${tableIdent} MODIFY ${columnIdent} ENUM(${[...existing, ...missing].map(mysqlString).join(',')})`,
  ];
  if (live.charset) parts.push(`CHARACTER SET ${name(live.charset)}`);
  if (live.collation) parts.push(`COLLATE ${name(live.collation)}`);
  parts.push(live.isNullable === 'YES' ? 'NULL' : 'NOT NULL');
  if (live.columnDefault !== null) parts.push(`DEFAULT ${mysqlString(live.columnDefault)}`);
  if (live.comment) parts.push(`COMMENT ${mysqlString(live.comment)}`);
  await runner.query(parts.join(' '));
}

/** A MySQL string literal: quotes doubled, backslashes escaped. */
function mysqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/**
 * The values of an INFORMATION_SCHEMA `COLUMN_TYPE` such as
 * `enum('a','it''s','x\\y')`, in order; `null` when it is not an enum.
 * Each value is a quoted literal where `''` is a quote and `\` escapes the
 * next character, so commas and parentheses inside a value are kept.
 */
function parseMysqlEnum(columnType: string): string[] | null {
  const m = /^enum\((.*)\)$/is.exec(columnType.trim());
  if (!m) return null;
  const body = m[1];
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] !== "'") throw new Error(`DB_DIALECT_BAD_ENUM: ${columnType}`);
    i++;
    let value = '';
    for (;;) {
      if (i >= body.length) throw new Error(`DB_DIALECT_BAD_ENUM: ${columnType}`);
      const ch = body[i];
      if (ch === '\\' && i + 1 < body.length) {
        value += body[i + 1];
        i += 2;
      } else if (ch === "'" && body[i + 1] === "'") {
        value += "'";
        i += 2;
      } else if (ch === "'") {
        i++;
        break;
      } else {
        value += ch;
        i++;
      }
    }
    out.push(value);
    if (i < body.length) {
      if (body[i] !== ',') throw new Error(`DB_DIALECT_BAD_ENUM: ${columnType}`);
      i++;
    }
  }
  return out;
}
