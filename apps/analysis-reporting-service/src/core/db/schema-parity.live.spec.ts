import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffSchemas, readSchema } from '@cybedefend/db-dialect';
import type { Dialect, NormalisedSchema } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from './live-database';
import { SCHEMA_PARITY_ALLOW } from './schema-parity.allow';

/**
 * Schema parity: one empty MySQL database built by the frozen
 * MySQL track then migrations-common/, one empty PostgreSQL database built by
 * the baseline then migrations-common/, compared on the tables of the core
 * entities. Every difference must be named in schema-parity.allow.ts with
 * its reason.
 *
 *   AR_SCHEMA_PARITY_LIVE=1 \
 *   AR_SCHEMA_PARITY_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *   AR_SCHEMA_PARITY_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *   pnpm exec jest --ci --runInBand --testPathPatterns=schema-parity.live
 */
const describeLive =
  process.env.AR_SCHEMA_PARITY_LIVE === '1' ? describe : describe.skip;

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

/** The six detection tables whose findings are unique per fingerprint. */
const FINGERPRINT_TABLES = [
  'vulnerability_detections_sast',
  'vulnerability_detections_iac',
  'vulnerability_detections_secret',
  'vulnerability_detections_cicd',
  'vulnerability_detections_sca',
  'vulnerability_detections_container',
];

/** The four detection tables whose `updateAt` moves on every UPDATE. */
const UPDATED_AT_TABLES = [
  'vulnerability_detections_sast',
  'vulnerability_detections_iac',
  'vulnerability_detections_secret',
  'vulnerability_detections_cicd',
];

const hasKey = (keys: string[][], columns: string[]) =>
  keys.some((k) => k.join(',') === columns.join(','));

describeLive('analysis-reporting schema parity', () => {
  let mysqlDb: LiveDatabase;
  let pgDb: LiveDatabase;
  const tables = coreTables();

  beforeAll(async () => {
    mysqlDb = await createLiveDatabase({
      prefix: 'ar_parity',
      envPrefix: 'AR_SCHEMA_PARITY',
      entities: [],
      dialect: 'mysql',
    });
    pgDb = await createLiveDatabase({
      prefix: 'ar_parity',
      envPrefix: 'AR_SCHEMA_PARITY',
      entities: [],
      dialect: 'postgres',
    });
  }, 600_000);

  afterAll(async () => {
    await mysqlDb?.drop();
    await pgDb?.drop();
  });

  async function schemas(): Promise<Record<Dialect, NormalisedSchema>> {
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

  async function diff() {
    const s = await schemas();
    return diffSchemas(s.mysql, s.postgres, SCHEMA_PARITY_ALLOW);
  }

  it('both tracks build the same core schema', async () => {
    expect(tables.length).toBe(32);
    expect((await diff()).differences).toEqual([]);
  });

  it('every allowance is still needed', async () => {
    expect((await diff()).unusedAllowances).toEqual([]);
  });

  it('the six (projectId, branch, fingerprint) uniques exist on both engines', async () => {
    const s = await schemas();
    for (const dialect of ['mysql', 'postgres'] as const) {
      for (const table of FINGERPRINT_TABLES) {
        expect([
          dialect,
          table,
          hasKey(s[dialect][table].uniques, [
            'projectId',
            'branch',
            'fingerprint',
          ]),
        ]).toEqual([dialect, table, true]);
      }
    }
  });

  it('(scanner, ruleId) is unique on both engines', async () => {
    const s = await schemas();
    for (const dialect of ['mysql', 'postgres'] as const) {
      expect([
        dialect,
        hasKey(s[dialect].correspondance_table.uniques, ['scanner', 'ruleId']),
      ]).toEqual([dialect, true]);
    }
  });

  it('the four detection updatedAt columns move on UPDATE on both engines', async () => {
    for (const db of [mysqlDb, pgDb]) {
      const q = (name: string) =>
        db.dialect === 'postgres' ? `"${name}"` : `\`${name}\``;
      const p = (n: number) => (db.dialect === 'postgres' ? `$${n}` : '?');
      for (const table of UPDATED_AT_TABLES) {
        const id = `00000000-0000-4000-8000-${String(UPDATED_AT_TABLES.indexOf(table)).padStart(12, '0')}`;
        const columns = [
          'id',
          'projectId',
          'currentPriority',
          'currentSeverity',
          'currentState',
          'language',
          'path',
          'scannerType',
          'vulnerableStartLine',
          'vulnerableEndLine',
          'updateAt',
        ];
        const values = [
          id,
          'project-1',
          'medium',
          'medium',
          'to_verify',
          'python',
          'app.py',
          'sast',
          1,
          1,
          '2020-01-01 00:00:00',
        ];
        await db.dataSource.query(
          `INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES (${values.map((_, i) => p(i + 1)).join(', ')})`,
          values,
        );
        await db.dataSource.query(
          `UPDATE ${q(table)} SET ${q('currentState')} = ${p(1)} WHERE ${q('id')} = ${p(2)}`,
          ['resolved', id],
        );
        const rows: Array<{ updateAt: Date | string }> =
          await db.dataSource.query(
            `SELECT ${q('updateAt')} AS ${q('updateAt')} FROM ${q(table)} WHERE ${q('id')} = ${p(1)}`,
            [id],
          );
        const moved = new Date(rows[0].updateAt).getUTCFullYear() > 2020;
        expect([db.dialect, table, moved]).toEqual([db.dialect, table, true]);
      }
    }
  });
});
