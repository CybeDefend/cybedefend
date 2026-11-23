import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diffSchemas,
  readSchema,
  type NormalisedSchema,
} from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from './live-database';
import { SCHEMA_PARITY_ALLOW } from './schema-parity.allow';

/**
 * Schema parity: one empty MySQL database built by the frozen
 * MySQL track then migrations-common/, one empty PostgreSQL database built by
 * the baseline then migrations-common/, compared on the tables of the core
 * entities. Every difference must be named in schema-parity.allow.ts with
 * its reason.
 *
 *   SS_SCHEMA_PARITY_LIVE=1 \
 *   SS_SCHEMA_PARITY_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *   SS_SCHEMA_PARITY_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *   pnpm exec jest --ci --runInBand --testPathPatterns=schema-parity.live
 */
const describeLive =
  process.env.SS_SCHEMA_PARITY_LIVE === '1' ? describe : describe.skip;

/** The tables of the core entities, as the metadata snapshot lists them. */
function coreTables(): string[] {
  const snapshot = JSON.parse(
    readFileSync(
      join(__dirname, '__snapshots__', 'entity-metadata.mysql.json'),
      'utf8',
    ),
  ) as { columns: Array<{ table: string }> };
  return [...new Set(snapshot.columns.map((c) => c.table))].sort();
}

describeLive('security-scanning schema parity', () => {
  let mysqlDb: LiveDatabase;
  let pgDb: LiveDatabase;
  const tables = coreTables();

  beforeAll(async () => {
    // No entity is loaded: the two engines are opened in one process, and the
    // decorators were applied for DB_TYPE only (the helper skips its dialect
    // check for an empty entity list).
    mysqlDb = await createLiveDatabase({
      prefix: 'ss_parity',
      envPrefix: 'SS_SCHEMA_PARITY',
      entities: [],
      dialect: 'mysql',
    });
    pgDb = await createLiveDatabase({
      prefix: 'ss_parity',
      envPrefix: 'SS_SCHEMA_PARITY',
      entities: [],
      dialect: 'postgres',
    });
  }, 300_000);

  afterAll(async () => {
    await mysqlDb?.drop();
    await pgDb?.drop();
  });

  async function readBoth(): Promise<{
    mysql: NormalisedSchema;
    postgres: NormalisedSchema;
  }> {
    const mysqlRunner = mysqlDb.dataSource.createQueryRunner();
    const pgRunner = pgDb.dataSource.createQueryRunner();
    try {
      return {
        mysql: await readSchema(mysqlRunner, 'mysql', tables),
        postgres: await readSchema(pgRunner, 'postgres', tables),
      };
    } finally {
      await mysqlRunner.release();
      await pgRunner.release();
    }
  }

  it('both tracks build the same core schema', async () => {
    expect(tables.length).toBeGreaterThan(0);
    const { mysql, postgres } = await readBoth();
    expect(
      diffSchemas(mysql, postgres, SCHEMA_PARITY_ALLOW).differences,
    ).toEqual([]);
  });

  it('every allowance is still needed', async () => {
    const { mysql, postgres } = await readBoth();
    expect(
      diffSchemas(mysql, postgres, SCHEMA_PARITY_ALLOW).unusedAllowances,
    ).toEqual([]);
  });

  it('the scannerType enum has the same values on both engines', async () => {
    const { mysql, postgres } = await readBoth();
    const mysqlEnum = mysql.scanner.columns.scannerType.type;
    const pgEnum = postgres.scanner.columns.scannerType.type;
    expect(pgEnum).toBe(mysqlEnum);
    expect(pgEnum).toContain('aibom');
    // scan.scanType is a plain varchar on both engines.
    expect(postgres.scan.columns.scanType.type).toBe(
      mysql.scan.columns.scanType.type,
    );
  });
});
