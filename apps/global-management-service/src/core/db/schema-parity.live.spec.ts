import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffSchemas, readSchema } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from './live-database';
import { SCHEMA_PARITY_ALLOW } from './schema-parity.allow';
import { restrictToColumns } from './schema-parity.columns';

/**
 * Schema parity: one empty MySQL database built by the frozen
 * MySQL track then migrations-common/, one empty PostgreSQL database built by
 * the baseline then migrations-common/, compared on the columns of the core
 * entities. Every difference must be named in schema-parity.allow.ts with
 * its reason.
 *
 *   GM_SCHEMA_PARITY_LIVE=1 \
 *   GM_SCHEMA_PARITY_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *   GM_SCHEMA_PARITY_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *   pnpm exec jest --ci --runInBand --testPathPatterns=schema-parity.live
 */
const describeLive =
  process.env.GM_SCHEMA_PARITY_LIVE === '1' ? describe : describe.skip;

/** The columns of the core entities by table, as the metadata snapshot lists them. */
function coreColumns(): Map<string, Set<string>> {
  const snapshot = JSON.parse(
    readFileSync(
      join(__dirname, '__snapshots__', 'entity-metadata.mysql.json'),
      'utf8',
    ),
  ) as { columns: Array<{ table: string; column: string }> };
  const byTable = new Map<string, Set<string>>();
  for (const { table, column } of snapshot.columns) {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(column);
  }
  return byTable;
}

describeLive('global-management schema parity', () => {
  let mysqlDb: LiveDatabase;
  let pgDb: LiveDatabase;
  const columns = coreColumns();
  const tables = [...columns.keys()].sort();

  beforeAll(async () => {
    mysqlDb = await createLiveDatabase({
      prefix: 'gm_parity',
      envPrefix: 'GM_SCHEMA_PARITY',
      entities: [],
      dialect: 'mysql',
    });
    pgDb = await createLiveDatabase({
      prefix: 'gm_parity',
      envPrefix: 'GM_SCHEMA_PARITY',
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
        restrictToColumns(
          await readSchema(mysqlRunner, 'mysql', tables),
          columns,
        ),
        restrictToColumns(
          await readSchema(pgRunner, 'postgres', tables),
          columns,
        ),
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
});
