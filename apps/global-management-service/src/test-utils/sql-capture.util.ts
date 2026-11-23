import { join } from 'node:path';
import { DataSource } from 'typeorm';

/** One statement TypeORM sent to the database. */
export interface CapturedStatement {
  sql: string;
  params: unknown[];
}

/**
 * What a statement answers: the rows of a SELECT, or the number of rows an
 * UPDATE / DELETE matched (mysql2 reports FOUND rows).
 */
export type CapturedAnswer = Record<string, unknown>[] | { affected: number };

export type CaptureResponder = (statement: CapturedStatement) => CapturedAnswer;

/**
 * A MySQL DataSource holding the real entity metadata of global-management that
 * never connects: every statement goes through `respond` and is recorded in
 * `statements`, in order. Repositories taken from it run the real TypeORM code
 * (SQL generation, the pre-query of a paginated join, hydration of the rows), so
 * a spec can count the statements a read issues and read their SQL.
 */
export async function createSqlCaptureDataSource(
  respond: CaptureResponder = () => [],
): Promise<{
  dataSource: DataSource;
  statements: CapturedStatement[];
  setResponder: (next: CaptureResponder) => void;
}> {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'unused',
    entities: [join(__dirname, '../entities/*.entity.ts')],
  });
  // Builds the entity metadata the query builders need; never connects.
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();

  const statements: CapturedStatement[] = [];
  let responder = respond;
  const queryRunner = {
    isTransactionActive: false,
    isReleased: false,
    data: {},
    broadcaster: { broadcast: async () => undefined },
    release: async () => undefined,
    query: async (
      sql: string,
      params: unknown[] = [],
      useStructuredResult = false,
    ) => {
      const statement = { sql, params };
      statements.push(statement);
      const answer = responder(statement);
      const records = Array.isArray(answer) ? answer : [];
      const affected = Array.isArray(answer) ? undefined : answer.affected;
      if (!useStructuredResult) return records;
      return { records, raw: records, affected };
    },
  };
  (
    dataSource as unknown as { createQueryRunner: () => unknown }
  ).createQueryRunner = () => queryRunner;

  return {
    dataSource,
    statements,
    setResponder: (next) => {
      responder = next;
    },
  };
}

/** The column aliases a SELECT returns (`... AS \`alias\``), in order. */
export function selectedAliases(sql: string): string[] {
  const head = sql.split(/\sFROM\s/i)[0];
  return [...head.matchAll(/AS `([^`]+)`/g)].map((m) => m[1]);
}

/**
 * A raw row for `sql`: every selected alias takes its value from `values`,
 * looked up by the full alias (`project_name`) or else by the column, i.e. the
 * part after the last underscore (`name`). An alias found in neither is null.
 */
export function rawRow(
  sql: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const alias of selectedAliases(sql)) {
    const column = alias.slice(alias.lastIndexOf('_') + 1);
    row[alias] =
      alias in values
        ? values[alias]
        : column in values
          ? values[column]
          : null;
  }
  return row;
}

/** The SELECT statements among `statements`. */
export const selects = (statements: CapturedStatement[]) =>
  statements.filter((s) => /^\s*SELECT/i.test(s.sql));
