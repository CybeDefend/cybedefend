import type { NormalisedSchema } from '@cybedefend/db-dialect';

/**
 * The schema restricted to the given columns of the given tables, with the
 * keys, indexes and foreign keys that involve those columns only. The core
 * parity spec compares the core columns: outside the Community Edition a
 * table may hold more columns, declared and created by the closed edition,
 * which compares them itself.
 */
export function restrictToColumns(
  schema: NormalisedSchema,
  columns: Map<string, Set<string>>,
): NormalisedSchema {
  const restricted: NormalisedSchema = {};
  for (const [name, table] of Object.entries(schema)) {
    const kept = columns.get(name);
    if (!kept) continue;
    const within = (cols: string[]) => cols.every((c) => kept.has(c));
    restricted[name] = {
      columns: Object.fromEntries(
        Object.entries(table.columns).filter(([c]) => kept.has(c)),
      ),
      primaryKey: table.primaryKey,
      uniques: table.uniques.filter(within),
      indexes: table.indexes.filter(within),
      foreignKeys: table.foreignKeys.filter((fk) => within(fk.columns)),
    };
  }
  return restricted;
}
