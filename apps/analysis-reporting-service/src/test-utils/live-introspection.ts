import type { DataSource } from 'typeorm';
import { currentDialect, ident } from '@cybedefend/db-dialect';

/**
 * Catalogue reads for the two-engine live specs: what a MySQL spec
 * read from `SHOW INDEX`, `information_schema.STATISTICS`, `EXPLAIN` and
 * `ANALYZE TABLE`, answered the same way on PostgreSQL. Only the read differs
 * between engines; the assertions of the specs stay the same.
 */

/** The columns of `index` on `table`, in index order. */
export async function indexColumns(
  ds: DataSource,
  table: string,
  index: string,
): Promise<string[]> {
  if (currentDialect() === 'mysql') {
    const rows: Array<{ Column_name: string }> = await ds.query(
      `SHOW INDEX FROM ${ident(table).text} WHERE Key_name = ?`,
      [index],
    );
    return rows.map((r) => r.Column_name);
  }
  const rows: Array<{ column: string }> = await ds.query(
    `SELECT a.attname AS "column"
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = $1 AND i.relname = $2
      ORDER BY k.ord`,
    [table, index],
  );
  return rows.map((r) => r.column);
}

/** The indexes of `table` whose first column is `column`. */
export async function indexesLeadingWith(
  ds: DataSource,
  table: string,
  column: string,
): Promise<string[]> {
  if (currentDialect() === 'mysql') {
    const rows: Array<{ Key_name: string }> = await ds.query(
      `SHOW INDEX FROM ${ident(table).text} WHERE Seq_in_index = 1 AND Column_name = ?`,
      [column],
    );
    return rows.map((r) => r.Key_name);
  }
  const rows: Array<{ name: string }> = await ds.query(
    `SELECT i.relname AS "name"
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
      WHERE t.relname = $1 AND a.attname = $2`,
    [table, column],
  );
  return rows.map((r) => r.name);
}

/** Whether `index` on `table` is unique; null when there is no such index. */
export async function indexIsUnique(
  ds: DataSource,
  table: string,
  index: string,
): Promise<boolean | null> {
  if (currentDialect() === 'mysql') {
    const [row] = await ds.query(
      `SELECT NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
        LIMIT 1`,
      [table, index],
    );
    return row ? Number(row.nonUnique) === 0 : null;
  }
  const [row] = await ds.query(
    `SELECT x.indisunique AS "unique"
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
      WHERE t.relname = $1 AND i.relname = $2`,
    [table, index],
  );
  return row ? Boolean(row.unique) : null;
}

/** Refreshes the planner statistics of `tables`. */
export async function analyzeTables(
  ds: DataSource,
  tables: string[],
): Promise<void> {
  await ds.query(
    currentDialect() === 'mysql'
      ? `ANALYZE TABLE ${tables.join(', ')}`
      : `ANALYZE ${tables.join(', ')}`,
  );
}

/**
 * One access to a table in the plan of a statement: the alias (or table) it
 * reads, whether it reads the whole table (`full`: MySQL's `type = ALL`, a
 * PostgreSQL Seq Scan) and the index it reads (`key`, null when none). On
 * MySQL `type` is EXPLAIN's; on PostgreSQL the plan node's type.
 */
export interface PlanAccess {
  table: string;
  type: string;
  full: boolean;
  key: string | null;
}

interface PgPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Alias?: string;
  'Index Name'?: string;
  Plans?: PgPlanNode[];
}

/** The table accesses of the plan of `statement`. */
export async function planAccesses(
  ds: DataSource,
  statement: string,
  parameters: unknown[] = [],
): Promise<PlanAccess[]> {
  if (currentDialect() === 'mysql') {
    const plan: Array<{ table: string; type: string; key: string | null }> =
      await ds.query(`EXPLAIN ${statement}`, parameters);
    return plan.map((row) => ({
      table: row.table,
      type: row.type,
      full: row.type === 'ALL',
      key: row.key,
    }));
  }
  const [{ 'QUERY PLAN': plan }] = (await ds.query(
    `EXPLAIN (FORMAT JSON) ${statement}`,
    parameters,
  )) as Array<{ 'QUERY PLAN': Array<{ Plan: PgPlanNode }> }>;
  const accesses: PlanAccess[] = [];
  const visit = (node: PgPlanNode): void => {
    if (node['Relation Name']) {
      // A Bitmap Heap Scan reads the index through its Bitmap Index Scan child.
      const bitmap = (node.Plans ?? []).find(
        (child) => child['Node Type'] === 'Bitmap Index Scan',
      );
      accesses.push({
        table: node.Alias ?? node['Relation Name'],
        type: node['Node Type'],
        full: node['Node Type'] === 'Seq Scan',
        key: node['Index Name'] ?? bitmap?.['Index Name'] ?? null,
      });
    }
    (node.Plans ?? []).forEach(visit);
  };
  visit(plan[0].Plan);
  return accesses;
}
