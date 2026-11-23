import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffSchemas, readSchema, type Dialect } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from './live-database';
import { SCHEMA_PARITY_ALLOW } from './schema-parity.allow';
import { UPDATED_AT_COLUMNS } from './updated-at-columns';

/**
 * Schema parity: one empty MySQL database built by the frozen
 * MySQL track then migrations-common/, one empty PostgreSQL database built by
 * the baseline then migrations-common/, compared on the tables of the core
 * entities. Every difference must be named in schema-parity.allow.ts with
 * its reason. The spec also proves on both engines that the onUpdate columns
 * of UPDATED_AT_COLUMNS move on UPDATE (a trigger on PostgreSQL, MySQL's ON
 * UPDATE on MySQL) and that the branch uniques upsertBranches relies on
 * exist.
 *
 *   EI_SCHEMA_PARITY_LIVE=1 \
 *   EI_SCHEMA_PARITY_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *   EI_SCHEMA_PARITY_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *   pnpm exec jest --ci --runInBand --testPathPatterns=schema-parity.live
 */
const describeLive =
  process.env.EI_SCHEMA_PARITY_LIVE === '1' ? describe : describe.skip;

interface SnapshotColumn {
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  generationStrategy: string | null;
  default: string | null;
}

/** The columns of the core entities, as the metadata snapshot lists them. */
function snapshotColumns(): SnapshotColumn[] {
  const snapshot = JSON.parse(
    readFileSync(
      join(__dirname, '__snapshots__', 'entity-metadata.mysql.json'),
      'utf8',
    ),
  ) as { columns: SnapshotColumn[] };
  return snapshot.columns;
}

function coreTables(): string[] {
  return [...new Set(snapshotColumns().map((c) => c.table))].sort();
}

/** Quotes an identifier, so camelCase survives PostgreSQL's case folding. */
const q = (dialect: Dialect, ident: string) =>
  dialect === 'mysql' ? `\`${ident}\`` : `"${ident}"`;

/** `?` on MySQL, `$n` on PostgreSQL. */
function ph(dialect: Dialect, text: string): string {
  if (dialect === 'mysql') return text;
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

/** A literal for a snapshot column type. */
function literal(type: string, alt = false): unknown {
  switch (type) {
    case 'Number':
    case 'int':
    case 'tinyint':
      return alt ? 2 : 1;
    case 'Boolean':
      return !alt;
    case 'datetime':
    case 'timestamp':
    case 'Date':
      return new Date(alt ? '2001-01-01T00:00:00Z' : '2000-01-01T00:00:00Z');
    default:
      return alt ? 'v2' : 'v1';
  }
}

describeLive('external-integrations schema parity', () => {
  let mysqlDb: LiveDatabase;
  let pgDb: LiveDatabase;
  const tables = coreTables();

  beforeAll(async () => {
    mysqlDb = await createLiveDatabase({
      prefix: 'ei_parity',
      envPrefix: 'EI_SCHEMA_PARITY',
      entities: [],
      dialect: 'mysql',
    });
    pgDb = await createLiveDatabase({
      prefix: 'ei_parity',
      envPrefix: 'EI_SCHEMA_PARITY',
      entities: [],
      dialect: 'postgres',
    });
  }, 300_000);

  afterAll(async () => {
    await mysqlDb?.drop();
    await pgDb?.drop();
  });

  async function diff() {
    const mysqlRunner = mysqlDb.dataSource.createQueryRunner();
    const pgRunner = pgDb.dataSource.createQueryRunner();
    try {
      return diffSchemas(
        await readSchema(mysqlRunner, 'mysql', tables),
        await readSchema(pgRunner, 'postgres', tables),
        SCHEMA_PARITY_ALLOW,
      );
    } finally {
      await mysqlRunner.release();
      await pgRunner.release();
    }
  }

  it('both tracks build the same core schema', async () => {
    expect(tables.length).toBeGreaterThan(0);
    expect((await diff()).differences).toEqual([]);
  });

  it('every allowance is still needed', async () => {
    expect((await diff()).unusedAllowances).toEqual([]);
  });

  it('the branch uniques used by upsertBranches exist on both engines', async () => {
    for (const [db, dialect] of [
      [mysqlDb, 'mysql'],
      [pgDb, 'postgres'],
    ] as const) {
      const runner = db.dataSource.createQueryRunner();
      try {
        const schema = await readSchema(runner, dialect, [
          'github_branches',
          'gitlab_branches',
        ]);
        expect(schema.github_branches.uniques).toContainEqual([
          'repositoryId',
          'name',
        ]);
        expect(schema.gitlab_branches.uniques).toContainEqual([
          'repositoryId',
          'name',
        ]);
      } finally {
        await runner.release();
      }
    }
  });

  it('the onUpdate columns of UPDATED_AT_COLUMNS move on UPDATE on both engines', async () => {
    const columns = snapshotColumns();
    const byTable = new Map<string, string[]>();
    for (const [table, column] of UPDATED_AT_COLUMNS) {
      const list = byTable.get(table) ?? [];
      list.push(column);
      byTable.set(table, list);
    }
    expect(byTable.size).toBeGreaterThan(0);

    const stuck: string[] = [];
    for (const [db, dialect] of [
      [mysqlDb, 'mysql'],
      [pgDb, 'postgres'],
    ] as const) {
      const runner = db.dataSource.createQueryRunner();
      try {
        // The throwaway rows reference no parent, so the FK checks are off.
        // MySQL: per session. PostgreSQL: never `session_replication_role =
        // replica`, which also silences every ordinary trigger, the
        // updated-at ones under test included. Instead, in a transaction
        // rolled back at the end, disable every trigger of the table (the
        // FK's internal ones need a superuser) and enable the user ones again.
        if (dialect === 'mysql') {
          await runner.query('SET FOREIGN_KEY_CHECKS=0');
        } else {
          await runner.startTransaction();
        }
        for (const [table, touchColumns] of byTable) {
          if (dialect === 'postgres') {
            await runner.query(
              `ALTER TABLE ${q(dialect, table)} DISABLE TRIGGER ALL`,
            );
            await runner.query(
              `ALTER TABLE ${q(dialect, table)} ENABLE TRIGGER USER`,
            );
          }
          const cols = columns.filter((c) => c.table === table);
          const id = randomUUID();
          // Every NOT NULL column without a default, plus the id (MySQL has
          // no database default for it), plus an old value for each onUpdate
          // column so the move is measurable even at second precision.
          const insertCols = [
            'id',
            ...cols
              .filter((c) => !c.nullable && c.default === null && !c.primary)
              .map((c) => c.column),
            ...touchColumns,
          ];
          const insertVals: unknown[] = [
            id,
            ...cols
              .filter((c) => !c.nullable && c.default === null && !c.primary)
              .map((c) => literal(c.type)),
            ...touchColumns.map(() => new Date('2000-01-01T00:00:00Z')),
          ];
          await runner.query(
            ph(
              dialect,
              `INSERT INTO ${q(dialect, table)} (${insertCols
                .map((c) => q(dialect, c))
                .join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
            ),
            insertVals,
          );
          const other = cols.find(
            (c) => !c.primary && !touchColumns.includes(c.column),
          );
          expect(other).toBeDefined();
          await runner.query(
            ph(
              dialect,
              `UPDATE ${q(dialect, table)} SET ${q(dialect, other!.column)} = ? WHERE ${q(dialect, 'id')} = ?`,
            ),
            [literal(other!.type, true), id],
          );
          for (const column of touchColumns) {
            const rows = (await runner.query(
              ph(
                dialect,
                `SELECT ${q(dialect, column)} AS v FROM ${q(dialect, table)} WHERE ${q(dialect, 'id')} = ?`,
              ),
              [id],
            )) as Array<{ v: unknown }>;
            const moved = new Date(rows[0].v as string).getTime();
            if (!(moved > new Date('2000-01-01T00:00:00Z').getTime())) {
              stuck.push(`${dialect} ${table}.${column}`);
            }
          }
        }
      } finally {
        if (dialect === 'mysql') {
          await runner.query('SET FOREIGN_KEY_CHECKS=1');
        } else if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        await runner.release();
      }
    }
    // Every column is checked on both engines before the verdict, so a
    // failure names all the columns that did not move, not the first one.
    expect(stuck).toEqual([]);
  }, 120_000);
});
